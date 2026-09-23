export type ParsedMapsUrl = {
  nameHint?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  cid?: string;
  query?: string;
};

const SHORT_HOSTS = ["maps.app.goo.gl", "goo.gl", "g.co"];

export function isMapsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    return (
      SHORT_HOSTS.includes(host) ||
      host.endsWith("google.com") ||
      host.startsWith("maps.google.")
    );
  } catch {
    return false;
  }
}

function isShortLink(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    return SHORT_HOSTS.includes(host);
  } catch {
    return false;
  }
}

/** Follows Google short links (maps.app.goo.gl) to the full maps URL. */
export async function resolveMapsUrl(raw: string, maxHops = 3): Promise<string> {
  let current = raw;
  for (let hop = 0; hop < maxHops && isShortLink(current); hop++) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; TecAceVoiceDemo/1.0)" },
      });
    } catch {
      return current;
    }
    const location = response.headers.get("location");
    if (!location) return current;
    current = new URL(location, current).toString();
  }
  return current;
}

function decodePlaceName(segment: string): string {
  return decodeURIComponent(segment.replace(/\+/g, " ")).trim();
}

export function parseMapsUrl(raw: string): ParsedMapsUrl {
  const parsed: ParsedMapsUrl = {};
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return parsed;
  }

  const placeMatch = url.pathname.match(/\/maps\/place\/([^/@]+)/);
  if (placeMatch) {
    const name = decodePlaceName(placeMatch[1]!);
    if (name && !/^@/.test(name)) parsed.nameHint = name;
  }

  const atMatch = raw.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    parsed.lat = Number(atMatch[1]);
    parsed.lng = Number(atMatch[2]);
  }

  const q = url.searchParams.get("q") || url.searchParams.get("query");
  if (q) {
    const coords = q.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/);
    if (coords) {
      parsed.lat ??= Number(coords[1]);
      parsed.lng ??= Number(coords[2]);
    } else {
      parsed.query = decodePlaceName(q);
      parsed.nameHint ??= parsed.query;
    }
  }

  const placeId =
    url.searchParams.get("place_id") || url.searchParams.get("query_place_id");
  if (placeId) parsed.placeId = placeId;

  const cid = url.searchParams.get("cid");
  if (cid) parsed.cid = cid;

  const dataPlaceId = raw.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (dataPlaceId) parsed.cid ??= dataPlaceId[1];

  return parsed;
}

/** Short human label used while research is still running. */
export function fallbackName(parsed: ParsedMapsUrl, raw: string): string {
  if (parsed.nameHint) return parsed.nameHint;
  if (parsed.query) return parsed.query;
  try {
    return new URL(raw).hostname;
  } catch {
    return "Unknown business";
  }
}
