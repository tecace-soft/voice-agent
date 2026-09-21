import type { AmbienceLevel } from "./ambience";

export type BusinessHour = {
  day: string;
  open: string;
  close: string;
  closed?: boolean;
};

export type BusinessService = {
  name: string;
  price?: string;
  description?: string;
};

export type BusinessPolicies = {
  reservations?: string;
  walkIns?: string;
  parking?: string;
  payment?: string;
  cancellation?: string;
  other?: string[];
};

export type BusinessFaq = { q: string; a: string };

export type BusinessProfile = {
  name: string;
  category: string;
  address: string;
  phone?: string;
  website?: string;
  lat?: number;
  lng?: number;
  hours: BusinessHour[];
  services: BusinessService[];
  highlights: string[];
  policies: BusinessPolicies;
  faqs: BusinessFaq[];
  rating?: number;
  reviewSummary?: string;
};

export type ResearchSource = { url: string; title: string };

export type ResearchInputs = {
  businessName: string;
  websiteUrl?: string;
  mapsUrl?: string;
  /** Anything the operator knows that the web will not say. */
  notes?: string;
};

export type CustomerPrompts = {
  live: string;
  backend: string;
  greeting: string;
  edited: boolean;
  /** Which generation of `buildPrompts` wrote these; absent on old records. */
  version?: number;
};

/** How long a prospect may spend on the demo before asking us for more. */
export const DEFAULT_DEMO_MINUTES = 10;

export type CustomerStatus = "researching" | "ready" | "error";

/**
 * Where the deal stands. Set by the operator and only by the operator — what
 * the prospect did with the demo is reported separately as `Engagement`, and a
 * stage that sometimes moves itself is a stage nobody trusts.
 */
export const CUSTOMER_STAGES = [
  "new",
  "contacted",
  "interested",
  "won",
  "lost",
] as const;

export type CustomerStage = (typeof CUSTOMER_STAGES)[number];

/** One line the operator wrote about a prospect. Append-only. */
export type CrmNote = {
  id: string;
  at: string;
  text: string;
};

export type Customer = {
  id: string;
  label?: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
  active: boolean;
  /** What the research starts from. The name is required; the links are extra
   *  context, not the subject. */
  businessName: string;
  websiteUrl?: string;
  mapsUrl?: string;
  resolvedMapsUrl?: string;
  researchNotes?: string;
  profile: BusinessProfile;
  dossier: string;
  sources: ResearchSource[];
  prompts: CustomerPrompts;
  voice: string;
  callSound?: CallSound;
  agentName: string;
  /**
   * The language the receptionist opens in. Absent means English, which is
   * what almost every demo wants. It changes the opening only — the prompt
   * follows the caller into any language either way.
   */
  language?: string;
  /** Demo minutes for this prospect; absent means DEFAULT_DEMO_MINUTES. */
  demoMinutes?: number;
  stage?: CustomerStage;
  lastContactedAt?: string;
  followUpAt?: string;
  status: CustomerStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
  researchedAt?: string;
};

export type TranscriptSpeaker = "caller" | "receptionist";

export type TranscriptEntry = {
  id: string;
  speaker: TranscriptSpeaker;
  text: string;
  startMs: number;
  endMs: number;
};

export type CallStatus = "started" | "completed" | "failed" | "abandoned";

export type CallSentiment = "happy" | "mixed" | "frustrated";

/**
 * What one demo call told us about the product. The transcript says what
 * happened; this says what to do about it, which is the thing an operator
 * cannot get by reading thirty calls in a row.
 *
 * It is written once when the call is reported and never recomputed, so the
 * wording an operator read yesterday is the wording they read today. A call
 * with no review is a call the model was not asked about or could not answer
 * on — never a call that went perfectly.
 */
export type CallReview = {
  at: string;
  model: string;
  /** What the caller was trying to get done. */
  tested: string;
  /** What the receptionist handled well. */
  worked: string;
  /** Where it fell short. Empty when nothing did. */
  struggled: string;
  /** Fixable things, short enough to group across calls. */
  gaps: string[];
  sentiment: CallSentiment;
};

export type CallLog = {
  id: string;
  customerId: string;
  liveSessionId: string;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  status: CallStatus;
  endReason?: string;
  turns?: number;
  transcript: TranscriptEntry[];
  userAgent?: string;
  /** Retired in favour of visitorId; still read on older records. */
  ipHash?: string;
  visitorId?: string;
  isTest: boolean;
  review?: CallReview;
};

export type CallState =
  | "idle"
  | "connecting"
  | "ringing"
  | "connected"
  | "ending"
  | "ended"
  | "error";

export type Heat = "cold" | "warm" | "hot";

export type Engagement = {
  score: number;
  level: Heat;
  /** The same thing in words, so the badge can explain itself. */
  reason: string;
};

export type CustomerStats = {
  views: number;
  calls: number;
  totalSec: number;
  /** Different browsers, not different visits. */
  visitors: number;
  lastCallAt?: string;
  lastViewAt?: string;
};

export type CustomerWithStats = Customer & {
  stats: CustomerStats;
  heat: Engagement;
};

export type TrackEvent = {
  type: "page_view";
  customerId: string;
  at: string;
  /** Retired in favour of visitorId; still read on older records. */
  ipHash?: string;
  visitorId?: string;
};

export type VoiceOption = {
  id: string;
  label: string;
  accent: string;
  presentation: "feminine" | "masculine";
};

/** The voices gpt-live-1 ships, with the accent each one speaks in. */
export const LIVE_VOICE_OPTIONS: VoiceOption[] = [
  { id: "gleam", label: "Gleam", accent: "North American", presentation: "feminine" },
  { id: "meridian", label: "Meridian", accent: "North American", presentation: "masculine" },
  { id: "delta", label: "Delta", accent: "Southern US", presentation: "feminine" },
  { id: "cinder", label: "Cinder", accent: "Southern US", presentation: "masculine" },
  { id: "quartz", label: "Quartz", accent: "Australian", presentation: "feminine" },
  { id: "ripple", label: "Ripple", accent: "Australian", presentation: "masculine" },
  { id: "vesper", label: "Vesper", accent: "British", presentation: "masculine" },
  { id: "willow", label: "Willow", accent: "Irish", presentation: "feminine" },
  { id: "stone", label: "Stone", accent: "Irish", presentation: "masculine" },
  { id: "beacon", label: "Beacon", accent: "Filipino", presentation: "masculine" },
  { id: "bossa", label: "Bossa", accent: "Brazilian Portuguese", presentation: "feminine" },
  { id: "tempo", label: "Tempo", accent: "Brazilian Portuguese", presentation: "masculine" },
];

export const LIVE_VOICES = LIVE_VOICE_OPTIONS.map((voice) => voice.id);

export const DEFAULT_VOICE = "gleam";

/**
 * There is no voice here for most of the languages a demo can open in, because
 * the voice carries its accent into every language it speaks. A Korean opening
 * in `gleam` is fluent Korean in an American accent. That is a property of the
 * model, not something this app can configure away, so the prompt tells the
 * receptionist never to apologise for it.
 */

/** How the call itself should sound, on top of what the model says. */
export type CallSound = {
  /** Narrow the agent audio to the telephone band. */
  phoneLine: boolean;
  /**
   * Retired in favour of `ambience`, still read on older records. It switched
   * on a flat room tone so quiet nobody could hear it.
   */
  roomTone?: boolean;
  /** How much of a working office is going on behind the receptionist. */
  ambience: AmbienceLevel;
};

export const DEFAULT_CALL_SOUND: CallSound = { phoneLine: true, ambience: "quiet" };
