import { sql } from "./client.js";
import { env } from "../config/env.js";
import { toE164 } from "./agentNumbers.js";

// How long the voice agent has spent talking on each business's calls — this month, and last month.
//
// Per business, attributed the way everything else the agent does is: by the agent's OWN number on
// the call (the one that was dialled, for an inbound call; the one it rang out from, for an outbound
// one), resolved through agent_numbers to the account that owns it when the call ends. A number
// nobody owns still used the minutes, so those land in one "unassigned" bucket rather than
// vanishing — the same reason inbound_calls keeps calls to unassigned lines.
//
// A running counter rather than a sum over call rows, because not every agent session has a row
// here (outbound lead calls are recorded by backend-app). The agent reports every session's length.
//
// One row per owner. A new month is applied in two places that must agree: a WRITE rolls the stored
// row over inside the same atomic statement that adds to it, so two calls ending together cannot race
// a rollover; a READ projects the stored row onto the current month (`asOf`) without writing, so a
// business with no calls yet this month reads as zero rather than showing last month as current.

export const UNASSIGNED = "unassigned";

export interface MonthTotals {
  /** "YYYY-MM", in the business timezone. */
  currentMonth: string;
  currentSeconds: number;
  currentMinutes: number;
  /** The calendar month before currentMonth — even if it had no calls. */
  previousMonth: string;
  previousSeconds: number;
  previousMinutes: number;
  /** When a call last added to this business's total. */
  updatedAt: string | null;
}

export interface OwnerCallMinutes extends MonthTotals {
  /** The owning account, or null for the unassigned bucket. */
  userId: string | null;
  email: string | null;
  name: string | null;
  businessName: string | null;
}

export interface StoredTotals {
  currentMonth: string;
  currentSeconds: number;
  previousMonth: string;
  previousSeconds: number;
  updatedAt: string | null;
}

/**
 * "YYYY-MM" for an instant in the business timezone. A call at 11:30pm Pacific on the 30th belongs
 * to that month, not to the next one UTC has already started.
 */
export function monthKey(at: Date, timeZone: string = env.timezone): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(at);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  return `${year}-${month}`;
}

/** The calendar month before a "YYYY-MM" key. */
export function previousMonthKey(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** Seconds as minutes, to one decimal. */
export function toMinutes(seconds: number): number {
  return Math.round((seconds / 60) * 10) / 10;
}

/**
 * A stored row as it reads in the `current` month — the read-side twin of the rollover in
 * addCallSeconds, and it must stay in step with it.
 *
 * On a new month the old one becomes "previous" only if it really is the month before; after a month
 * with no calls, "previous" is that empty month at zero, not an older total wearing its name. A
 * stored month AHEAD of now (a clock or timezone change) is shown as stored rather than wiped.
 */
export function asOf(stored: StoredTotals | null, current: string): MonthTotals {
  const previous = previousMonthKey(current);
  let totals: { currentMonth: string; currentSeconds: number; previousMonth: string; previousSeconds: number };
  if (!stored) {
    totals = { currentMonth: current, currentSeconds: 0, previousMonth: previous, previousSeconds: 0 };
  } else if (stored.currentMonth >= current) {
    totals = {
      currentMonth: stored.currentMonth,
      currentSeconds: Number(stored.currentSeconds),
      previousMonth: stored.previousMonth,
      previousSeconds: Number(stored.previousSeconds),
    };
  } else {
    totals = {
      currentMonth: current,
      currentSeconds: 0,
      previousMonth: previous,
      previousSeconds: stored.currentMonth === previous ? Number(stored.currentSeconds) : 0,
    };
  }
  return {
    ...totals,
    currentMinutes: toMinutes(totals.currentSeconds),
    previousMinutes: toMinutes(totals.previousSeconds),
    updatedAt: stored?.updatedAt ?? null,
  };
}

/**
 * Add one agent session's seconds to the business that owns `agentNumber`, rolling that business's
 * month over first if it has changed. Returns the owner's totals afterwards.
 *
 * The casts are deliberate: in an INSERT ... SELECT, an untyped parameter in the select list resolves
 * to text, and text into an integer column is an error.
 */
export async function addCallSeconds(
  seconds: number,
  agentNumber: string | undefined,
  now: Date = new Date(),
): Promise<OwnerCallMinutes> {
  const current = monthKey(now);
  const previous = previousMonthKey(current);
  const phone = toE164(agentNumber ?? "");
  const [row] = (await sql`
    WITH owner AS (
      SELECT (SELECT user_id FROM agent_numbers WHERE phone_e164 = ${phone}::text) AS user_id
    )
    INSERT INTO agent_call_minutes AS m
      (owner_key, user_id, current_month, current_seconds, previous_month, previous_seconds, updated_at)
    SELECT COALESCE(owner.user_id::text, ${UNASSIGNED}::text), owner.user_id,
           ${current}::text, ${seconds}::int, ${previous}::text, 0,
           ${seconds > 0 ? now : null}::timestamptz
    FROM owner
    ON CONFLICT (owner_key) DO UPDATE SET
      current_month = GREATEST(m.current_month, EXCLUDED.current_month),
      current_seconds = CASE
        WHEN m.current_month >= EXCLUDED.current_month THEN m.current_seconds + EXCLUDED.current_seconds
        ELSE EXCLUDED.current_seconds
      END,
      previous_month = CASE
        WHEN m.current_month >= EXCLUDED.current_month THEN m.previous_month
        ELSE EXCLUDED.previous_month
      END,
      previous_seconds = CASE
        WHEN m.current_month >= EXCLUDED.current_month THEN m.previous_seconds
        WHEN m.current_month = EXCLUDED.previous_month THEN m.current_seconds
        ELSE 0
      END,
      updated_at = COALESCE(EXCLUDED.updated_at, m.updated_at)
    RETURNING m.owner_key AS "ownerKey"
  `) as unknown as { ownerKey: string }[];
  const [owner] = await listCallMinutes(row!.ownerKey, now);
  return owner!;
}

interface ListRow {
  userId: string | null;
  email: string | null;
  name: string | null;
  businessName: string | null;
  currentMonth: string | null;
  currentSeconds: number | null;
  previousMonth: string | null;
  previousSeconds: number | null;
  updatedAt: string | null;
}

/**
 * Minutes per business, busiest first. `ownerKey` narrows it to one account id, or to "unassigned".
 *
 * Every business with an agent number is listed, including those with no calls yet — a business at
 * zero is an answer, and leaving it out would read as "not tracked".
 */
export async function listCallMinutes(ownerKey?: string, now: Date = new Date()): Promise<OwnerCallMinutes[]> {
  const rows = (await sql`
    SELECT
      u.id               AS "userId",
      u.email,
      u.name,
      bp.business_name   AS "businessName",
      m.current_month    AS "currentMonth",
      m.current_seconds  AS "currentSeconds",
      m.previous_month   AS "previousMonth",
      m.previous_seconds AS "previousSeconds",
      m.updated_at       AS "updatedAt"
    FROM (
      SELECT owner_key FROM agent_call_minutes
      UNION
      SELECT user_id::text FROM agent_numbers WHERE user_id IS NOT NULL
    ) k
    LEFT JOIN agent_call_minutes m ON m.owner_key = k.owner_key
    LEFT JOIN users u ON u.id::text = k.owner_key
    LEFT JOIN business_profiles bp ON bp.user_id = u.id
    WHERE ${ownerKey === undefined ? sql`TRUE` : sql`k.owner_key = ${ownerKey}`}
  `) as unknown as ListRow[];

  const current = monthKey(now);
  return rows
    .map((r) => ({
      userId: r.userId,
      email: r.email,
      name: r.name,
      businessName: r.businessName,
      ...asOf(r.currentMonth === null ? null : (r as StoredTotals), current),
    }))
    .sort((a, b) => b.currentSeconds - a.currentSeconds || label(a).localeCompare(label(b)));
}

function label(owner: OwnerCallMinutes): string {
  return owner.businessName ?? owner.email ?? "￿"; // the unassigned bucket sorts last on a tie
}

/** Zero minutes for an account with no agent number and no calls — so a customer still gets a row. */
export function emptyMinutesFor(
  user: { id: string; email: string; name: string },
  now: Date = new Date(),
): OwnerCallMinutes {
  return { userId: user.id, email: user.email, name: user.name, businessName: null, ...asOf(null, monthKey(now)) };
}
