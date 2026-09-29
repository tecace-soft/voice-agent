// Where Twilio should send what for a number we manage, and whether Twilio's copy still says so.
//
// Two origins, on purpose. A ringing call goes to the phone agent on the VPS (`AGENT_PUBLIC_URL`), which
// answers with TwiML in milliseconds; this backend runs on Vercel and a cold start on the voice path
// would be dead air. So this backend takes only what happens AFTER a call — the status callback — and
// later the texts. Pure: nothing here reads env or the database.

export interface WebhookSet {
  voiceUrl: string;
  voiceFallbackUrl: string;
  statusCallback: string;
  /** Set once a number is verified for texting (phase 3). */
  smsUrl?: string;
}

const trim = (origin: string) => origin.trim().replace(/\/+$/, "");

/** The webhooks every managed number should carry, or null while either origin is unset. */
export function webhookUrlsFor(cfg: { agentPublicUrl: string; publicBackendUrl: string }): WebhookSet | null {
  const agent = trim(cfg.agentPublicUrl);
  const backend = trim(cfg.publicBackendUrl);
  if (!agent || !backend) return null;
  return {
    voiceUrl: `${agent}/incoming`,
    voiceFallbackUrl: `${agent}/incoming-fallback`,
    statusCallback: `${backend}/twilio/voice-status`,
  };
}

/** What Twilio currently has for a number, as its API reports it (null = never set). */
export interface TwilioWebhooks {
  voiceUrl: string | null;
  voiceFallbackUrl: string | null;
  statusCallback: string | null;
  smsUrl?: string | null;
}

/**
 * "ok" when Twilio has exactly what we want; "stale" when any wanted URL differs or is missing. A number
 * configured by hand before this existed is stale — it has a voice URL and no status callback — which
 * is what Configure repairs.
 */
export function webhookStateOf(actual: TwilioWebhooks, wanted: WebhookSet): "ok" | "stale" {
  if (actual.voiceUrl !== wanted.voiceUrl) return "stale";
  if (actual.voiceFallbackUrl !== wanted.voiceFallbackUrl) return "stale";
  if (actual.statusCallback !== wanted.statusCallback) return "stale";
  if (wanted.smsUrl !== undefined && (actual.smsUrl ?? null) !== wanted.smsUrl) return "stale";
  return "ok";
}

// Twilio's number resource has no "type" field, so the kind is read off the area code. US toll-free
// NPAs are a fixed list; anything else in +1 is a local number, and outside +1 we don't guess.
const TOLL_FREE_NPAS = new Set(["800", "833", "844", "855", "866", "877", "888"]);

export function inferNumberType(e164: string): "local" | "tollfree" | null {
  const match = /^\+1(\d{3})\d{7}$/.exec(e164);
  if (!match) return null;
  return TOLL_FREE_NPAS.has(match[1]!) ? "tollfree" : "local";
}

/**
 * The URL to check a Twilio signature against: the origin Twilio was configured with plus the request's
 * path and query. The request's own host is discarded — it is whatever the client put in the header.
 */
export function signedUrlFor(publicBackendUrl: string, request: Request): string {
  const url = new URL(request.url);
  return `${trim(publicBackendUrl)}${url.pathname}${url.search}`;
}
