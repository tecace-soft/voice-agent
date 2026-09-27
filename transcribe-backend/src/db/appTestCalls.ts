import { randomBytes } from "node:crypto";
import { sql } from "./client.js";
import { jsonb } from "./jsonb.js";
import type { CallReview, TranscriptEntry } from "../demo/types.js";

// In-app test calls a business places on its own receptionist, and the monthly allowance they count
// against. The demo's test calls stay in demo_calls; these belong to an account.

export type TestCallStatus = "started" | "completed" | "failed" | "abandoned";

export interface TestCall {
  id: string;
  userId: string;
  placedBy: string | null;
  liveSessionId: string | null;
  startedAt: string;
  endedAt: string | null;
  status: TestCallStatus;
  durationSec: number | null;
  endReason: string | null;
  transcript: TranscriptEntry[];
  events: TestCallEvent[];
  review: CallReview | null;
}

/** What happened during a test call beyond the words: the simulated transfers, texts and messages. */
export type TestCallEvent = { at: string; type: string; data: Record<string, unknown> };

/** A test call with no report after this long is over, however it ended. The same rule as a demo's. */
export const STALE_TEST_CALL_MS = 10 * 60 * 1000;

const COLUMNS = sql`
  id,
  user_id         AS "userId",
  placed_by       AS "placedBy",
  live_session_id AS "liveSessionId",
  started_at      AS "startedAt",
  ended_at        AS "endedAt",
  status,
  duration_sec    AS "durationSec",
  end_reason      AS "endReason",
  transcript,
  events,
  review
`;

function toCall(row: Record<string, unknown>): TestCall {
  const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
  return { ...(row as unknown as TestCall), startedAt: iso(row.startedAt)!, endedAt: iso(row.endedAt) };
}

export async function startTestCall(userId: string, placedBy: string): Promise<TestCall> {
  const id = randomBytes(9).toString("base64url");
  const [row] = await sql`
    INSERT INTO app_test_calls (id, user_id, placed_by, status)
    VALUES (${id}, ${userId}, ${placedBy}, 'started')
    RETURNING ${COLUMNS}
  `;
  return toCall(row as Record<string, unknown>);
}

export async function attachTestSession(id: string, liveSessionId: string): Promise<void> {
  await sql`UPDATE app_test_calls SET live_session_id = ${liveSessionId} WHERE id = ${id}`;
}

/** No session came back, so there was no call: take the row back rather than count it. */
export async function deleteTestCall(id: string): Promise<void> {
  await sql`DELETE FROM app_test_calls WHERE id = ${id} AND status = 'started'`;
}

export async function findTestCall(id: string): Promise<TestCall | null> {
  const [row] = await sql`SELECT ${COLUMNS} FROM app_test_calls WHERE id = ${id}`;
  return row ? toCall(row as Record<string, unknown>) : null;
}

/**
 * Record how a test call ended. The first report wins: the browser reports on hang-up and again
 * from the unload path, and the second must not overwrite the first or ask for a second review.
 */
export async function finishTestCall(
  id: string,
  userId: string,
  result: {
    status: Exclude<TestCallStatus, "started">;
    durationSec?: number;
    endReason?: string;
    transcript: TranscriptEntry[];
    events: TestCallEvent[];
  },
): Promise<{ outcome: "missing" } | { outcome: "alreadyReported" } | { outcome: "recorded"; call: TestCall }> {
  const [row] = await sql`
    UPDATE app_test_calls SET
      status       = ${result.status},
      ended_at     = now(),
      duration_sec = ${result.durationSec ?? null},
      end_reason   = ${result.endReason ?? null},
      transcript   = ${jsonb(result.transcript)},
      events       = ${jsonb(result.events)}
    WHERE id = ${id} AND user_id = ${userId} AND status = 'started'
    RETURNING ${COLUMNS}
  `;
  if (row) return { outcome: "recorded", call: toCall(row as Record<string, unknown>) };
  const existing = await findTestCall(id);
  return existing && existing.userId === userId ? { outcome: "alreadyReported" } : { outcome: "missing" };
}

export async function attachTestReview(id: string, review: CallReview): Promise<void> {
  await sql`UPDATE app_test_calls SET review = ${jsonb(review)} WHERE id = ${id}`;
}

export async function listTestCalls(userId: string, limit = 20): Promise<TestCall[]> {
  const rows = await sql`
    SELECT ${COLUMNS} FROM app_test_calls
    WHERE user_id = ${userId}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;
  return (rows as Record<string, unknown>[]).map(toCall);
}

/**
 * Seconds of test calling this calendar month, in the business timezone. A finished call counts
 * its length; one still going counts the time so far (up to the stale limit), so two tabs cannot
 * both start a call on the last minute of the allowance.
 */
export async function testSecondsThisMonth(userId: string, timeZone: string): Promise<number> {
  const [row] = await sql`
    SELECT COALESCE(SUM(
      CASE
        WHEN status = 'started' AND started_at > now() - interval '10 minutes'
          THEN EXTRACT(EPOCH FROM (now() - started_at))
        ELSE COALESCE(duration_sec, 0)
      END
    ), 0)::int AS seconds
    FROM app_test_calls
    WHERE user_id = ${userId}
      AND started_at >= (date_trunc('month', now() AT TIME ZONE ${timeZone}) AT TIME ZONE ${timeZone})
  `;
  return Number((row as { seconds: number } | undefined)?.seconds ?? 0);
}

/** The account's own monthly allowance, or null for the service default. */
export async function testSecondsCap(userId: string): Promise<number | null> {
  const [row] = await sql`SELECT test_seconds_cap AS cap FROM users WHERE id = ${userId}`;
  const cap = (row as { cap: number | null } | undefined)?.cap;
  return typeof cap === "number" ? cap : null;
}

export async function setTestSecondsCap(userId: string, seconds: number | null): Promise<void> {
  await sql`UPDATE users SET test_seconds_cap = ${seconds} WHERE id = ${userId}`;
}
