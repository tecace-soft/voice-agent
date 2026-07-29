import { sql } from "./client";

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
  purpose: string;
  dateTime: string; // ISO 8601 date-time
}

// A stored intake row, plus the DB-managed status/timestamps.
export interface IntakeRecord {
  id: string;
  language: string;
  name: string;
  email: string;
  phoneNumber: string;
  purpose: string;
  scheduledAt: string;
  status: IntakeStatus;
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
  created_at   AS "createdAt",
  updated_at   AS "updatedAt"
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
  q?: string; // substring search across name / email / purpose
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
  return rows as IntakeRecord[];
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
  return (rows as { scheduled_at: string }[]).map((r) =>
    new Date(r.scheduled_at).getTime(),
  );
}

// Outcome of attempting to book a client into their requested slot.
export type BookResult =
  | { ok: true; intake: IntakeRecord }
  | { ok: false; reason: "not_found" | "conflict" | "in_past" };

// Atomically mark a client 'booked' — but only if their slot is not in the past and no
// other booked client's window overlaps theirs (slotMinutes on each side). A single
// conditional UPDATE keeps the checks and the write in one statement so two overlapping
// bookings can't both win.
export async function bookIntake(
  id: string,
  slotMinutes: number,
): Promise<BookResult> {
  const [row] = await sql`
    UPDATE intakes AS target
    SET status = 'booked', updated_at = now()
    WHERE target.id = ${id}::uuid
      AND target.scheduled_at >= now()
      AND NOT EXISTS (
        SELECT 1 FROM intakes AS other
        WHERE other.status = 'booked'
          AND other.id <> target.id
          AND other.scheduled_at >  target.scheduled_at - make_interval(mins => ${slotMinutes})
          AND other.scheduled_at <  target.scheduled_at + make_interval(mins => ${slotMinutes})
      )
    RETURNING ${RETURN_COLUMNS}
  `;
  if (row) return { ok: true, intake: row as IntakeRecord };
  // Zero rows updated: distinguish missing id vs. past slot vs. conflict.
  const existing = await getIntake(id);
  if (!existing) return { ok: false, reason: "not_found" };
  if (new Date(existing.scheduledAt).getTime() < Date.now()) {
    return { ok: false, reason: "in_past" };
  }
  return { ok: false, reason: "conflict" };
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

// Permanently delete a client record (hard delete). Returns true if a row was removed.
// If the client was booked, their slot frees up automatically.
export async function deleteIntake(id: string): Promise<boolean> {
  const [row] = await sql`DELETE FROM intakes WHERE id = ${id}::uuid RETURNING id`;
  return Boolean(row);
}
