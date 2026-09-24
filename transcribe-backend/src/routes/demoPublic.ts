import { Elysia, t } from "elysia";
import { env } from "../config/env.js";
import { demoAllowance, inFlightCalls } from "../demo/analytics.js";
import { callClock, safeTimeZone } from "../demo/callClock.js";
import { CALL_MAX_SEC, callLimitSec } from "../demo/callLimits.js";
import { OpenAIError, createLiveSession } from "../demo/openai.js";
import type { CallLog, Customer } from "../demo/types.js";
import { DEFAULT_DEMO_MINUTES } from "../demo/types.js";
import { getCustomer, listCalls, listLiveSessions } from "../db/demoRead.js";
import { attachLiveSession, deleteCall, recordPageView, startCall } from "../db/demoWrite.js";
import { applyCallReport, clientIp, jsonError, rateLimited } from "./demoCommon.js";

// The prospect's side of the demo: the page behind a `/c/<id>` link, and the call it places.
//
// **Nothing here is behind the admin guard, and that is the point.** A prospect has no sign-in; the
// nanoid in the link they were emailed is the only credential, exactly as it was on the promo. So
// every handler is written as if the id were guessable:
//
//  * the customer read sends a hand-picked field list and never the whole record — the operator's
//    notes, labels, contact details and call history stay on the admin side (see `publicView`);
//  * the dial is ceilinged four ways over (rate limit, demo allowance, per-prospect concurrency,
//    global live-session seat), because this is the route that spends money;
//  * the report writes only to the call it names, and cannot create one.
//
// These were three routes in the promo — `app/c/[id]/page.tsx` loading the customer server-side,
// `app/api/session/route.ts`, and `app/api/calls/[callId]/route.ts`. The first was a server
// component, so it had no HTTP shape of its own; the other two are ports, and the notes in them say
// where they differ.

/**
 * How many people may be on ONE prospect's demo at once.
 *
 * Several colleagues trying a demo together is the whole point, so this is not 1. But one busy demo
 * must not spend every session the other demos need — this is the fairness half of the two ceilings.
 */
const CONCURRENT_PER_CUSTOMER = 4;

/**
 * How many live sessions this deployment believes it may hold open across every prospect.
 *
 * gpt-live-1 is rate limited by concurrent sessions per OpenAI **organisation** — 25 on tier 1, 50
 * on tier 2, 200 on tier 3 (developers.openai.com/api/docs/models/gpt-live-1) — and a second API key
 * or project shares that pool rather than adding to it. Kept under the real figure on purpose: a
 * caller then hears "busy, try again" from us instead of a rate-limit error from OpenAI, and there is
 * headroom for the phone agent, which draws on the same organisation.
 *
 * Both of these are constants rather than settings. The promo read them from the environment and
 * nothing ever set them; a number that has only ever had its default is better read here, next to the
 * reasoning, than configured in three places. Raise them in code when the tier changes.
 */
const LIVE_SESSION_LIMIT = 20;

const BUSY_DEMO =
  "This demo already has as many people on it as it can take at once. Try again in a moment.";
const BUSY_EVERYWHERE = "All the demo lines are busy right now. Try again in a moment.";

/** Why a link does not open a demo. The page words each one; all three are a 404. */
type Unavailable = "missing" | "paused" | "preparing";

function unavailable(customer: Customer | null): Unavailable | null {
  if (!customer) return "missing";
  if (!customer.active) return "paused";
  if (customer.status !== "ready") return "preparing";
  return null;
}

/**
 * What the business itself should see, and nothing else.
 *
 * This is the prop list `app/c/[id]/page.tsx` built, which the promo pinned in
 * `tests/public-view.test.ts` for one reason: the page is public, so a field added to `Customer`
 * must not reach it just because it was added. `label`, `contactName`, `contactEmail`,
 * `operatorNotes`, `researchNotes`, `stage`, `followUpAt`, `demoMinutes` and the call history are all
 * the operator's, and none of them is here. `prompts.edited` is left off the same way — whether an
 * operator hand-edited the prompt is not the business's business.
 *
 * Kept as an explicit object rather than a delete-list so that adding a field is a decision someone
 * makes here, in the open. `demo/publicView.test.ts` fails if one appears without being listed.
 */
export function publicView(customer: Customer, demo: ReturnType<typeof demoAllowance>) {
  return {
    customerId: customer.id,
    name: customer.profile.name,
    category: customer.profile.category,
    address: customer.profile.address,
    phone: customer.profile.phone,
    agentName: customer.agentName,
    language: customer.language,
    // Sent raw. The page resolves both against the promo's own `lib/` copies it already carries
    // (`resolveCallSound`, `LIVE_VOICE_OPTIONS`), so the labels and the defaults live in one place —
    // the client — rather than being duplicated here where nothing renders them.
    callSound: customer.callSound,
    voice: customer.voice,
    profile: customer.profile,
    // The page shows these in its Prompt tab, deliberately: the business is meant to be able to read
    // what its receptionist has been told. Same as the promo.
    prompts: {
      live: customer.prompts.live,
      backend: customer.prompts.backend,
      greeting: customer.prompts.greeting,
    },
    dossier: customer.dossier,
    sources: customer.sources,
    researchedAt: customer.researchedAt,
    demo,
  };
}

export const demoPublic = new Elysia({ prefix: "/demo/public" })
  /**
   * The demo behind a `/c/<id>` link.
   *
   * The promo loaded this in a server component and called `notFound()` for all three unavailable
   * cases at once. Here the reason comes with the 404, because the operator's Share tab promises a
   * specific one ("the link shows an unavailable message" for a paused demo) and the page cannot word
   * it without being told. Saying which is no disclosure: knowing an id exists requires already
   * holding the id.
   *
   * A failure reading the allowance must not take the page down — the promo's own note — so the
   * prospect gets the full allowance and a working call button rather than a locked-out one. A
   * failure reading the *customer* is a 500: there is no page to show without it.
   */
  .get(
    "/customers/:id",
    async ({ params, status }) => {
      let customer: Customer | null;
      try {
        customer = await getCustomer(params.id);
      } catch (error) {
        return status(500, jsonError(error));
      }

      const why = unavailable(customer);
      if (why || !customer) return status(404, { error: "This demo isn't available.", reason: why });

      const minutes = customer.demoMinutes ?? DEFAULT_DEMO_MINUTES;
      let demo = demoAllowance([], minutes);
      try {
        demo = demoAllowance(await listCalls(customer.id), minutes);
      } catch (error) {
        console.error(`[demo] could not read demo usage for ${customer.id}:`, error);
      }

      return { customer: publicView(customer, demo) };
    },
    { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )

  /**
   * Someone opened a demo page — the promo's `POST /api/track`, which only ever carried this one
   * event. It is what the Overview's view counts and `distinctVisitors` are built from.
   *
   * Answers `{ ok: true }` for anything it will not record, including an unknown customer. The page
   * fires this and forgets it; there is nothing for it to do with a refusal, and a demo that fails
   * to open because a counter said no would be the worse outcome. A bad id writes nothing — the
   * foreign key would refuse it anyway — and is not worth telling a caller about.
   */
  .post(
    "/track",
    async ({ body }) => {
      if (body.event !== "page_view" || typeof body.customerId !== "string") return { ok: true };
      try {
        const customer = await getCustomer(body.customerId);
        if (!customer) return { ok: true };
        await recordPageView(
          customer.id,
          typeof body.visitorId === "string" ? body.visitorId.slice(0, 64) : undefined,
        );
      } catch (error) {
        console.error("[demo]", error);
      }
      return { ok: true };
    },
    {
      body: t.Object({
        customerId: t.Optional(t.Unknown()),
        event: t.Optional(t.Unknown()),
        visitorId: t.Optional(t.Unknown()),
      }),
    },
  )

  /**
   * Open a call: the browser's SDP offer goes out to OpenAI's live API and the answer comes back.
   *
   * This is the promo's `app/api/session/route.ts` along the path it took when `isTest` was false —
   * every ceiling included. The one structural change is the global seat: the promo kept a Redis set
   * (`markLive` / `listLiveSessions`) because Redis could not answer "which calls are live" across
   * customers, and Postgres can, so `listLiveSessions()` asks the table and there is no set to write,
   * expire, or disagree with the rows.
   *
   * `isTest` is gone from the body. The promo accepted it here and authorised it with an admin
   * cookie, because one route served both the prospect and the operator's test panel; those are two
   * routes here, and this one cannot make a test call however it is asked.
   */
  .post(
    "/session",
    async ({ body, headers, status }) => {
      const { customerId, sdp } = body;
      if (!customerId || !sdp) {
        return status(400, { error: "Missing customerId or sdp." });
      }

      const ip = clientIp(headers);
      if (rateLimited(ip)) {
        return status(429, { error: "Too many calls in a row. Wait a minute and try again." });
      }

      let customer: Customer | null;
      try {
        customer = await getCustomer(customerId);
      } catch (error) {
        return status(500, jsonError(error));
      }
      const why = unavailable(customer);
      if (why === "missing" || !customer) {
        return status(404, { error: "This demo isn't available." });
      }
      if (why === "paused") return status(403, { error: "This demo is paused." });
      if (why === "preparing") {
        return status(409, { error: "This demo is still being prepared." });
      }

      // The demo is a fixed amount of time per prospect. Running out is the nudge: the page then
      // offers the contact form instead of the call button.
      let maxSec = CALL_MAX_SEC;
      try {
        const calls = await listCalls(customer.id);
        if (inFlightCalls(calls).length >= CONCURRENT_PER_CUSTOMER) {
          return status(429, { error: BUSY_DEMO });
        }
        const allowance = demoAllowance(calls, customer.demoMinutes ?? DEFAULT_DEMO_MINUTES);
        if (allowance.exhausted) {
          return status(403, {
            error: `This demo has used its ${Math.round(
              allowance.allowedSec / 60,
            )} minutes. Ask us for more and we will open it back up.`,
            exhausted: true,
          });
        }
        // How long this one call may run. The browser hangs up when it is reached, so a demo cannot
        // be overrun by one long call.
        maxSec = callLimitSec(allowance.remainingSec);
      } catch (error) {
        return status(500, jsonError(error));
      }

      // The record is written before OpenAI is asked for a session, so that the next person to dial
      // can see this call already counting. Creating it afterwards left a window the width of an
      // OpenAI round trip in which every simultaneous caller read an empty demo and was waved
      // through.
      let call: CallLog;
      try {
        call = await startCall({
          customerId: customer.id,
          userAgent: headers["user-agent"],
          isTest: false,
          visitorId: typeof body.visitorId === "string" ? body.visitorId.slice(0, 64) : undefined,
        });
      } catch (error) {
        return status(500, jsonError(error));
      }

      // Reserving and then looking again is what makes the cap hold when several people dial in the
      // same instant: checking first and writing second leaves a gap in which everyone reads an empty
      // demo. Whoever is holding the oldest reservations keeps them, decided the same way on every
      // instance, and the rest stand down.
      try {
        const inFlight = inFlightCalls(await listCalls(customer.id)).sort(
          (a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id),
        );
        if (inFlight.findIndex((entry) => entry.id === call.id) >= CONCURRENT_PER_CUSTOMER) {
          await deleteCall(customer.id, call.id).catch(() => undefined);
          return status(429, { error: BUSY_DEMO });
        }

        // And the same again for the account as a whole, so we run out of demo lines politely rather
        // than being cut off by OpenAI.
        const everywhere = await listLiveSessions();
        everywhere.sort(
          (a, b) => a.startedAtMs - b.startedAtMs || a.callId.localeCompare(b.callId),
        );
        if (everywhere.findIndex((entry) => entry.callId === call.id) >= LIVE_SESSION_LIMIT) {
          await deleteCall(customer.id, call.id).catch(() => undefined);
          return status(429, { error: BUSY_EVERYWHERE });
        }
      } catch (error) {
        await deleteCall(customer.id, call.id).catch(() => undefined);
        return status(500, jsonError(error));
      }

      // The stored prompts cannot know what day it is, so the date goes on here, per call, and onto
      // both: the voice hears "tomorrow" and the model it delegates to is the one that takes the
      // booking.
      const clock = callClock(
        new Date(),
        safeTimeZone(body.timeZone, env.defaultTimezone),
        customer.profile.hours,
      );

      try {
        const session = await createLiveSession(
          {
            model: env.openaiLiveModel,
            instructions: `${customer.prompts.live}\n\n${clock}`,
            audio: { output: { voice: customer.voice } },
            delegation: {
              type: "responses",
              responses: {
                model: env.openaiBackendModel,
                instructions: `${customer.prompts.backend}\n\n${clock}`,
              },
            },
            store: false,
          },
          sdp,
        );

        await attachLiveSession(call.id, session.id);

        return {
          callId: call.id,
          sessionId: session.id,
          sdp: session.sdp,
          greeting: customer.prompts.greeting,
          maxSec,
        };
      } catch (error) {
        // No session means no call. Take the reservation back rather than leaving a record that
        // spends the allowance and holds a seat for the ten minutes it takes to age out.
        await deleteCall(customer.id, call.id).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        console.error("[demo]", error);
        return status(error instanceof OpenAIError ? error.status : 500, { error: message });
      }
    },
    {
      body: t.Object({
        customerId: t.Optional(t.String({ maxLength: 64 })),
        sdp: t.Optional(t.String()),
        timeZone: t.Optional(t.Unknown()),
        visitorId: t.Optional(t.Unknown()),
      }),
    },
  )

  /**
   * How the call ended, from the browser that made it.
   *
   * The same implementation as the operator's report — see `applyCallReport`, which owns the rules
   * about what a browser is allowed to write into the transcript column. There is no guard, and it
   * needs none: it can only finish a call that already exists and is still `started`, it creates
   * nothing, and a second report changes nothing.
   *
   * The promo's `clearLive(call)` is gone with the live set: finishing the row is what frees the
   * seat, because `listLiveSessions()` reads the rows.
   */
  .post(
    "/calls/:callId",
    async ({ body, params, status }) => {
      const outcome = await applyCallReport(params.callId, body);
      if (outcome.kind === "failed") return status(500, outcome.error);
      if (outcome.kind === "missing") return status(404, { error: "Call not found." });
      if (outcome.kind === "alreadyReported") return { ok: true, alreadyReported: true };
      return { ok: true, reviewed: outcome.reviewed };
    },
    {
      params: t.Object({ callId: t.String({ maxLength: 64 }) }),
      // Unknown throughout, deliberately: `applyCallReport` decides for itself what each field will
      // accept, and a report that fails validation is a call that goes unrecorded — the one outcome
      // this route has no way to recover from.
      body: t.Object({
        customerId: t.Optional(t.String()),
        status: t.Optional(t.Unknown()),
        durationSec: t.Optional(t.Unknown()),
        endReason: t.Optional(t.Unknown()),
        transcript: t.Optional(t.Unknown()),
      }),
    },
  );
