// What the assistant may DO on a call — the dashboard's copy of transcribe-backend's
// `business/callSettings.ts` shape. The backend validates for real and names the field it refused;
// the checks here only catch the obvious mistakes before Save, so the form can say so as you type.

export const MAX_SCENARIOS = 20;
export const MAX_WATERFALL_NUMBERS = 5;
export const MAX_LINK_TEXT = 150;
export const MAX_BRIEF = 500;

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type Day = (typeof DAYS)[number];

export type TransferMode = "cold" | "warm" | "waterfall";
export const HOLD_MUSIC = ["classical", "ambient", "electronica", "guitars", "rock", "soft-rock"] as const;
export type HoldMusic = (typeof HOLD_MUSIC)[number];

export const HOLD_MUSIC_LABEL: Record<HoldMusic, string> = {
  classical: "Classical",
  ambient: "Ambient",
  electronica: "Electronica",
  guitars: "Guitars",
  rock: "Rock",
  "soft-rock": "Soft rock",
};

/**
 * One track from each of Twilio's royalty-free hold playlists — the buckets the phone agent plays as
 * a conference's wait music — for the preview button. Path-style HTTPS on purpose: the buckets have
 * dots in their names, so the virtual-host form fails TLS, and this page is served over HTTPS.
 * Checked 2026-09-26 (each returns audio/mpeg).
 */
export const HOLD_MUSIC_PREVIEW: Record<HoldMusic, string> = {
  classical: "https://s3.amazonaws.com/com.twilio.music.classical/ith_chopin-15-2.mp3",
  ambient: "https://s3.amazonaws.com/com.twilio.music.ambient/aerosolspray_-_Living_Taciturn.mp3",
  electronica: "https://s3.amazonaws.com/com.twilio.music.electronica/Kaer_Trouz_-_Seawall_Stepper.mp3",
  guitars: "https://s3.amazonaws.com/com.twilio.music.guitars/Pitx_-_Long_Winter.mp3",
  rock: "https://s3.amazonaws.com/com.twilio.music.rock/jlbrock44_-_Apologize_Guitar_Deep_Fried.mp3",
  "soft-rock": "https://s3.amazonaws.com/com.twilio.music.soft-rock/jacksontorreal_-_The_First_Sunny_Sky.mp3",
};

export const DEFAULT_COLLECT_BEFORE = "The caller's name and the reason for the call";
export const DEFAULT_LINK_TEXT = "[business_name]: Here's the link you asked for";

export type Window = { day: Day; open: string; close: string };

export type TransferScenario = {
  id: string;
  enabled: boolean;
  mode: TransferMode;
  name: string;
  description: string;
  numbers: string[];
  collectBefore: string;
  holdMusic: HoldMusic;
  hours: Window[];
};

export type MessageScenario = { id: string; enabled: boolean; name: string; brief: string };

export type LinkScenario = {
  id: string;
  enabled: boolean;
  triggers: string[];
  text: string;
  url: string;
};

export type CallSettings = {
  timezone?: string;
  transfer: { waterfallEnabled: boolean; scenarios: TransferScenario[] };
  messages: { scenarios: MessageScenario[] };
  links: { scenarios: LinkScenario[] };
  sms: { doubleOptIn: boolean };
};

export function emptyCallSettings(): CallSettings {
  return {
    transfer: { waterfallEnabled: false, scenarios: [] },
    messages: { scenarios: [] },
    links: { scenarios: [] },
    sms: { doubleOptIn: true },
  };
}

/** Stored settings may be missing sections (older records, a demo that never had any). */
export function withDefaults(raw: Partial<CallSettings> | null | undefined): CallSettings {
  const base = emptyCallSettings();
  if (!raw) return base;
  return {
    ...(raw.timezone ? { timezone: raw.timezone } : {}),
    transfer: { ...base.transfer, ...raw.transfer, scenarios: raw.transfer?.scenarios ?? [] },
    messages: { scenarios: raw.messages?.scenarios ?? [] },
    links: { scenarios: raw.links?.scenarios ?? [] },
    sms: { ...base.sms, ...raw.sms },
  };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** What the backend returns for a business. A demo has only `draft`, saved with its record. */
export type StoredCallSettings = {
  draft: CallSettings;
  published: CallSettings | null;
  publishedAt: string | null;
  dirty: boolean;
  waterfallAllowed: boolean;
  agentNumber: string | null;
};

/** "(206) 555-0134" for display; anything else as it is. */
export function displayPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return e164;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

/** A quick look at a typed number, before the backend has the final say. */
export function phoneProblem(typed: string): string | null {
  const text = typed.trim();
  if (!text) return "Add a phone number.";
  if (/(ext|x|#|,|;|\bp\b|\bw\b)/i.test(text.replace(/^\+/, ""))) {
    return "Extensions aren't supported. Use a direct number.";
  }
  const digits = text.replace(/\D/g, "");
  // A leading "+" is taken as written (the backend's toE164 does the same), so it must be +1.
  if (text.startsWith("+") && !(digits.length === 11 && digits.startsWith("1"))) {
    return "Use a 10-digit US phone number, like (206) 555-0134.";
  }
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10 || /^[01]/.test(local) || /^...[01]/.test(local)) {
    return "Use a 10-digit US phone number, like (206) 555-0134.";
  }
  return null;
}

export function urlProblem(typed: string): string | null {
  try {
    const url = new URL(typed.trim());
    return url.protocol === "https:" && url.hostname.includes(".") ? null : "Links have to start with https://";
  } catch {
    return "Use a full link starting with https://";
  }
}

export const MODE_LABEL: Record<TransferMode, string> = {
  cold: "Cold",
  warm: "Warm",
  waterfall: "Waterfall",
};

export const MODE_EXPLAINER: Record<TransferMode, string> = {
  cold: "Puts the caller straight through. If nobody answers, the assistant takes a message.",
  warm: "Asks the caller a few questions, then rings your team with a summary. They press 1 to take the call.",
  waterfall: "Like warm, but rings several phones in order, about 20 seconds each, until someone accepts.",
};

export function hoursSummary(hours: Window[]): string {
  if (!hours.length) return "Any time";
  const byDay = new Map<string, string[]>();
  for (const w of hours) byDay.set(w.day, [...(byDay.get(w.day) ?? []), `${w.open}–${w.close}`]);
  return [...byDay.entries()].map(([day, ranges]) => `${day.slice(0, 3)} ${ranges.join(", ")}`).join(" · ");
}

/** The link text as it will arrive, `[business_name]` filled in. Same wording as the backend. */
export function linkPreview(text: string, url: string, businessName: string): string {
  const body = (text || DEFAULT_LINK_TEXT).replace(/\[business_name\]/gi, businessName || "We");
  return `${body} ${url}`;
}

/** The first text a number gets when double opt-in is on. Same wording as the backend. */
export function consentPreview(businessName: string, businessPhone?: string | null): string {
  const name = businessName || "This business";
  const help = businessPhone ? ` Questions: ${businessPhone}.` : "";
  return (
    `${name}: Reply YES to get the info you asked for on your call. Messages may include promotions. ` +
    `Msg & data rates may apply. Reply STOP to opt out, HELP for help.${help}`
  );
}
