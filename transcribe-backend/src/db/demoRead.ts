import type { DemoCallRow, DemoCustomerRow, DemoEventRow, DemoNoteRow } from "../demo/map.js";
import { fromCallRow, fromCustomerRow, fromEventRow, fromNoteRow } from "../demo/rows.js";
import type { CallLog, CrmNote, Customer, TrackEvent } from "../demo/types.js";
import { sql } from "./client.js";

// The Demo tabs' reads. Each one is the promo's own loader (lib/store.ts, lib/calls.ts, lib/crm.ts)
// with its Redis fan-out replaced by one statement — including its ORDER BY, which is not a detail:
// the promo sorted in JavaScript after reading, and the analytics and the screens were written
// against that order. The Overview's "recent calls" is `calls.slice(0, 20)` of listAllCalls(), so a
// different order there is a different list, silently.
//
// Two rules make the rows fit `rows.ts` without any mapping in between:
//
//  * Columns are aliased to the camelCase the `Demo*Row` types use. postgres.js returns whatever
//    the column is called, and an unaliased snake_case column would arrive as a key nothing reads —
//    i.e. as `undefined`, not as an error.
//  * The columns are listed out, never `SELECT *`. A column added to the table later (another
//    `imported_at`, say) would otherwise land in the row object and, through it, in the API
//    response.
//
// JSONB comes back from postgres.js already parsed, and TIMESTAMPTZ as a `Date` — which is exactly
// what `Demo*Row` declares, so the rows go straight into `rows.ts`.

/** A fresh fragment each call: a query object is built once, so it is not shared between queries. */
const customerColumns = () => sql`
  id, active,
  business_name     AS "businessName",
  label,
  contact_name      AS "contactName",
  contact_email     AS "contactEmail",
  operator_notes    AS "operatorNotes",
  website_url       AS "websiteUrl",
  maps_url          AS "mapsUrl",
  resolved_maps_url AS "resolvedMapsUrl",
  research_notes    AS "researchNotes",
  profile, dossier, sources, prompts,
  call_sound        AS "callSound",
  voice,
  agent_name        AS "agentName",
  language,
  demo_minutes      AS "demoMinutes",
  stage, status, error,
  last_contacted_at AS "lastContactedAt",
  follow_up_at      AS "followUpAt",
  researched_at     AS "researchedAt",
  created_at        AS "createdAt",
  updated_at        AS "updatedAt"
`;

const callColumns = () => sql`
  id,
  customer_id     AS "customerId",
  live_session_id AS "liveSessionId",
  started_at      AS "startedAt",
  ended_at        AS "endedAt",
  status,
  duration_sec    AS "durationSec",
  turns,
  end_reason      AS "endReason",
  is_test         AS "isTest",
  visitor_id      AS "visitorId",
  ip_hash         AS "ipHash",
  user_agent      AS "userAgent",
  transcript, review
`;

const eventColumns = () => sql`
  customer_id AS "customerId",
  type, at,
  visitor_id  AS "visitorId",
  ip_hash     AS "ipHash",
  source
`;

/**
 * Every prospect, newest first — the promo's `customers.sort((a, b) => b.createdAt.localeCompare(a.createdAt))`.
 * The customers table and the pipeline board both render this order as given.
 *
 * `id` breaks a tie so the order is total. The promo's tie went to whatever order Redis handed the
 * set back in, i.e. to nothing in particular; two customers created in the same millisecond are not
 * in the real export anyway.
 */
/**
 * The one piece of the promo's read-time `normalize()` (lib/store.ts:19-55) that this data
 * actually needs: a customer saved before stages existed has none, and the CRM board and the
 * drawer's stage select both read it directly. `analytics.ts` already defaults it the same way
 * (`customer.stage ?? "new"`), so this only makes the screens agree with the numbers.
 *
 * The rest of normalize() is deliberately not reproduced, having been checked against the real
 * export rather than assumed:
 *   - the "quartz" voice migration: no record carries it (all 10 are "gleam");
 *   - the blank-businessName backfill: none is blank, and the column is NOT NULL;
 *   - the callSound default: all 10 have one.
 * And the prompt rebuild is a decision, not an omission. The promo regenerated any unedited prompt
 * whose version was behind the code's PROMPT_VERSION (8 of these 10 are unedited, at versions 3, 4
 * and none). Reproducing that would mean porting lib/prompt.ts and lib/maps.ts to regenerate text
 * for a retired product; instead the stored prompt is shown, which is the prompt those recorded
 * calls were actually made with. See src/demo/PORTING.md.
 */
function normalize(customer: Customer): Customer {
  return customer.stage ? customer : { ...customer, stage: "new" };
}

export async function listCustomers(): Promise<Customer[]> {
  const rows = (await sql`
    SELECT ${customerColumns()}
    FROM demo_customers
    ORDER BY created_at DESC, id DESC
  `) as unknown as DemoCustomerRow[];
  return rows.map((row) => normalize(fromCustomerRow(row)));
}

/** One prospect, or null when there is no such id. */
export async function getCustomer(id: string): Promise<Customer | null> {
  const rows = (await sql`
    SELECT ${customerColumns()}
    FROM demo_customers
    WHERE id = ${id}
  `) as unknown as DemoCustomerRow[];
  const row = rows[0];
  return row ? normalize(fromCustomerRow(row)) : null;
}

/**
 * Every call across every prospect, newest first. The Overview reads the first 20 of these as its
 * recent-calls list, and the analytics window them by `startedAt`.
 */
export async function listAllCalls(): Promise<CallLog[]> {
  const rows = (await sql`
    SELECT ${callColumns()}
    FROM demo_calls
    ORDER BY started_at DESC, id DESC
  `) as unknown as DemoCallRow[];
  return rows.map(fromCallRow);
}

/**
 * One prospect's calls, newest first — same order as listAllCalls, because the customer page and
 * the Overview show the same rows and must agree about which one is the latest.
 */
export async function listCalls(customerId: string): Promise<CallLog[]> {
  const rows = (await sql`
    SELECT ${callColumns()}
    FROM demo_calls
    WHERE customer_id = ${customerId}
    ORDER BY started_at DESC, id DESC
  `) as unknown as DemoCallRow[];
  return rows.map(fromCallRow);
}

/**
 * Page views for one customer, or for every customer when given no id — the promo's `readEvents`,
 * which concatenated its legacy global list with the per-customer ones. Both lists are rows of
 * `demo_call_events` here (`source` records which one an event came from), so "all" is simply no
 * WHERE clause.
 *
 * Ordered oldest first for determinism only. The promo returned these in list order — legacy first,
 * then per customer — and nothing depends on it: `analytics.ts` counts them, takes a max over `at`,
 * and collects visitor ids into a Set, while `timeline()` and `activityFeed()` re-sort what they are
 * given.
 */
export async function readEvents(customerId?: string): Promise<TrackEvent[]> {
  const rows = (await sql`
    SELECT ${eventColumns()}
    FROM demo_call_events
    WHERE ${customerId === undefined ? sql`TRUE` : sql`customer_id = ${customerId}`}
    ORDER BY at, id
  `) as unknown as DemoEventRow[];
  return rows.map(fromEventRow);
}

/**
 * One prospect's CRM notes, newest first — the promo's `notes.sort((a, b) => b.at.localeCompare(a.at))`.
 * The drawer shows them as a history, so the note just written has to be at the top.
 */
export async function listNotes(customerId: string): Promise<CrmNote[]> {
  const rows = (await sql`
    SELECT id, customer_id AS "customerId", at, text
    FROM demo_notes
    WHERE customer_id = ${customerId}
    ORDER BY at DESC, id DESC
  `) as unknown as DemoNoteRow[];
  return rows.map(fromNoteRow);
}
