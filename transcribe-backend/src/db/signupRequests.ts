import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { sql } from "./client.js";
import { jsonb } from "./jsonb.js";
import { normalizeEmail } from "./users.js";

// Sign-ups before they are accounts (`signup_requests`, see `client.ts`), and the six-digit codes
// that prove an email.
//
// The code lives on the request row rather than in a table of its own: a request has one code at a
// time, a resend replaces it, and a request older than a day is dead anyway — so "five sends a day"
// is five sends on the row.

export type SignupSource = "claim" | "start";
export type SignupStatus = "pending" | "open" | "verified" | "approved" | "declined";

export interface BusinessInput {
  businessName: string;
  websiteUrl?: string;
  mapsUrl?: string;
}

export interface SignupRequest {
  id: string;
  source: SignupSource;
  customerId: string | null;
  name: string;
  email: string;
  phone: string | null;
  note: string | null;
  business: BusinessInput | null;
  passwordHash: string;
  ipHash: string;
  status: SignupStatus;
  codeExpiresAt: string | null;
  codeAttempts: number;
  codeSentAt: string | null;
  codeSends: number;
  userId: string | null;
  researchStartedAt: string | null;
  createdAt: string;
}

/** How long a code works, how often it may be tried, resent, and how long a request waits for one. */
export const CODE_TTL_MS = 15 * 60_000;
export const MAX_CODE_ATTEMPTS = 5;
export const RESEND_GAP_MS = 60_000;
export const MAX_CODE_SENDS = 5;
export const PENDING_TTL_MS = 24 * 3_600_000;

const COLUMNS = sql`
  id, source, customer_id AS "customerId", name, email, phone, note, business,
  password_hash AS "passwordHash", ip_hash AS "ipHash", status,
  code_expires_at AS "codeExpiresAt", code_attempts AS "codeAttempts",
  code_sent_at AS "codeSentAt", code_sends AS "codeSends", user_id AS "userId",
  research_started_at AS "researchStartedAt", created_at AS "createdAt"
`;

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

function fromRow(row: Record<string, unknown>): SignupRequest {
  return {
    ...(row as unknown as SignupRequest),
    business: (typeof row.business === "string" ? JSON.parse(row.business) : row.business) as BusinessInput | null,
    codeExpiresAt: iso(row.codeExpiresAt),
    codeSentAt: iso(row.codeSentAt),
    researchStartedAt: iso(row.researchStartedAt),
    createdAt: iso(row.createdAt)!,
  };
}

/** A client address as a keyed hash: enough to count by, useless to anyone who reads the table. */
export function hashIp(ip: string): string {
  return createHmac("sha256", env.authSecret).update(`ip:${ip}`).digest("hex").slice(0, 32);
}

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Keyed to the request, so a code hash copied from one row proves nothing about another. */
export function hashCode(requestId: string, code: string): string {
  return createHmac("sha256", env.authSecret).update(`code:${requestId}:${code}`).digest("hex");
}

export function codeMatches(requestId: string, code: string, stored: string | null): boolean {
  if (!stored || !/^\d{6}$/.test(code)) return false;
  const a = Buffer.from(hashCode(requestId, code), "hex");
  const b = Buffer.from(stored, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Requests made from this address since `sinceMs` ago — the per-address brake, shared across instances. */
export async function countRecentByIp(ipHash: string, sinceMs: number): Promise<number> {
  const [row] = await sql`
    SELECT count(*)::int AS n FROM signup_requests
     WHERE ip_hash = ${ipHash} AND created_at > ${new Date(Date.now() - sinceMs)}
  `;
  return (row as { n: number }).n;
}

/** Open requests (no email here) waiting on one demo. */
export async function countOpenForCustomer(customerId: string): Promise<number> {
  const [row] = await sql`
    SELECT count(*)::int AS n FROM signup_requests WHERE customer_id = ${customerId} AND status = 'open'
  `;
  return (row as { n: number }).n;
}

/**
 * A new sign-up waiting for its code. Any earlier one from the same address that never got its code
 * is dropped, so signing up again is the way out of a lost email.
 */
export async function createPending(input: {
  source: SignupSource;
  customerId: string | null;
  name: string;
  email: string;
  phone?: string | null;
  note?: string | null;
  business?: BusinessInput | null;
  passwordHash: string;
  ipHash: string;
}): Promise<{ request: SignupRequest; code: string }> {
  const email = normalizeEmail(input.email);
  await sql`DELETE FROM signup_requests WHERE email = ${email} AND status = 'pending'`;
  const [row] = await sql`
    INSERT INTO signup_requests (source, customer_id, name, email, phone, note, business, password_hash, ip_hash, status)
    VALUES (
      ${input.source}, ${input.customerId}, ${input.name.trim()}, ${email}, ${input.phone?.trim() || null},
      ${input.note?.trim() || null}, ${input.business ? jsonb(input.business) : null}, ${input.passwordHash},
      ${input.ipHash}, 'pending'
    )
    RETURNING ${COLUMNS}
  `;
  const request = fromRow(row as Record<string, unknown>);
  const code = await setCode(request.id);
  return { request: { ...request, codeSends: 1 }, code };
}

/** A fresh code on a pending request (first send or a resend). */
export async function setCode(id: string): Promise<string> {
  const code = newCode();
  await sql`
    UPDATE signup_requests
       SET code_hash = ${hashCode(id, code)}, code_expires_at = ${new Date(Date.now() + CODE_TTL_MS)},
           code_attempts = 0, code_sent_at = now(), code_sends = code_sends + 1, updated_at = now()
     WHERE id = ${id}
  `;
  return code;
}

/** The live pending sign-up for this email, with the stored code hash, or null. */
export async function findPending(email: string): Promise<(SignupRequest & { codeHash: string | null }) | null> {
  const [row] = await sql`
    SELECT ${COLUMNS}, code_hash AS "codeHash" FROM signup_requests
     WHERE email = ${normalizeEmail(email)} AND status = 'pending'
       AND created_at > ${new Date(Date.now() - PENDING_TTL_MS)}
     ORDER BY created_at DESC LIMIT 1
  `;
  if (!row) return null;
  const r = row as Record<string, unknown>;
  return { ...fromRow(r), codeHash: (r.codeHash as string | null) ?? null };
}

export async function recordWrongCode(id: string): Promise<void> {
  await sql`UPDATE signup_requests SET code_attempts = code_attempts + 1, updated_at = now() WHERE id = ${id}`;
}

/** The code was right and the account exists. False when another tab got there first. */
export async function markVerified(id: string, userId: string): Promise<boolean> {
  const rows = await sql`
    UPDATE signup_requests
       SET status = 'verified', user_id = ${userId}, code_hash = NULL, updated_at = now()
     WHERE id = ${id} AND status = 'pending'
     RETURNING id
  `;
  return rows.length > 0;
}

/**
 * A claim on a deployment with no email: saved straight away as `open`, for an admin. Asking again
 * for the same demo from the same address updates the one request rather than adding another.
 */
export async function saveOpenClaim(input: {
  customerId: string;
  name: string;
  email: string;
  phone?: string | null;
  note?: string | null;
  passwordHash: string;
  ipHash: string;
}): Promise<SignupRequest> {
  const email = normalizeEmail(input.email);
  const [existing] = await sql`
    SELECT id FROM signup_requests WHERE customer_id = ${input.customerId} AND email = ${email} AND status = 'open'
  `;
  if (existing) {
    const [row] = await sql`
      UPDATE signup_requests
         SET name = ${input.name.trim()}, phone = ${input.phone?.trim() || null}, note = ${input.note?.trim() || null},
             password_hash = ${input.passwordHash}, updated_at = now()
       WHERE id = ${(existing as { id: string }).id}
       RETURNING ${COLUMNS}
    `;
    return fromRow(row as Record<string, unknown>);
  }
  const [row] = await sql`
    INSERT INTO signup_requests (source, customer_id, name, email, phone, note, password_hash, ip_hash, status)
    VALUES ('claim', ${input.customerId}, ${input.name.trim()}, ${email}, ${input.phone?.trim() || null},
            ${input.note?.trim() || null}, ${input.passwordHash}, ${input.ipHash}, 'open')
    RETURNING ${COLUMNS}
  `;
  return fromRow(row as Record<string, unknown>);
}

export async function findRequest(id: string): Promise<SignupRequest | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql`SELECT ${COLUMNS} FROM signup_requests WHERE id = ${id}`;
  return row ? fromRow(row as Record<string, unknown>) : null;
}

/** Open requests (made without email), newest first; one demo's, or every one. */
export async function listOpen(customerId?: string): Promise<SignupRequest[]> {
  const rows = await sql`
    SELECT ${COLUMNS} FROM signup_requests
     WHERE status = 'open' AND ${customerId === undefined ? sql`true` : sql`customer_id = ${customerId}`}
     ORDER BY created_at DESC
  `;
  return (rows as unknown as Record<string, unknown>[]).map(fromRow);
}

/** An admin's answer to an open request. False when it was no longer open. */
export async function decideRequest(
  id: string,
  decision: { status: "approved" | "declined"; by: string; userId?: string | null; note?: string | null },
): Promise<boolean> {
  const rows = await sql`
    UPDATE signup_requests
       SET status = ${decision.status}, decided_by = ${decision.by}, decided_at = now(),
           user_id = coalesce(${decision.userId ?? null}, user_id), decline_note = ${decision.note?.trim() || null},
           updated_at = now()
     WHERE id = ${id} AND status = 'open'
     RETURNING id
  `;
  return rows.length > 0;
}

/** The verified self-service sign-up behind an account, if it came from `/start`. */
export async function findStartRequestForUser(userId: string): Promise<SignupRequest | null> {
  const [row] = await sql`
    SELECT ${COLUMNS} FROM signup_requests
     WHERE user_id = ${userId} AND source = 'start' AND status = 'verified'
     ORDER BY created_at DESC LIMIT 1
  `;
  return row ? fromRow(row as Record<string, unknown>) : null;
}

/** Research runs sign-ups started since midnight UTC: all of them, or from one address. */
export async function countResearchToday(ipHash?: string): Promise<number> {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const [row] = await sql`
    SELECT count(*)::int AS n FROM signup_requests
     WHERE research_started_at >= ${midnight}
       AND ${ipHash === undefined ? sql`true` : sql`ip_hash = ${ipHash}`}
  `;
  return (row as { n: number }).n;
}

/** Claim the one research run a sign-up gets. False when it was already claimed. */
export async function claimResearch(id: string): Promise<boolean> {
  const rows = await sql`
    UPDATE signup_requests SET research_started_at = now(), updated_at = now()
     WHERE id = ${id} AND research_started_at IS NULL
     RETURNING id
  `;
  return rows.length > 0;
}

// Exported for tests that need a stable fingerprint without the secret.
export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
