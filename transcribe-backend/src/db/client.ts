import postgres from "postgres";
import { env } from "../config/env.js";

// postgres.js — a runtime-agnostic Postgres client (works on both Bun locally and the Node
// runtime on Vercel). A single shared, pooled client; use it as a tagged template so values are
// sent as bound parameters (injection-safe). `prepare: false` keeps it compatible with connection
// poolers (transaction pooling doesn't support server-side prepared statements).
export const sql = postgres(env.databaseUrl, {
  prepare: false,
  // Our schema setup is idempotent (IF NOT EXISTS), which emits routine NOTICEs; suppress them.
  onnotice: () => {},
});

// Create the schema if it does not exist. Called once on startup (and by the migrate script).
// Statements run separately because the Postgres wire protocol takes one command per query.
export async function initDb(): Promise<void> {
  // One row per transcribe-app pass — the data behind the dashboard's stats.
  await sql`
    CREATE TABLE IF NOT EXISTS voicemail_runs (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      voicemails INTEGER NOT NULL DEFAULT 0,  -- messages carrying audio the run found
      processed  INTEGER NOT NULL DEFAULT 0,  -- transcribed + written to the sheet this run
      skipped    INTEGER NOT NULL DEFAULT 0,  -- already handled on a prior run
      failed     INTEGER NOT NULL DEFAULT 0,  -- errored (left for a retry)
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_voicemail_runs_created_at ON voicemail_runs (created_at)`;

  // Dashboard accounts. Passwords are scrypt hashes (src/auth/password.ts) — never plaintext.
  // `token_version` is bumped to invalidate the session tokens an account already handed out.
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT NOT NULL,           -- stored lower-cased; sign-in is case-insensitive
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)`;
}

// Ensure the schema is ready before serving requests, at most once per process (cached promise).
// On Vercel the app is a fetch handler with no startup hook, so we gate requests on this — but run
// a cheap probe first and only fall back to the full idempotent initDb when the table is missing,
// so concurrent cold starts don't contend on the CREATE lock. A failed attempt clears the cache.
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
    // Probe every table, so a database created before a table was added still gets migrated.
    await sql`SELECT 1 FROM voicemail_runs LIMIT 1`;
    await sql`SELECT 1 FROM users LIMIT 1`;
    return;
  } catch {
    await initDb();
  }
}
