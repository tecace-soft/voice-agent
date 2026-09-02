import { createHash } from "node:crypto";
import { sql } from "./client.js";

// What a customer told us about their business, and what the agent may say because of it.
//
// TWO KINDS OF DATA, and the distinction is the point:
//   * source_text is what the customer wrote. It is the only thing anybody edits, and the only
//     thing we could not reproduce.
//   * everything else is DERIVED from it by the extractor. Nothing hand-edits those columns, which
//     is what makes it safe to re-run every stored source through a better extractor later and give
//     every customer the improvement at once.
//
// `isLive` is computed on read rather than stored. A stored flag is one more thing that can drift
// out of step with the row it describes; derived, it cannot be wrong.

export interface BusinessProfile {
  userId: string;
  sourceText: string;
  businessName: string | null;
  hoursText: string | null;
  openHour: number | null;
  closeHour: number | null;
  website: string | null;
  facts: string | null;
  /** True when there's enough here for the agent to answer AS this business rather than neutrally. */
  isLive: boolean;
  extractedAt: string | null;
  updatedAt: string;
}

export interface ExtractedFields {
  businessName: string | null;
  hoursText: string | null;
  openHour: number | null;
  closeHour: number | null;
  website: string | null;
  facts: string;
}

/**
 * Enough to speak as this business: a name to answer as, and at least one fact to answer from.
 *
 * A name without facts is the worst of both worlds — the agent introduces itself as Acme and then
 * cannot say anything about Acme, which sounds broken in a way that neutral does not.
 */
const IS_LIVE = sql`(p.business_name IS NOT NULL AND p.facts IS NOT NULL AND btrim(p.facts) <> '')`;

// Every column is qualified with the `p` alias, and every query below aliases business_profiles as
// `p` — including the single-table ones, which don't need it. agent_numbers also has user_id and
// updated_at, so the joined read would otherwise fail with "column reference is ambiguous" at
// runtime, where no typecheck would have caught it.
const COLUMNS = sql`
  p.user_id       AS "userId",
  p.source_text   AS "sourceText",
  p.business_name AS "businessName",
  p.hours_text    AS "hoursText",
  p.open_hour     AS "openHour",
  p.close_hour    AS "closeHour",
  p.website,
  p.facts,
  ${IS_LIVE}      AS "isLive",
  p.extracted_at  AS "extractedAt",
  p.updated_at    AS "updatedAt"
`;

/** Stable fingerprint of the source, so an unchanged save skips the model call entirely. */
export function hashSource(sourceText: string): string {
  return createHash("sha256").update(sourceText.trim(), "utf8").digest("hex");
}

export async function findProfile(userId: string): Promise<BusinessProfile | null> {
  const [row] = await sql`SELECT ${COLUMNS} FROM business_profiles p WHERE p.user_id = ${userId}`;
  return (row as BusinessProfile | undefined) ?? null;
}

/** The stored hash, without pulling the whole row — used to decide whether to re-extract. */
export async function currentHash(userId: string): Promise<string | null> {
  const [row] = await sql`SELECT source_hash FROM business_profiles WHERE user_id = ${userId}`;
  return (row as { source_hash: string } | undefined)?.source_hash ?? null;
}

/**
 * Write the source and everything derived from it, in one statement.
 *
 * Only ever called with a successful extraction. A failed one must not reach here: the previous
 * row stays exactly as it was, still live, still being served to callers — losing a working profile
 * because a model call timed out would be a worse outcome than the save not taking.
 */
export async function saveProfile(
  userId: string,
  sourceText: string,
  fields: ExtractedFields,
): Promise<BusinessProfile> {
  await sql`
    INSERT INTO business_profiles (
      user_id, source_text, source_hash, business_name, hours_text,
      open_hour, close_hour, website, facts, extracted_at, updated_at
    ) VALUES (
      ${userId}, ${sourceText}, ${hashSource(sourceText)}, ${fields.businessName},
      ${fields.hoursText}, ${fields.openHour}, ${fields.closeHour}, ${fields.website},
      ${fields.facts}, now(), now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      source_text   = EXCLUDED.source_text,
      source_hash   = EXCLUDED.source_hash,
      business_name = EXCLUDED.business_name,
      hours_text    = EXCLUDED.hours_text,
      open_hour     = EXCLUDED.open_hour,
      close_hour    = EXCLUDED.close_hour,
      website       = EXCLUDED.website,
      facts         = EXCLUDED.facts,
      extracted_at  = now(),
      updated_at    = now()
  `;
  return (await findProfile(userId))!;
}

export async function deleteProfile(userId: string): Promise<boolean> {
  const rows = await sql`DELETE FROM business_profiles WHERE user_id = ${userId} RETURNING user_id`;
  return rows.length > 0;
}

/**
 * The profile behind a phone number, for the agent — but only when it is live.
 *
 * A profile too thin to speak from is returned as null, exactly like a number nobody owns. The
 * agent's decision stays binary: either there is a business to be, or it answers neutrally.
 */
export async function findLiveProfileByPhone(phoneE164: string): Promise<BusinessProfile | null> {
  const [row] = await sql`
    SELECT ${COLUMNS}
    FROM business_profiles p
    JOIN agent_numbers n ON n.user_id = p.user_id
    WHERE n.phone_e164 = ${phoneE164} AND ${IS_LIVE}
  `;
  return (row as BusinessProfile | undefined) ?? null;
}
