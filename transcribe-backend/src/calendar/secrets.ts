import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

// The credentials a calendar connection keeps — a refresh token, an app-specific password, an API
// key — are encrypted before they reach the database, and the OAuth `state` that comes back from
// Google or Microsoft is signed so a callback cannot be pointed at somebody else's account.
//
// One key for both, derived from CALENDAR_SECRET (see config/env.ts), with a different label each
// so the two uses never share a key.

function key(label: string, secret = env.calendarSecret): Buffer {
  return createHash("sha256").update(`${label}\u0000${secret}`).digest();
}

/** AES-256-GCM, as `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function seal(value: unknown, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("calendar-credentials", secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** The sealed value, or null when it was sealed under another key or has been tampered with. */
export function open<T>(sealed: string, secret?: string): T | null {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key("calendar-credentials", secret), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const text = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export type OAuthState = {
  /** The account the connection is for (an admin may connect on a customer's behalf). */
  uid: string;
  provider: string;
  /** Where the browser goes afterwards. Checked against the allowed origins before it is signed. */
  back: string;
  exp: number;
};

/** A signed, expiring OAuth `state`. Ten minutes is plenty to click through a consent screen. */
export function signState(state: Omit<OAuthState, "exp">, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...state, exp: now + 10 * 60_000 })).toString("base64url");
  const mac = createHmac("sha256", key("calendar-oauth-state")).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function readState(raw: string | undefined, now = Date.now()): OAuthState | null {
  const [payload, mac] = (raw ?? "").split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", key("calendar-oauth-state")).update(payload).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    return typeof state.exp === "number" && state.exp > now ? state : null;
  } catch {
    return null;
  }
}
