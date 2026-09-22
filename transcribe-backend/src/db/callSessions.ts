import { toMinutes } from "./callMinutes.js";
import { sql } from "./client.js";

// Reads over agent_call_sessions: what a business used between two instants, and how far back the
// table can answer at all. The write lives in callMinutes.ts, inside the counter's transaction.

/** Seconds, minutes and calls for one owner over a range. */
export interface PeriodTotals {
  /** The exact figure, as currentSeconds is — minutes are the rounded reading of it. */
  periodSeconds: number;
  /** One decimal, like the monthly figures (see toMinutes). */
  periodMinutes: number;
  periodCalls: number;
}

/**
 * Per-owner totals for `from` (inclusive) to `to` (exclusive), by the call's start — a call counts
 * wholly in the period it started in, never split across two.
 *
 * `ownerKey` scopes the sum to one business, and the caller always passes the one whose rows it is
 * answering for: unscoped, a single-business read would sum every business's sessions, and the
 * (owner_key, started_at) index would go unused.
 *
 * Returned as a map keyed by owner_key so the caller can merge it into the rows it already has;
 * owners with no calls in the range are simply absent (the caller reads them as zero).
 */
export async function periodTotalsByOwner(
  from: Date,
  to: Date,
  ownerKey?: string,
): Promise<Map<string, PeriodTotals>> {
  // SUM is bigint, so ::int would throw on a total past 2^31 rather than answering; postgres.js
  // hands a bigint back as a string, which is why the seconds are put through Number() below.
  const rows = (await sql`
    SELECT owner_key           AS "ownerKey",
           SUM(seconds)::bigint AS "periodSeconds",
           COUNT(*)::int        AS "periodCalls"
    FROM agent_call_sessions
    WHERE started_at >= ${from}::timestamptz AND started_at < ${to}::timestamptz
      AND ${ownerKey === undefined ? sql`TRUE` : sql`owner_key = ${ownerKey}`}
    GROUP BY owner_key
  `) as unknown as { ownerKey: string; periodSeconds: string | number; periodCalls: number }[];

  return new Map(
    rows.map((r) => {
      const periodSeconds = Number(r.periodSeconds);
      // Summed in seconds and rounded once, so a period's minutes never drift with its number of calls.
      return [r.ownerKey, { periodSeconds, periodMinutes: toMinutes(periodSeconds), periodCalls: r.periodCalls }];
    }),
  );
}

/**
 * The earliest session on record, or null when there are none. Ranged totals can only cover calls
 * recorded since this table shipped; returning this lets a caller tell "nothing happened" apart from
 * "we weren't counting yet" instead of reading a confident zero.
 */
export async function earliestSessionAt(): Promise<string | null> {
  const [row] = (await sql`
    SELECT MIN(started_at) AS "earliest" FROM agent_call_sessions
  `) as unknown as { earliest: Date | null }[];
  return row?.earliest ? new Date(row.earliest).toISOString() : null;
}
