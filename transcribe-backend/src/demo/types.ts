// The promo's `lib/types.ts`, reduced to the declarations `analytics.ts` and the demo routes need.
// Every declaration below is a verbatim copy from that file — the same field names, the same
// optionality, the same comments — so the domain objects this backend hands the dashboard are the
// objects the promo handed it. `AmbienceLevel` is the one exception to the file of origin: it lives
// in the promo's `lib/ambience.ts`, and `CallSound` references it, so it is copied verbatim too.

export type AmbienceLevel = "off" | "quiet" | "busy";

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

export type CustomerPrompts = {
  live: string;
  backend: string;
  greeting: string;
  edited: boolean;
  /** Which generation of `buildPrompts` wrote these; absent on old records. */
  version?: number;
};

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

export type TrackEvent = {
  type: "page_view";
  customerId: string;
  at: string;
  /** Retired in favour of visitorId; still read on older records. */
  ipHash?: string;
  visitorId?: string;
};

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
