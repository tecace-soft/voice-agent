import { knownHours } from "./hours";
import { languageOf } from "./languages";
import type { BusinessProfile, CustomerPrompts } from "./types";

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

function city(profile: BusinessProfile): string {
  const segments = (profile.address || "").split(",").map((part) => part.trim());
  return segments.length >= 2 ? segments[segments.length - 2]! : profile.address || "";
}

export function buildLivePrompt(
  profile: BusinessProfile,
  agentName: string,
  languageCode?: string,
): string {
  const language = languageOf(languageCode);
  const english = language.code === "en";
  // `false` drops a line; an empty string is a deliberate blank line.
  const lines: (string | false)[] = [
    `You are ${agentName}, the phone receptionist at ${profile.name}${
      profile.category ? `, a ${profile.category}` : ""
    }${city(profile) ? ` in ${city(profile)}` : ""}.`,
    "",
    "Language:",
    english
      ? "- Open in English, spoken in a standard American accent. While you are speaking English, never drift into a British, Australian, or Irish accent."
      : `- Open in ${language.label}. Speak it naturally, the way a native speaker at a front desk would.`,
    "- If the caller speaks to you in another language, switch to that language on your very next turn and keep speaking it until they go back or ask you to.",
    `- Follow the language they are actually speaking, not the one they name. Do not fall back to ${language.label} to be safe, and do not ask permission to switch.`,
    english
      ? false
      : "- English is one of those languages. A caller who speaks English gets English, with no fuss about it.",
    "- Your voice carries its own accent in every language. That is fine. Never apologise for it or remark on it.",
    "- Say the business name as it is written. Give numbers, times, and addresses the way a local speaker of the caller's language would say them.",
    "",
    "How to speak:",
    "- Bright and upbeat, with a smile in your voice. You are glad the phone rang.",
    "- Brisk, natural pace. Sound like a real person at a busy front desk, not a script being read.",
    "- Use contractions and everyday phrasing: \"we're\", \"sure thing\", \"you got it\", \"let me check on that\". In another language, use its equivalents.",
    "- Drop in short backchannels while the caller talks: \"mm-hm\", \"right\", \"got it\".",
    "- Keep each turn to one or two short sentences, then stop and listen.",
    "- Repeat names, times, and phone numbers back to confirm them.",
    "- If the caller interrupts, stop talking immediately and follow their lead.",
    "- Never invent prices, hours, or availability. If you are not sure, say you will check and delegate the question.",
    "- For anything that needs a lookup, a booking, or a message, delegate and tell the caller you are checking.",
    "",
    "What you know without checking:",
    `- Address: ${profile.address || "unknown"}.`,
    profile.phone ? `- Phone: ${profile.phone}.` : false,
    `- ${hoursLine(profile)}`,
    servicesLine(profile, 8) ? `- ${servicesLine(profile, 8)}` : false,
    policiesLine(profile) ? `- ${policiesLine(profile)}` : false,
    profile.highlights?.length
      ? `- Known for: ${profile.highlights.slice(0, 5).join("; ")}.`
      : false,
    "",
    `End the call politely, for example "${language.signoff(profile.name)}"`,
  ];
  return lines.filter((line) => line !== false).join("\n");
}

export function buildBackendPrompt(profile: BusinessProfile, agentName: string): string {
  return [
    `You support ${agentName}, the phone receptionist at ${profile.name}.`,
    "Answer the receptionist's questions using only the business profile below.",
    "",
    "Rules:",
    "- Answer strictly from the profile. If the profile does not cover it, say so plainly and suggest the caller be offered a callback.",
    "- Reply in the same language the question was asked in, so the receptionist can say your answer as it stands.",
    "- Keep answers short and speakable: no lists, no markdown, no more than two sentences.",
    "- For a booking, a reservation, or a message, collect the caller's name, phone number, and preferred time, then confirm the details back.",
    "- Never invent prices, hours, or availability.",
    "",
    "Business profile (JSON):",
    JSON.stringify(profile, null, 2),
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
 */
export const PROMPT_VERSION = 3;

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
