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

  // Which mailbox the run fetched from — the address the transcribe-app polls. Everything the
  // dashboard shows is scoped by it: a `user` sees only the mailbox matching their own account
  // email. Nullable because runs reported before this existed have no mailbox to attribute them
  // to; those read as "unattributed" and only an admin ever sees them.
  await sql`ALTER TABLE voicemail_runs ADD COLUMN IF NOT EXISTS mailbox_email TEXT`;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_voicemail_runs_mailbox
    ON voicemail_runs (mailbox_email, created_at DESC)
  `;

  // Dashboard accounts. Passwords are scrypt hashes (src/auth/password.ts) — never plaintext.
  // `token_version` is bumped to invalidate the session tokens an account already handed out.
  // `role` is 'admin' (can manage accounts) or 'user' (can only read the dashboard).
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT NOT NULL,           -- stored lower-cased; sign-in is case-insensitive
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      password_hash TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email)`;

  // Roles arrived after the table did, so an already-deployed database needs the column added.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`;
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`;
  await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user'))`;

  // Accounts that existed before roles all defaulted to 'user', which would leave nobody able to
  // manage accounts. Promote the oldest account, but only if there is no admin at all.
  await sql`
    UPDATE users SET role = 'admin'
    WHERE id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
  `;

  // Notes people send from the dashboard's Feedback page. The author's name and email are copied
  // in rather than joined, so a note still says who wrote it after that account is removed —
  // which is also why user_id is nullable and set to NULL rather than cascading the delete.
  await sql`
    CREATE TABLE IF NOT EXISTS feedback (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
      author_name  TEXT NOT NULL,
      author_email TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT 'other',
      message      TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'open',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at  TIMESTAMPTZ,
      resolved_by  TEXT
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback (created_at DESC)`;
  await sql`ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_category_check`;
  await sql`
    ALTER TABLE feedback ADD CONSTRAINT feedback_category_check
    CHECK (category IN ('bug', 'idea', 'data', 'other'))
  `;
  await sql`ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_status_check`;
  await sql`
    ALTER TABLE feedback ADD CONSTRAINT feedback_status_check
    CHECK (status IN ('open', 'resolved'))
  `;
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
    // Probe every table AND the columns added after the fact, so a database created against an
    // older version of this schema still gets migrated.
    await sql`SELECT mailbox_email FROM voicemail_runs LIMIT 1`;
    await sql`SELECT role FROM users LIMIT 1`;
    await sql`SELECT 1 FROM feedback LIMIT 1`;
    return;
  } catch {
    await initDb();
  }
}
