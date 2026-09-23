import { ClaudeCliError, extractJson } from "./callReview.js";
import { runResearchPrompt } from "./researchRunner.js";
import { parseMapsUrl, resolveMapsUrl } from "./maps.js";
import type { BusinessProfile, ResearchInputs, ResearchSource } from "./types.js";

const PROFILE_SHAPE = `{
  "name": string,
  "category": string,
  "address": string,
  "phone": string | null,
  "website": string | null,
  "hours": [{ "day": string, "open": string, "close": string, "closed": boolean }],
  "services": [{ "name": string, "price": string | null, "description": string | null }],
  "highlights": [string],
  "policies": {
    "reservations": string | null,
    "walkIns": string | null,
    "parking": string | null,
    "payment": string | null,
    "cancellation": string | null,
    "other": [string]
  },
  "faqs": [{ "q": string, "a": string }],
  "rating": number | null,
  "reviewSummary": string | null,
  "sources": [{ "url": string, "title": string }]
}`;

export type ResearchResult = {
  /** The name actually researched, which can differ from the one passed in. */
  businessName: string;
  profile: BusinessProfile;
  dossier: string;
  sources: ResearchSource[];
  resolvedMapsUrl?: string;
  costUsd?: number;
};

function stripEmpties<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripEmpties(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === null || item === "" || item === "unknown") continue;
      out[key] = stripEmpties(item);
    }
    return out as T;
  }
  return value;
}

/** The links and notes the operator supplied, as prompt lines. */
function referenceLines(inputs: ResearchInputs, resolvedMapsUrl?: string): string[] {
  const lines: string[] = [];
  if (inputs.websiteUrl) lines.push(`- Website (operator supplied): ${inputs.websiteUrl}`);
  const maps = resolvedMapsUrl ?? inputs.mapsUrl;
  if (maps) {
    lines.push(`- Google Maps listing (one reference, not the whole story): ${maps}`);
    const placeName = parseMapsUrl(maps).nameHint;
    if (placeName) lines.push(`- Name on that listing: ${placeName}`);
  }
  if (inputs.notes) lines.push(`- Notes from the operator: ${inputs.notes}`);
  return lines;
}

/** A name that is really just a host, left over from a link-only record. */
function looksLikeHost(name: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name.trim());
}

export function buildDossierPrompt(
  inputs: ResearchInputs,
  resolvedMapsUrl?: string,
): string {
  const references = referenceLines(inputs, resolvedMapsUrl);
  return [
    `Research the business "${inputs.businessName}" so an AI phone receptionist can answer its calls.`,
    "",
    references.length
      ? ["References to start from:", ...references].join("\n")
      : "No links were supplied. Search for the business by name.",
    "",
    "Search the web and read the pages that matter: the official site, the Google Maps or Yelp listing, booking pages, menus, and recent reviews.",
    "",
    "Write a markdown briefing with these sections:",
    "1. Identity: exact business name, what it does, full address, phone number, website.",
    "2. Hours for every day of the week, including holiday or seasonal notes.",
    "3. Services or menu with prices where published, and what it is best known for.",
    "4. Policies: reservations, walk-ins, parking, payment methods, cancellation, accessibility.",
    "5. The questions callers most often ask a business like this, each with the answer for this one.",
    "6. Rating and the recurring themes in recent reviews.",
    "7. Sources: every URL you used, one per line.",
    "",
    "Reply with the briefing itself. No preamble, no summary of what you did, no offer to continue.",
    "",
    "Rules: report only what the sources say. Write `unknown` where you cannot verify something. Never invent hours, prices, or phone numbers. If several businesses share the name, use the supplied links to pick the right one and say which you chose.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildProfilePrompt(businessName: string, dossier: string): string {
  return [
    "Convert this research briefing into JSON.",
    "",
    `Business name: ${businessName}`,
    "",
    "Reply with ONLY a JSON object of this shape, no prose and no markdown fence:",
    PROFILE_SHAPE,
    "",
    "Copy facts only from the briefing. Use null or an empty array where the briefing says unknown. Do not add facts. Times use 24-hour HH:MM. A closed day sets closed to true.",
    "",
    "Briefing:",
    dossier,
  ].join("\n");
}

type RawProfile = BusinessProfile & { sources?: ResearchSource[] };

export async function researchBusiness(inputs: ResearchInputs): Promise<ResearchResult> {
  const resolvedMapsUrl = inputs.mapsUrl
    ? await resolveMapsUrl(inputs.mapsUrl)
    : undefined;

  let businessName = inputs.businessName.trim();
  // A record that only ever had a link carries a hostname as its name. The
  // resolved listing knows the real one.
  if ((!businessName || looksLikeHost(businessName)) && resolvedMapsUrl) {
    businessName = parseMapsUrl(resolvedMapsUrl).nameHint ?? businessName;
  }
  if (!businessName) {
    throw new ClaudeCliError("A business name is required to research.");
  }

  const dossierRun = await runResearchPrompt(
    buildDossierPrompt({ ...inputs, businessName }, resolvedMapsUrl),
    { withSearch: true },
  );

  if (!dossierRun.text) {
    throw new ClaudeCliError("The research run came back empty.");
  }

  const profileRun = await runResearchPrompt(
    buildProfilePrompt(businessName, dossierRun.text),
    { withSearch: false },
  );

  const parsed = extractJson(profileRun.text) as RawProfile;
  const profile = stripEmpties(parsed);

  // What the provider says it read comes first: it knows, where the briefing
  // only shows what the model chose to write down.
  const sources = dedupeSources([
    ...(dossierRun.citations ?? []),
    ...(parsed.sources ?? []),
    ...urlsInText(dossierRun.text),
  ]);

  const result: BusinessProfile = {
    ...profile,
    name: profile.name || businessName,
    category: profile.category || "",
    address: profile.address || "",
    hours: profile.hours ?? [],
    services: profile.services ?? [],
    highlights: profile.highlights ?? [],
    policies: profile.policies ?? {},
    faqs: profile.faqs ?? [],
  };
  delete (result as RawProfile).sources;

  if (resolvedMapsUrl) {
    const coords = parseMapsUrl(resolvedMapsUrl);
    if (coords.lat !== undefined) result.lat = coords.lat;
    if (coords.lng !== undefined) result.lng = coords.lng;
  }
  if (!result.website && inputs.websiteUrl) result.website = inputs.websiteUrl;

  return {
    businessName,
    profile: result,
    dossier: dossierRun.text,
    sources,
    resolvedMapsUrl,
    costUsd: (dossierRun.costUsd ?? 0) + (profileRun.costUsd ?? 0),
  };
}

/**
 * Tracking that a search tool bolted on. The Sources panel is shown to the
 * business itself, so the links there should look like links they could have
 * sent us themselves.
 */
const TRACKING_PARAMS = /^(utm_|ref$|referrer$|fbclid$|gclid$|msclkid$|_ga$)/i;

/** A results page is how the model got somewhere, not a source for anything. */
const SEARCH_PAGES = [
  /^(www\.)?google\.[a-z.]+$/i,
  /^(www\.)?bing\.com$/i,
  /^(www\.)?duckduckgo\.com$/i,
  /^search\./i,
];

export function cleanSourceUrl(raw: string): string | null {
  const trimmed = raw.replace(/[.,;]+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }

  const isSearchHost = SEARCH_PAGES.some((pattern) => pattern.test(url.hostname));
  if (isSearchHost && !/^\/maps\/place\//.test(url.pathname)) return null;

  const text = url.toString().replace(/\?$/, "");
  // A bare domain reads better without the slash the URL parser adds.
  return url.pathname === "/" && !url.search && !url.hash
    ? text.replace(/\/$/, "")
    : text;
}

export function urlsInText(text: string): ResearchSource[] {
  const matches = text.match(/https?:\/\/[^\s)<>\]"']+/g) ?? [];
  const out: ResearchSource[] = [];
  for (const match of matches) {
    const url = cleanSourceUrl(match);
    if (!url) continue;
    let title = url;
    try {
      title = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      // Keep the cleaned URL as the title.
    }
    out.push({ url, title });
  }
  return out;
}

export function dedupeSources(sources: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>();
  const out: ResearchSource[] = [];
  for (const source of sources) {
    const url = source?.url ? cleanSourceUrl(source.url) : null;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: source.title || url });
  }
  return out.slice(0, 25);
}

export function emptyProfile(name: string): BusinessProfile {
  return {
    name,
    category: "",
    address: "",
    hours: [],
    services: [],
    highlights: [],
    policies: {},
    faqs: [],
  };
}
