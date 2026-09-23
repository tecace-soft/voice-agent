import { Elysia, t } from "elysia";
import { authenticateAdmin } from "../auth/guard.js";
import {
  activityFeed,
  callsPerDay,
  computeKpis,
  computeStats,
  countableCalls,
  emptyStats,
  engagement,
  heatByCustomer,
  statsByCustomer,
  testCalls,
  withinDays,
} from "../demo/analytics.js";
import type {
  BusinessProfile,
  CallLog,
  CallSound,
  CrmNote,
  Customer,
  CustomerPrompts,
  CustomerStage,
  CustomerStats,
  Engagement,
  TrackEvent,
} from "../demo/types.js";
import { CUSTOMER_STAGES } from "../demo/types.js";
import {
  getCustomer,
  listAllCalls,
  listCalls,
  listCustomers,
  listNotes,
  readEvents,
} from "../db/demoRead.js";
import type { CustomerPatch } from "../db/demoWrite.js";
import {
  addNote,
  createCustomer,
  deleteCustomer,
  patchCall,
  patchCustomer,
} from "../db/demoWrite.js";

// The Demo tabs' reads. Each handler is the promo's own route handler
// (app/api/admin/{analytics,customers,customers/[id],crm}/route.ts) with its `lib/store` and
// `lib/calls` loaders swapped for `db/demoRead.ts`'s and its `NextResponse.json` for Elysia's
// return — the shaping between those two points is left exactly as it was. That is deliberate: the
// dashboard's Demo screens are verbatim ports of the promo's and parse these bodies field for
// field, so a tidier `topCustomers` or a renamed `realCallCount` is a broken screen, not a cleanup.
//
// Admin-only, through the same `authenticateAdmin` guard as the rest of this API. The promo put
// these behind its own operator password; here the dashboard's admin session is the only way in.
// Note what that rules out: `authenticateAdmin` resolves a *user* token, so an API key — which
// `src/routes/usage.ts` accepts for the usage numbers — cannot reach any of this. Demo data is
// every prospect's contact details and call transcripts, which is not what a machine key is for.

const DEMO_IS_ADMIN = "Only an admin can read the demo data.";

/**
 * The promo's `lib/api.ts`, minus the three error classes it special-cased (`StoreConfigError`,
 * `OpenAIError`, `ClaudeCliError`) — none of which exists here, because neither Redis nor OpenAI
 * nor the Claude CLI is in this path. What is left is its fallback, and its reason: an unhandled
 * throw in a handler returns an empty 500, which reaches the browser as "Unexpected end of JSON
 * input" and tells nobody anything. Every handler catches and comes through here instead.
 *
 * This returns the body rather than the response, because the status is Elysia's `status()` to set.
 */
function jsonError(error: unknown): { error: string } {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[demo]", error);
  return { error: message };
}

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
 * Does this look like a Google Maps link? Copied verbatim from the promo's `lib/maps.ts` — only the
 * `export` is dropped, since nothing outside this file asks. The rest of that module (the short-link
 * follower, `parseMapsUrl`, `fallbackName`) belongs to the retired research pipeline and is not
 * ported; this one predicate is what the create form's 400 is made of.
 */
const SHORT_HOSTS = ["maps.app.goo.gl", "goo.gl", "g.co"];

function isMapsUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    return (
      SHORT_HOSTS.includes(host) ||
      host.endsWith("google.com") ||
      host.startsWith("maps.google.")
    );
  } catch {
    return false;
  }
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
      const [customers, calls, events] = await Promise.all([
        listCustomers(),
        listAllCalls(),
        readEvents(),
      ]);
      const stats = statsByCustomer(calls, events);
      const heat = heatByCustomer(calls, stats);
      const withStats: CustomerWithStats[] = customers.map((customer) => ({
        ...customer,
        stats: stats[customer.id] ?? emptyStats(),
        heat: heat[customer.id] ?? engagement(emptyStats(), []),
      }));
      return { customers: withStats };
    } catch (error) {
      return status(500, jsonError(error));
    }
  })

  // One prospect's page: the record, its all-time stats, and its calls, views and notes.
  .get(
    "/customers/:id",
    async ({ headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const { id } = params;
      let customer: Customer | null, calls: CallLog[], events: TrackEvent[], notes: CrmNote[];
      try {
        customer = await getCustomer(id);
        if (!customer) {
          return status(404, { error: "Customer not found." });
        }
        // Only this customer's views; no need to read every other one's.
        [calls, events, notes] = await Promise.all([
          listCalls(id),
          readEvents(id),
          listNotes(id),
        ]);
      } catch (error) {
        return status(500, jsonError(error));
      }
      const stats = computeStats(
        calls,
        events.filter((event) => event.customerId === id),
      );
      return { customer, stats, calls, events, notes };
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
      const [customers, calls, events] = await Promise.all([
        listCustomers(),
        listAllCalls(),
        readEvents(),
      ]);
      const notes = await listAllNotes(customers.map((customer) => customer.id));

      const stats = statsByCustomer(calls, events);
      const heat = heatByCustomer(calls, stats);

      const withStats: CustomerWithStats[] = customers.map((customer) => ({
        ...customer,
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

      try {
        // The promo kicked off `runResearch` in an `after()` here and returned the record with
        // `status: "researching"`. That pipeline is retired, so what comes back is final: an empty
        // profile and empty prompts for the operator to fill in, already `status: "ready"`.
        const customer = await createCustomer({ ...body, businessName, websiteUrl, mapsUrl });
        return status(201, { customer });
      } catch (error) {
        return status(500, jsonError(error));
      }
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
      const caller = await authenticateAdmin(headers.authorization, DEMO_IS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      if (body.voice && !LIVE_VOICES.includes(body.voice)) {
        return status(400, { error: "Unknown voice." });
      }
      if (body.stage && !CUSTOMER_STAGES.includes(body.stage as CustomerStage)) {
        return status(400, { error: "Unknown stage." });
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
        return { customer };
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
   * `analyze` asked the promo's research pipeline for the review of a call that reported before
   * reviews existed. That pipeline is retired, so the request is accepted and the call comes back
   * unchanged rather than failing — including the promo's "too short to say anything about" 400 and
   * its 502, neither of which has anything left to raise it. `isTest` in the same request still
   * applies. The guard below is kept exactly as it was, so `{ callId, analyze: true }` is still a
   * valid request and `{ callId }` on its own is still the promo's 400.
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
        const call = await patchCall(id, body.callId, {
          isTest: typeof body.isTest === "boolean" ? body.isTest : undefined,
          analyze: wantsAnalysis,
        });
        if (!call) {
          return status(404, { error: "Call not found." });
        }
        return { call };
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
  );
