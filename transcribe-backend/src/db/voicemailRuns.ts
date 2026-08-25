import { env } from "../config/env.js";
import { sql } from "./client.js";

// One transcribe-app pass, reported after it finishes. Counts come straight from the app's
// RunSummary (see transcribe-app/src/transcribe_app/pipeline.py).
export interface VoicemailRunInput {
  voicemails: number; // messages carrying audio the run found
  processed: number; // transcribed + written to the sheet this run
  skipped: number; // already handled on a prior run
  failed: number; // errored (left for a retry)
  mailboxEmail?: string; // the address the run fetched from; absent on pre-mailbox reports
}

// A stored run row (camelCase, as the API returns it).
export interface VoicemailRunRecord extends Omit<VoicemailRunInput, "mailboxEmail"> {
  id: string;
  mailboxEmail: string | null; // null for runs reported before mailboxes existed
  createdAt: string;
}

// The aggregate the dashboard reads.
export interface VoicemailStats {
  totalProcessed: number; // all-time voicemails transcribed — the headline number
  totalFailed: number;
  runs: number; // how many transcribe passes have reported
  lastRunAt: string | null;
  today: number; // processed today (business timezone)
  last7Days: number; // processed in the last 7 days
  daily: { day: string; processed: number }[]; // per-day trend, last 14 days
  recent: VoicemailRunRecord[]; // the most recent runs (newest first) — feeds the table
  runSeries: VoicemailRunRecord[]; // the last runs in chronological order — feeds the per-run line chart
}

// How many runs the per-run line chart plots. Bounded so the line stays readable as runs pile up,
// but generous enough that new points keep extending the line rather than pushing old ones off a
// tiny window.
const RUN_SERIES_LIMIT = 60;

const RETURN_COLUMNS = sql`
  id,
  voicemails,
  processed,
  skipped,
  failed,
  mailbox_email AS "mailboxEmail",
  created_at AS "createdAt"
`;

// Mailbox scoping, as a fragment every query drops into its WHERE clause.
//   undefined -> every mailbox (an admin looking at everything)
//   null      -> only runs reported before mailboxes existed (admin only — a person's email is
//                never null, so a `user` can never land here)
//   a string  -> just that mailbox (what a `user` is limited to)
// A `user` whose email matches no mailbox therefore matches no rows, which is the correct answer
// rather than an error.
export type MailboxScope = string | null | undefined;

export function mailboxFilter(mailbox: MailboxScope) {
  if (mailbox === undefined) return sql`TRUE`;
  if (mailbox === null) return sql`mailbox_email IS NULL`;
  return sql`mailbox_email = ${mailbox}`;
}

// Day boundaries follow the business timezone so "today" matches what the dashboard user expects.
const TZ = env.timezone;

// Persist one reported run and return the stored row.
export async function insertVoicemailRun(input: VoicemailRunInput): Promise<VoicemailRunRecord> {
  const [row] = await sql`
    INSERT INTO voicemail_runs (voicemails, processed, skipped, failed, mailbox_email)
    VALUES (
      ${input.voicemails},
      ${input.processed},
      ${input.skipped},
      ${input.failed},
      ${input.mailboxEmail?.trim().toLowerCase() || null}
    )
    RETURNING ${RETURN_COLUMNS}
  `;
  return row as VoicemailRunRecord;
}

// Every mailbox that has reported a run, with enough of a summary for an admin to see who is
// producing what before picking one to look at.
export interface MailboxSummary {
  mailboxEmail: string | null; // null = runs reported before mailboxes existed
  runs: number;
  processed: number;
  failed: number;
  lastRunAt: string | null;
}

export async function listMailboxes(): Promise<MailboxSummary[]> {
  return (await sql`
    SELECT mailbox_email AS "mailboxEmail",
           count(*)::int AS runs,
           coalesce(sum(processed), 0)::int AS processed,
           coalesce(sum(failed), 0)::int AS failed,
           max(created_at) AS "lastRunAt"
    FROM voicemail_runs
    GROUP BY mailbox_email
    ORDER BY max(created_at) DESC
  `) as unknown as MailboxSummary[];
}

// Everything the dashboard needs, in one call, for one mailbox (or every mailbox when `mailbox` is
// undefined — an admin looking at the lot).
export async function getVoicemailStats(mailbox?: MailboxScope): Promise<VoicemailStats> {
  const scope = mailboxFilter(mailbox);
  const [totals, daily, recent, runSeries] = await Promise.all([
    sql`
      SELECT
        coalesce(sum(processed), 0)::int AS "totalProcessed",
        coalesce(sum(failed), 0)::int    AS "totalFailed",
        count(*)::int                    AS runs,
        max(created_at)                  AS "lastRunAt",
        coalesce(sum(processed) FILTER (
          WHERE created_at AT TIME ZONE ${TZ} >= date_trunc('day', now() AT TIME ZONE ${TZ})
        ), 0)::int AS today,
        coalesce(sum(processed) FILTER (
          WHERE created_at >= now() - interval '7 days'
        ), 0)::int AS "last7Days"
      FROM voicemail_runs
      WHERE ${scope}
    `,
    sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day,
             sum(processed)::int AS processed
      FROM voicemail_runs
      WHERE ${scope} AND created_at >= now() - interval '14 days'
      GROUP BY 1
      ORDER BY 1
    `,
    sql`SELECT ${RETURN_COLUMNS} FROM voicemail_runs WHERE ${scope} ORDER BY created_at DESC LIMIT 10`,
    // The most recent RUN_SERIES_LIMIT runs, returned oldest→newest so the chart reads left→right.
    sql`
      SELECT ${RETURN_COLUMNS} FROM (
        SELECT id, voicemails, processed, skipped, failed, mailbox_email, created_at
        FROM voicemail_runs
        WHERE ${scope}
        ORDER BY created_at DESC
        LIMIT ${RUN_SERIES_LIMIT}
      ) sub
      ORDER BY created_at ASC
    `,
  ]);

  const t = totals[0] as {
    totalProcessed: number;
    totalFailed: number;
    runs: number;
    lastRunAt: string | null;
    today: number;
    last7Days: number;
  };
  return {
    ...t,
    daily: daily as unknown as { day: string; processed: number }[],
    recent: recent as unknown as VoicemailRunRecord[],
    runSeries: runSeries as unknown as VoicemailRunRecord[],
  };
}
