import { createHash, randomBytes } from "node:crypto";
import { sql } from "../db/client.js";

// One-time sign-in links (`auth_tokens`, see `db/client.ts`): an admin's invite, where the customer
// chooses a password (7 days), and a password reset (60 minutes).
//
// The token is 32 random bytes handed out once, in the link; only its SHA-256 is stored, so a copy of
// the table opens nothing. Issuing a new link for the same account and purpose retires the old one,
// and a link works once — `consumeLink` is a single conditional UPDATE, so two tabs cannot both use it.

export type LinkPurpose = "invite" | "reset";

export const LINK_TTL_MS: Record<LinkPurpose, number> = {
  invite: 7 * 24 * 3_600_000,
  reset: 60 * 60_000,
};

const digest = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function issueLink(
  userId: string,
  purpose: LinkPurpose,
  createdBy: string | null = null,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_TTL_MS[purpose]);
  await sql`
    UPDATE auth_tokens SET used_at = now()
     WHERE user_id = ${userId} AND purpose = ${purpose} AND used_at IS NULL
  `;
  await sql`
    INSERT INTO auth_tokens (user_id, purpose, token_hash, created_by, expires_at)
    VALUES (${userId}, ${purpose}, ${digest(token)}, ${createdBy}, ${expiresAt})
  `;
  return { token, expiresAt: expiresAt.toISOString() };
}

/** Whose link this is, while it still works — for the page to greet them before they choose a password. */
export async function inspectLink(token: string): Promise<{ userId: string; purpose: LinkPurpose } | null> {
  if (!token || token.length > 200) return null;
  const [row] = await sql`
    SELECT user_id AS "userId", purpose FROM auth_tokens
     WHERE token_hash = ${digest(token)} AND used_at IS NULL AND expires_at > now()
  `;
  return (row as { userId: string; purpose: LinkPurpose } | undefined) ?? null;
}

/** Use the link up. Null when it is unknown, used, retired or expired. */
export async function consumeLink(token: string): Promise<{ userId: string; purpose: LinkPurpose } | null> {
  if (!token || token.length > 200) return null;
  const [row] = await sql`
    UPDATE auth_tokens SET used_at = now()
     WHERE token_hash = ${digest(token)} AND used_at IS NULL AND expires_at > now()
     RETURNING user_id AS "userId", purpose
  `;
  return (row as { userId: string; purpose: LinkPurpose } | undefined) ?? null;
}
