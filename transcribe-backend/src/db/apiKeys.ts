import { sql } from "./client.js";

// Keys other systems use to read this API.
//
// One key per integration rather than one shared secret, because the two questions that matter later
// — "who is calling this?" and "how do we cut just them off?" — cannot be answered by a value in an
// env file. Revoking is a column, not a redeploy, and `last_used_at` says which integrations are
// actually live.
//
// Every key reads every business; a caller picks one per request (?userId= on /usage/minutes).
//
// The secret itself is never stored, only its SHA-256 hash (see auth/apiKey.ts). `key_prefix` is the
// first few visible characters, kept so a person can match a key on screen to the one in someone
// else's config without either of us being able to read the rest.

export interface ApiKeyRecord {
  id: string;
  name: string;
  /** The first characters of the key, for recognising it on screen. Never enough to use. */
  keyPrefix: string;
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const COLUMNS = sql`
  k.id,
  k.name,
  k.key_prefix   AS "keyPrefix",
  k.created_at   AS "createdAt",
  k.created_by   AS "createdBy",
  k.last_used_at AS "lastUsedAt",
  k.revoked_at   AS "revokedAt"
`;

const FROM = sql`FROM api_keys k`;

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  return (await sql`
    SELECT ${COLUMNS} ${FROM} ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC
  `) as unknown as ApiKeyRecord[];
}

export async function findApiKey(id: string): Promise<ApiKeyRecord | null> {
  if (!isUuid(id)) return null;
  const [row] = await sql`SELECT ${COLUMNS} ${FROM} WHERE k.id = ${id}`;
  return (row as ApiKeyRecord | undefined) ?? null;
}

export async function createApiKey(input: {
  name: string;
  keyHash: string;
  keyPrefix: string;
  createdBy: string;
}): Promise<ApiKeyRecord> {
  const [row] = await sql`
    INSERT INTO api_keys (name, key_hash, key_prefix, created_by)
    VALUES (${input.name.trim()}, ${input.keyHash}, ${input.keyPrefix}, ${input.createdBy})
    RETURNING id
  `;
  return (await findApiKey((row as { id: string }).id))!;
}

/** The key behind a hash, if it exists and has not been revoked. */
export async function findActiveApiKey(keyHash: string): Promise<ApiKeyRecord | null> {
  const [row] = await sql`
    SELECT ${COLUMNS} ${FROM} WHERE k.key_hash = ${keyHash} AND k.revoked_at IS NULL
  `;
  return (row as ApiKeyRecord | undefined) ?? null;
}

/**
 * Record that a key was used, at most once every five minutes.
 *
 * "Is this integration still running?" is worth answering; "which second did it last call?" is not
 * worth a database write on every request.
 */
export async function touchApiKey(id: string): Promise<void> {
  await sql`
    UPDATE api_keys SET last_used_at = now()
    WHERE id = ${id} AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')
  `;
}

/** Stop a key working, keeping the row so the history of who had access survives. */
export async function revokeApiKey(id: string): Promise<ApiKeyRecord | null> {
  if (!isUuid(id)) return null;
  // Already-revoked keys are left as they are, keeping the time it first happened.
  await sql`UPDATE api_keys SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL`;
  return findApiKey(id);
}

export async function deleteApiKey(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await sql`DELETE FROM api_keys WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

// Postgres raises on a malformed uuid, which would turn a mistyped id into a 500. Nothing matches,
// which is the honest answer — the same guard the call records use.
function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
