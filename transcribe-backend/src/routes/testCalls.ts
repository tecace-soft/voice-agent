import { Elysia, t } from "elysia";
import { authenticate, authenticateAdmin, UNAUTHORIZED } from "../auth/guard.js";
import { env } from "../config/env.js";
import { findProfile } from "../db/businessProfiles.js";
import { findCallSettings } from "../db/callSettings.js";
import { findUserById } from "../db/users.js";
import {
  STALE_TEST_CALL_MS,
  attachTestReview,
  attachTestSession,
  deleteTestCall,
  finishTestCall,
  listTestCalls,
  setTestSecondsCap,
  startTestCall,
  testSecondsCap,
  testSecondsThisMonth,
  type TestCallEvent,
} from "../db/appTestCalls.js";
import { CALL_MAX_SEC, callLimitSec } from "../demo/callLimits.js";
import { reviewCall } from "../demo/callReview.js";
import { OpenAIError, createLiveSession } from "../demo/openai.js";
import type { CallLog, TranscriptEntry } from "../demo/types.js";
import { composeSession } from "../session/compose.js";
import { bookingTargetFor } from "../calendar/service.js";
import { liveSessionConfig } from "../session/live.js";
import { fromBusinessRow } from "../session/records.js";
import { clientIp, rateLimited } from "./demoCommon.js";

// In-app test calls for a real business: the receptionist exactly as its callers will get it, over
// the browser instead of a phone line, with the business's DRAFT call settings so a transfer or a
// link can be tried before it is published. The session is built by the same composer the phone
// agent uses; what the browser does with a tool call is simulated there (src/settings/simulator).
//
// Customers may place them, against a monthly allowance, because tuning is theirs to do and every
// minute is a real, billed GPT-Live minute. Admins are not held to the allowance.
//
// Same wire shape as the demo's test call (`POST /session`, `POST /calls/:id`), so the dashboard's
// call hook is shared: it only changes which base path it dials through.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function targetFor(user: { id: string; role: string }, requested?: string): string {
  if (user.role !== "admin") return user.id;
  const wanted = requested?.trim();
  return wanted && UUID.test(wanted) ? wanted : user.id;
}

async function allowance(userId: string) {
  const [used, own] = await Promise.all([testSecondsThisMonth(userId, env.timezone), testSecondsCap(userId)]);
  const cap = own ?? env.testSecondsPerMonth;
  return { usedSec: used, capSec: cap, remainingSec: Math.max(0, cap - used) };
}

const REPORTABLE = ["completed", "failed", "abandoned"] as const;

function isEntry(entry: unknown): entry is TranscriptEntry {
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

function isEvent(entry: unknown): entry is TestCallEvent {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return typeof e.type === "string" && e.type.length <= 40 && typeof e.at === "string" && typeof e.data === "object";
}

export const testCalls = new Elysia({ prefix: "/business/test" })
  .post(
    "/session",
    async ({ body, headers, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const target = targetFor(user, body.customerId);
      if (!body.sdp) return status(400, { error: "Missing sdp." });
      if (rateLimited(`test:${clientIp(headers)}`)) {
        return status(429, { error: "Too many calls in a row. Wait a minute and try again." });
      }

      const [row, settings, booking] = await Promise.all([
        findProfile(target),
        findCallSettings(target),
        bookingTargetFor(target),
      ]);
      const record = row ? fromBusinessRow(row) : null;
      if (!record) {
        return status(409, { error: "Add your business information first — there's nothing to test yet." });
      }

      let maxSec = CALL_MAX_SEC;
      if (user.role !== "admin") {
        const left = await allowance(target);
        if (left.remainingSec < 15) {
          return status(403, {
            error: "You've used this month's test-call minutes. Ask us if you need more.",
            exhausted: true,
          });
        }
        maxSec = callLimitSec(left.remainingSec);
      }

      const call = await startTestCall(target, user.id);
      const session = composeSession({
        record,
        callSettings: settings.draft,
        channel: "app-test",
        now: new Date(),
        timeZone: settings.draft.timezone ?? env.timezone,
        waterfallAllowed: settings.waterfallAllowed,
        neverPublished: settings.published === null,
        booking,
      });
      try {
        const live = await createLiveSession(liveSessionConfig(session), body.sdp);
        await attachTestSession(call.id, live.id);
        return { callId: call.id, sessionId: live.id, sdp: live.sdp, greeting: session.greeting, maxSec };
      } catch (error) {
        await deleteTestCall(call.id).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        return status(error instanceof OpenAIError ? error.status : 500, { error: message });
      }
    },
    {
      body: t.Object({
        customerId: t.Optional(t.String({ maxLength: 64 })),
        sdp: t.Optional(t.String({ maxLength: 20_000 })),
        timeZone: t.Optional(t.Unknown()),
        isTest: t.Optional(t.Unknown()),
      }),
    },
  )

  // How a test call ended. Nothing is refused for being malformed — a bad transcript line or event
  // is dropped, not the report — and the first report wins.
  .post(
    "/calls/:callId",
    async ({ body, headers, params, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const target = targetFor(user, body.customerId);
      const reported = REPORTABLE.find((s) => s === body.status) ?? "abandoned";
      const transcript = Array.isArray(body.transcript) ? body.transcript.slice(0, 500).filter(isEntry) : [];
      const events = Array.isArray(body.events) ? body.events.slice(0, 200).filter(isEvent) : [];
      const outcome = await finishTestCall(params.callId, target, {
        status: reported,
        durationSec:
          typeof body.durationSec === "number" && body.durationSec >= 0
            ? Math.min(Math.round(body.durationSec), CALL_MAX_SEC + 60)
            : undefined,
        endReason: typeof body.endReason === "string" ? body.endReason.slice(0, 120) : undefined,
        transcript,
        events,
      });
      if (outcome.outcome === "missing") return status(404, { error: "Call not found." });
      if (outcome.outcome === "alreadyReported") return { ok: true, reviewed: false };
      // The same reviewer as a demo's test call: it reads only the transcript.
      const review = await reviewCall({ transcript: outcome.call.transcript } as CallLog);
      if (review) await attachTestReview(outcome.call.id, review).catch(() => undefined);
      return { ok: true, reviewed: Boolean(review) };
    },
    {
      params: t.Object({ callId: t.String({ maxLength: 64 }) }),
      body: t.Object({
        customerId: t.Optional(t.String({ maxLength: 64 })),
        status: t.Optional(t.Unknown()),
        durationSec: t.Optional(t.Unknown()),
        endReason: t.Optional(t.Unknown()),
        transcript: t.Optional(t.Unknown()),
        events: t.Optional(t.Unknown()),
      }),
    },
  )

  // The Test & improve section: recent test calls with their reviews, and this month's allowance.
  .get(
    "/calls",
    async ({ headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const target = targetFor(user, query.userId);
      const [calls, left] = await Promise.all([listTestCalls(target), allowance(target)]);
      const now = Date.now();
      return {
        calls: calls.map((c) =>
          // A call nobody reported is over by now, whatever the row still says.
          c.status === "started" && now - new Date(c.startedAt).getTime() > STALE_TEST_CALL_MS
            ? { ...c, status: "abandoned" as const }
            : c,
        ),
        usage: { ...left, unlimited: user.role === "admin" },
      };
    },
    { query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }) },
  )

  // An admin raising or lowering one account's allowance. Null goes back to the service default.
  .put(
    "/cap",
    async ({ body, headers, query, status }) => {
      const caller = await authenticateAdmin(headers.authorization, "Only an admin can change test-call minutes.");
      if ("denied" in caller) return status(caller.denied, caller.body);
      const target = query.userId?.trim();
      if (!target || !UUID.test(target)) return status(400, { error: "missing_user", message: "Say which account." });
      if (!(await findUserById(target))) return status(404, { error: "not_found", message: "No such account." });
      await setTestSecondsCap(target, body.seconds === null ? null : Math.round(body.seconds));
      return { usage: await allowance(target) };
    },
    {
      query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }),
      body: t.Object({ seconds: t.Union([t.Number({ minimum: 0, maximum: 36_000 }), t.Null()]) }),
    },
  );
