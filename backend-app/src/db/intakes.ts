import { sql } from "./client";

// The fields collected for a callback intake (camelCase — matches the API body).
export interface IntakeInput {
  language: string;
  name: string;
  email: string;
  phoneNumber: string;
  purpose: string;
  dateTime: string; // ISO 8601 date-time
}

// A stored intake row, plus the DB-generated id/timestamp.
export interface IntakeRecord {
  id: string;
  language: string;
  name: string;
  email: string;
  phoneNumber: string;
  purpose: string;
  scheduledAt: string;
  createdAt: string;
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
  created_at   AS "createdAt"
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
