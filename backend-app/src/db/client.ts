import { SQL } from "bun";
import { env } from "../config/env";

// Bun ships a native PostgreSQL client (`Bun.SQL`) — no external driver dependency.
// A single shared, connection-pooled client for the whole app. Import `sql` and use it
// as a tagged template: values are sent as bound parameters, so this is injection-safe.
export const sql = new SQL(env.databaseUrl);

// Create the schema if it does not exist. Called once on startup (and by the migrate
// script). Kept idempotent so it is safe to run every boot in development. Statements
// run separately because the Postgres wire protocol takes one command per query.
export async function initDb(): Promise<void> {
  // `status` drives the callback lifecycle: new -> contacted -> booked | unreachable.
  await sql`
    CREATE TABLE IF NOT EXISTS intakes (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      language     TEXT NOT NULL,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      purpose      TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ NOT NULL,
      status       TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'contacted', 'booked', 'unreachable')),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Forward-compat for tables created before these columns existed.
  await sql`ALTER TABLE intakes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'`;
  await sql`ALTER TABLE intakes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`;
  // The agent polls by status, so index it.
  await sql`CREATE INDEX IF NOT EXISTS idx_intakes_status ON intakes (status)`;
}
