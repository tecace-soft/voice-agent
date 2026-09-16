import { createHash, randomBytes } from "node:crypto";
import { findActiveApiKey, touchApiKey, type ApiKeyRecord } from "../db/apiKeys.js";

// Authentication for other systems calling this API.
//
// Sent the same way a dashboard session is — `Authorization: Bearer <key>` — and told apart by the
// `ak_` prefix, so one header serves both and no route has to know which kind of caller it has until
// it asks. Keys carry no expiry: an integration that stops working at 3am because a token aged out
// is worse than one that keeps working until somebody revokes it on purpose.
//
// Only the hash is ever stored, so a key can be checked but never read back or reissued.

export const API_KEY_PREFIX = "ak_";

/** A new secret. 24 random bytes — far past guessing, and short enough to paste into a config. */
export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(24).toString("base64url");
}

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret.trim(), "utf8").digest("hex");
}

/** The visible part kept for display: enough to recognise a key, useless on its own. */
export function apiKeyPrefixOf(secret: string): string {
  return secret.slice(0, API_KEY_PREFIX.length + 6);
}

function bearer(authorization: string | undefined): string {
  return (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
}

/** True when the caller presented something shaped like an API key, valid or not. */
export function looksLikeApiKey(authorization: string | undefined): boolean {
  return bearer(authorization).startsWith(API_KEY_PREFIX);
}

/**
 * The key behind this header, or null if it is unknown or revoked.
 *
 * The last-used stamp is awaited rather than left floating: on a serverless runtime the function can
 * be frozen the moment the response is sent, and a write still in flight would simply be lost.
 */
export async function authenticateApiKey(authorization: string | undefined): Promise<ApiKeyRecord | null> {
  const secret = bearer(authorization);
  if (!secret.startsWith(API_KEY_PREFIX)) return null;
  const key = await findActiveApiKey(hashApiKey(secret));
  if (!key) return null;
  await touchApiKey(key.id);
  return key;
}

export const INVALID_API_KEY = {
  error: "invalid_api_key",
  message: "That API key is not valid, or it has been revoked.",
} as const;
