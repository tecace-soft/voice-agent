// The arithmetic behind a ranged usage total, kept away from the database so it can be read and
// tested on its own: what a valid range is, when a period's total stops changing, and which instant
// a reported call belongs to.

/** A year and a day: long enough for an annual report, short enough that a typo can't scan years. */
export const MAX_RANGE_DAYS = 366;

/**
 * The longest call this API will take, in seconds — a day. It is the ingest's cap on a reported
 * duration AND how far a reported start may lag its report before we disbelieve it, which is one
 * number stated once rather than the same literal written wherever a call's length is bounded.
 */
export const MAX_CALL_SECONDS = 86400;

export type ParsedRange =
  | { kind: "absent" }
  | { kind: "range"; from: Date; to: Date }
  | { kind: "error"; error: "invalid_range" | "range_too_long" };

// An instant, not a date: "2026-08-15" means different moments in different timezones, and a usage
// boundary that moves with the reader is a boundary nobody can reconcile.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function instant(value: string): Date | null {
  if (!INSTANT.test(value)) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  // Date silently rolls an impossible day over — "2026-02-30" parses as 2 March — and a boundary
  // that quietly moves to a day nobody asked for is worse than one that is refused. Day 0 of the
  // next month is the last day of this one; the 400-year shift keeps a four-digit year under 100
  // out of Date.UTC's two-digit-year mapping, the Gregorian calendar being identical across it.
  const [year, month, day] = value.slice(0, 10).split("-").map(Number) as [number, number, number];
  if (day < 1 || day > new Date(Date.UTC(year + 400, month, 0)).getUTCDate()) return null;
  return at;
}

/**
 * `from` inclusive, `to` exclusive, so back-to-back periods neither overlap nor leave a gap.
 * Both or neither: one bound alone is a caller mistake, and guessing the other would quietly answer
 * a different question than the one asked.
 */
export function parseRange(from: string | undefined, to: string | undefined): ParsedRange {
  if (from === undefined && to === undefined) return { kind: "absent" };
  if (from === undefined || to === undefined) return { kind: "error", error: "invalid_range" };

  const start = instant(from.trim());
  const end = instant(to.trim());
  if (!start || !end) return { kind: "error", error: "invalid_range" };
  // Equal bounds are an empty window: a caller bug, not an answer of zero.
  if (start.getTime() >= end.getTime()) return { kind: "error", error: "invalid_range" };
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86400_000) {
    return { kind: "error", error: "range_too_long" };
  }
  return { kind: "range", from: start, to: end };
}

/**
 * Whether a period's total can still rise. A call is only reported once it ends, so one that started
 * before `to` may still be running; after `settleSeconds` past `to` there is nothing left to arrive.
 *
 * That last step assumes no call runs longer than `settleSeconds`. The ingest accepts a duration of
 * up to MAX_CALL_SECONDS, so with the default hour a longer call CAN still arrive after a period has
 * read settled. Deliberate: the alternative is calling a month unsettled for a day because a call
 * might have run all night. Callers are told `settleSeconds`, so they can judge it themselves.
 */
export function isSettled(to: Date, now: Date, settleSeconds: number): boolean {
  return now.getTime() >= to.getTime() + settleSeconds * 1000;
}

/**
 * When a reported call started. The agent reports as the call ends, so arrival minus its length is
 * right to within the round-trip; an explicit `startedAt` is better and is used when it is credible.
 * A start in the future or absurdly far back means a wrong clock on the agent's host, and trusting it
 * would move a business's usage into the wrong period.
 */
export function startedAtFor(reported: string | undefined, seconds: number, reportedAt: Date): Date {
  const derived = new Date(reportedAt.getTime() - seconds * 1000);
  if (!reported) return derived;
  const at = instant(reported.trim());
  if (!at) return derived;
  const lag = reportedAt.getTime() - at.getTime();
  if (lag < 0 || lag > MAX_CALL_SECONDS * 1000) return derived;
  return at;
}
