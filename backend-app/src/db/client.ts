import postgres from "postgres";
import { env } from "../config/env.js";

// postgres.js — a runtime-agnostic Postgres client (works on both Bun locally and the
// Node runtime on Vercel; `Bun.SQL` would not run on Node). A single shared, pooled
// client; use it as a tagged template so values are sent as bound parameters (injection-safe).
// `prepare: false` keeps it compatible with connection poolers such as Neon's / Vercel
// Postgres' PgBouncer (transaction pooling doesn't support server-side prepared statements).
export const sql = postgres(env.databaseUrl, {
  prepare: false,
  // Our schema setup is idempotent (IF NOT EXISTS / DROP IF EXISTS), which emits routine
  // NOTICEs; suppress them so migrate output stays clean.
  onnotice: () => {},
});

// Create the schema if it does not exist. Called once on startup (and by the migrate
// script). Kept idempotent so it is safe to run every boot in development. Statements
// run separately because the Postgres wire protocol takes one command per query.
export async function initDb(): Promise<void> {
  // `status` drives the callback lifecycle:
  //   new -> contacted -> booked | unreachable, and booked -> canceled.
  await sql`
    CREATE TABLE IF NOT EXISTS intakes (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      language     TEXT NOT NULL,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      purpose      TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ NOT NULL,
      status       TEXT NOT NULL DEFAULT 'new',
      notes        TEXT,
      attempts     INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Forward-compat for tables created before these columns existed.
  await sql`ALTER TABLE intakes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'`;
  await sql`ALTER TABLE intakes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`;
  // `notes` holds the agent's post-call summary (free text; null until written).
  await sql`ALTER TABLE intakes ADD COLUMN IF NOT EXISTS notes TEXT`;
  // `attempts` counts how many times the agent has tried to call this lead. The agent
  // bounds retries on it: past a max, it marks the lead `unreachable` so calls stop.
  await sql`ALTER TABLE intakes ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`;
  // Reconcile the allowed-status constraint (drop + re-add keeps it correct as the
  // lifecycle grows — existing values are always a subset of the new list, so it's safe).
  await sql`ALTER TABLE intakes DROP CONSTRAINT IF EXISTS intakes_status_check`;
  await sql`
    ALTER TABLE intakes ADD CONSTRAINT intakes_status_check
      CHECK (status IN ('new', 'contacted', 'booked', 'unreachable', 'canceled'))
  `;
  // The agent polls by status, so index it.
  await sql`CREATE INDEX IF NOT EXISTS idx_intakes_status ON intakes (status)`;
}
