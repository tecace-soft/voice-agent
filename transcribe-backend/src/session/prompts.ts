import { knownHours } from "../demo/hours.js";
import { languageOf } from "../demo/languages.js";
import { backendProfile, city, safetyLines, withArticle } from "../demo/prompt.js";
import type { BusinessProfile, CustomerPrompts } from "../demo/types.js";
import { MAX_FIELD_CHARS } from "../business/profileShape.js";

// The two prompts a business can see and edit: who the receptionist is and what it knows.
//
// Deliberately NOT the rules. How a call is triaged, when a person is offered, what may never be
// promised — that is the fixed rule book in callRules.ts, which every call gets and no customer
// edits. Splitting it this way is what lets a customer rewrite their receptionist's personality or
// correct a price in the Advanced box without being able to switch off "never say anything is
// booked". The demo's own builder (demo/prompt.ts) mixes the two and says "this is a demo line";
// it stays exactly as the promo wrote it, for the promo parity check, and is no longer what writes a
// prompt here — only its helpers are borrowed.
//
// The composer (compose.ts) puts these between the rule book and the per-call blocks.

/**
 * Which generation of this builder wrote a stored prompt.
 *
 * The 100s, so a prompt written by the demo's builder (versions 1-6, same `version` field) always
 * reads as older and is rebuilt when nobody edited it. Bump it when the wording changes in a way a
 * saved prompt should pick up.
 *
 * 101: first version — persona, language and knowledge only; rules moved to the rule book.
 */
export const SESSION_PROMPT_VERSION = 101;

/** Who answers when a business hasn't named its receptionist. "You are , the…" is what an empty name did. */
export const DEFAULT_AGENT_NAME = "Tess";

/** Services and FAQs the voice model is handed directly; the backend has the whole profile. */
const VOICE_SERVICES = 12;
const VOICE_FAQS = 20;
// An answer is stored at up to MAX_FIELD_CHARS (300). The FAQs are the answers a business wrote to
// be said as written, so every stored one is handed to the voice; a lower cap here dropped the whole
// question from the voice model without anyone seeing it.
const VOICE_FAQ_ANSWER_MAX = MAX_FIELD_CHARS;

export function agentNameOf(name: string | null | undefined): string {
  return name?.trim() || DEFAULT_AGENT_NAME;
}

function hoursLine(profile: BusinessProfile): string {
  const known = knownHours(profile.hours);
  if (!known.length) {
    return "Hours: not given. If asked, say you don't have the hours in front of you.";
  }
  return `Hours: ${known.map((h) => `${h.day} ${h.text}`).join("; ")}.`;
}

function policyLines(profile: BusinessProfile): string[] {
  const p = profile.policies ?? {};
  const named: [string, string | undefined][] = [
    ["Reservations", p.reservations],
    ["Walk-ins", p.walkIns],
    ["Parking", p.parking],
    ["Payment", p.payment],
    ["Cancellation", p.cancellation],
  ];
  return [
    ...named.filter(([, v]) => v?.trim()).map(([k, v]) => `- ${k}: ${v!.trim()}`),
    ...(p.other ?? []).filter((o) => o?.trim()).map((o) => `- ${o.trim()}`),
  ];
}

/** The voice model's prompt: persona, language, and the facts worth answering without checking. */
export function buildSessionLivePrompt(
  profile: BusinessProfile,
  agentName: string,
  languageCode?: string,
): string {
  const language = languageOf(languageCode);
  const english = language.code === "en";
  const town = city(profile.address);
  const services = (profile.services ?? []).filter((s) => s.name?.trim()).slice(0, VOICE_SERVICES);
  const faqs = (profile.faqs ?? [])
    .filter((f) => f.q?.trim() && f.a?.trim() && f.a.length <= VOICE_FAQ_ANSWER_MAX)
    .slice(0, VOICE_FAQS);
  const policies = policyLines(profile);

  const lines: (string | false)[] = [
    "# Role and objective",
    `You are ${agentNameOf(agentName)}, the phone receptionist at ${profile.name}${
      profile.category ? `, ${withArticle(profile.category)}` : ""
    }${town ? ` in ${town}` : ""}.`,
    "",
    "# Personality and tone",
    "- Warm, calm and upbeat. Sound like a real person at a friendly front desk, not a script.",
    "- Natural pace. One or two short sentences a turn, then listen.",
    "- If the caller sounds upset or worried, drop the cheer: acknowledge it and focus on the next step.",
    "",
    "# Language",
    english
      ? "- Open in English, in a standard American accent, and keep that accent while speaking English."
      : `- Open in ${language.label}, spoken the way a native speaker at a front desk would.`,
    // The caller's language is followed but never their register. Kept from the demo prompt, where
    // casual English samples came out as 반말 once a call moved into Korean.
    "- Whatever language you speak, use its polite customer-service register, however casually the caller talks.",
    "- Korean: 존댓말 (해요체/합쇼체), address the caller as 고객님, never 반말 or 당신. Japanese: です・ます. Spanish: usted. French: vous. German: Sie. Mandarin: 您.",
    "- Your voice keeps its own accent in every language. Never apologise for it or remark on it.",
    "",
    "# What you know about this business",
    `- Name: ${profile.name}.`,
    profile.category ? `- What it is: ${profile.category}.` : false,
    `- Address: ${profile.address || "not given"}.`,
    profile.phone ? `- Phone: ${profile.phone}.` : false,
    profile.website ? `- Website: ${profile.website}.` : false,
    `- ${hoursLine(profile)}`,
    services.length
      ? `- Services: ${services.map((s) => (s.price ? `${s.name} (${s.price})` : s.name)).join("; ")}.`
      : false,
    ...(policies.length ? policies : []),
    profile.highlights?.length ? `- Known for: ${profile.highlights.slice(0, 8).join("; ")}.` : false,
    ...safetyLines(profile.category).map((line) => `- ${line}`),
    faqs.length ? "" : false,
    faqs.length ? "# Common questions" : false,
    ...faqs.map((f) => `- "${f.q.trim()}" ${f.a.trim()}`),
    "",
    "Anything not written here, the back office may know from the full profile: delegate before you answer.",
  ];
  return lines.filter((line) => line !== false).join("\n");
}

/** The delegate model's prompt: the whole profile, to look things up in. */
export function buildSessionBackendPrompt(profile: BusinessProfile, agentName: string): string {
  return [
    `You are the back office for ${agentNameOf(agentName)}, the phone receptionist at ${profile.name}. The receptionist hands you callers' questions and requests and says your answer aloud.`,
    "",
    "# How to answer",
    "- Reply in the language the question was asked in, in its polite customer-service register (Korean 존댓말, never 반말), so it can be said as it stands.",
    "- One or two short spoken sentences. No lists, no markdown, no links read out character by character.",
    "- Use only the profile below. If it does not cover the question, say so plainly. Never invent prices, hours, or availability.",
    ...safetyLines(profile.category).map((line) => `- ${line}`),
    "",
    // Named so the rule book's "What you know" section resolves on the delegate model too.
    "# What you know: the full business profile (JSON)",
    JSON.stringify(backendProfile(profile), null, 2),
  ].join("\n");
}

/**
 * The instruction that makes the receptionist speak first, with the exact line to say.
 *
 * Built from the greeting a business typed in Agent profile (already resolved by the composer), so
 * the line a caller hears is the one the business wrote — the same string the phone agent renders
 * to audio ahead of time.
 */
export function buildSessionGreetingPrompt(greetingLine: string): string {
  return [
    "Speak first. Do not wait for the caller to say anything.",
    `Say: "${greetingLine}"`,
    "Then stop and listen. If they answer in another language, carry on in that language.",
  ].join(" ");
}

/** The opening line when a business has not written one. */
export function defaultGreetingLine(businessName: string, agentName: string, languageCode?: string): string {
  return languageOf(languageCode).greeting(businessName, agentNameOf(agentName));
}

/**
 * A business's greeting with its placeholders filled. `{business}` and `{agent}` are what the
 * Agent profile screen tells people to write, and what the phone agent has always replaced.
 */
export function resolveGreetingLine(
  greeting: string | null | undefined,
  businessName: string,
  agentName: string,
  languageCode?: string,
): string {
  const typed = greeting?.trim();
  if (!typed) return defaultGreetingLine(businessName, agentName, languageCode);
  return typed.replace(/\{business\}/g, businessName).replace(/\{agent\}/g, agentNameOf(agentName));
}

export function buildSessionPrompts(
  profile: BusinessProfile,
  agentName: string,
  languageCode?: string,
  greeting?: string | null,
): CustomerPrompts {
  return {
    live: buildSessionLivePrompt(profile, agentName, languageCode),
    backend: buildSessionBackendPrompt(profile, agentName),
    greeting: buildSessionGreetingPrompt(resolveGreetingLine(greeting, profile.name, agentName, languageCode)),
    edited: false,
    version: SESSION_PROMPT_VERSION,
  };
}

/**
 * Which stored prompts to keep — the same contract as the demo's `resolvePrompts`: text that
 * arrives changed is a hand edit and is frozen; prompts nobody touched follow the data, and are
 * rebuilt when this builder's version moves on.
 */
export function resolveSessionPrompts(input: {
  current: CustomerPrompts | null | undefined;
  submitted?: Partial<CustomerPrompts> | null;
  profile: BusinessProfile;
  agentName: string;
  language?: string;
  greeting?: string | null;
  regenerate?: boolean;
}): CustomerPrompts {
  const { current, submitted, profile, agentName, language, greeting, regenerate } = input;
  const fresh = () => buildSessionPrompts(profile, agentName, language, greeting);
  if (regenerate || !current) return fresh();

  if (submitted) {
    const typed = {
      live: submitted.live ?? current.live,
      backend: submitted.backend ?? current.backend,
      greeting: submitted.greeting ?? current.greeting,
    };
    if (typed.live !== current.live || typed.backend !== current.backend || typed.greeting !== current.greeting) {
      return { ...typed, edited: true, version: current.version };
    }
  }
  return current.edited ? current : fresh();
}

/** A hand-edited prompt from before a rule change the business should hear about. */
export function promptsOutdated(prompts: CustomerPrompts | null | undefined): boolean {
  return Boolean(prompts?.edited) && (prompts?.version ?? 0) < SESSION_PROMPT_VERSION;
}
