// The phone numbers on our Twilio account, and where each one sends its calls.
//
// Twilio is the source of truth for what we own and which webhook a number rings; `agent_numbers`
// stays the source of truth for whose business a number answers as. Nothing here is stored — every
// read goes to Twilio — so the Agent numbers page can't show a list that has drifted from the account.
//
// Two REST calls over plain fetch (no SDK), the same way src/calendar talks to its providers. The
// config is passed in rather than read from env so this module can be tested without one.

export interface TwilioConfig {
  accountSid: string;
  /** API key SID, or the account SID when authenticating with the auth token. */
  username: string;
  password: string;
  apiBase: string;
}

/** The Twilio config from env, or null when it isn't set up (no account SID or no credential). */
export function twilioConfigFrom(e: {
  twilioAccountSid: string;
  twilioApiKeySid: string;
  twilioApiKeySecret: string;
  twilioAuthToken: string;
  twilioApiBase: string;
}): TwilioConfig | null {
  if (!e.twilioAccountSid) return null;
  if (e.twilioApiKeySid && e.twilioApiKeySecret) {
    return { accountSid: e.twilioAccountSid, username: e.twilioApiKeySid, password: e.twilioApiKeySecret, apiBase: e.twilioApiBase };
  }
  if (e.twilioAuthToken) {
    return { accountSid: e.twilioAccountSid, username: e.twilioAccountSid, password: e.twilioAuthToken, apiBase: e.twilioApiBase };
  }
  return null;
}

export interface TwilioNumber {
  sid: string;
  phoneE164: string;
  friendlyName: string;
  voiceUrl: string | null;
  voiceFallbackUrl: string | null;
}

/**
 * Where a number's calls go, relative to the voice agent:
 *   connected     — its voice URL is the agent's /incoming;
 *   not_connected — it has no voice URL, so a call gets Twilio's default and reaches nobody;
 *   elsewhere     — it rings some other webhook (a Twilio demo, another service). Overwriting that
 *                   is a choice, so the route asks before doing it.
 */
export type AgentStatus = "connected" | "not_connected" | "elsewhere";

export class TwilioError extends Error {
  kind: "auth" | "not_found" | "other";
  constructor(kind: TwilioError["kind"], message: string) {
    super(message);
    this.name = "TwilioError";
    this.kind = kind;
  }
}

export function agentIncomingUrl(agentBase: string): string {
  return `${agentBase.replace(/\/+$/, "")}/incoming`;
}

function agentFallbackUrl(agentBase: string): string {
  return `${agentBase.replace(/\/+$/, "")}/incoming-fallback`;
}

// Scheme and host compare case-insensitively (URL lower-cases them); the path is case-sensitive,
// as the agent's router is. A trailing slash is ignored.
function sameUrl(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const path = (u: URL) => u.pathname.replace(/\/+$/, "");
    return x.origin === y.origin && path(x) === path(y) && x.search === y.search;
  } catch {
    return false;
  }
}

export function agentStatus(voiceUrl: string | null, agentBase: string | null): AgentStatus {
  if (!voiceUrl) return "not_connected";
  if (agentBase && sameUrl(voiceUrl, agentIncomingUrl(agentBase))) return "connected";
  return "elsewhere";
}

interface RawNumber {
  sid: string;
  phone_number: string;
  friendly_name?: string | null;
  voice_url?: string | null;
  voice_fallback_url?: string | null;
}

function fromRaw(n: RawNumber): TwilioNumber {
  return {
    sid: n.sid,
    phoneE164: n.phone_number,
    friendlyName: n.friendly_name || n.phone_number,
    voiceUrl: n.voice_url || null,
    voiceFallbackUrl: n.voice_fallback_url || null,
  };
}

async function twilioFetch(cfg: TwilioConfig, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Basic ${btoa(`${cfg.username}:${cfg.password}`)}`);
  headers.set("accept", "application/json");

  let res: Response;
  try {
    res = await fetch(`${cfg.apiBase}${path}`, { ...init, headers });
  } catch (err) {
    throw new TwilioError("other", `Couldn't reach Twilio: ${(err as Error).message}`);
  }

  const text = await res.text();
  if (!res.ok) {
    // Twilio's error body is {code, message, more_info, status}. Its message never echoes our
    // credentials, so it is safe to pass on; a body we can't read is replaced by the status.
    let message = `Twilio answered ${res.status}.`;
    try {
      const body = JSON.parse(text) as { message?: string };
      if (body.message) message = `Twilio: ${body.message}`;
    } catch {
      /* keep the status line */
    }
    const kind = res.status === 401 || res.status === 403 ? "auth" : res.status === 404 ? "not_found" : "other";
    throw new TwilioError(kind, message);
  }
  return text ? JSON.parse(text) : {};
}

/** Every number on the account, following Twilio's pages until there are no more. */
export async function listOwnedNumbers(cfg: TwilioConfig): Promise<TwilioNumber[]> {
  const out: TwilioNumber[] = [];
  let path: string | null = `/2010-04-01/Accounts/${cfg.accountSid}/IncomingPhoneNumbers.json?PageSize=1000`;
  while (path) {
    const page = (await twilioFetch(cfg, path)) as {
      incoming_phone_numbers?: RawNumber[];
      next_page_uri?: string | null;
    };
    out.push(...(page.incoming_phone_numbers ?? []).map(fromRaw));
    path = page.next_page_uri || null;
  }
  return out;
}

/** Point a number's voice webhook (and its fallback) at the voice agent. Returns the updated number. */
export async function connectNumber(cfg: TwilioConfig, sid: string, agentBase: string): Promise<TwilioNumber> {
  // The SID goes into the URL path; anything but a phone-number SID is refused before it can
  // address some other resource on the account.
  if (!/^PN[0-9A-Za-z]+$/.test(sid)) {
    throw new TwilioError("not_found", "That isn't a Twilio phone number SID.");
  }
  const body = new URLSearchParams({
    VoiceUrl: agentIncomingUrl(agentBase),
    VoiceMethod: "POST",
    VoiceFallbackUrl: agentFallbackUrl(agentBase),
    VoiceFallbackMethod: "POST",
  });
  const updated = await twilioFetch(cfg, `/2010-04-01/Accounts/${cfg.accountSid}/IncomingPhoneNumbers/${sid}.json`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return fromRaw(updated as RawNumber);
}
