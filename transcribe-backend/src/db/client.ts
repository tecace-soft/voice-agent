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
  // How far along a customer is, and which business record is theirs.
  //
  // `business_id` is the connection point between the two halves of this system: it holds the id of
  // the `demo_customers` row this account grew out of. Nothing is joined on it at read time — the
  // two tables stay independent on purpose — it exists so that promoting an account knows which
  // demo record to copy from, once.
  //
  // `status` is deliberately NOT defaulted to a lifecycle stage. Every account that already exists
  // gets `'unassigned'`, which means "not placed in the lifecycle yet" and gates nothing: one of
  // them is a live voicemail customer and must carry on exactly as before while this is built. Only
  // `'demo'` restricts anything, so a stage nobody has set can never take a section away from
  // somebody.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_id TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'unassigned'`;
  await sql`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_known
  `;
  await sql`
    ALTER TABLE users ADD CONSTRAINT users_status_known
      CHECK (status IN ('unassigned', 'demo', 'pre-production', 'production'))
  `;
  // One account per demo record. Promoting the same prospect twice would give two accounts the same
  // business, and the second copy would silently diverge from the first.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS users_one_per_business
      ON users (business_id) WHERE business_id IS NOT NULL
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
  // What this business wants the assistant to do differently on their calls — typed in the
  // dashboard, in their own words, and appended to the agent's instructions as preferences. Their
  // wishes, not their own rule book: the caller-facing guarantees are not a customer setting.
  await sql`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS house_rules TEXT`;

  // The structured profile a customer edits in the Knowledge tab — the same shape the demo
  // prospects use (`demo/types.ts` BusinessProfile), so the dashboard renders both with one editor.
  //
  // It does NOT replace the derived columns above; it feeds them. `business/derive.ts` renders
  // `facts`, `hours_text`, `open_hour`, `close_hour`, `business_name` and `website` out of this on
  // every save, because `GET /business/config` promises the phone agent flat strings and two ints
  // and that promise is older than this column. Structured here, flat on the wire.
  //
  // NULL means a profile written before this existed: the derived columns are then the extractor's
  // own and are left exactly as they are, so nothing a customer has today changes until they open
  // the tab. `backfillProfile` builds one on first read.
  await sql`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS profile JSONB`;
  // The three prompts, generated from the profile and editable by hand — the demo's own contract
  // (`prompts.edited` freezes them, a version bump rebuilds the untouched ones). Stored rather than
  // built at call time so an edit is a thing that persists, and so the dashboard can show exactly
  // what was sent.
  await sql`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS prompts JSONB`;
  // Which of the twelve voices answers, and which language the opening line is in. Both are the
  // demo's per-customer settings; the phone agent reads a global voice today and detects the
  // caller's language, so these are stored and shown but not yet consumed — see BUSINESS_TABS.md.
  await sql`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS voice TEXT`;
  await sql`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS language TEXT`;

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
  // How long the voice agent has been on the phone for each business: this month's running total
  // and last month's, rolled over by src/db/callMinutes.ts. Seconds, not minutes, so short calls
  // aren't lost to rounding.
  //
  // owner_key is the account id, or 'unassigned' for calls on numbers nobody owns. It is the
  // conflict target and never null (NULL never equals NULL, so user_id itself can't be one); the
  // CHECK keeps the two from disagreeing. CASCADE, like inbound_calls: an account's usage goes with it.
  await sql`
    CREATE TABLE IF NOT EXISTS agent_call_minutes (
      owner_key        TEXT PRIMARY KEY,
      user_id          UUID REFERENCES users(id) ON DELETE CASCADE,
      current_month    TEXT NOT NULL,
      current_seconds  INTEGER NOT NULL DEFAULT 0,
      previous_month   TEXT NOT NULL,
      previous_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at       TIMESTAMPTZ,
      CHECK (owner_key = COALESCE(user_id::text, 'unassigned'))
    )
  `;

  // One row per reported agent session, so usage can be totalled over any range — the monthly
  // counter above can only answer "this month" and "last month". Written in the same transaction as
  // that counter (src/db/callMinutes.ts), so the two can never disagree about a call.
  //
  // owner_key matches the counter's: the account that owned the agent's number when the call was
  // reported, or 'unassigned'. Fixed at write time, so reassigning a number later doesn't rewrite
  // history. started_at is what every range is measured by; reported_at is when the agent told us,
  // and the two differ by the call's length (or by however late the report was).
  await sql`
    CREATE TABLE IF NOT EXISTS agent_call_sessions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_key   TEXT NOT NULL,
      user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
      seconds     INTEGER NOT NULL CHECK (seconds >= 0 AND seconds <= 86400),
      started_at  TIMESTAMPTZ NOT NULL,
      reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (owner_key = COALESCE(user_id::text, 'unassigned'))
    )
  `;
  // The range query is always "this owner, between two instants"; the second index is for
  // coverageFrom, a MIN over the whole table.
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_call_sessions_owner_started ON agent_call_sessions (owner_key, started_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_call_sessions_started ON agent_call_sessions (started_at)`;

  // Keys other systems use to read this API — one per integration, so one can be cut off without
  // touching the others. Only the HASH is stored: a key is shown once when it is created and is
  // unreadable afterwards, so a database dump cannot be used to call the API.
  //
  // user_id is unused: every key reads every business, choosing one per request. It is left in place
  // because the table is already deployed, and dropping a column is not worth a destructive migration.
  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name         TEXT NOT NULL,
      key_hash     TEXT NOT NULL UNIQUE,
      key_prefix   TEXT NOT NULL,
      user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by   TEXT,
      last_used_at TIMESTAMPTZ,
      revoked_at   TIMESTAMPTZ
    )
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

  // ---- Demo data, imported from the promo's final Redis export (2026-09-22). ----
  // A different product sharing this database, hence the demo_ prefix. The ids are the promo's own
  // nanoids: they are in the demo links, the transcripts and the CSV exports, so renumbering them
  // would break links for no gain.
  await sql`
    CREATE TABLE IF NOT EXISTS demo_customers (
      id                TEXT PRIMARY KEY,
      active            BOOLEAN NOT NULL DEFAULT true,
      business_name     TEXT NOT NULL,
      label             TEXT,
      contact_name      TEXT,
      contact_email     TEXT,
      operator_notes    TEXT,          -- the promo's Customer.notes, not the CRM note list
      website_url       TEXT,
      maps_url          TEXT,
      resolved_maps_url TEXT,
      research_notes    TEXT,
      profile           JSONB NOT NULL DEFAULT '{}'::jsonb,
      dossier           TEXT NOT NULL DEFAULT '',   -- markdown, not JSON
      sources           JSONB NOT NULL DEFAULT '[]'::jsonb,
      prompts           JSONB NOT NULL DEFAULT '{}'::jsonb,
      call_sound        JSONB,
      voice             TEXT,
      agent_name        TEXT,
      language          TEXT,          -- absent means English
      demo_minutes      INTEGER,
      stage             TEXT CHECK (stage IS NULL OR stage IN ('new','contacted','interested','won','lost')),
      status            TEXT NOT NULL,
      error             TEXT,
      last_contacted_at TIMESTAMPTZ,
      follow_up_at      TIMESTAMPTZ,
      researched_at     TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL,   -- the promo's own timestamps, not the import's
      updated_at        TIMESTAMPTZ NOT NULL,
      imported_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_demo_customers_stage ON demo_customers (stage)`;

  await sql`
    CREATE TABLE IF NOT EXISTS demo_calls (
      id              TEXT PRIMARY KEY,
      customer_id     TEXT NOT NULL REFERENCES demo_customers(id) ON DELETE CASCADE,
      live_session_id TEXT,
      started_at      TIMESTAMPTZ NOT NULL,
      ended_at        TIMESTAMPTZ,
      status          TEXT NOT NULL CHECK (status IN ('started','completed','failed','abandoned')),
      duration_sec    INTEGER CHECK (duration_sec IS NULL OR duration_sec >= 0),
      turns           INTEGER CHECK (turns IS NULL OR turns >= 0),
      end_reason      TEXT,
      is_test         BOOLEAN NOT NULL DEFAULT false,
      visitor_id      TEXT,
      ip_hash         TEXT,
      user_agent      TEXT,
      transcript      JSONB NOT NULL DEFAULT '[]'::jsonb,
      review          JSONB,
      imported_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_demo_calls_customer_started ON demo_calls (customer_id, started_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_demo_calls_started ON demo_calls (started_at)`;

  // The source has no event id, so identity is the tuple below. `source` keeps the distinction the
  // promo's own readEvents makes between its legacy global list and the per-customer ones.
  await sql`
    CREATE TABLE IF NOT EXISTS demo_call_events (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id TEXT NOT NULL REFERENCES demo_customers(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      at          TIMESTAMPTZ NOT NULL,
      visitor_id  TEXT,
      ip_hash     TEXT,
      source      TEXT NOT NULL CHECK (source IN ('legacy','customer')),
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // What makes a re-import idempotent. COALESCE because NULL never equals NULL in an index either.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_call_events_identity
      ON demo_call_events (customer_id, type, at, COALESCE(visitor_id, ''), COALESCE(ip_hash, ''))
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_demo_call_events_customer_at ON demo_call_events (customer_id, at)`;

  // Empty in the 2026-09-22 export — no note was ever written. It exists because the CRM tab writes
  // notes, and the schema should not need changing the day it does.
  await sql`
    CREATE TABLE IF NOT EXISTS demo_notes (
      id          TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES demo_customers(id) ON DELETE CASCADE,
      at          TIMESTAMPTZ NOT NULL,
      text        TEXT NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_demo_notes_customer_at ON demo_notes (customer_id, at DESC)`;
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
    await sql`SELECT house_rules FROM business_profiles LIMIT 1`;
    await sql`SELECT 1 FROM inbound_calls LIMIT 1`;
    await sql`SELECT requested_time, sheet_written_at FROM inbound_calls LIMIT 1`;
    await sql`SELECT 1 FROM agent_call_minutes LIMIT 1`;
    await sql`SELECT 1 FROM agent_call_sessions LIMIT 1`;
    await sql`SELECT 1 FROM api_keys LIMIT 1`;
    await sql`SELECT 1 FROM demo_customers LIMIT 1`;
    await sql`SELECT 1 FROM demo_calls LIMIT 1`;
    await sql`SELECT 1 FROM demo_call_events LIMIT 1`;
    await sql`SELECT 1 FROM demo_notes LIMIT 1`;
    return;
  } catch {
    await initDb();
  }
}
