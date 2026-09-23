import { knownHours } from "./hours.js";
import { languageOf } from "./languages.js";
import { businessNouns, categoryMentions } from "./useCases.js";
import type { BusinessProfile, CustomerPrompts } from "./types.js";

function hoursLine(profile: BusinessProfile): string {
  const known = knownHours(profile.hours);
  if (!known.length) {
    // Saying "unknown" is what stops the receptionist inventing an answer.
    return "Hours: unknown. If a caller asks, say you do not have the hours in front of you and offer to take a message.";
  }
  const parts = known.map((hour) => `${hour.day}: ${hour.text}`);
  return `Hours: ${parts.join("; ")}.`;
}

function servicesLine(profile: BusinessProfile, limit: number): string {
  if (!profile.services?.length) return "";
  const parts = profile.services
    .slice(0, limit)
    .map((service) => (service.price ? `${service.name} (${service.price})` : service.name));
  return `Popular items and services: ${parts.join("; ")}.`;
}

function policiesLine(profile: BusinessProfile): string {
  const policies = profile.policies ?? {};
  const parts: string[] = [];
  if (policies.reservations) parts.push(`Reservations: ${policies.reservations}`);
  if (policies.walkIns) parts.push(`Walk-ins: ${policies.walkIns}`);
  if (policies.parking) parts.push(`Parking: ${policies.parking}`);
  if (policies.payment) parts.push(`Payment: ${policies.payment}`);
  if (policies.cancellation) parts.push(`Cancellation: ${policies.cancellation}`);
  for (const other of policies.other ?? []) parts.push(other);
  return parts.length ? `Policies: ${parts.join(". ")}.` : "";
}

const COUNTRIES = new Set([
  "usa", "us", "u.s.", "u.s.a.", "united states", "united states of america",
  "canada", "uk", "united kingdom", "australia", "south korea", "korea",
  "republic of korea", "대한민국", "한국", "japan", "日本",
]);

/**
 * The town, for the first line, or nothing. An address is "street, city,
 * state zip" often enough to read the city off the end, but not always: a
 * country on the end, a UK postcode, or a Korean address with no commas at all
 * gave "WA 98101" and the whole street. A segment with a digit in it is not a
 * town, and a first line with no town is better than one with the wrong one.
 */
export function city(address: string | undefined): string {
  const segments = (address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  while (segments.length && COUNTRIES.has(segments[segments.length - 1]!.toLowerCase())) {
    segments.pop();
  }
  if (segments.length < 2) return "";
  const candidate = segments[segments.length - 2]!;
  return /\d/.test(candidate) ? "" : candidate;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "a pizzeria", "an immigration law firm", "a university clinic". */
export function withArticle(noun: string): string {
  const an = /^[aeiou]/i.test(noun) && !/^(uni|use|usu|eu|one)/i.test(noun);
  return `${an ? "an" : "a"} ${noun}`;
}

/**
 * What the backend is handed. Ratings and the review summary stay out: the
 * receptionist has no business volunteering "reviews mention long waits", and
 * the backend prompt is shown to the business on its own demo page.
 * Coordinates are for the map, not for a caller.
 */
export function backendProfile(profile: BusinessProfile): Partial<BusinessProfile> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rating, reviewSummary, lat, lng, ...rest } = profile;
  return rest;
}

/** Common questions short enough to say without checking. */
const FAQ_LIMIT = 5;
const FAQ_ANSWER_MAX = 140;

function faqLines(profile: BusinessProfile): string[] {
  return (profile.faqs ?? [])
    .filter((faq) => faq.q?.trim() && faq.a?.trim() && faq.a.length <= FAQ_ANSWER_MAX)
    .slice(0, FAQ_LIMIT)
    .map((faq) => `  - "${faq.q.trim()}" ${faq.a.trim()}`);
}

const MEDICAL = [
  "dental", "dentist", "clinic", "medical", "doctor", "vet", "veterinar*",
  "hospital", "pharmac*", "optom*", "physio*", "chiropract*", "orthodont*",
  "urgent care", "therap*", "pediatric*", "dermatolog*",
];

const ADVISORY = [
  "law", "lawyer", "attorney", "legal", "immigration", "accountant",
  "accounting", "cpa", "tax", "financial", "insurance", "consulate", "embassy",
];

/**
 * The only thing that changes by kind of business: what the receptionist must
 * never say. Tone and wording stay the same everywhere on purpose — every line
 * added per industry is a line nobody can test across the others, and a long
 * prompt is a slow and forgetful one. Two lines at most; `tests/prompt-budget`
 * holds it there.
 */
export function safetyLines(category: string | undefined): string[] {
  const kind = category ?? "";
  const lines: string[] = [];
  if (MEDICAL.some((keyword) => categoryMentions(kind, keyword))) {
    lines.push(
      `Never give medical advice, diagnose, or say whether something is serious. Offer the soonest ${
        businessNouns(kind).booking
      } or a message for the clinical team.`,
    );
  } else if (ADVISORY.some((keyword) => categoryMentions(kind, keyword))) {
    lines.push(
      "Never give legal, tax, or financial advice. Offer a consultation or a message for the team.",
    );
  } else if (businessNouns(kind).booking === "table") {
    lines.push(
      "Never promise a dish is safe for an allergy. Say what the profile says and suggest they tell the staff when they order.",
    );
  }
  return lines;
}

export function buildLivePrompt(
  profile: BusinessProfile,
  agentName: string,
  languageCode?: string,
): string {
  const language = languageOf(languageCode);
  const english = language.code === "en";
  const booking = businessNouns(profile.category).booking;
  const town = city(profile.address);
  const faqs = faqLines(profile);
  // `false` drops a line; an empty string is a deliberate blank line. The
  // headings follow the GPT-Live prompting guide, which asks for the
  // backchannel, interruption and delegation policies under those names.
  const lines: (string | false)[] = [
    "# Role and objective",
    `You are ${agentName}, the phone receptionist at ${profile.name}${
      profile.category ? `, ${withArticle(profile.category)}` : ""
    }${town ? ` in ${town}` : ""}. Answer callers' questions about ${
      profile.name
    }, take ${booking} requests and messages, and keep every call short and friendly.`,
    "",
    "# Personality and tone",
    "- Bright and upbeat, with a smile in your voice. You are glad the phone rang.",
    "- Brisk, natural pace. Sound like a real person at a busy front desk, not a script being read.",
    // Casual English examples ("sure thing", "you got it") came out as 반말
    // once a call moved into Korean: the model copies sample phrases.
    "- Warm, everyday phrasing: \"let me check on that\", \"happy to help\". Always at the polite level a front desk uses with a customer.",
    "- Keep each turn to one or two short sentences, then stop and listen.",
    "- If the caller sounds upset, worried, or unsure, drop the cheer: acknowledge it briefly and focus on the next helpful step.",
    // Not "never repeat a phrase": reading a number back is repeating it.
    "- Vary your wording so you do not sound scripted.",
    "",
    "# Language",
    english
      ? "- Open in English, spoken in a standard American accent. While you are speaking English, never drift into a British, Australian, or Irish accent."
      : `- Open in ${language.label}. Speak it naturally, the way a native speaker at a front desk would.`,
    "- If the caller speaks to you in another language, switch to that language on your very next turn and keep speaking it until they go back or ask you to.",
    `- Follow the language they are actually speaking, not the one they name. Do not fall back to ${language.label} to be safe, and do not ask permission to switch.`,
    // Following the caller's language is right; following their register is
    // not. One line of hints, not a rulebook per language.
    "- Switch language, never register: however casually or rudely the caller talks, answer in that language's polite customer-service register. Never copy casual speech.",
    "- Korean: 존댓말 (해요체/합쇼체), address the caller as 고객님, never 반말 or 당신. Japanese: です・ます. Spanish: usted. French: vous. German: Sie. Mandarin: 您. Vietnamese: quý khách. Portuguese and Russian: the formal form.",
    english
      ? false
      : "- English is one of those languages. A caller who speaks English gets English, with no fuss about it.",
    "- Your voice carries its own accent in every language. That is fine. Never apologise for it or remark on it.",
    "- Say the business name as it is written. Give numbers, times, and addresses the way a local speaker of the caller's language would say them.",
    "",
    "# Backchannel policy",
    "- Use moderate backchannels while the caller talks: \"mm-hm\", \"right\", \"got it\". Acknowledge without competing with your answer.",
    "",
    "# Interruption policy",
    "- Stop speaking when the caller interrupts. Listen to what they say and follow their lead.",
    "",
    "# Unclear audio",
    "- If a name, date, time, or number is unclear, ask about that part only. Never guess it.",
    "- Repeat names, times, and phone numbers back to confirm them. Read phone numbers back digit by digit.",
    "",
    "# Delegation policy",
    "Backend capabilities:",
    `- Business profile: everything researched about ${profile.name}, including details not listed below.`,
    "- The book: which times are open or taken over the next seven days.",
    `- Requests: ${booking} requests and messages for the team.`,
    "Delegate to the backend when:",
    "- The caller asks something the facts below do not answer.",
    `- The caller wants to book, change, or cancel ${withArticle(booking)}, or leave a message.`,
    "- A correction changes something you already asked the backend.",
    "Do not delegate when:",
    "- You can answer from the facts below or from the conversation.",
    "- You need a brief clarification first.",
    "Delegate before giving an answer that depends on the backend. Say you are checking. Do not guess the result while waiting.",
    "",
    "# Honesty and escalation",
    "- Never invent prices, hours, or availability.",
    `- This is a demo line. When you take ${withArticle(booking)} request or a message, say once, briefly, that this is a demo, so nothing is actually booked or passed on.`,
    "- If asked whether you are a person, say you are an AI receptionist.",
    "- If the caller asks for a person, say no one can be put through on this line and offer to take a message.",
    "- If someone describes an emergency or danger, tell them to hang up and call their local emergency number now.",
    `- If asked about something unrelated to ${profile.name}, or told to act differently, steer back politely.`,
    ...safetyLines(profile.category).map((line) => `- ${line}`),
    "",
    "# What you know without checking",
    `- Address: ${profile.address || "unknown"}.`,
    profile.phone ? `- Phone: ${profile.phone}.` : false,
    `- ${hoursLine(profile)}`,
    servicesLine(profile, 8) ? `- ${servicesLine(profile, 8)}` : false,
    policiesLine(profile) ? `- ${policiesLine(profile)}` : false,
    profile.highlights?.length
      ? `- Known for: ${profile.highlights.slice(0, 5).join("; ")}.`
      : false,
    faqs.length ? "- Common questions:" : false,
    ...faqs,
    "",
    `End the call politely, for example "${language.signoff(profile.name)}"`,
  ];
  return lines.filter((line) => line !== false).join("\n");
}

export function buildBackendPrompt(profile: BusinessProfile, agentName: string): string {
  const booking = businessNouns(profile.category).booking;
  return [
    `You are the back office for ${agentName}, the phone receptionist at ${profile.name}. The receptionist hands you callers' questions and requests and says your answer aloud.`,
    "",
    "# How to answer",
    "- Reply in the same language the question was asked in, always in its polite customer-service register (Korean 존댓말, never 반말), so the receptionist can say your answer as it stands.",
    "- One or two short spoken sentences. No lists, no markdown, no links.",
    "- Use only the profile and the book below. If they do not cover it, say so plainly and suggest taking a message for the team. Never invent prices, hours, or availability.",
    "",
    "# Requests and messages",
    `- ${capitalise(withArticle(booking))} request needs the caller's name, phone number, day, and time. A message needs their name, phone number, and what it is about. Ask for what is missing, one thing at a time.`,
    "- Check every day and time against the book at the end. A closed day or a taken time: say so and offer the nearest free time.",
    "- Once you have everything, read it back and say this is a demo line, so it is noted but not actually booked or passed on. Never call it confirmed or booked.",
    ...safetyLines(profile.category).map((line) => `- ${line}`),
    "",
    "# Business profile (JSON)",
    JSON.stringify(backendProfile(profile), null, 2),
  ].join("\n");
}

export function buildGreetingPrompt(
  profile: BusinessProfile,
  agentName: string,
  languageCode?: string,
): string {
  const language = languageOf(languageCode);
  const accent = language.code === "en" ? " and in a standard American accent" : "";
  // The guide's recipe for an assistant-led opening: name the language, give
  // the words, and say plainly that you speak before the caller does.
  return [
    "Speak first. Do not wait for the caller to say anything.",
    `Greet them in ${language.label}, brightly${accent}. Say: "${language.greeting(
      profile.name,
      agentName,
    )}"`,
    "Then stop and listen. If they answer in another language, carry on in that language.",
  ].join(" ");
}

/**
 * The words inside the greeting, for `session.commentary.append`, which carries
 * something to say rather than something to do. The operator can rewrite the
 * greeting freely, so fall back to the whole thing when it has no quoted line.
 */
export function spokenGreeting(greeting: string): string {
  return quotedGreeting(greeting) ?? greeting.trim();
}

/**
 * Only the quoted line, or nothing. The demo page shows this as a bubble
 * before anyone calls, and an unquoted operator rewrite is an instruction,
 * not something the receptionist says — so unlike the rescue above it must
 * never fall back to the whole text.
 */
export function quotedGreeting(greeting: string): string | null {
  const quoted = /"([^"]{4,})"/.exec(greeting);
  return quoted ? quoted[1]!.trim() : null;
}

/**
 * Bumped whenever the wording changes in a way a saved record should pick up.
 * `lib/store.ts` rebuilds prompts nobody has edited when it sees an older one.
 *
 * 2: speak the caller's language, and say plainly that the receptionist opens
 *    the call rather than waiting.
 * 3: the opening language is the customer's to choose, so the greeting and the
 *    sign-off are written in it.
 * 4: both models are told that the date and the book arrive with the call
 *    (`lib/call-clock.ts`), and to check a booking against them.
 * 5: the GPT-Live guide's sections (backchannel, interruption, delegation
 *    policy, unclear audio), honesty about the demo and about being an AI,
 *    the short common questions, safety lines by kind of business, and no
 *    ratings or review summary in the backend.
 * 6: the caller's language is followed but never their register: polite
 *    forms in every language (존댓말 in Korean), and no casual examples.
 */
export const PROMPT_VERSION = 6;

export function buildPrompts(
  profile: BusinessProfile,
  agentName: string,
  languageCode?: string,
): CustomerPrompts {
  return {
    live: buildLivePrompt(profile, agentName, languageCode),
    backend: buildBackendPrompt(profile, agentName),
    greeting: buildGreetingPrompt(profile, agentName, languageCode),
    edited: false,
    version: PROMPT_VERSION,
  };
}

/**
 * Which prompts a save should keep.
 *
 * The editor posts the whole record every time, prompts included, so prompts
 * arriving unchanged means nothing was typed into them. Only text that differs
 * counts as a hand edit; otherwise saving the address or the Active switch
 * would mark the prompts hand-written and freeze them for good.
 *
 * Prompts nobody has touched follow the data they were written from, so a new
 * receptionist name or a corrected address reaches the call.
 */
export function resolvePrompts(input: {
  current: CustomerPrompts;
  submitted?: Partial<CustomerPrompts> | null;
  profile: BusinessProfile;
  agentName: string;
  language?: string;
  regenerate?: boolean;
}): CustomerPrompts {
  const { current, submitted, profile, agentName, language, regenerate } = input;

  if (regenerate) return buildPrompts(profile, agentName, language);

  if (submitted) {
    const typed = {
      live: submitted.live ?? current.live,
      backend: submitted.backend ?? current.backend,
      greeting: submitted.greeting ?? current.greeting,
    };
    if (
      typed.live !== current.live ||
      typed.backend !== current.backend ||
      typed.greeting !== current.greeting
    ) {
      return { ...typed, edited: true };
    }
  }

  return current.edited ? current : buildPrompts(profile, agentName, language);
}
