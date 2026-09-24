import { reviewCall } from "../demo/callReview.js";
import type { CallReview, CallStatus, TranscriptEntry } from "../demo/types.js";
import { attachReview, finishCall } from "../db/demoWrite.js";

// What `routes/demo.ts` (the operator's side) and `routes/demoPublic.ts` (the prospect's) both need.
//
// It lives here rather than in either of them because of what sharing means in each case. The rate
// limiter has to be ONE map: two copies would each allow the full five dials a minute, so a caller
// who found both routes would get ten. The call report has to be ONE implementation: it caps and
// validates a transcript on its way into a JSONB column, and a second copy of those rules is a
// second set of rows that read back differently later.

/**
 * The promo's `lib/api.ts`, minus the three error classes it special-cased (`StoreConfigError`,
 * `OpenAIError`, `ClaudeCliError`) — none of which exists here, because neither Redis nor the Claude
 * CLI is in this path. What is left is its fallback, and its reason: an unhandled throw in a handler
 * returns an empty 500, which reaches the browser as "Unexpected end of JSON input" and tells nobody
 * anything. Every handler catches and comes through here instead.
 *
 * This returns the body rather than the response, because the status is Elysia's `status()` to set.
 */
export function jsonError(error: unknown): { error: string } {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[demo]", error);
  return { error: message };
}

// ---------------------------------------------------------------------------------------------
// The dial rate limit, from the promo's `app/api/session/route.ts`.
//
// On the public route this is the cheap ceiling in front of the three stored ones (the demo
// allowance, the per-prospect concurrency reservation and the global live-session seat). On the
// admin route it is the only one, by design: an operator has no allowance, and five dials a minute
// is far more than a person tests by hand while still stopping a retry loop left running.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

/**
 * A per-instance memory of who has dialled recently. Serverless runs many instances, so this thins
 * out bursts rather than enforcing an exact number; the real protection against one prospect running
 * up the bill is the demo allowance, which is stored and shared.
 */
const recentByIp = new Map<string, number[]>();

export function rateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (recentByIp.get(key) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  hits.push(now);
  recentByIp.set(key, hits);

  // Without this the map keeps every address this instance has ever seen.
  if (recentByIp.size > 5000) {
    for (const [ip, times] of recentByIp) {
      if (times.every((at) => now - at >= RATE_WINDOW_MS)) recentByIp.delete(ip);
    }
  }

  return hits.length > RATE_LIMIT;
}

/** The promo read this off the `Request`; Elysia has already parsed the headers. */
export function clientIp(headers: Record<string, string | undefined>): string {
  const forwarded = headers["x-forwarded-for"];
  return forwarded?.split(",")[0]?.trim() || "local";
}

// ---------------------------------------------------------------------------------------------
// The end-of-call report.

/**
 * How a call is allowed to have ended, the promo's `VALID`. Anything else — a stale client, a
 * truncated beacon, a `"started"` sent back at us — is recorded as `"abandoned"` rather than
 * refused, because the call did end and the report is the only chance to say so.
 */
const REPORTABLE: CallStatus[] = ["completed", "failed", "abandoned"];

/**
 * A transcript entry as the browser should have sent it. `speaker` and `text` are what every later
 * reader touches, so an entry without them is not repairable and is dropped; `id` and the two
 * timestamps only have to exist in the right shape.
 */
function isTranscriptEntry(entry: unknown): entry is TranscriptEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    (e.speaker === "caller" || e.speaker === "receptionist") &&
    typeof e.text === "string" &&
    typeof e.id === "string" &&
    typeof e.startMs === "number" &&
    typeof e.endMs === "number"
  );
}

/** What the browser sends when a call ends. Every field is unknown — see `applyCallReport`. */
export type CallReportBody = {
  customerId?: string;
  status?: unknown;
  durationSec?: unknown;
  endReason?: unknown;
  transcript?: unknown;
};

export type CallReportResult =
  | { kind: "missing" }
  | { kind: "alreadyReported" }
  | { kind: "failed"; error: { error: string } }
  | { kind: "recorded"; reviewed: boolean };

/**
 * Write down how a call ended, then read what it says about the product.
 *
 * Nothing here is refused for being malformed. A report that fails validation is a call that goes
 * unrecorded, and that is the one outcome this has no way to recover from — so every field decides
 * for itself what it will accept and falls back rather than erroring.
 *
 * The transcript is capped because it goes straight into a JSONB column from a browser, and each
 * entry is checked rather than cast. The promo cast the array and got away with it because Redis
 * held the record loosely; here the entries are stored permanently and then read back by
 * `analytics.ts` (`gapRollup`, `callerSaid`) and by `callReview`, which reach straight into
 * `entry.text` and `entry.speaker`. One malformed entry from a browser would be a row that makes a
 * later read throw, long after the call it came from. A bad entry is dropped, not rejected: the
 * recorded call matters more than a line of it.
 */
export async function applyCallReport(
  callId: string,
  body: CallReportBody,
): Promise<CallReportResult> {
  const reported = body.status as CallStatus;
  const ended = REPORTABLE.includes(reported) ? reported : "abandoned";
  const transcript = Array.isArray(body.transcript)
    ? body.transcript.slice(0, 500).filter(isTranscriptEntry)
    : [];
  const durationSec =
    typeof body.durationSec === "number" && body.durationSec >= 0
      ? Math.round(body.durationSec)
      : undefined;
  const endReason =
    typeof body.endReason === "string" ? body.endReason.slice(0, 120) : undefined;

  let outcome: Awaited<ReturnType<typeof finishCall>>;
  try {
    outcome = await finishCall(
      callId,
      {
        status: ended,
        endedAt: new Date().toISOString(),
        durationSec,
        endReason,
        turns: transcript.length,
        transcript,
      },
      // The promo read `body.customerId` first so its lookup could go straight to the right record
      // rather than walking every customer. A primary key needs no such help, so here it is only a
      // narrowing filter: sent, it still has to match.
      typeof body.customerId === "string" ? body.customerId : undefined,
    );
  } catch (error) {
    return { kind: "failed", error: jsonError(error) };
  }

  if (outcome.outcome === "missing") return { kind: "missing" };
  // A beacon can land after the normal report; keep the first result.
  if (outcome.outcome === "alreadyReported") return { kind: "alreadyReported" };

  // Read what the call says about the product while the transcript is in hand. Nobody is waiting on
  // this — the client reports and moves on — but the answer cannot go out before it has been stored,
  // so it is awaited here rather than left running.
  //
  // Everything about it is contained: `reviewCall` is documented never to throw and returns null on
  // any failure, and saving it is caught as well. The call is already recorded, and a review problem
  // must never be able to un-record it — the review can be asked for again from the admin.
  let review: CallReview | null = null;
  try {
    review = await reviewCall(outcome.call);
    if (review) await attachReview(outcome.call.id, review);
  } catch (error) {
    console.error("[demo]", error);
  }

  return { kind: "recorded", reviewed: Boolean(review) };
}
