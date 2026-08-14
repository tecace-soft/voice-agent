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
      purpose      TEXT NOT NULL DEFAULT '',
      scheduled_at TIMESTAMPTZ NOT NULL,
      status       TEXT NOT NULL DEFAULT 'new',
      notes        TEXT,
      transcript   TEXT,
      attempts     INTEGER NOT NULL DEFAULT 0,
      cal_uid      TEXT,
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
  // `cal_uid` = the Cal.com booking uid for this intake's meeting (null when there's no
  // active meeting). We store it on booking so we can cancel that exact Cal.com booking
  // when the booking is canceled/deleted — freeing the slot so it can be cleanly re-booked.
  await sql`ALTER TABLE intakes ADD COLUMN IF NOT EXISTS cal_uid TEXT`;
  // `callback_after` = the earliest time to (re)call this lead, set when a call reaches
  // someone who asks to be called back later. The poller holds the lead until this instant
  // instead of using its default pre-call delay; null means "no deferred callback".
  await sql`ALTER TABLE intakes ADD COLUMN IF NOT EXISTS callback_after TIMESTAMPTZ`;
  // `purpose` = what the lead reached out about (the TecAce consulting scenario; the agent
  // confirms it on the call). Backfilled to '' on any rows created while it was absent.
  await sql`ALTER TABLE intakes ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT ''`;
  // `transcript` = the full text of the agent's call with this lead (both sides), written at
  // call end so the call is reviewable in the dashboard. Null until a call has happened.
  await sql`ALTER TABLE intakes ADD COLUMN IF NOT EXISTS transcript TEXT`;
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

// Ensure the schema is ready before serving requests, at most once per process (cached promise).
// On Vercel the app is a fetch handler with no startup hook, so we gate requests on this. BUT we
// must NOT run the heavy DDL (ALTER/DROP/CREATE — each takes an exclusive table lock) on every
// cold start: under steady polling Vercel spins fresh instances constantly, and concurrent
// cold-start migrations contend on those locks and hang, timing out the caller. So we run a cheap
// probe first and only fall back to the full idempotent initDb when the schema is actually behind
// (e.g. the first cold start after a deploy that added a column). A failed attempt clears the
// cache so the next request retries rather than caching a reject.
let dbReady: Promise<void> | null = null;
export function ensureDbReady(): Promise<void> {
  if (!dbReady) {
    dbReady = migrateIfNeeded().catch((err) => {
      dbReady = null;
      throw err;
    });
  }
  return dbReady;
}

async function migrateIfNeeded(): Promise<void> {
  try {
    // Cheap, lock-free probe of the newest expected column. If it selects, the schema is current
    // and we skip all DDL. NOTE: when adding a new column to initDb, update this probe column too.
    await sql`SELECT transcript FROM intakes LIMIT 1`;
    return;
  } catch {
    // Table or a column is missing → run the full idempotent setup (adds/updates as needed).
    await initDb();
  }
}
