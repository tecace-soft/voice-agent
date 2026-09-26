import { Elysia, t } from "elysia";
import { authenticateAdmin, authenticateDemo, ownsDemo } from "../auth/guard.js";
import { env } from "../config/env.js";
import {
  activityFeed,
  callsPerDay,
  computeKpis,
  computeStats,
  countableCalls,
  emptyStats,
  engagement,
  extendDemoMinutes,
  heatByCustomer,
  statsByCustomer,
  testCalls,
  withinDays,
} from "../demo/analytics.js";
import { callClock, safeTimeZone } from "../demo/callClock.js";
import { CALL_MAX_SEC } from "../demo/callLimits.js";
import { reviewCall, reviewable } from "../demo/callReview.js";
import { isMapsUrl } from "../demo/maps.js";
import { OpenAIError, createLiveSession } from "../demo/openai.js";
import { researchBusiness } from "../demo/research.js";
import { applyCallReport, clientIp, jsonError, rateLimited } from "./demoCommon.js";
import type {
  BusinessProfile,
  CallLog,
  CallReview,
  CallSound,
  CallStatus,
  CrmNote,
  Customer,
  CustomerPrompts,
  CustomerStage,
  CustomerStats,
  Engagement,
  ResearchInputs,
  TrackEvent,
  TranscriptEntry,
} from "../demo/types.js";
import { CUSTOMER_STAGES, DEFAULT_DEMO_MINUTES } from "../demo/types.js";
import {
  getCustomer,
  listAllCalls,
  listCalls,
  listCustomers,
  listNotes,
  readEvents,
} from "../db/demoRead.js";
import type { CustomerPatch } from "../db/demoWrite.js";
import { lifecycleByDemo, withLifecycle } from "../db/customerLifecycle.js";
import { findUserByBusinessId, toPublicUser } from "../db/users.js";
import { PromotionError, startOnboarding } from "../business/promote.js";
import {
  addNote,
  attachLiveSession,
  attachReview,
  createCustomer,
  deleteCall,
  deleteCustomer,
  failResearch,
  finishCall,
  patchCall,
  patchCustomer,
  saveResearch,
  startCall,
  startResearch,
} from "../db/demoWrite.js";

// The Demo tabs' reads. Each handler is the promo's own route handler
// (app/api/admin/{analytics,customers,customers/[id],crm}/route.ts) with its `lib/store` and
// `lib/calls` loaders swapped for `db/demoRead.ts`'s and its `NextResponse.json` for Elysia's
// return — the shaping between those two points is left exactly as it was. That is deliberate: the
// dashboard's Demo screens are verbatim ports of the promo's and parse these bodies field for
// field, so a tidier `topCustomers` or a renamed `realCallCount` is a broken screen, not a cleanup.
//
// Admin-only, through the same `authenticateAdmin` guard as the rest of this API, WITH TWO
// EXCEPTIONS — `GET /customers/:id` and `PATCH /customers/:id`, which a demo-stage customer may use
// on their own record so they can read and correct the receptionist we built for them. Both go
// through `authenticateDemo` and check `ownsDemo`; everything else on this file is the operator's
// pipeline and stays admin-only, which is also the safe default for anything added later.
//
// What the admin guard rules out either way: it resolves a *user* token, so an API key — which
// `src/routes/usage.ts` accepts for the usage numbers — cannot reach any of this. Demo data is
// every prospect's contact details and call transcripts, which is not what a machine key is for.

const DEMO_IS_ADMIN = "Only an admin can read the demo data.";

// Said to a signed-in customer who is not in the demo stage, and to one whose account has no demo
// record behind it. Both are "there is nothing here for you", not "you got it wrong".
const DEMO_NOT_YOURS = "Only an admin can read other customers' demos.";

/** The route's own not-found, reused for somebody else's record — see `ownsDemo` for why. */
const NO_SUCH_CUSTOMER = { error: "Customer not found." } as const;

/**
 * What a demo-stage customer may change about their own record: the receptionist, and nothing else.
 *
 * Everything left out is the operator's side of the deal — the demo allowance and how much time to
 * add to it, whether the demo is still active, the sales stage and follow-up dates, the contact
 * details and the operator's private notes, and the research inputs that cost money to re-run. A
 * customer who could set `addDemoMinutes` would have an unmetered line; one who could set `stage`
 * would be editing our pipeline.
 */
const CUSTOMER_MAY_EDIT = [
  "profile",
  "prompts",
  "regeneratePrompts",
  "agentName",
  "voice",
  "language",
  "callSound",
] as const;

/** The promo's `lib/types.ts` shape for a row of the customers table. */
type CustomerWithStats = Customer & {
  stats: CustomerStats;
  heat: Engagement;
};

/**
 * Every prospect's notes at once, each tagged with whose it is, for the CRM feed that reads across
 * the whole pipeline — the promo's `lib/crm.ts` `listAllNotes`, kept here because `demoRead.ts`
 * exposes the per-customer read that the rest of these handlers need. The fan-out is one small
 * query per customer against an indexed column, over the tens of records an operator's list holds,
 * and the reads go out together.
 */
async function listAllNotes(
  customerIds: string[],
): Promise<(CrmNote & { customerId: string })[]> {
  const perCustomer = await Promise.all(
    customerIds.map(async (customerId) =>
      (await listNotes(customerId)).map((note) => ({ ...note, customerId })),
    ),
  );
  return perCustomer.flat().sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The promo's `runResearch`, from the bottom of `app/api/admin/customers/route.ts`: research the
 * business, store what came back, and on a failure mark the record rather than leave it silent.
 *
 * `saveResearch` and `failResearch` return `null` when the record has gone in the meantime, which
 * is the promo's own `const current = await getCustomer(id); if (!current) return;` — a prospect
 * deleted while its research was in flight must not be resurrected by the run finishing.
 *
 * This never throws. It is called without being awaited, so a rejection here would be an unhandled
 * promise rejection, which on Node is a process-level event and on Bun prints and carries on —
 * neither of which is a way to report that one prospect's research failed. Even the write on the
 * failure path is guarded, because it is the write most likely to be the thing that broke.
 */
async function runResearch(id: string, inputs: ResearchInputs): Promise<void> {
  try {
    const result = await researchBusiness(inputs);
    await saveResearch(id, result);
  } catch (error) {
    console.error("[demo] research failed", error);
    try {
      await failResearch(id, error instanceof Error ? error.message : String(error));
    } catch (saveError) {
      console.error("[demo] could not record the research failure", saveError);
    }
  }
}

/**
 * Research still in flight, so something can wait for it.
 *
 * Two callers, and they want it for opposite reasons. A test awaits `pendingResearch()` because a
 * background run is otherwise a race it would have to sleep on. A shutdown would await it to give
 * the run a chance to land.
 *
 * **The failure mode this set describes rather than fixes.** Nothing here can survive the process
 * going away. `POST /customers` answers 201 the instant the row is written and the run continues on
 * borrowed time: a container restart, a deploy, or a serverless host freezing the function once the
 * response is flushed all end it wherever it had got to, and the prospect is left at
 * `status: "researching"` with no run attached to it. Neither `saveResearch` nor `failResearch`
 * ever fires, so nothing marks it. The promo has exactly this hole — `after()` keeps the function
 * alive but cannot outlive the invocation either — and names it: `isResearchStalled` reads a
 * "researching" record older than 15 minutes as stalled, which is the dashboard's cue to offer
 * "Re-research". `POST /demo/customers/:id/research` is that way out, and it runs *inside* the
 * request, so it either finishes or returns a 502 saying why.
 */
const inFlightResearch = new Set<Promise<void>>();

function startBackgroundResearch(id: string, inputs: ResearchInputs): void {
  const task = runResearch(id, inputs);
  inFlightResearch.add(task);
  void task.finally(() => inFlightResearch.delete(task));
}

/** Resolves once every background run started so far has finished. */
export function pendingResearch(): Promise<void> {
  return Promise.all([...inFlightResearch]).then(() => undefined);
}

/**
 * The promo's `LIVE_VOICES` — the `id` of each entry of `LIVE_VOICE_OPTIONS` in `lib/types.ts`, in
 * its order. Only the ids are copied: the labels, accents and presentations are the promo's voice
 * picker's, and nothing here renders one. The list exists so an unknown `voice` on a PATCH is the
 * promo's own 400 rather than a receptionist configured to speak in a voice that does not exist.
 */
const LIVE_VOICES: string[] = [
  "gleam",
  "meridian",
  "delta",
  "cinder",
  "quartz",
  "ripple",
  "vesper",
  "willow",
  "stone",
  "beacon",
  "bossa",
  "tempo",
];

// The dial rate limit, the error body and the end-of-call report now live in `demoCommon.ts`:
// the prospect-facing routes in `demoPublic.ts` need the same three, and the limiter in particular
// has to be one shared map rather than a copy per route file.

export const demo = new Elysia({ prefix: "/demo" })
  // The Overview tab: the KPIs, the calls-per-day chart, the busiest prospects, the latest calls.
  .get(
    "/analytics",
    async ({ headers, query, status }) => {
      const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const days = Number(query.days ?? 30);
      const window = [7, 30, 90].includes(days) ? days : 30;
      // The operator's own test calls are hidden by default, because they would
      // flatter every number. This is how they look at them anyway.
      const includeTests = query.includeTests === "1";

      let customers: Customer[], calls: CallLog[], events: TrackEvent[];
      try {
        [customers, calls, events] = await Promise.all([
          listCustomers(),
          listAllCalls(),
          readEvents(),
        ]);
      } catch (error) {
        return status(500, jsonError(error));
      }

      // Everything but the customer count is scoped to the period on screen.
      const windowRaw = withinDays(calls, window, (call) => call.startedAt);
      const counted = includeTests
        ? calls.map((call) => ({ ...call, isTest: false }))
        : calls;
      const windowCalls = withinDays(counted, window, (call) => call.startedAt);
      const windowEvents = withinDays(events, window, (event) => event.at);

      const stats = statsByCustomer(windowCalls, windowEvents);
      const kpis = computeKpis(
        customers.map((customer) => customer.id),
        stats,
      );

      const nameFor = new Map(customers.map((c) => [c.id, c.profile.name || c.mapsUrl]));
      const contactFor = new Map(customers.map((c) => [c.id, c.contactName ?? ""]));

      const topCustomers = customers
        .map((customer) => ({
          id: customer.id,
          name: customer.profile.name || "Unnamed",
          minutes: Math.round(((stats[customer.id] ?? emptyStats()).totalSec / 60) * 10) / 10,
          calls: (stats[customer.id] ?? emptyStats()).calls,
        }))
        .filter((entry) => entry.calls > 0)
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 8);

      const recentCalls = calls.slice(0, 20).map((call) => ({
        id: call.id,
        customerId: call.customerId,
        customerName: nameFor.get(call.customerId) ?? "Deleted customer",
        contactName: contactFor.get(call.customerId) ?? "",
        startedAt: call.startedAt,
        durationSec: call.durationSec ?? 0,
        status: call.status,
        isTest: call.isTest,
        turns: call.turns ?? call.transcript.length,
      }));

      return {
        kpis,
        window,
        callsPerDay: callsPerDay(counted, window),
        topCustomers,
        recentCalls,
        realCallCount: countableCalls(calls).length,
        // What is being left out, so a zero on the dashboard can explain itself.
        testCallCount: testCalls(windowRaw).length,
        includeTests,
      };
    },
    {
      // Both arrive as strings and are read exactly as the promo read them off `searchParams`: an
      // unrecognised `days` falls back to 30, and only "1" turns the test calls on.
      query: t.Object({
        days: t.Optional(t.String({ maxLength: 8 })),
        includeTests: t.Optional(t.String({ maxLength: 8 })),
      }),
    },
  )

  // The Prospects tab: every customer, with its all-time stats and heat alongside.
  .get("/customers", async ({ headers, status }) => {
    const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
    if ("denied" in caller) return status(caller.denied, caller.body);

    try {
      const [customers, calls, events, lifecycle] = await Promise.all([
        listCustomers(),
        listAllCalls(),
        readEvents(),
        lifecycleByDemo(),
      ]);
      const stats = statsByCustomer(calls, events);
      const heat = heatByCustomer(calls, stats);
      const withStats: CustomerWithStats[] = customers.map((customer) => ({
        ...withLifecycle(customer, lifecycle),
        stats: stats[customer.id] ?? emptyStats(),
        heat: heat[customer.id] ?? engagement(emptyStats(), []),
      }));
      return { customers: withStats };
    } catch (error) {
      return status(500, jsonError(error));
    }
  })

  // One prospect's page: the record, its all-time stats, and its calls, views and notes.
  //
  // Shared with the customer whose record it is. They get the same shape minus the operator's notes:
  // those are what we write about a deal, and a CRM note is not something the other party reads.
  .get(
    "/customers/:id",
    async ({ headers, params, status }) => {
      const caller = await authenticateDemo(headers.authorization, DEMO_NOT_YOURS);
      if ("denied" in caller) return status(caller.denied, caller.body);
      if (!ownsDemo(caller, params.id)) return status(404, NO_SUCH_CUSTOMER);

      const { id } = params;
      let customer: Customer | null, calls: CallLog[], events: TrackEvent[], notes: CrmNote[];
      try {
        customer = await getCustomer(id);
        if (!customer) {
          return status(404, { error: "Customer not found." });
        }
        // Only this customer's views; no need to read every other one's.
        let lifecycle;
        [calls, events, notes, lifecycle] = await Promise.all([
          listCalls(id),
          readEvents(id),
          listNotes(id),
          lifecycleByDemo(id),
        ]);
        customer = withLifecycle(customer, lifecycle);
      } catch (error) {
        return status(500, jsonError(error));
      }
      const stats = computeStats(
        calls,
        events.filter((event) => event.customerId === id),
      );
      return { customer, stats, calls, events, notes: caller.scope === "all" ? notes : [] };
    },
    { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )

  /**
   * Everything the pipeline board and its activity feed need, in one read.
   *
   * The board is a whole-pipeline view, so it cannot be assembled a customer at
   * a time the way the detail page is. Stats are all-time here rather than
   * windowed: a prospect who went quiet three weeks ago is exactly who the
   * operator is looking for, and a 30 day window would hide them.
   */
  .get("/crm", async ({ headers, status }) => {
    const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
    if ("denied" in caller) return status(caller.denied, caller.body);

    try {
      const [customers, calls, events, lifecycle] = await Promise.all([
        listCustomers(),
        listAllCalls(),
        readEvents(),
        lifecycleByDemo(),
      ]);
      const notes = await listAllNotes(customers.map((customer) => customer.id));

      const stats = statsByCustomer(calls, events);
      const heat = heatByCustomer(calls, stats);

      const withStats: CustomerWithStats[] = customers.map((customer) => ({
        ...withLifecycle(customer, lifecycle),
        stats: stats[customer.id] ?? emptyStats(),
        heat: heat[customer.id] ?? engagement(emptyStats(), []),
      }));

      return {
        customers: withStats,
        feed: activityFeed(
          {
            customers: customers.map((customer) => ({
              id: customer.id,
              name: customer.profile.name || customer.businessName || "Unnamed",
            })),
            notes,
            events,
            calls,
          },
          40,
        ),
      };
    } catch (error) {
      return status(500, jsonError(error));
    }
  })

  // ---------------------------------------------------------------------------------------------
  // The writes. Same shape as the reads above: each handler is the promo's own
  // (app/api/admin/customers/route.ts POST, customers/[id]/route.ts PATCH+DELETE,
  // customers/[id]/notes/route.ts, customers/[id]/calls/route.ts PATCH) with its `lib/store` /
  // `lib/crm` / `lib/calls` writes swapped for `db/demoWrite.ts`'s.
  //
  // **Validating the body is this layer's job**, exactly as it was the promo's. `demoWrite.ts`
  // trims and stores; the blank business name, the `http(s)://` on a website, the shape of a Maps
  // link, the known voices and the known stages are all 400s here, with the promo's own wording —
  // the create form and the drawer show those strings to the operator verbatim.
  //
  // The body schemas below are deliberately loose: every field is optional and the ones with a rule
  // are plain `t.String()`, so a blank or malformed value reaches the handler and gets this API's
  // own `{ error }` 400 instead of the framework's 422. That is the same reasoning as the `query`
  // schema in `src/routes/usage.ts`.

  // Add a prospect by hand.
  .post(
    "/customers",
    async ({ body, headers, status }) => {
      const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const businessName = (body.businessName ?? "").trim();
      if (!businessName) {
        return status(400, { error: "Enter the business name." });
      }

      const websiteUrl = (body.websiteUrl ?? "").trim() || undefined;
      if (websiteUrl && !/^https?:\/\//i.test(websiteUrl)) {
        return status(400, { error: "The website must start with http:// or https://." });
      }

      const mapsUrl = (body.mapsUrl ?? "").trim() || undefined;
      if (mapsUrl && !isMapsUrl(mapsUrl)) {
        return status(400, { error: "That does not look like a Google Maps link." });
      }

      let customer: Customer;
      try {
        customer = await createCustomer({ ...body, businessName, websiteUrl, mapsUrl });
      } catch (error) {
        return status(500, jsonError(error));
      }

      // The promo's `after(...)`, which keeps a serverless function alive past its response while
      // the research runs. Elysia has no such hook, and it does not need one here: the handler
      // returns the body it has already built, and this promise is simply not awaited, so the 201
      // goes out at once and the run carries on against the same process. That is what the promo
      // says `after` degrades to locally — "a plain background call".
      //
      // What it does NOT give us is `after`'s one guarantee, and `startBackgroundResearch` says so
      // in full: on a host that can freeze the function the moment the response is flushed, the run
      // dies mid-flight and the record is left at `status: "researching"` for good.
      startBackgroundResearch(customer.id, {
        businessName,
        websiteUrl,
        mapsUrl,
        notes: customer.researchNotes,
      });
      return status(201, { customer: withLifecycle(customer, await lifecycleByDemo(customer.id)) });
    },
    {
      body: t.Object({
        businessName: t.Optional(t.String()),
        websiteUrl: t.Optional(t.String()),
        mapsUrl: t.Optional(t.String()),
        researchNotes: t.Optional(t.String()),
        label: t.Optional(t.String()),
        contactName: t.Optional(t.String()),
        contactEmail: t.Optional(t.String()),
        agentName: t.Optional(t.String()),
        language: t.Optional(t.String()),
      }),
    },
  )

  /**
   * Research a prospect's business, or research it again — the promo's
   * `app/api/admin/customers/[id]/research/route.ts`, status codes and error strings included.
   *
   * Two model calls behind one request: the first searches the web and writes a briefing, the
   * second turns that briefing into the business profile. **It is a real, billable run**, and it
   * takes over a minute, so it is not something a page should fire by accident — the promo's route
   * declares `maxDuration = 300` for exactly that shape, and the same ceiling applies here.
   *
   * The body is optional and every field in it is: sent, the four research inputs replace what is
   * stored (this is the ResearchInputsPanel saving and running in one go); absent, the run uses
   * what is already on the record, which is the promo's own "No body is fine: re-research with what
   * is stored." `regeneratePrompts` is the one field that is not an input — it overrides the rule
   * that hand-edited prompts survive a run.
   *
   * Unlike the create path this runs *inside* the request. That is the promo's choice too, and it
   * is what makes this the cure for a prospect stuck at "researching": it cannot be lost to a
   * teardown without the caller being told.
   */
  .post(
    "/customers/:id/research",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      let customer: Customer | null;
      try {
        customer = await getCustomer(params.id);
      } catch (error) {
        return status(500, jsonError(error));
      }
      if (!customer) {
        return status(404, { error: "Customer not found." });
      }

      // The promo read these off the stored record and then let the body override them one at a
      // time, with the same `!== undefined` rule as the customer PATCH: `""` clears an optional
      // field, an absent key leaves it. `businessName` is the exception it makes there too — a
      // blank one is a no-op, not a way to empty the record, and the 400 below catches a record
      // that never had one.
      const regeneratePrompts = body?.regeneratePrompts ?? false;
      let businessName = customer.businessName;
      let websiteUrl = customer.websiteUrl;
      let mapsUrl = customer.mapsUrl;
      let researchNotes = customer.researchNotes;

      if (body) {
        if (body.businessName?.trim()) businessName = body.businessName.trim();
        if (body.websiteUrl !== undefined) websiteUrl = body.websiteUrl.trim() || undefined;
        if (body.mapsUrl !== undefined) mapsUrl = body.mapsUrl.trim() || undefined;
        if (body.researchNotes !== undefined) {
          researchNotes = body.researchNotes.trim() || undefined;
        }
      }

      if (!businessName) {
        return status(400, { error: "Enter the business name." });
      }

      // Stored before the run, not after it, so the table says "Researching" for the minute this
      // takes rather than looking idle.
      try {
        await startResearch(params.id, { businessName, websiteUrl, mapsUrl, researchNotes });
      } catch (error) {
        return status(500, jsonError(error));
      }

      try {
        const result = await researchBusiness({
          businessName,
          websiteUrl,
          mapsUrl,
          notes: researchNotes,
        });
        const next = await saveResearch(params.id, result, { regeneratePrompts });
        // Deleted while the run was in flight. The promo's `runResearch` returns silently on this;
        // this one has a caller waiting, and "Customer not found." is what that caller is owed.
        if (!next) return status(404, { error: "Customer not found." });
        return { customer: withLifecycle(next, await lifecycleByDemo(next.id)) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[demo] research failed", error);
        try {
          await failResearch(params.id, message);
        } catch (saveError) {
          console.error("[demo] could not record the research failure", saveError);
        }
        return status(502, { error: message });
      }
    },
    {
      params: t.Object({ id: t.String({ maxLength: 64 }) }),
      // Optional whole: "Re-research with what is stored" sends no body at all. Loose inside, like
      // every other body schema here, so a malformed value reaches the handler and gets this API's
      // own `{ error }` rather than the framework's 422.
      body: t.Optional(
        t.Object({
          regeneratePrompts: t.Optional(t.Boolean()),
          businessName: t.Optional(t.String()),
          websiteUrl: t.Optional(t.String()),
          mapsUrl: t.Optional(t.String()),
          researchNotes: t.Optional(t.String()),
        }),
      ),
    },
  )

  /**
   * Change one prospect. The merge rules live in `patchCustomer` — trimmed, `""` clears, an absent
   * key leaves the stored value alone — because it does the read and the write in one transaction.
   *
   * That is also why the two 400s come before the 404 rather than after it, as they did in the
   * promo: there is no separate read here to 404 on first. A request that names both an unknown id
   * and an unknown stage gets "Unknown stage." where the promo said "Customer not found."; every
   * other case is identical, and the drawer only ever patches a prospect it is already showing.
   */
  .patch(
    "/customers/:id",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateDemo(headers.authorization, DEMO_NOT_YOURS);
      if ("denied" in caller) return status(caller.denied, caller.body);
      if (!ownsDemo(caller, params.id)) return status(404, NO_SUCH_CUSTOMER);

      // A customer editing their own record may only send the receptionist's own fields. Refused by
      // NAMING the field rather than by dropping it: a save that silently keeps half of what was
      // sent is how a form comes to show something the server never stored.
      if (caller.scope === "own") {
        const forbidden = Object.keys(body).filter(
          (key) =>
            body[key as keyof typeof body] !== undefined &&
            !(CUSTOMER_MAY_EDIT as readonly string[]).includes(key),
        );
        if (forbidden.length > 0) {
          return status(403, {
            error: `Only an admin can change ${forbidden.sort().join(", ")}.`,
          });
        }
      }

      if (body.voice && !LIVE_VOICES.includes(body.voice)) {
        return status(400, { error: "Unknown voice." });
      }
      if (body.stage && !CUSTOMER_STAGES.includes(body.stage as CustomerStage)) {
        return status(400, { error: "Unknown stage." });
      }
      // The "Add time" menu. Only the *amount* can be judged out here — the new total is added to
      // the stored value inside `patchCustomer`'s transaction, which is where the stored value is
      // — and `extendDemoMinutes` returns null for exactly the amounts the promo refuses
      // (not a number, not finite, not above zero), whatever it is added to. So this asks it with
      // the fallback standing in for the current value, and the refusal, like the two above,
      // happens before anything is written.
      if (
        body.addDemoMinutes !== undefined &&
        extendDemoMinutes(undefined, body.addDemoMinutes, DEFAULT_DEMO_MINUTES) === null
      ) {
        return status(400, { error: "Minutes to add must be positive." });
      }

      // `callSound`, `profile` and `prompts` are whole objects the editor round-trips untouched.
      // The promo validated none of them — `body.profile ?? customer.profile` — so they are taken
      // as they arrive rather than re-described here, where a stricter schema would turn a field
      // the editor added into a 422 on every save.
      const patch: CustomerPatch = {
        ...body,
        stage: body.stage as CustomerStage | undefined,
        callSound: body.callSound as CallSound | undefined,
        profile: body.profile as BusinessProfile | undefined,
        prompts: body.prompts as Partial<CustomerPrompts> | undefined,
      };

      try {
        const customer = await patchCustomer(params.id, patch);
        if (!customer) return status(404, { error: "Customer not found." });
        return { customer: withLifecycle(customer, await lifecycleByDemo(customer.id)) };
      } catch (error) {
        return status(500, jsonError(error));
      }
    },
    {
      params: t.Object({ id: t.String({ maxLength: 64 }) }),
      body: t.Object({
        businessName: t.Optional(t.String()),
        websiteUrl: t.Optional(t.String()),
        mapsUrl: t.Optional(t.String()),
        researchNotes: t.Optional(t.String()),
        label: t.Optional(t.String()),
        contactName: t.Optional(t.String()),
        contactEmail: t.Optional(t.String()),
        notes: t.Optional(t.String()),
        active: t.Optional(t.Boolean()),
        agentName: t.Optional(t.String()),
        demoMinutes: t.Optional(t.Number()),
        // Unknown rather than a number, so `"ten"` reaches the handler and becomes the promo's
        // own "Minutes to add must be positive." rather than the framework's 422 — the same
        // reason `voice` and `stage` below are plain strings. `extendDemoMinutes` is what decides
        // whether it is a number at all.
        addDemoMinutes: t.Optional(t.Unknown()),
        // Plain strings, checked against LIVE_VOICES / CUSTOMER_STAGES in the handler, so an
        // unknown one is the promo's "Unknown voice." / "Unknown stage." rather than a 422.
        stage: t.Optional(t.String()),
        voice: t.Optional(t.String()),
        // null clears a date the operator set by mistake; an absent key leaves it.
        lastContactedAt: t.Optional(t.Union([t.String(), t.Null()])),
        followUpAt: t.Optional(t.Union([t.String(), t.Null()])),
        language: t.Optional(t.String()),
        callSound: t.Optional(t.Unknown()),
        profile: t.Optional(t.Unknown()),
        prompts: t.Optional(t.Unknown()),
        regeneratePrompts: t.Optional(t.Boolean()),
      }),
    },
  )

  /**
   * Demo → onboarding, from the customer's own demo page ("Start onboarding").
   *
   * Not a promo route: the promo had no lifecycle. Shared with the customer whose demo it is, like
   * the two routes above, and an admin may press it on their behalf. Either way it moves the account
   * LINKED to this demo, never the caller's own when an admin calls it.
   *
   * What moves: the demo is copied into the account's own business information (unless it already
   * has some, which is kept), the account goes to `pre-production`, and the deal is marked won on the
   * CRM board. After this the customer's dashboard is the Business section, not this demo.
   *
   * 409 once the account is past the demo, 422 when the demo is too thin to copy.
   */
  .post(
    "/customers/:id/onboard",
    async ({ headers, params, status }) => {
      const caller = await authenticateDemo(headers.authorization, DEMO_NOT_YOURS);
      if ("denied" in caller) return status(caller.denied, caller.body);
      if (!ownsDemo(caller, params.id)) return status(404, NO_SUCH_CUSTOMER);

      try {
        const demo = await getCustomer(params.id);
        if (!demo) return status(404, NO_SUCH_CUSTOMER);

        const account =
          caller.scope === "own" ? caller.user : await findUserByBusinessId(params.id);
        if (!account) {
          return status(409, {
            error: "Link an account to this customer first — onboarding moves that account.",
          });
        }
        if (account.status === "pre-production" || account.status === "production") {
          return status(409, { error: "This customer is already past the demo." });
        }

        let moved;
        try {
          moved = await startOnboarding(account.id, demo);
        } catch (err) {
          if (err instanceof PromotionError) return status(422, { error: err.message });
          throw err;
        }

        // Best effort: the account has moved, which is what the customer asked for. A board that
        // still says "Interested" is cosmetic and the operator can drag it.
        let customer: Customer = demo;
        if (demo.stage !== "won") {
          customer = (await patchCustomer(params.id, { stage: "won" }).catch(() => null)) ?? demo;
        }
        return {
          customer: withLifecycle(customer, await lifecycleByDemo(params.id)),
          user: toPublicUser(moved.user),
          copied: moved.copied,
        };
      } catch (error) {
        return status(500, jsonError(error));
      }
    },
    { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )

  // Remove a prospect and, by the foreign keys, its calls, views and notes with it.
  .delete(
    "/customers/:id",
    async ({ headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      let removed = false;
      try {
        removed = await deleteCustomer(params.id);
      } catch (error) {
        return status(500, jsonError(error));
      }
      if (!removed) {
        return status(404, { error: "Customer not found." });
      }
      return { ok: true };
    },
    { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )

  // One prospect's CRM timeline, newest first.
  .get(
    "/customers/:id/notes",
    async ({ headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const { id } = params;
      try {
        const customer = await getCustomer(id);
        if (!customer) {
          return status(404, { error: "Customer not found." });
        }
        return { notes: await listNotes(id) };
      } catch (error) {
        return status(500, jsonError(error));
      }
    },
    { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )

  // Append a line to it.
  .post(
    "/customers/:id/notes",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const { id } = params;
      const text = (body.text ?? "").trim();
      if (!text) {
        return status(400, { error: "Write something first." });
      }

      try {
        // The customer is read first because `demo_notes.customer_id` is a foreign key: without
        // this, a note against a prospect that is no longer there is a constraint violation and a
        // 500, where the promo said so plainly.
        const customer = await getCustomer(id);
        if (!customer) {
          return status(404, { error: "Customer not found." });
        }
        return status(201, { note: await addNote(id, text) });
      } catch (error) {
        return status(500, jsonError(error));
      }
    },
    {
      params: t.Object({ id: t.String({ maxLength: 64 }) }),
      body: t.Object({ text: t.Optional(t.String()) }),
    },
  )

  /**
   * Change one of a prospect's calls.
   *
   * `isTest` reclassifies it: calls made before the test flag was explicit were tagged from the
   * admin cookie, so an operator trying a prospect's own link marked it as a test and it
   * disappeared from the numbers. This is how those get counted again, one at a time, by the person
   * who knows which was which.
   *
   * `analyze` asks for the review of a call that has none — one placed before `POST /demo/calls/:id`
   * started asking for reviews, or one where the model was unreachable at the time. It is the
   * promo's own branch, back verbatim now that `reviewCall` lives here: **an existing review is
   * never redone**, because it costs money and the operator has already read the old wording; a
   * call with too little of a caller in it is the promo's 400; a model that cannot be read back is
   * its 502.
   *
   * Both fields may arrive together and both apply. Nothing is written until every refusal is past,
   * as the promo's single `saveCall` at the end of its handler had it: a request answered 400 or
   * 502 is one that changed nothing, the reclassification sharing it included.
   */
  .patch(
    "/customers/:id/calls",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const { id } = params;
      const wantsAnalysis = body.analyze === true;
      if (!body.callId || (typeof body.isTest !== "boolean" && !wantsAnalysis)) {
        return status(400, { error: "Send a callId with isTest or analyze." });
      }

      try {
        // The customer is read first so the two 404s stay distinguishable: `patchCall` returns null
        // for "this customer has no call with that id", which covers both, and the drawer shows
        // whichever sentence it is given.
        const customer = await getCustomer(id);
        if (!customer) {
          return status(404, { error: "Customer not found." });
        }
        // An empty patch is `patchCall`'s read: the same primary-key select, scoped to this
        // customer, that the 404 above depends on.
        const existing = await patchCall(id, body.callId, {});
        if (!existing) {
          return status(404, { error: "Call not found." });
        }

        let next =
          typeof body.isTest === "boolean" ? { ...existing, isTest: body.isTest } : existing;

        let review: CallReview | null = null;
        if (wantsAnalysis && !next.review) {
          if (!reviewable(next)) {
            return status(400, { error: "This call is too short to say anything about." });
          }
          // `reviewCall` returns null for every failure alike — no key, a model that would not
          // answer, an answer that was not the JSON asked for. Here, unlike the end-of-call report,
          // there is somebody waiting on the answer and nothing else to tell them, so it is a 502
          // rather than a silently unreviewed call.
          review = await reviewCall(next);
          if (!review) {
            return status(502, {
              error: "The review could not be read back. Try again in a moment.",
            });
          }
          next = { ...next, review };
        }

        // The writes, once nothing can refuse any more. Each returns the row as it now stands, so
        // the second carries the first; `?? next` covers the row being deleted underneath us, which
        // leaves the caller the record it asked about rather than a 500.
        if (typeof body.isTest === "boolean") {
          next = (await patchCall(id, body.callId, { isTest: body.isTest })) ?? next;
        }
        if (review) {
          next = (await attachReview(next.id, review)) ?? next;
        }
        return { call: next };
      } catch (error) {
        return status(500, jsonError(error));
      }
    },
    {
      params: t.Object({ id: t.String({ maxLength: 64 }) }),
      body: t.Object({
        callId: t.Optional(t.String()),
        // Unknown rather than boolean: the promo's guard tests `typeof body.isTest !== "boolean"`
        // itself, so a non-boolean has to reach it to become "Send a callId with isTest or
        // analyze." instead of a 422.
        isTest: t.Optional(t.Unknown()),
        analyze: t.Optional(t.Unknown()),
      }),
    },
  )

  /**
   * Place a test call: the browser's SDP offer goes out to OpenAI's live API and the answer comes
   * back, with a `demo_calls` row opened for it.
   *
   * This is the promo's `app/api/session/route.ts`, reduced to the path it took when `isTest` was
   * true. Everything the promo did behind `if (!isTest)` — the demo allowance, the per-customer
   * concurrency reservation, the global live-session seat, and the `markLive` / `listLiveSessions`
   * bookkeeping those two needed — protects the *public* demo, which stays on the promo; an admin
   * test call skipped all of it there and there is no prospect-facing dial here to protect. The
   * `visitorId()` cookie goes with them: it identified an anonymous visitor, and the caller here is
   * a signed-in admin. What is left is the rate limit, the customer checks, and the work itself.
   *
   * The promo authorised the test flag with `body.isTest === true && isAdminRequest()`. The admin
   * guard below is that check, which is why the row is written `is_test = true` unconditionally:
   * every call reachable from this route is one the operator placed from the test panel.
   *
   * A test call spends real live-API minutes with nothing but this guard and the rate limit in
   * front of it — there is no allowance behind an admin, by design.
   */
  .post(
    "/session",
    async ({ body, headers, status }) => {
      const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

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
      if (!customer) {
        return status(404, { error: "This demo isn't available." });
      }
      if (!customer.active) {
        return status(403, { error: "This demo is paused." });
      }
      if (customer.status !== "ready") {
        return status(409, { error: "This demo is still being prepared." });
      }

      // The record is written before OpenAI is asked for a session, so that the
      // next person to dial can see this call already counting. Creating it
      // afterwards left a window the width of an OpenAI round trip in which every
      // simultaneous caller read an empty demo and was waved through.
      let call: CallLog;
      try {
        call = await startCall({
          customerId: customer.id,
          userAgent: headers["user-agent"],
          // Every call reachable from this route is one the operator placed from the test panel —
          // the admin guard above is that check.
          isTest: true,
        });
      } catch (error) {
        return status(500, jsonError(error));
      }

      // The stored prompts cannot know what day it is, so the date goes on here,
      // per call, and onto both: the voice hears "tomorrow" and the model it
      // delegates to is the one that takes the booking.
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
          // How long this one call may run. The browser hangs up when it is reached,
          // so a demo cannot be overrun by one long call, and a test call is still
          // held to the ten minute ceiling.
          //
          // The promo narrowed this to what was left of the prospect's allowance
          // (`callLimitSec(allowance.remainingSec)`) for a public call. There is no
          // allowance on this route — an admin test call skipped it there too — so the
          // ceiling is the whole answer, and it is the second sentence above that makes
          // this worth sending at all.
          maxSec: CALL_MAX_SEC,
        };
      } catch (error) {
        // No session means no call. Take the record back rather than leaving one that sits in the
        // Activity tab as a call that never happened and counts as in flight for ten minutes.
        await deleteCall(customer.id, call.id).catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        const code = error instanceof OpenAIError ? error.status : 500;
        console.error("[demo]", error);
        return status(code, { error: message });
      }
    },
    {
      // Loose, like the other bodies here: a missing `customerId` or `sdp` must reach the handler
      // to become the promo's own 400 rather than the framework's 422. `timeZone` is unknown
      // because `safeTimeZone` is the thing that decides whether it is a timezone.
      body: t.Object({
        customerId: t.Optional(t.String()),
        sdp: t.Optional(t.String()),
        timeZone: t.Optional(t.Unknown()),
      }),
    },
  )

  /**
   * Report how a test call ended: the promo's `app/api/calls/[callId]/route.ts`.
   *
   * The client reports twice by design — once when the call ends normally, and again from the
   * unload path when the operator closes the tab mid-call — so **the first report wins and the
   * second changes nothing**. That decision is made inside `finishCall`, on the locked row: a
   * report of a call that is no longer `"started"` comes straight back as `alreadyReported`, the
   * stored transcript and duration untouched and, just as importantly, no second review asked for.
   *
   * Nothing the client sends is refused. A status outside the three is recorded as `"abandoned"`,
   * a missing duration as none at all: the call is over either way, and this is the only moment
   * anything can be written down about it.
   *
   * The promo also called `clearLive(call)` here, handing back the global live-session seat. There
   * is nothing to hand back: the seat is counted from the rows themselves (`listLiveSessions`), so
   * finishing the call frees it. And an admin test call never held one — `inFlightCalls` skips test
   * calls, which is what makes the operator's dialling invisible to a prospect's concurrency.
   *
   * The body handling and the review live in `demoCommon.ts`: the prospect-facing report at
   * `POST /demo/public/calls/:callId` writes into the same column and must cap and validate a
   * transcript by exactly the same rules.
   */
  .post(
    "/calls/:callId",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const outcome = await applyCallReport(params.callId, body);
      if (outcome.kind === "failed") return status(500, outcome.error);
      if (outcome.kind === "missing") return status(404, { error: "Call not found." });
      if (outcome.kind === "alreadyReported") return { ok: true, alreadyReported: true };
      return { ok: true, reviewed: outcome.reviewed };
    },
    {
      params: t.Object({ callId: t.String({ maxLength: 64 }) }),
      // Unknown throughout, deliberately: every field above decides for itself what it will accept,
      // and a report that fails validation is a call that goes unrecorded — the one outcome this
      // route has no way to recover from.
      body: t.Object({
        customerId: t.Optional(t.String()),
        status: t.Optional(t.Unknown()),
        durationSec: t.Optional(t.Unknown()),
        endReason: t.Optional(t.Unknown()),
        transcript: t.Optional(t.Unknown()),
      }),
    },
  );
