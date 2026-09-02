import { sql } from "./client.js";
import { mailboxFilter, type MailboxScope } from "./voicemailRuns.js";

// Proof that a poller is still alive.
//
// Runs only tell you a poller worked; they say nothing when it stops. A poller that dies at 3am
// looks exactly like a quiet night — no rows, no errors, no signal at all — and the first anyone
// hears of it is a customer asking where their voicemails went. So every cycle reports in, whether
// or not it had anything to do.
//
// One row per mailbox, UPSERTed. Appending would add ~260 rows a day per client to say nothing
// happened, which is the reason the run reporter skips empty cycles in the first place.
//
// Liveness is derived at read time from the poller's OWN reported interval rather than a constant
// here: the two would drift the moment anyone changed POLL_INTERVAL_SECONDS, and a monitor that
// cries wolf after a config change gets muted.

export interface HeartbeatRecord {
  mailboxEmail: string | null;
  lastSeenAt: string;
  intervalSeconds: number;
  lastCycleOk: boolean;
  detail: string | null;
  host: string | null;
  // Derived, not stored — see STALE_AFTER_CYCLES.
  online: boolean;
  secondsSinceSeen: number;
}

// How many cycles a poller may miss before it counts as offline. Two and a bit: one missed cycle is
// a slow pass or a restart, and paging someone for that trains them to ignore the alert. Three
// missed cycles in a row is not noise.
const STALE_AFTER_CYCLES = 2.5;

// Floor for the staleness window, so a very short poll interval can't make the check hair-trigger.
const MIN_STALE_SECONDS = 120;

export async function recordHeartbeat(input: {
  mailboxEmail: string | null;
  intervalSeconds: number;
  lastCycleOk: boolean;
  detail: string | null;
  host: string | null;
}): Promise<void> {
  // A null mailbox can't take part in ON CONFLICT (NULL is never equal to NULL), so unattributed
  // pollers get a fixed sentinel key. They are a misconfiguration anyway — the dashboard shows them
  // as unattributed exactly so somebody fixes it.
  const key = input.mailboxEmail ?? "";
  await sql`
    INSERT INTO poller_heartbeats (mailbox_key, mailbox_email, last_seen_at, interval_seconds,
                                   last_cycle_ok, detail, host)
    VALUES (${key}, ${input.mailboxEmail}, now(), ${input.intervalSeconds},
            ${input.lastCycleOk}, ${input.detail}, ${input.host})
    ON CONFLICT (mailbox_key) DO UPDATE SET
      last_seen_at     = now(),
      interval_seconds = EXCLUDED.interval_seconds,
      last_cycle_ok    = EXCLUDED.last_cycle_ok,
      detail           = EXCLUDED.detail,
      host             = EXCLUDED.host
  `;
}

/** Every poller this caller is entitled to see, with liveness worked out in the query. */
export async function listHeartbeats(mailbox?: MailboxScope): Promise<HeartbeatRecord[]> {
  const scope = mailboxFilter(mailbox);
  return (await sql`
    SELECT mailbox_email AS "mailboxEmail",
           last_seen_at  AS "lastSeenAt",
           interval_seconds AS "intervalSeconds",
           last_cycle_ok AS "lastCycleOk",
           detail,
           host,
           extract(epoch FROM now() - last_seen_at)::int AS "secondsSinceSeen",
           -- The ::float8 casts are load-bearing. Parameters go over untyped, so Postgres infers
           -- them from context: next to the INTEGER interval_seconds it infers integer, and then
           -- rejects 2.5 outright with "invalid input syntax for type integer". Casting states the
           -- type rather than leaving it to be guessed from a neighbouring column.
           (extract(epoch FROM now() - last_seen_at)
              <= greatest(interval_seconds::float8 * ${STALE_AFTER_CYCLES}::float8,
                          ${MIN_STALE_SECONDS}::float8)) AS online
    FROM poller_heartbeats
    WHERE ${scope}
    ORDER BY last_seen_at DESC
  `) as unknown as HeartbeatRecord[];
}

/** How many pollers in this scope are silent — the number worth putting in front of an admin. */
export async function countOffline(mailbox?: MailboxScope): Promise<number> {
  const rows = await listHeartbeats(mailbox);
  return rows.filter((r) => !r.online).length;
}
