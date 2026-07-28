import { SQL } from "bun";
import { env } from "../config/env";

// Bun ships a native PostgreSQL client (`Bun.SQL`) — no external driver dependency.
// A single shared, connection-pooled client for the whole app. Import `sql` and use it
// as a tagged template: values are sent as bound parameters, so this is injection-safe.
export const sql = new SQL(env.databaseUrl);

// Create the schema if it does not exist. Called once on startup (and by the migrate
// script). Kept idempotent so it is safe to run every boot in development.
export async function initDb(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS intakes (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      language     TEXT NOT NULL,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      purpose      TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}
