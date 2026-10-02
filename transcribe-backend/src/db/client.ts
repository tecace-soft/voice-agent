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
  // What Twilio knows about each number (docs/superpowers/specs/2026-09-28-twilio-numbers-forwarding-
  // design.md). NULL twilio_sid = registered by hand before this existed, or a number Twilio no longer
  // has; a sync fills it in by matching phone_e164 against the account. webhook_state is the last
  // comparison of Twilio's URLs with the ones this server wants: unknown | ok | stale | error.
  // released_at is soft on purpose — call records point at the number by text, and the row keeps who
  // let go of what; buying the same number again clears it.
  await sql`
    ALTER TABLE agent_numbers
      ADD COLUMN IF NOT EXISTS twilio_sid          TEXT,
      ADD COLUMN IF NOT EXISTS number_type         TEXT,
      ADD COLUMN IF NOT EXISTS capabilities        JSONB,
      ADD COLUMN IF NOT EXISTS voice_url           TEXT,
      ADD COLUMN IF NOT EXISTS voice_fallback_url  TEXT,
      ADD COLUMN IF NOT EXISTS status_callback_url TEXT,
      ADD COLUMN IF NOT EXISTS sms_url             TEXT,
      ADD COLUMN IF NOT EXISTS webhook_state       TEXT NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS webhook_error       TEXT,
      ADD COLUMN IF NOT EXISTS webhooks_checked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS synced_at           TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS purchased_at        TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS purchase_request_id TEXT,
      ADD COLUMN IF NOT EXISTS released_at         TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS released_by         UUID REFERENCES users(id) ON DELETE SET NULL
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS agent_numbers_twilio_sid
    ON agent_numbers (twilio_sid) WHERE twilio_sid IS NOT NULL
  `;
  // A Buy that is clicked twice, or retried after a timeout, finds the row it already made instead of
  // buying a second number.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS agent_numbers_purchase_request
    ON agent_numbers (purchase_request_id) WHERE purchase_request_id IS NOT NULL
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
  // Whether this business's line, when it forwards to the agent, holds the call behind "press 1 to
  // accept" (a landline carrier's answer confirmation). Only then does the phone agent press 1: on
  // any other forwarded call the caller is already connected and would hear the tones.
  await sql`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS forward_accept_press BOOLEAN NOT NULL DEFAULT false`;

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

  // The customer's permanent id, HADE-0001: four letters from the business name as it was when the
  // customer was created, then a number. The nanoid above is the promo's and lives in links; this
  // one is what people say and write down, and it survives renames of the business.
  //
  // The number comes from a sequence, so a number is never handed out twice (a deleted customer's
  // number is not reused) and the code is unique whatever the letters are. Rows that predate the
  // column are numbered once, oldest first, in a single DO block: one statement, so it runs in one
  // transaction under the advisory lock, and concurrent cold starts cannot both number the same
  // rows. The DEFAULT is only set after that, so the backfill is the only thing that ever sees a
  // NULL.
  await sql`CREATE SEQUENCE IF NOT EXISTS customer_code_seq`;
  await sql`ALTER TABLE demo_customers ADD COLUMN IF NOT EXISTS customer_seq BIGINT`;
  await sql`
    DO $$
    DECLARE base BIGINT;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('demo_customers.customer_seq'));
      SELECT GREATEST(
        COALESCE((SELECT max(customer_seq) FROM demo_customers), 0),
        (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM customer_code_seq)
      ) INTO base;
      UPDATE demo_customers d SET customer_seq = base + n.rn
        FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
                FROM demo_customers WHERE customer_seq IS NULL) n
       WHERE d.id = n.id;
      IF FOUND THEN
        PERFORM setval('customer_code_seq', (SELECT max(customer_seq) FROM demo_customers));
      END IF;
    END $$
  `;
  await sql`ALTER TABLE demo_customers ALTER COLUMN customer_seq SET DEFAULT nextval('customer_code_seq')`;
  await sql`ALTER TABLE demo_customers ALTER COLUMN customer_seq SET NOT NULL`;

  // The letters: the first letter of each of the first four words, then one more letter from each
  // word in turn until there are four. Only A-Z count ("L&I" is two words, "Co." is CO), and legal
  // suffixes, titles and small words are skipped unless nothing else is left. Harbor Dental → HADE,
  // Meet Korean BBQ → MEKB, H Mart Bellevue → HMAB, Wowrack → WOWR. Short names are padded with X; a
  // name with no Latin letters at all gets CUST. lpad's width is at least the number's own length
  // because lpad truncates, so the number grows past 9999 instead of wrapping.
  await sql`
    CREATE OR REPLACE FUNCTION demo_customer_code(business TEXT, seq BIGINT) RETURNS TEXT
    LANGUAGE plpgsql IMMUTABLE AS $$
    DECLARE
      words TEXT[];
      take INT[];
      n INT;
      remaining INT := 4;
      progressed BOOLEAN := true;
      prefix TEXT := '';
    BEGIN
      words := ARRAY(
        SELECT w FROM unnest(regexp_split_to_array(upper(coalesce(business, '')), '[^A-Z]+'))
          WITH ORDINALITY AS t(w, o)
         WHERE w <> '' AND w <> ALL (ARRAY['A','AN','AND','AT','CO','COMPANY','CORP','CORPORATION',
           'DDS','DMD','DR','FOR','IN','INC','LIMITED','LLC','LLP','LP','LTD','MD','OF','PC','PLC',
           'PLLC','THE'])
         ORDER BY o);
      IF cardinality(words) = 0 THEN
        words := ARRAY(
          SELECT w FROM unnest(regexp_split_to_array(upper(coalesce(business, '')), '[^A-Z]+'))
            WITH ORDINALITY AS t(w, o)
           WHERE w <> '' ORDER BY o);
      END IF;
      n := least(cardinality(words), 4);
      IF n = 0 THEN
        prefix := 'CUST';
      ELSE
        take := array_fill(1, ARRAY[n]);
        remaining := 4 - n;
        WHILE remaining > 0 AND progressed LOOP
          progressed := false;
          FOR i IN 1..n LOOP
            EXIT WHEN remaining = 0;
            IF take[i] < length(words[i]) THEN
              take[i] := take[i] + 1;
              remaining := remaining - 1;
              progressed := true;
            END IF;
          END LOOP;
        END LOOP;
        FOR i IN 1..n LOOP
          prefix := prefix || left(words[i], take[i]);
        END LOOP;
        prefix := rpad(prefix, 4, 'X');
      END IF;
      RETURN prefix || '-' || lpad(seq::text, greatest(4, length(seq::text)), '0');
    END $$
  `;

  // The code is written once, by the trigger below, when the row is inserted; nothing else can set
  // it or change it afterwards, and renaming the business leaves it alone. Databases from before this
  // had `customer_code` as a generated column rendering CUST-0001: the DO block turns that into a
  // plain column and re-codes those rows once from their current names, keeping their numbers.
  await sql`ALTER TABLE demo_customers ADD COLUMN IF NOT EXISTS customer_code TEXT`;
  await sql`
    DO $$
    DECLARE was_generated BOOLEAN;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('demo_customers.customer_code'));
      SELECT is_generated = 'ALWAYS' INTO was_generated
        FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'demo_customers'
         AND column_name = 'customer_code';
      IF was_generated THEN
        ALTER TABLE demo_customers ALTER COLUMN customer_code DROP EXPRESSION;
      END IF;
      UPDATE demo_customers SET customer_code = demo_customer_code(business_name, customer_seq)
       WHERE was_generated OR customer_code IS NULL;
    END $$
  `;
  await sql`ALTER TABLE demo_customers ALTER COLUMN customer_code SET NOT NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_customers_code ON demo_customers (customer_code)`;
  await sql`
    CREATE OR REPLACE FUNCTION demo_customers_code_guard() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        NEW.customer_code := demo_customer_code(NEW.business_name, NEW.customer_seq);
      ELSIF NEW.customer_code IS DISTINCT FROM OLD.customer_code
         OR NEW.customer_seq IS DISTINCT FROM OLD.customer_seq THEN
        RAISE EXCEPTION 'demo_customers.customer_code is permanent';
      END IF;
      RETURN NEW;
    END $$
  `;
  // Created after the re-coding: `migrateIfNeeded` probes for it, so a database that stopped before
  // it runs the whole schema again.
  await sql`
    CREATE OR REPLACE TRIGGER demo_customers_code_guard
      BEFORE INSERT OR UPDATE ON demo_customers
      FOR EACH ROW EXECUTE FUNCTION demo_customers_code_guard()
  `;

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

  // ---- call settings: transfers, text-a-link, message scenarios ----------------------------------
  //
  // What the assistant may DO on a call, as opposed to what it knows (profile) or how it sounds
  // (prompts, voice). Shape and limits live in src/business/callSettings.ts; this only stores it.
  //
  // Two copies on purpose. `draft` is what the settings screens edit and what an in-app test call
  // uses; `published` is what a real phone call uses, and it changes only when someone presses
  // Publish. A half-finished transfer scenario must never reach a stranger's call just because it
  // was saved. NULL published means "never published" — the phone agent then falls back to the
  // single transfer_number above, exactly as before any of this existed.
  await sql`
    CREATE TABLE IF NOT EXISTS business_call_settings (
      user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      draft        JSONB NOT NULL,
      published    JSONB,
      published_at TIMESTAMPTZ,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Waterfall transfers are a plan feature: only an admin switches them on for an account, and the
  // customer's own saves are checked against it.
  await sql`ALTER TABLE business_call_settings ADD COLUMN IF NOT EXISTS waterfall_allowed BOOLEAN NOT NULL DEFAULT false`;
  // A demo has no phone line, so one copy: what the operator's test call uses. Copied into the
  // business's draft once, at onboarding — the same one-way hand-off as the profile.
  await sql`ALTER TABLE demo_customers ADD COLUMN IF NOT EXISTS call_settings JSONB`;

  // The calendar or booking tool a business books callers into (src/calendar). One per business:
  // the assistant needs one answer to "is Tuesday at 2 free?". `secret` is the sealed credentials —
  // a refresh token, an app-specific password or an API key — never stored in the clear, and never
  // sent back to the browser. The booking RULES live in the call settings, draft and published.
  await sql`
    CREATE TABLE IF NOT EXISTS calendar_connections (
      user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      provider    TEXT NOT NULL,
      account     TEXT NOT NULL DEFAULT '',
      secret      TEXT NOT NULL,
      target_id   TEXT,
      target_name TEXT,
      status      TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error')),
      last_error  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Every booking the assistant made, so the business can see them in one place whatever calendar
  // they landed in. `test` marks the ones made from an in-app test call.
  await sql`
    CREATE TABLE IF NOT EXISTS appointment_bookings (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider     TEXT NOT NULL,
      external_id  TEXT,
      start_at     TIMESTAMPTZ NOT NULL,
      end_at       TIMESTAMPTZ NOT NULL,
      caller_name  TEXT NOT NULL DEFAULT '',
      caller_phone TEXT NOT NULL DEFAULT '',
      reason       TEXT NOT NULL DEFAULT '',
      test         BOOLEAN NOT NULL DEFAULT false,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_appointment_bookings_user ON appointment_bookings (user_id, created_at DESC)`;

  // In-app test calls for real businesses. The demo's own test calls stay in demo_calls, which is
  // keyed by a demo record; these belong to an account. Kept as rows rather than a counter because
  // the monthly allowance is a SUM over this month, and the transcript and review are what the
  // customer reads back afterwards.
  await sql`
    CREATE TABLE IF NOT EXISTS app_test_calls (
      id              TEXT PRIMARY KEY,
      user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      placed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
      live_session_id TEXT,
      started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at        TIMESTAMPTZ,
      status          TEXT NOT NULL CHECK (status IN ('started','completed','failed','abandoned')),
      duration_sec    INTEGER CHECK (duration_sec IS NULL OR duration_sec >= 0),
      end_reason      TEXT,
      transcript      JSONB NOT NULL DEFAULT '[]'::jsonb,
      events          JSONB NOT NULL DEFAULT '[]'::jsonb,
      review          JSONB
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_app_test_calls_user_started ON app_test_calls (user_id, started_at DESC)`;
  // Test minutes a customer may spend per calendar month. NULL means the service default; an admin
  // raises or lowers it per account.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS test_seconds_cap INTEGER`;

  // What happened during a call beyond the words: transfer attempts and their outcome, links
  // offered and texted, consent replies. Keyed by Twilio's CallSid for a phone call (the one id both
  // legs of a transferred call share) or by the test call's id for an in-app one.
  await sql`
    CREATE TABLE IF NOT EXISTS call_events (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
      call_sid     TEXT,
      test_call_id TEXT,
      at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      type         TEXT NOT NULL,
      data         JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_call_events_sid ON call_events (call_sid, at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_call_events_test ON call_events (test_call_id, at)`;

  // Whether a phone number has agreed to receive texts from a business. Per business, not global:
  // agreeing to one company's links is not agreeing to every company's. `pending` holds links asked
  // for before the YES arrived, sent the moment it does.
  await sql`
    CREATE TABLE IF NOT EXISTS sms_consents (
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      phone_e164 TEXT NOT NULL,
      status     TEXT NOT NULL CHECK (status IN ('pending','opted_in','opted_out')),
      pending    JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, phone_e164)
    )
  `;

  // Both legs of a transferred call are one call. The agent posts a record per leg; keyed by
  // CallSid, the second leg merges into the first instead of listing the caller twice.
  await sql`ALTER TABLE inbound_calls ADD COLUMN IF NOT EXISTS call_sid TEXT`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_calls_call_sid
      ON inbound_calls (call_sid) WHERE call_sid IS NOT NULL
  `;

  // The moves between stages (docs/superpowers/specs/2026-09-27-phase-gates-design.md). A demo
  // customer asks to be set up; an admin approves (→ pre-production) or declines with a note; later
  // an admin switches the line on (→ production). The request is a sub-state of `demo`, kept as
  // timestamps rather than a fifth status, so the status CHECK — and the deployed backend that
  // relies on it — stay as they are.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_requested_at TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_request_note TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_declined_at TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_decline_note TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS live_at TIMESTAMPTZ`;
  // Billing, as the dashboard shows it: the plan the customer chose and the card on file. One row
  // per account, written when they request setup (`/demo/customers/:id/request-onboarding`) or from
  // the Billing page. The card is a MOCK until ax-billing (Stripe) is wired in: only what a receipt
  // would print is kept — brand, last four, expiry — never the number or the CVC. Nothing here is
  // charged; the trial starts at `users.live_at`, and `TRIAL_DAYS` after that is the first bill.
  await sql`
    CREATE TABLE IF NOT EXISTS billing_accounts (
      user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan               TEXT NOT NULL CHECK (plan IN ('solo', 'standard', 'business')),
      payment_brand      TEXT,
      payment_last4      TEXT,
      payment_exp_month  INTEGER,
      payment_exp_year   INTEGER,
      payment_name       TEXT,
      payment_mode       TEXT NOT NULL DEFAULT 'test',
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Accounts that were already answering calls before the stages existed: a number, and business
  // details the agent can speak from. They are in production in all but name, so they are named
  // so, once — `live_at` is what makes it once, so an admin who later moves one back is not undone
  // by the next cold start.
  await sql`
    UPDATE users u SET status = 'production', live_at = now()
     WHERE u.status = 'unassigned' AND u.role <> 'admin' AND u.live_at IS NULL
       AND EXISTS (SELECT 1 FROM agent_numbers n WHERE n.user_id = u.id)
       AND EXISTS (
         SELECT 1 FROM business_profiles p
          WHERE p.user_id = u.id AND p.business_name IS NOT NULL
            AND p.facts IS NOT NULL AND btrim(p.facts) <> ''
       )
  `;

  // Sign-up (routes/signup.ts). Where an account came from — an admin (every account before this
  // existed), a prospect claiming their demo from its public page, or a self-service sign-up — and
  // when its email was proven by a code. Informational: an unverified sign-up never becomes a row
  // here at all, so nothing gates on this.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source TEXT NOT NULL DEFAULT 'admin'`;
  await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_signup_source_known`;
  await sql`
    ALTER TABLE users ADD CONSTRAINT users_signup_source_known
      CHECK (signup_source IN ('admin', 'claim', 'start'))
  `;

  // A sign-up before it is an account: what the person typed, the password already hashed, and the
  // code sent to prove the email. The `users` row is written only once the code is right (or, on a
  // deployment with no email, when an admin approves the request), so a stranger typing someone
  // else's address neither fills the Accounts list nor takes that address.
  //
  //   pending  — waiting for the code;
  //   open     — no email here, so no code: waiting for an admin (a claim only);
  //   verified — the code was right and the account exists (`user_id`);
  //   approved / declined — an admin answered an `open` one.
  await sql`
    CREATE TABLE IF NOT EXISTS signup_requests (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source              TEXT NOT NULL CHECK (source IN ('claim', 'start')),
      customer_id         TEXT,
      name                TEXT NOT NULL,
      email               TEXT NOT NULL,
      phone               TEXT,
      note                TEXT,
      business            JSONB,
      password_hash       TEXT NOT NULL,
      ip_hash             TEXT NOT NULL,
      status              TEXT NOT NULL
        CHECK (status IN ('pending', 'open', 'verified', 'approved', 'declined')),
      code_hash           TEXT,
      code_expires_at     TIMESTAMPTZ,
      code_attempts       INTEGER NOT NULL DEFAULT 0,
      code_sent_at        TIMESTAMPTZ,
      code_sends          INTEGER NOT NULL DEFAULT 0,
      user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
      research_started_at TIMESTAMPTZ,
      decided_by          UUID REFERENCES users(id) ON DELETE SET NULL,
      decided_at          TIMESTAMPTZ,
      decline_note        TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_signup_requests_email ON signup_requests (email, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_signup_requests_ip ON signup_requests (ip_hash, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_signup_requests_customer ON signup_requests (customer_id, status)`;

  // One-time sign-in links: an admin's invite (choose a password, 7 days) and a password reset
  // (60 minutes). Only the SHA-256 of the token is kept; issuing a new one retires the old.
  await sql`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose     TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
      token_hash  TEXT NOT NULL,
      created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      used_at     TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens (token_hash)`;

  // The guided setup interview (src/setup): one consultant chat per business at a time. `items` is
  // the model's own transcript (Responses input items, tool calls included); `messages` is what the
  // customer saw. Both are kept because the changes shown under a reply are known only when it was
  // made. Nothing here is a setting — every write lands in business_call_settings.draft — so a row
  // can be discarded (Reset) without losing anything the phone line will use. CASCADE like the profile.
  await sql`
    CREATE TABLE IF NOT EXISTS business_setup_sessions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
      model       TEXT NOT NULL,
      items       JSONB NOT NULL DEFAULT '[]'::jsonb,
      messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
      topics      JSONB NOT NULL DEFAULT '{"transfers":"pending","messages":"pending","appointments":"pending"}'::jsonb,
      turn_count  INTEGER NOT NULL DEFAULT 0,
      -- A turn in flight. Serverless can't hold a lock across the model call, so the row says until
      -- when it is taken; a second Send in that window is refused rather than run against the same draft.
      busy_until  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    )
  `;
  // Reset (Start over) hides a conversation instead of deleting it: the daily turn cap counts user
  // messages from these rows, so deleting them would hand back a fresh allowance.
  await sql`ALTER TABLE business_setup_sessions ADD COLUMN IF NOT EXISTS discarded_at TIMESTAMPTZ`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS business_setup_sessions_one_active ON business_setup_sessions (user_id) WHERE status = 'active'`;
  await sql`CREATE INDEX IF NOT EXISTS idx_business_setup_sessions_user ON business_setup_sessions (user_id, created_at DESC)`;
  // Scenario tests (docs/superpowers/specs/2026-10-01-scenario-tests-design.md). The scenarios a
  // business is tested with; one row per built-in template at most, plus any an admin adds.
  await sql`
    CREATE TABLE IF NOT EXISTS scenario_tests (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_id TEXT,
      title       TEXT NOT NULL,
      definition  JSONB NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS scenario_tests_one_template
      ON scenario_tests (user_id, template_id) WHERE template_id IS NOT NULL
  `;
  // One press of Run selected. The settings and the composed session are copied in, so editing
  // either while it runs cannot change what is being tested. "interrupted" is not stored: it is a
  // running pass nobody has touched for five minutes, decided when it is read.
  await sql`
    CREATE TABLE IF NOT EXISTS scenario_passes (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
      settings_kind     TEXT NOT NULL CHECK (settings_kind IN ('draft','published')),
      status            TEXT NOT NULL CHECK (status IN ('running','completed','cancelled')),
      time_zone         TEXT NOT NULL,
      settings_snapshot JSONB NOT NULL,
      session_snapshot  JSONB NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at       TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_scenario_passes_user ON scenario_passes (user_id, created_at DESC)`;
  // Each scenario in a pass, run once. `scenario_snapshot` is the definition with its times filled
  // in; null (and the run already done, as a run error) when they could not be.
  await sql`
    CREATE TABLE IF NOT EXISTS scenario_runs (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pass_id           UUID NOT NULL REFERENCES scenario_passes(id) ON DELETE CASCADE,
      scenario_id       UUID REFERENCES scenario_tests(id) ON DELETE SET NULL,
      position          INTEGER NOT NULL,
      title             TEXT NOT NULL,
      scenario_snapshot JSONB,
      status            TEXT NOT NULL CHECK (status IN ('queued','running','grading','done')),
      verdict           TEXT CHECK (verdict IS NULL OR verdict IN ('pass','fail','run_error')),
      failures          JSONB NOT NULL DEFAULT '[]'::jsonb,
      error_reason      TEXT,
      transcript        JSONB NOT NULL DEFAULT '[]'::jsonb,
      sandbox_state     JSONB NOT NULL DEFAULT '{"calls":[],"bookings":[],"messages":[]}'::jsonb,
      duration_sec      INTEGER,
      cost_usd          NUMERIC(10,4),
      started_at        TIMESTAMPTZ,
      finished_at       TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_scenario_runs_pass ON scenario_runs (pass_id, position)`;
  // One row per openai-agent-app process (server / poller / scenarios), UPSERTed on every heartbeat.
  // Liveness is derived at read time from interval_seconds, never stored.
  await sql`
    CREATE TABLE IF NOT EXISTS service_heartbeats (
      service          TEXT PRIMARY KEY,
      last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      interval_seconds INTEGER NOT NULL DEFAULT 60,
      ok               BOOLEAN NOT NULL DEFAULT true,
      detail           TEXT,
      started_at       TIMESTAMPTZ,
      host             TEXT,
      metrics          JSONB
    )
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
    await sql`SELECT house_rules FROM business_profiles LIMIT 1`;
    await sql`SELECT forward_accept_press FROM business_profiles LIMIT 1`;
    await sql`SELECT 1 FROM inbound_calls LIMIT 1`;
    await sql`SELECT requested_time, sheet_written_at FROM inbound_calls LIMIT 1`;
    await sql`SELECT 1 FROM agent_call_minutes LIMIT 1`;
    await sql`SELECT 1 FROM agent_call_sessions LIMIT 1`;
    await sql`SELECT 1 FROM api_keys LIMIT 1`;
    await sql`SELECT business_id, status FROM users LIMIT 1`;
    await sql`SELECT customer_code FROM demo_customers LIMIT 1`;
    await sql`SELECT 1 FROM demo_calls LIMIT 1`;
    await sql`SELECT 1 FROM demo_call_events LIMIT 1`;
    await sql`SELECT 1 FROM demo_notes LIMIT 1`;
    await sql`SELECT waterfall_allowed FROM business_call_settings LIMIT 1`;
    await sql`SELECT call_settings FROM demo_customers LIMIT 1`;
    await sql`SELECT 1 FROM calendar_connections LIMIT 1`;
    await sql`SELECT 1 FROM appointment_bookings LIMIT 1`;
    await sql`SELECT 1 FROM app_test_calls LIMIT 1`;
    await sql`SELECT test_seconds_cap FROM users LIMIT 1`;
    await sql`SELECT 1 FROM call_events LIMIT 1`;
    await sql`SELECT 1 FROM sms_consents LIMIT 1`;
    await sql`SELECT call_sid FROM inbound_calls LIMIT 1`;
    await sql`SELECT onboarding_requested_at, onboarding_declined_at, live_at FROM users LIMIT 1`;
    await sql`SELECT email_verified_at, signup_source FROM users LIMIT 1`;
    await sql`SELECT research_started_at FROM signup_requests LIMIT 1`;
    await sql`SELECT 1 FROM auth_tokens LIMIT 1`;
    await sql`SELECT twilio_sid, webhook_state, released_at FROM agent_numbers LIMIT 1`;
    await sql`SELECT busy_until, discarded_at FROM business_setup_sessions LIMIT 1`;
    await sql`SELECT 1 FROM scenario_tests LIMIT 1`;
    await sql`SELECT 1 FROM scenario_passes LIMIT 1`;
    await sql`SELECT 1 FROM scenario_runs LIMIT 1`;
    await sql`SELECT 1 FROM service_heartbeats LIMIT 1`;
    const [guard] = await sql`SELECT 1 FROM pg_trigger WHERE tgname = 'demo_customers_code_guard'`;
    if (!guard) throw new Error("customer codes not converted");
    return;
  } catch {
    await initDb();
  }
}
