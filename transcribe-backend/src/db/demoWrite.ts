// The Demo tabs' writes: the promo's four admin route handlers, with their merge rules kept
// literally, over `demo_*` rows instead of Redis JSON blobs.
//
// The merge contract is the whole point of this file, and it is the promo's, copied from
// `app/api/admin/customers/[id]/route.ts`:
//
//   * a **trimmed** string is what gets stored — `" Acme "` is `"Acme"`;
//   * `""` (or whitespace) **clears** an optional field, because `"".trim() || undefined` is
//     `undefined`;
//   * an **absent** key leaves the stored value alone, because the ternary tests `!== undefined`
//     before it tests emptiness.
//
// The drawer and the customers table both depend on that third case: the drawer PATCHes one field
// at a time and would wipe the rest if an absent key meant "clear". The two required strings
// (`businessName`, `agentName`) are the exception the promo itself makes — they use
// `?.trim() || current`, so a blank one is a no-op rather than a way to empty the record.
//
// Every function returns the **updated domain object**, read back out of the row through
// `rows.ts`, so a caller gets exactly what a loader would have given it.

import { randomBytes } from "node:crypto";
import { extendDemoMinutes } from "../demo/analytics.js";
import { languageOf } from "../demo/languages.js";
import type { DemoCallRow, DemoCustomerRow, DemoNoteRow } from "../demo/map.js";
import { buildPrompts, resolvePrompts } from "../demo/prompt.js";
import { emptyProfile } from "../demo/research.js";
import { fromCallRow, fromCustomerRow, fromNoteRow } from "../demo/rows.js";
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
  CustomerStatus,
  ResearchSource,
  TranscriptEntry,
} from "../demo/types.js";
import { DEFAULT_DEMO_MINUTES } from "../demo/types.js";
import { sql } from "./client.js";

// A value bound for a JSONB column is passed through as-is: **do not pre-stringify it.**
// postgres.js learns from the server's ParameterDescription that `$n::jsonb` is OID 3802, and
// types.js registers the json serializer (JSON.stringify) for that OID, so the driver encodes it
// itself (connection.js: `options.serializers[type](x)`). Encoding it here as well stores a JSON
// *string* instead of an object — see the same note in `demoImport.ts`, and
// `jsonbBinding.test.ts`, which pins this against postgres.js's own serializer.
const jsonb = (value: unknown) =>
  value === null || value === undefined ? null : sql.json(value as Parameters<typeof sql.json>[0]);

// Selected explicitly, never `SELECT *`: a column added later must not silently change the shape
// `rows.ts` is handed. The aliases are `DemoCustomerRow`'s field names.
const customerColumns = () => sql`
  c.id,
  c.active,
  c.business_name     AS "businessName",
  c.label,
  c.contact_name      AS "contactName",
  c.contact_email     AS "contactEmail",
  c.operator_notes    AS "operatorNotes",
  c.website_url       AS "websiteUrl",
  c.maps_url          AS "mapsUrl",
  c.resolved_maps_url AS "resolvedMapsUrl",
  c.research_notes    AS "researchNotes",
  c.profile,
  c.dossier,
  c.sources,
  c.prompts,
  c.call_sound        AS "callSound",
  c.voice,
  c.agent_name        AS "agentName",
  c.language,
  c.demo_minutes      AS "demoMinutes",
  c.stage,
  c.status,
  c.error,
  c.last_contacted_at AS "lastContactedAt",
  c.follow_up_at      AS "followUpAt",
  c.researched_at     AS "researchedAt",
  c.created_at        AS "createdAt",
  c.updated_at        AS "updatedAt"
`;

const callColumns = () => sql`
  l.id,
  l.customer_id     AS "customerId",
  l.live_session_id AS "liveSessionId",
  l.started_at      AS "startedAt",
  l.ended_at        AS "endedAt",
  l.status,
  l.duration_sec    AS "durationSec",
  l.turns,
  l.end_reason      AS "endReason",
  l.is_test         AS "isTest",
  l.visitor_id      AS "visitorId",
  l.ip_hash         AS "ipHash",
  l.user_agent      AS "userAgent",
  l.transcript,
  l.review
`;

/**
 * The promo minted ids with `nanoid(n)`, and those ids are in demo links, transcripts and CSV
 * exports. New ones have to look the same or the table ends up with two shapes of id, so this is
 * nanoid's contract reproduced over `node:crypto` rather than a dependency added for eight lines:
 * `size` characters drawn from a 64-character URL-safe alphabet.
 *
 * 64 divides 256 exactly, so masking a random byte with 63 is uniform — no modulo bias and no
 * rejection loop. The alphabet is the same set nanoid uses (`A-Za-z0-9_-`); only the order differs,
 * which nothing can observe.
 */
const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function newId(size: number): string {
  const bytes = randomBytes(size);
  let id = "";
  for (let i = 0; i < size; i += 1) id += ID_ALPHABET[(bytes[i] as number) & 63];
  return id;
}

// Copied verbatim from the promo's `lib/types.ts`; `src/demo/types.ts` left the two constants out
// as unused, and creating a customer is what uses them. `emptyProfile` used to be copied here too,
// from `lib/research.ts`, because that module was not ported; it is now, so the import above is the
// promo's own function rather than a second copy of it.
const DEFAULT_VOICE = "gleam";
const DEFAULT_CALL_SOUND: CallSound = { phoneLine: true, ambience: "quiet" };

/** The promo's PATCH body, field for field. */
export interface CustomerPatch {
  businessName?: string;
  websiteUrl?: string;
  mapsUrl?: string;
  researchNotes?: string;
  label?: string;
  contactName?: string;
  contactEmail?: string;
  notes?: string;
  active?: boolean;
  agentName?: string;
  demoMinutes?: number;
  /**
   * Minutes to **add** to the stored figure, from the "Add time" menu. `unknown` because the
   * route hands it over exactly as it arrived: `extendDemoMinutes` is the one place that decides
   * whether a value is a usable amount, and typing it `number` here would mean two answers to
   * that question.
   */
  addDemoMinutes?: unknown;
  stage?: CustomerStage;
  lastContactedAt?: string | null;
  followUpAt?: string | null;
  voice?: string;
  language?: string;
  callSound?: CallSound;
  profile?: BusinessProfile;
  prompts?: Partial<CustomerPrompts>;
  regeneratePrompts?: boolean;
}

/**
 * Change one customer. `null` when there is none with that id — the caller turns that into the
 * promo's 404.
 *
 * Read and write are one transaction, with `FOR UPDATE` on the read: the merge happens in this
 * process, so two drawers saving different fields at the same moment would otherwise have the
 * slower one write back the values it read before the faster one's.
 */
export async function patchCustomer(id: string, patch: CustomerPatch): Promise<Customer | null> {
  return (await sql.begin(async (tx) => {
    const [row] = await tx`
      SELECT ${customerColumns()} FROM demo_customers c WHERE c.id = ${id} FOR UPDATE
    `;
    if (!row) return null;
    const customer = fromCustomerRow(row as unknown as DemoCustomerRow);

    const next: Customer = {
      ...customer,
      businessName: patch.businessName?.trim() || customer.businessName,
      websiteUrl:
        patch.websiteUrl !== undefined
          ? patch.websiteUrl.trim() || undefined
          : customer.websiteUrl,
      mapsUrl:
        patch.mapsUrl !== undefined ? patch.mapsUrl.trim() || undefined : customer.mapsUrl,
      researchNotes:
        patch.researchNotes !== undefined
          ? patch.researchNotes.trim() || undefined
          : customer.researchNotes,
      label: patch.label !== undefined ? patch.label.trim() || undefined : customer.label,
      contactName:
        patch.contactName !== undefined
          ? patch.contactName.trim() || undefined
          : customer.contactName,
      contactEmail:
        patch.contactEmail !== undefined
          ? patch.contactEmail.trim() || undefined
          : customer.contactEmail,
      notes: patch.notes !== undefined ? patch.notes.trim() || undefined : customer.notes,
      active: patch.active ?? customer.active,
      agentName: patch.agentName?.trim() || customer.agentName,
      // `addDemoMinutes` is the "Add time" menu and adds to what is stored; a plain `demoMinutes`
      // is the Share tab's number field and sets it outright. The addition happens here, against
      // the row this transaction locked, and never against the total the browser sent — a page
      // open since yesterday would otherwise undo someone else's top-up by writing back the
      // figure it was still showing. That is the entire reason the field exists, so a
      // `demoMinutes` arriving alongside it is ignored rather than merged.
      //
      // The route has already refused an amount `extendDemoMinutes` cannot use, so the `??` is
      // unreachable from the API; it keeps the stored value for any other caller.
      demoMinutes:
        patch.addDemoMinutes !== undefined
          ? (extendDemoMinutes(
              customer.demoMinutes,
              patch.addDemoMinutes,
              DEFAULT_DEMO_MINUTES,
            ) ?? customer.demoMinutes)
          : typeof patch.demoMinutes === "number" && Number.isFinite(patch.demoMinutes)
            ? Math.max(0, Math.round(patch.demoMinutes))
            : customer.demoMinutes,
      voice: patch.voice ?? customer.voice,
      // An unrecognised code lands on English rather than leaving the receptionist
      // opening in a language nothing here knows how to greet in.
      language:
        patch.language !== undefined ? languageOf(patch.language).code : customer.language,
      stage: patch.stage ?? customer.stage,
      // null clears a date the operator set by mistake; undefined leaves it.
      lastContactedAt:
        patch.lastContactedAt !== undefined
          ? patch.lastContactedAt || undefined
          : customer.lastContactedAt,
      followUpAt:
        patch.followUpAt !== undefined ? patch.followUpAt || undefined : customer.followUpAt,
      callSound: patch.callSound ?? customer.callSound,
      profile: patch.profile ?? customer.profile,
      updatedAt: new Date().toISOString(),
    };

    next.prompts = resolvePrompts({
      current: customer.prompts,
      submitted: patch.prompts,
      profile: next.profile,
      agentName: next.agentName,
      language: next.language,
      regenerate: patch.regeneratePrompts,
    });

    // Only the columns the promo's PATCH can touch. `status`, `error`, `dossier`, `sources`,
    // `resolved_maps_url`, `researched_at` and `created_at` are the research pipeline's and are
    // left exactly as they were, which is what `{ ...customer }` did for it.
    const [updated] = await tx`
      UPDATE demo_customers AS c SET
        business_name     = ${next.businessName},
        website_url       = ${next.websiteUrl ?? null},
        maps_url          = ${next.mapsUrl ?? null},
        research_notes    = ${next.researchNotes ?? null},
        label             = ${next.label ?? null},
        contact_name      = ${next.contactName ?? null},
        contact_email     = ${next.contactEmail ?? null},
        operator_notes    = ${next.notes ?? null},
        active            = ${next.active},
        agent_name        = ${next.agentName},
        demo_minutes      = ${next.demoMinutes ?? null},
        voice             = ${next.voice},
        language          = ${next.language ?? null},
        stage             = ${next.stage ?? null},
        last_contacted_at = ${next.lastContactedAt ?? null},
        follow_up_at      = ${next.followUpAt ?? null},
        call_sound        = ${jsonb(next.callSound)},
        profile           = ${jsonb(next.profile)},
        prompts           = ${jsonb(next.prompts)},
        updated_at        = ${next.updatedAt}
      WHERE c.id = ${id}
      RETURNING ${customerColumns()}
    `;
    return fromCustomerRow(updated as unknown as DemoCustomerRow);
  })) as Customer | null;
}

/** The promo's POST body. `businessName` is the only required field. */
export interface NewCustomerInput {
  businessName: string;
  websiteUrl?: string;
  mapsUrl?: string;
  researchNotes?: string;
  label?: string;
  contactName?: string;
  contactEmail?: string;
  agentName?: string;
  language?: string;
}

/**
 * Add a customer — the promo's `POST /api/admin/customers`, field for field. The trims and the
 * `"Alex"` default are its; so, now, is everything this row starts life holding:
 *
 *  * `profile` is `emptyProfile(businessName)` and `dossier`/`sources` are empty, because nothing
 *    has been researched **yet**;
 *  * `prompts` is `buildPrompts(profile, agentName, language)`, so a prospect opens with a working
 *    receptionist from the first moment — a thin one off the empty profile ("Hours: unknown"), but
 *    the role, the language rules and the greeting are all there;
 *  * `status` is `"researching"`, the promo's own, because the route now does what the promo's
 *    route did next: it fires the research in the background and this record is updated when that
 *    lands. An earlier version of this comment explained why the status was `"ready"` instead —
 *    that was true while the research pipeline was absent, and it no longer is.
 *
 * A record that reaches `"researching"` and never leaves it is the one real failure mode of that
 * arrangement: the process is torn down between the response and the end of the run. The promo has
 * the same hole and describes it with `isResearchStalled`, which reads a "researching" record older
 * than 15 minutes as stalled; "Re-research" is the way out of it.
 *
 * Validating the business name, the `http(s)://` on a website and the shape of a Maps link is the
 * route's job, as it is in the promo: those are 400s with the operator's own wording, not database
 * concerns. What arrives here is trimmed and stored.
 */
export async function createCustomer(input: NewCustomerInput): Promise<Customer> {
  const now = new Date().toISOString();
  const businessName = (input.businessName ?? "").trim();
  const agentName = (input.agentName ?? "Alex").trim() || "Alex";
  // An unknown code opens in English rather than refusing the create.
  const language = languageOf(input.language).code;
  const profile = emptyProfile(businessName);
  const prompts = buildPrompts(profile, agentName, language);

  const [row] = await sql`
    INSERT INTO demo_customers (
      id, active, business_name, label, contact_name, contact_email, website_url, maps_url,
      research_notes, profile, dossier, sources, prompts, call_sound, voice, agent_name, language,
      status, created_at, updated_at
    ) VALUES (
      ${newId(12)}, ${true}, ${businessName}, ${input.label?.trim() || null},
      ${input.contactName?.trim() || null}, ${input.contactEmail?.trim() || null},
      ${input.websiteUrl?.trim() || null}, ${input.mapsUrl?.trim() || null},
      ${input.researchNotes?.trim() || null}, ${jsonb(profile)}, ${""}, ${jsonb([])},
      ${jsonb(prompts)}, ${jsonb(DEFAULT_CALL_SOUND)}, ${DEFAULT_VOICE}, ${agentName},
      ${language}, ${"researching" satisfies CustomerStatus}, ${now}, ${now}
    )
    RETURNING
      id, active, business_name AS "businessName", label, contact_name AS "contactName",
      contact_email AS "contactEmail", operator_notes AS "operatorNotes",
      website_url AS "websiteUrl", maps_url AS "mapsUrl", resolved_maps_url AS "resolvedMapsUrl",
      research_notes AS "researchNotes", profile, dossier, sources, prompts,
      call_sound AS "callSound", voice, agent_name AS "agentName", language,
      demo_minutes AS "demoMinutes", stage, status, error,
      last_contacted_at AS "lastContactedAt", follow_up_at AS "followUpAt",
      researched_at AS "researchedAt", created_at AS "createdAt", updated_at AS "updatedAt"
  `;
  return fromCustomerRow(row as unknown as DemoCustomerRow);
}

// ------------------------------------------------------------------------------------------------
// The research pipeline's three writes. The promo does all of this with `saveCustomer(...)` over a
// whole record it has in hand — once before the run to say it has started, once after to store what
// came back, and once on the failure path. Here they are three statements against the columns each
// one owns, which is also what keeps them out of `patchCustomer`'s way: that handler is documented
// to leave `status`, `error`, `dossier`, `sources`, `resolved_maps_url` and `researched_at` exactly
// as they were, and these are the only writers of them.

/** The four fields the operator can revise on the way into a re-research. */
export interface ResearchInputsPatch {
  businessName: string;
  websiteUrl?: string;
  mapsUrl?: string;
  researchNotes?: string;
}

/**
 * Mark a prospect as being researched right now, storing the inputs the run is about to use — the
 * promo's first `saveCustomer` in `app/api/admin/customers/[id]/research/route.ts`, which sets
 * `status: "researching"` and clears `error`.
 *
 * `null` when there is no such customer, which the caller turns into the promo's 404. Note that the
 * promo 404s on its own read *before* this write; the route here does the same, so this returning
 * `null` only ever means the record went away in between.
 *
 * `updatedAt` is deliberately not touched: the promo's object spread leaves it alone here too, and
 * the record has not changed in any way a reader cares about yet.
 */
export async function startResearch(
  id: string,
  inputs: ResearchInputsPatch,
): Promise<Customer | null> {
  const [row] = await sql`
    UPDATE demo_customers AS c SET
      business_name  = ${inputs.businessName},
      website_url    = ${inputs.websiteUrl ?? null},
      maps_url       = ${inputs.mapsUrl ?? null},
      research_notes = ${inputs.researchNotes ?? null},
      status         = ${"researching" satisfies CustomerStatus},
      error          = ${null}
    WHERE c.id = ${id}
    RETURNING ${customerColumns()}
  `;
  return row ? fromCustomerRow(row as unknown as DemoCustomerRow) : null;
}

/** What a finished research run has to say — `ResearchResult` from `src/demo/research.ts`. */
export interface ResearchOutcome {
  businessName: string;
  profile: BusinessProfile;
  dossier: string;
  sources: ResearchSource[];
  resolvedMapsUrl?: string;
}

/**
 * Store a finished run and rebuild the prompts from it — the promo's second `saveCustomer`, and the
 * same one its `runResearch` makes from `POST /customers`.
 *
 * **The prompts are the point.** The promo's rule is `keepPrompts = customer.prompts.edited &&
 * !regeneratePrompts`, and otherwise `buildPrompts(result.profile, agentName, language)`: a profile
 * that has just been discovered is worth nothing to a receptionist whose script still describes the
 * empty one. Hand-edited prompts survive unless "Re-research" was asked with regenerate on.
 *
 * Read and write are one transaction on a `FOR UPDATE` row for the same reason `patchCustomer` is:
 * `edited`, `agentName` and `language` are read here and are exactly what a drawer save changes, and
 * a research run takes over a minute — far longer than the window that handler races over.
 *
 * `null` when the record went away while the run was in flight, which is the promo's
 * `if (!current) return;`.
 */
export async function saveResearch(
  id: string,
  result: ResearchOutcome,
  options: { regeneratePrompts?: boolean } = {},
): Promise<Customer | null> {
  return (await sql.begin(async (tx) => {
    const [row] = await tx`
      SELECT ${customerColumns()} FROM demo_customers c WHERE c.id = ${id} FOR UPDATE
    `;
    if (!row) return null;
    const current = fromCustomerRow(row as unknown as DemoCustomerRow);

    const keepPrompts = current.prompts.edited && !options.regeneratePrompts;
    const prompts = keepPrompts
      ? current.prompts
      : buildPrompts(result.profile, current.agentName, current.language);
    const now = new Date().toISOString();

    const [updated] = await tx`
      UPDATE demo_customers AS c SET
        business_name     = ${result.businessName || current.businessName},
        resolved_maps_url = ${result.resolvedMapsUrl ?? null},
        profile           = ${jsonb(result.profile)},
        dossier           = ${result.dossier},
        sources           = ${jsonb(result.sources)},
        prompts           = ${jsonb(prompts)},
        status            = ${"ready" satisfies CustomerStatus},
        error             = ${null},
        researched_at     = ${now},
        updated_at        = ${now}
      WHERE c.id = ${id}
      RETURNING ${customerColumns()}
    `;
    return fromCustomerRow(updated as unknown as DemoCustomerRow);
  })) as Customer | null;
}

/**
 * Record that a research run failed — the promo's third `saveCustomer`, on the catch.
 *
 * Nothing else is touched. That is what "the record stays usable" means concretely: the profile,
 * the dossier, the sources and the prompts are whatever they were a moment ago, so a prospect that
 * had been researched before keeps the receptionist it had, and a brand-new one keeps the thin
 * prompts `createCustomer` built. The operator sees the message and can try again.
 *
 * `null` when the record went away in the meantime.
 */
export async function failResearch(id: string, message: string): Promise<Customer | null> {
  const [row] = await sql`
    UPDATE demo_customers AS c SET
      status     = ${"error" satisfies CustomerStatus},
      error      = ${message},
      updated_at = ${new Date().toISOString()}
    WHERE c.id = ${id}
    RETURNING ${customerColumns()}
  `;
  return row ? fromCustomerRow(row as unknown as DemoCustomerRow) : null;
}

/**
 * Remove a customer and everything hanging off it. `false` when there was none.
 *
 * The promo deleted the calls, the events and the notes by hand because Redis has no foreign keys;
 * here `demo_calls`, `demo_call_events` and `demo_notes` all reference `demo_customers(id)`
 * `ON DELETE CASCADE`, so this one statement is the whole cascade.
 */
export async function deleteCustomer(id: string): Promise<boolean> {
  const rows = await sql`DELETE FROM demo_customers WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/**
 * Append one CRM note — the promo's `addNote`: a 10-character id, the instant it was written, and
 * the text trimmed and cut at 2000 characters.
 *
 * Notes are their own append-only table rather than a field on the customer: writing one should not
 * rewrite the whole record, and a sales note is worth more as a history than as a box that keeps
 * getting overwritten. The `notes` string on the customer stays where it is — that is the
 * operator's scratchpad, and this is the timeline.
 */
export async function addNote(customerId: string, text: string): Promise<CrmNote> {
  const [row] = await sql`
    INSERT INTO demo_notes (id, customer_id, at, text)
    VALUES (${newId(10)}, ${customerId}, ${new Date().toISOString()}, ${text.trim().slice(0, 2000)})
    RETURNING id, customer_id AS "customerId", at, text
  `;
  return fromNoteRow(row as unknown as DemoNoteRow);
}

/** The promo's calls PATCH body, minus the `callId` the caller has already split out. */
export interface CallPatch {
  isTest?: boolean;
  /** Retired. Accepted and ignored — see below. */
}

/**
 * Change one call. `null` when that customer has no call with that id.
 *
 * `isTest` reclassifies it: calls made before the test flag was explicit were tagged from the admin
 * cookie, so an operator trying a prospect's own link marked it as a test and it disappeared from
 * the numbers. This is how those get counted again, one at a time, by the person who knows which
 * was which.
 *
 * Reclassifying is all this does. `analyze` is **not** handled here: the route owns that branch,
 * because it has to refuse a call that is too short (400) or a model that cannot be read back (502)
 * before anything is written, and it saves the result through `attachReview`. An earlier version of
 * this comment said the analyze pipeline was retired — it was, and then it came back with
 * `src/demo/callReview.ts`.
 */
export async function patchCall(
  customerId: string,
  callId: string,
  patch: CallPatch,
): Promise<CallLog | null> {
  const [row] =
    typeof patch.isTest === "boolean"
      ? await sql`
          UPDATE demo_calls AS l SET is_test = ${patch.isTest}
          WHERE l.id = ${callId} AND l.customer_id = ${customerId}
          RETURNING ${callColumns()}
        `
      : await sql`
          SELECT ${callColumns()} FROM demo_calls l
          WHERE l.id = ${callId} AND l.customer_id = ${customerId}
        `;
  return row ? fromCallRow(row as unknown as DemoCallRow) : null;
}

/**
 * Open a call record — the promo's `saveCall` of a freshly minted `CallLog`, at the top of
 * `app/api/session/route.ts`: a 12-character id, the instant it started, an empty transcript, and
 * `status: "started"` until a report comes in.
 *
 * `isTest` is not a parameter, because it is not a choice. The promo decided it per request
 * (`body.isTest === true && isAdminRequest()`) since the same route also served a prospect
 * following their own demo link; here the only caller is the operator's test panel behind the
 * admin guard, so every call this backend places is a test call and is written as one.
 *
 * `visitorId` is likewise absent: it identified an anonymous visitor to the public demo, and the
 * caller here is a signed-in admin.
 *
 * `liveSessionId` starts empty because the row is written *before* OpenAI is asked for a session —
 * see the ordering comment in the route. `attachLiveSession` fills it in once there is one.
 */
export async function startCall(input: {
  customerId: string;
  userAgent?: string;
}): Promise<CallLog> {
  const [row] = await sql`
    INSERT INTO demo_calls AS l (
      id, customer_id, live_session_id, started_at, status, is_test, user_agent, transcript
    ) VALUES (
      ${newId(12)}, ${input.customerId}, ${""}, ${new Date().toISOString()},
      ${"started" satisfies CallStatus}, ${true}, ${input.userAgent ?? null}, ${jsonb([])}
    )
    RETURNING ${callColumns()}
  `;
  return fromCallRow(row as unknown as DemoCallRow);
}

/**
 * Record which live session a started call is holding — the promo's second `saveCall`, the one
 * that runs after `createLiveSession` comes back. `null` when the row is no longer there.
 */
export async function attachLiveSession(
  callId: string,
  liveSessionId: string,
): Promise<CallLog | null> {
  const [row] = await sql`
    UPDATE demo_calls AS l SET live_session_id = ${liveSessionId}
    WHERE l.id = ${callId}
    RETURNING ${callColumns()}
  `;
  return row ? fromCallRow(row as unknown as DemoCallRow) : null;
}

/**
 * Take a started call back — the promo's `deleteCall`, used on its failure paths. `false` when
 * that customer has no call with that id.
 *
 * A session that never opened is not a call: left behind, the `started` row shows up in the
 * Activity tab and `inFlightCalls` counts it for the ten minutes it takes to age out.
 */
export async function deleteCall(customerId: string, callId: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM demo_calls WHERE id = ${callId} AND customer_id = ${customerId} RETURNING id
  `;
  return rows.length > 0;
}

/** What a report says about a call that has ended, already normalised by the route. */
export interface CallReport {
  status: CallStatus;
  endedAt: string;
  durationSec?: number;
  endReason?: string;
  turns: number;
  transcript: TranscriptEntry[];
}

/**
 * Why this is a union rather than `CallLog | null`: the report route has three answers, and two of
 * them are not errors. `missing` is its 404; `alreadyReported` is the call that has already been
 * reported once and must not be rewritten; `finished` carries the row as it now stands, which is
 * what the review then reads.
 */
export type CallOutcome =
  | { outcome: "finished"; call: CallLog }
  | { outcome: "alreadyReported" }
  | { outcome: "missing" };

/**
 * Close a started call — the promo's `saveCall(ended)` at the end of
 * `app/api/calls/[callId]/route.ts`.
 *
 * The status check lives *inside* the transaction, on a `FOR UPDATE` row, because the client
 * reports twice by design: the ordinary end-of-call POST, and the unload beacon that may land
 * after it. The promo read the call, checked `status !== "started"` in the route and then saved,
 * which leaves a window the width of that gap in which both reports read `started` and the second
 * overwrites the first — the stored transcript then being whichever request happened to commit
 * last. Here the second report finds the row locked, reads the status the first one wrote and is
 * told `alreadyReported`. The first result wins, which is the whole point of the check.
 *
 * `customerId` is an optional narrowing filter, not a requirement: the promo passed `body.customerId`
 * so its lookup could go straight to the right record instead of walking every customer, and a
 * primary-key select needs no such help. Sent, it still has to match — a report naming the wrong
 * prospect is not a report of this call.
 */
export async function finishCall(
  callId: string,
  report: CallReport,
  customerId?: string,
): Promise<CallOutcome> {
  return (await sql.begin(async (tx) => {
    const [existing] = await tx`
      SELECT l.id, l.status FROM demo_calls l
      WHERE l.id = ${callId} ${customerId ? sql`AND l.customer_id = ${customerId}` : sql``}
      FOR UPDATE
    `;
    if (!existing) return { outcome: "missing" };
    if ((existing as { status: string }).status !== "started") {
      return { outcome: "alreadyReported" };
    }

    const [row] = await tx`
      UPDATE demo_calls AS l SET
        status       = ${report.status},
        ended_at     = ${report.endedAt},
        duration_sec = ${report.durationSec ?? null},
        end_reason   = ${report.endReason ?? null},
        turns        = ${report.turns},
        transcript   = ${jsonb(report.transcript)}
      WHERE l.id = ${callId}
      RETURNING ${callColumns()}
    `;
    return { outcome: "finished", call: fromCallRow(row as unknown as DemoCallRow) };
  })) as CallOutcome;
}

/**
 * Store the review a reported call was given — the promo's `saveCall({ ...ended, review })`.
 *
 * Separate from `finishCall` because it happens after it and may not happen at all: the review is
 * asked for once the call is already safely recorded, and a call with no review is a call the model
 * was not asked about or could not answer on. `null` when the row is no longer there.
 */
export async function attachReview(callId: string, review: CallReview): Promise<CallLog | null> {
  const [row] = await sql`
    UPDATE demo_calls AS l SET review = ${jsonb(review)}
    WHERE l.id = ${callId}
    RETURNING ${callColumns()}
  `;
  return row ? fromCallRow(row as unknown as DemoCallRow) : null;
}
