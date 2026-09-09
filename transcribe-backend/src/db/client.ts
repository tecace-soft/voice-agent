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

  // One row per poller, UPSERTed every cycle — proof it is still running. mailbox_key is the
  // conflict target and never null (NULL never equals NULL, so a nullable column can't be one).
  await sql`
    CREATE TABLE IF NOT EXISTS poller_heartbeats (
      mailbox_key      TEXT PRIMARY KEY,
      mailbox_email    TEXT,
      last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      interval_seconds INTEGER NOT NULL DEFAULT 300,
      last_cycle_ok    BOOLEAN NOT NULL DEFAULT true,
      detail           TEXT,
      host             TEXT
    )
  `;

  // Why individual voicemails failed. One row per failed attachment, kept after acknowledgement so
  // the history survives — clearing the notification is not the same as forgetting the problem.
  await sql`
    CREATE TABLE IF NOT EXISTS voicemail_failures (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id          UUID REFERENCES voicemail_runs(id) ON DELETE CASCADE,
      mailbox_email   TEXT,
      filename        TEXT NOT NULL,
      from_addr       TEXT NOT NULL,
      error           TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      acknowledged_at TIMESTAMPTZ
    )
  `;
  // The badge query is "unacknowledged, for this mailbox" — a partial index so it stays cheap as
  // acknowledged rows accumulate and are never read by it again.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_voicemail_failures_unack
    ON voicemail_failures (mailbox_email, created_at DESC)
    WHERE acknowledged_at IS NULL
  `;

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

  // Which phone number the voice agent answers for which customer. Unrelated to voicemail — it
  // lives here because these are the same dashboard accounts being assigned. The UNIQUE on
  // phone_e164 is the whole point: two customers sharing a number would mean one company's facts
  // being read aloud to the other's caller.
  await sql`
    CREATE TABLE IF NOT EXISTS agent_numbers (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone_e164 TEXT NOT NULL UNIQUE,
      label      TEXT,
      -- SET NULL, not CASCADE: deleting an account must not delete a number we still pay Twilio
      -- for. It goes back to unassigned, and the agent answers neutrally until it is reassigned.
      user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // One Twilio number per customer, for now. Unassigned numbers stay unconstrained so a pool can be
  // held ready. Enforced here rather than in the UI: a rule the agent's correctness depends on
  // should not be something a future endpoint can forget to check.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS agent_numbers_one_per_user
    ON agent_numbers (user_id) WHERE user_id IS NOT NULL
  `;

  // What a customer told us about their business. source_text is theirs and is the only editable
  // part; every other column is derived from it by the extractor and is safe to regenerate.
  // CASCADE here, unlike agent_numbers: a profile means nothing without the account that wrote it,
  // whereas a phone number outlives its owner because we keep paying for it.
  await sql`
    CREATE TABLE IF NOT EXISTS business_profiles (
      user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      source_text   TEXT NOT NULL,
      source_hash   TEXT NOT NULL,
      business_name TEXT,
      hours_text    TEXT,
      open_hour     INTEGER,
      close_hour    INTEGER,
      website       TEXT,
      facts         TEXT,
      extracted_at  TIMESTAMPTZ,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Where callers go when they ask for a person. NOT derived from source_text like the columns
  // above: a phone number is not prose, and a model that picks the fax line or drops it entirely
  // routes a real caller to the wrong person. This one is typed in and validated.
  await sql`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS transfer_number TEXT`;
  // What the agent calls itself, and the first line every caller hears. Typed in for the same
  // reason as transfer_number: these are choices, not facts to be read out of a description.
  // NULL means "use the service default", which is why neither has a DEFAULT here — an empty
  // string and "not set" would otherwise be indistinguishable, and an empty greeting is silence.
  await sql`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS agent_name TEXT`;
  await sql`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS greeting TEXT`;
  // What this business wants put through to a person, on top of the standard appointment rules.
  await sql`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS transfer_topics TEXT`;

  // Calls the voice agent answered — the conversational counterpart to a transcribed voicemail.
  // user_id is resolved at write time from the number that was dialled; nullable, because a call
  // to an unassigned line still happened and the caller still deserves their message kept.
  await sql`
    CREATE TABLE IF NOT EXISTS inbound_calls (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id            UUID REFERENCES users(id) ON DELETE CASCADE,
      dialled            TEXT NOT NULL,
      caller             TEXT,
      caller_name        TEXT,
      callback_number    TEXT,
      request            TEXT,
      summary            TEXT,
      outcome            TEXT,
      callback_requested BOOLEAN NOT NULL DEFAULT false,
      duration_seconds   INTEGER,
      turns              JSONB NOT NULL DEFAULT '[]'::jsonb,
      started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // When the caller wants an appointment. Only ever set from what they SAID — the assistant has no
  // calendar, so this is a request to be actioned by a person, not a booking.
  await sql`ALTER TABLE inbound_calls ADD COLUMN IF NOT EXISTS requested_time TEXT`;
  // Stamped once the message has been written out to the spreadsheet, so a re-run cannot duplicate
  // a row. NULL means "still owed a row"; a message is only ever claimed by one writer.
  await sql`ALTER TABLE inbound_calls ADD COLUMN IF NOT EXISTS sheet_written_at TIMESTAMPTZ`;

  // The list is always "this customer's calls, newest first" — the one query the page makes.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_inbound_calls_user_started
    ON inbound_calls (user_id, started_at DESC)
  `;
  // A pasted screenshot, stored inline as a data URL. Kept in the row rather than in object storage
  // because feedback is low-volume and this needs no bucket, no signed URLs and no orphan cleanup —
  // the image is deleted exactly when the note is. The client downscales before upload and the
  // route caps the length, so a row stays well inside what a TEXT column handles comfortably.
  await sql`ALTER TABLE feedback ADD COLUMN IF NOT EXISTS screenshot TEXT`;
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
    await sql`SELECT screenshot FROM feedback LIMIT 1`;
    await sql`SELECT 1 FROM voicemail_failures LIMIT 1`;
    await sql`SELECT 1 FROM poller_heartbeats LIMIT 1`;
    await sql`SELECT 1 FROM agent_numbers LIMIT 1`;
    await sql`SELECT transfer_number FROM business_profiles LIMIT 1`;
    await sql`SELECT agent_name, greeting FROM business_profiles LIMIT 1`;
    await sql`SELECT transfer_topics FROM business_profiles LIMIT 1`;
    await sql`SELECT 1 FROM inbound_calls LIMIT 1`;
    await sql`SELECT requested_time, sheet_written_at FROM inbound_calls LIMIT 1`;
    return;
  } catch {
    await initDb();
  }
}
