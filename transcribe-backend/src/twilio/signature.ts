import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio's webhook signature (the `X-Twilio-Signature` header): HMAC-SHA1, keyed with the account's auth
// token, over the exact URL Twilio called followed by every POST parameter sorted by name, each as
// name + value with no separator, base64-encoded. Pure: the URL is the caller's responsibility, and it
// must be the one Twilio was configured with (`env.publicBackendUrl` + path + query), never the request's
// own Host — that header is whatever the client chose to send.

export type FormParams = Record<string, string>;

export function twilioSignature(authToken: string, url: string, params: FormParams): string {
  const sorted = Object.keys(params).sort();
  let data = url;
  for (const key of sorted) data += key + (params[key] ?? "");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/**
 * True when `signature` is the signature Twilio would have produced for this URL and body. A missing,
 * empty or malformed header is simply false: a webhook route answers 403 either way and never throws.
 */
export function verifyTwilioSignature(input: {
  authToken: string;
  url: string;
  params: FormParams;
  signature: string | null | undefined;
}): boolean {
  if (!input.signature) return false;
  const expected = Buffer.from(twilioSignature(input.authToken, input.url, input.params), "base64");
  const given = Buffer.from(input.signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Twilio posts `application/x-www-form-urlencoded`. Parsed from the raw text rather than through a body
 * parser because blank values (`ForwardedFrom=`) are part of what Twilio signed and must survive.
 */
export function parseForm(raw: string): FormParams {
  const out: FormParams = {};
  for (const [key, value] of new URLSearchParams(raw)) out[key] = value;
  return out;
}
