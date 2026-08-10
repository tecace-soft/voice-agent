import { sql } from "./client.js";

// The callback lifecycle a client record moves through:
//   new         — just submitted by the form, waiting for the agent
//   contacted   — the agent reached the person
//   booked      — a consultation was scheduled
//   unreachable — the agent could not get through
//   canceled    — a booking was canceled (frees the slot; only `booked` counts as taken)
export const INTAKE_STATUSES = [
  "new",
  "contacted",
  "booked",
  "unreachable",
  "canceled",
] as const;
export type IntakeStatus = (typeof INTAKE_STATUSES)[number];

// The fields collected for a callback intake (camelCase — matches the API body).
export interface IntakeInput {
  language: string;
  name: string;
  email: string;
  phoneNumber: string;
  purpose: string; // what the lead reached out about (the agent confirms it on the call)
  dateTime: string; // ISO 8601 date-time
}

// A stored intake row, plus the DB-managed status/timestamps.
export interface IntakeRecord {
  id: string;
  language: string;
  name: string;
  email: string;
  phoneNumber: string;
  purpose: string; // what the lead reached out about
  scheduledAt: string;
  status: IntakeStatus;
  notes: string | null; // agent's post-call summary (null until written)
  attempts: number; // how many times the agent has tried to call this lead
  calUid: string | null; // Cal.com booking uid for the active meeting (null if none)
  callbackAfter: string | null; // earliest time to (re)call this lead (null if none)
  createdAt: string;
  updatedAt: string;
}

// Shared column list, mapping the snake_case schema back to the camelCase shape the
// API returns. Reused by every read/write so the record shape stays consistent.
const RETURN_COLUMNS = sql`
  id,
  language,
  name,
  email,
  phone_number AS "phoneNumber",
  purpose,
  scheduled_at AS "scheduledAt",
  status,
  notes,
  attempts,
  cal_uid        AS "calUid",
  callback_after AS "callbackAfter",
  created_at     AS "createdAt",
  updated_at     AS "updatedAt"
`;

// Persist one intake and return the stored row.
export async function insertIntake(input: IntakeInput): Promise<IntakeRecord> {
  const [row] = await sql`
    INSERT INTO intakes (language, name, email, phone_number, purpose, scheduled_at)
    VALUES (${input.language}, ${input.name}, ${input.email},
            ${input.phoneNumber}, ${input.purpose}, ${input.dateTime})
    RETURNING ${RETURN_COLUMNS}
  `;
  return row as IntakeRecord;
}

// Optional filters the dashboard can apply to the list. All are combined with AND;
// omitted fields are ignored.
export interface IntakeFilters {
  status?: IntakeStatus; // lifecycle state — the agent polls `status=new`
  language?: string; // exact match, case-insensitive
  q?: string; // substring search across name / email
  scheduledFrom?: string; // ISO 8601 — scheduled_at >= this
  scheduledTo?: string; // ISO 8601 — scheduled_at <= this
}

// A composable SQL fragment (the result of a Bun `sql` tagged template), derived from
// an existing fragment so we don't have to name Bun's internal `SQL.Query` type.
type SqlFragment = typeof RETURN_COLUMNS;

// Build a `WHERE ...` fragment from the active filters (or an empty fragment if none).
// Every value is interpolated as a bound parameter, so this is injection-safe.
function whereClause(filters: IntakeFilters): SqlFragment {
  const conditions: SqlFragment[] = [];
  if (filters.status) {
    conditions.push(sql`status = ${filters.status}`);
  }
  if (filters.language) {
    conditions.push(sql`lower(language) = lower(${filters.language})`);
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    conditions.push(
      sql`(name ILIKE ${like} OR email ILIKE ${like} OR purpose ILIKE ${like})`,
    );
  }
  if (filters.scheduledFrom) {
    conditions.push(sql`scheduled_at >= ${filters.scheduledFrom}`);
  }
  if (filters.scheduledTo) {
    conditions.push(sql`scheduled_at <= ${filters.scheduledTo}`);
  }
  return conditions.reduce(
    (acc, cond, i) => (i === 0 ? sql`WHERE ${cond}` : sql`${acc} AND ${cond}`),
    sql``,
  );
}

// List stored intakes, newest first. `limit`/`offset` page; `filters` narrow the set.
export async function listIntakes(
  limit: number,
  offset: number,
  filters: IntakeFilters = {},
): Promise<IntakeRecord[]> {
  const where = whereClause(filters);
  const rows = await sql`
    SELECT ${RETURN_COLUMNS}
    FROM intakes
    ${where}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows as unknown as IntakeRecord[];
}

// Count matching intakes (same filters) — lets the dashboard show "N of M" / paging.
export async function countIntakes(filters: IntakeFilters = {}): Promise<number> {
  const where = whereClause(filters);
  const [row] = await sql`SELECT count(*)::int AS count FROM intakes ${where}`;
  return (row as { count: number }).count;
}

// Fetch a single intake by id, or null if it does not exist.
export async function getIntake(id: string): Promise<IntakeRecord | null> {
  const [row] = await sql`
    SELECT ${RETURN_COLUMNS}
    FROM intakes
    WHERE id = ${id}::uuid
  `;
  return (row as IntakeRecord | undefined) ?? null;
}

// Advance a client's lifecycle status (used by the agent to record what happened) and
// bump updated_at. Returns the updated row, or null if no intake has that id.
export async function updateIntakeStatus(
  id: string,
  status: IntakeStatus,
): Promise<IntakeRecord | null> {
  const [row] = await sql`
    UPDATE intakes
    SET status = ${status}, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING ${RETURN_COLUMNS}
  `;
  return (row as IntakeRecord | undefined) ?? null;
}

// Store (or clear) the Cal.com booking uid for an intake's meeting. Called after the
// meeting is created (uid) and after it's canceled (null). Returns the updated row, or
// null if no intake has that id.
export async function setCalUid(
  id: string,
  calUid: string | null,
): Promise<IntakeRecord | null> {
  const [row] = await sql`
    UPDATE intakes
    SET cal_uid = ${calUid}, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING ${RETURN_COLUMNS}
  `;
  return (row as IntakeRecord | undefined) ?? null;
}

// Schedule a deferred callback: store the earliest time to (re)call this lead, and RESET
// `attempts` to 0. A lead who answered and asked to be called back is engaged — they aren't
// unreachable — so they earn a fresh retry budget, and resetting also keeps the attempt cap
// from retiring them before the callback time arrives. Status stays `new` so the poller
// re-picks the lead (it holds the call until `callback_after`). Returns the updated row, or
// null if no intake has that id.
export async function setCallbackAfter(
  id: string,
  callbackAfter: string,
): Promise<IntakeRecord | null> {
  const [row] = await sql`
    UPDATE intakes
    SET callback_after = ${callbackAfter}::timestamptz,
        attempts = 0,
        status = 'new',
        updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING ${RETURN_COLUMNS}
  `;
  return (row as IntakeRecord | undefined) ?? null;
}

// Schedule an automatic retry: set the earliest time to call this lead again WITHOUT
// resetting `attempts` (unlike a human-requested callback via setCallbackAfter). Used by the
// post-call webhook when a call didn't connect — attempts must keep climbing toward the cap.
// Only applies to a still-`new` lead (a booked/contacted/retired lead is never re-called).
// Returns the updated row, or null if no matching intake exists.
export async function scheduleRetry(
  id: string,
  retryAfter: string,
): Promise<IntakeRecord | null> {
  const [row] = await sql`
    UPDATE intakes
    SET callback_after = ${retryAfter}::timestamptz, updated_at = now()
    WHERE id = ${id}::uuid AND status = 'new'
    RETURNING ${RETURN_COLUMNS}
  `;
  return (row as IntakeRecord | undefined) ?? null;
}

// Record one more call attempt against a client (atomic increment) and bump updated_at.
// The agent calls this each time it places a call; it reads the returned `attempts` to
// decide when to give up. A single UPDATE keeps concurrent increments from racing.
// Returns the updated row, or null if no intake has that id.
export async function incrementIntakeAttempts(
  id: string,
): Promise<IntakeRecord | null> {
  const [row] = await sql`
    UPDATE intakes
    SET attempts = attempts + 1, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING ${RETURN_COLUMNS}
  `;
  return (row as IntakeRecord | undefined) ?? null;
}

// The scheduled_at instants of every booked client — the taken slots. Optionally bounded
// to [from, to) for range queries so we don't scan the whole table.
export async function listBookedTimes(
  from?: string,
  to?: string,
): Promise<number[]> {
  const conditions: SqlFragment[] = [sql`status = 'booked'`];
  if (from) conditions.push(sql`scheduled_at >= ${from}`);
  if (to) conditions.push(sql`scheduled_at < ${to}`);
  const where = conditions.reduce(
    (acc, c, i) => (i === 0 ? sql`WHERE ${c}` : sql`${acc} AND ${c}`),
    sql``,
  );
  const rows = await sql`SELECT scheduled_at FROM intakes ${where}`;
  return (rows as unknown as { scheduled_at: string }[]).map((r) =>
    new Date(r.scheduled_at).getTime(),
  );
}

// Outcome of attempting to book a client into their requested slot.
export type BookResult =
  | { ok: true; intake: IntakeRecord }
  | { ok: false; reason: "not_found" | "conflict" | "in_past" };

// Atomically book a client. `at` is the time to book — the slot the caller chose on the
// call; when omitted it books the intake's existing scheduled_at (the form-requested
// time). Booking sets scheduled_at to the effective time, but only if it is not in the
// past and no other booked client's window overlaps it (slotMinutes on each side). A
// single conditional UPDATE keeps the checks and the write in one statement so two
// overlapping bookings can't both win. The `::timestamptz` cast types the (possibly null)
// param so COALESCE can fall back to the existing time.
export async function bookIntake(
  id: string,
  slotMinutes: number,
  at?: string,
): Promise<BookResult> {
  const target = at ?? null;
  const [row] = await sql`
    UPDATE intakes AS t
    SET status = 'booked',
        scheduled_at = COALESCE(${target}::timestamptz, t.scheduled_at),
        updated_at = now()
    WHERE t.id = ${id}::uuid
      AND COALESCE(${target}::timestamptz, t.scheduled_at) >= now()
      AND NOT EXISTS (
        SELECT 1 FROM intakes AS o
        WHERE o.status = 'booked'
          AND o.id <> t.id
          AND o.scheduled_at > COALESCE(${target}::timestamptz, t.scheduled_at) - make_interval(mins => ${slotMinutes})
          AND o.scheduled_at < COALESCE(${target}::timestamptz, t.scheduled_at) + make_interval(mins => ${slotMinutes})
      )
    RETURNING ${RETURN_COLUMNS}
  `;
  if (row) return { ok: true, intake: row as IntakeRecord };
  // Zero rows updated: distinguish missing id vs. past slot vs. conflict.
  const existing = await getIntake(id);
  if (!existing) return { ok: false, reason: "not_found" };
  const effective = at ?? existing.scheduledAt;
  if (new Date(effective).getTime() < Date.now()) {
    return { ok: false, reason: "in_past" };
  }
  return { ok: false, reason: "conflict" };
}

// Attach the agent's post-call summary to an intake. Returns the updated row, or null if
// no intake has that id.
export async function setIntakeNotes(
  id: string,
  notes: string,
): Promise<IntakeRecord | null> {
  const [row] = await sql`
    UPDATE intakes
    SET notes = ${notes}, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING ${RETURN_COLUMNS}
  `;
  return (row as IntakeRecord | undefined) ?? null;
}

// Cancel a client's booking: booked -> canceled, which frees the slot (only `booked`
// counts as taken). Keeps the client record. Only a currently-booked client can cancel.
export type CancelResult =
  | { ok: true; intake: IntakeRecord }
  | { ok: false; reason: "not_found" | "not_booked" };

export async function cancelBooking(id: string): Promise<CancelResult> {
  const [row] = await sql`
    UPDATE intakes
    SET status = 'canceled', updated_at = now()
    WHERE id = ${id}::uuid AND status = 'booked'
    RETURNING ${RETURN_COLUMNS}
  `;
  if (row) return { ok: true, intake: row as IntakeRecord };
  const existing = await getIntake(id);
  return { ok: false, reason: existing ? "not_booked" : "not_found" };
}

// Permanently delete a client record (hard delete). Returns the deleted row's Cal.com
// uid (so the caller can cancel that meeting), or null if no row was removed. If the
// client was booked, their slot frees up automatically.
export async function deleteIntake(
  id: string,
): Promise<{ calUid: string | null } | null> {
  const [row] = await sql`
    DELETE FROM intakes WHERE id = ${id}::uuid RETURNING cal_uid AS "calUid"
  `;
  return (row as { calUid: string | null } | undefined) ?? null;
}
