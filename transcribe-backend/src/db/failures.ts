import { sql } from "./client.js";
import { mailboxFilter, type MailboxScope } from "./voicemailRuns.js";

// Why a voicemail failed to transcribe, kept long enough to be read.
//
// The counts alone ("5 failed") never told anyone anything actionable — the reason lived only in
// the poller's journal, which means it was invisible off the box and gone once the journal rotated.
// A row per failed attachment makes "Sheets returned 503" and "the sheet header doesn't match"
// distinguishable from the dashboard, which is the difference between shrugging and fixing it.
//
// `acknowledged_at` is what clears the notification. The row is never deleted: the badge is about
// what is NEW, the list is the history, and conflating the two would mean losing the record of a
// problem the moment somebody glanced at it.

export interface FailureRecord {
  id: string;
  runId: string | null;
  mailboxEmail: string | null;
  filename: string;
  fromAddr: string;
  error: string;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface FailureInput {
  filename: string;
  fromAddr: string;
  error: string;
}

const COLUMNS = sql`
  id,
  run_id          AS "runId",
  mailbox_email   AS "mailboxEmail",
  filename,
  from_addr       AS "fromAddr",
  error,
  created_at      AS "createdAt",
  acknowledged_at AS "acknowledgedAt"
`;

/** Store the failures a run reported. No-op for a clean run, which is the common case. */
export async function insertFailures(
  runId: string,
  mailboxEmail: string | null,
  failures: FailureInput[],
): Promise<void> {
  if (!failures.length) return;
  const rows = failures.map((f) => ({
    run_id: runId,
    mailbox_email: mailboxEmail,
    filename: f.filename.slice(0, 500),
    from_addr: f.fromAddr.slice(0, 320),
    error: f.error.slice(0, 2000),
  }));
  await sql`INSERT INTO voicemail_failures ${sql(rows)}`;
}

/** Recent failures for this scope, newest first — the list the dashboard shows. */
export async function listFailures(
  mailbox?: MailboxScope,
  limit = 50,
): Promise<FailureRecord[]> {
  const scope = mailboxFilter(mailbox);
  return (await sql`
    SELECT ${COLUMNS} FROM voicemail_failures
    WHERE ${scope}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as unknown as FailureRecord[];
}

/** How many nobody has looked at yet — the number the dashboard badges. */
export async function countUnacknowledged(mailbox?: MailboxScope): Promise<number> {
  const scope = mailboxFilter(mailbox);
  const [row] = await sql`
    SELECT count(*)::int AS count FROM voicemail_failures
    WHERE ${scope} AND acknowledged_at IS NULL
  `;
  return (row as { count: number }).count;
}

/**
 * Mark this scope's outstanding failures as seen. Returns how many were cleared.
 *
 * Scoped, not global: acknowledging as an admin looking at every mailbox would silently clear
 * notifications for people who have not seen them. `WHERE acknowledged_at IS NULL` keeps the
 * original timestamp of anything already acknowledged rather than moving it forward on every view.
 */
export async function acknowledgeFailures(mailbox?: MailboxScope): Promise<number> {
  const scope = mailboxFilter(mailbox);
  const rows = await sql`
    UPDATE voicemail_failures
    SET acknowledged_at = now()
    WHERE ${scope} AND acknowledged_at IS NULL
    RETURNING id
  `;
  return rows.length;
}
