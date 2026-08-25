import { env } from "../config/env.js";
import { sql } from "./client.js";
import { mailboxFilter, type MailboxScope } from "./voicemailRuns.js";

// Deeper analysis of the transcribe-app than the dashboard's headline stats: aggregated over the
// WHOLE history in Postgres rather than over the 60 runs `/transcribe/stats` ships to the browser.
// Three questions it exists to answer:
//   - Is the app keeping up?      totals + reliability
//   - Is it running on schedule?  cadence (the gaps between consecutive runs)
//   - When does work arrive?      byHour / byWeekday
//
// Day and hour boundaries follow the business timezone, so "3 PM" means 3 PM to whoever reads it.
const TZ = env.timezone;

// How many transcribed sessions the Analytics view lists. Enough to page through a few weeks of
// work without shipping the whole history to a browser.
const SESSION_LIMIT = 100;

export interface TranscribeAnalytics {
  totals: {
    voicemails: number; // messages carrying audio, all time
    processed: number;
    skipped: number;
    failed: number;
    runs: number;
    emptyRuns: number; // passes that found nothing to do
    firstRunAt: string | null;
    lastRunAt: string | null;
  };
  // Each run that transcribed something, as its own session with the context needed to read it on
  // its own: what it found, what it did with it, and how long the app had been quiet beforehand.
  sessions: {
    id: string;
    mailboxEmail: string | null; // whose voicemails these were — the admin's "all mailboxes" view
    voicemails: number;          // interleaves sessions from several mailboxes
    processed: number;
    skipped: number;
    failed: number;
    createdAt: string;
    sincePreviousSeconds: number; // gap since the run before it (0 for the very first run)
  }[];
  byHour: { hour: number; processed: number; runs: number }[]; // 0-23, business timezone
  byWeekday: { weekday: number; processed: number; runs: number }[]; // 1=Mon … 7=Sun
  cadence: {
    medianGapSeconds: number; // typical time between consecutive runs
    longestGapSeconds: number;
    longestGapEndedAt: string | null; // the run that ended the longest quiet stretch
  };
  // What a run that actually transcribes something does. Deliberately NOT an average over all runs:
  // most passes find nothing, so processed/runs describes no run that ever happened. The exact
  // distribution is small (a run handles a handful of voicemails), so it ships whole.
  perRun: {
    productiveRuns: number; // runs that transcribed at least one voicemail
    medianProcessed: number; // across productive runs only
    maxProcessed: number;
    distribution: { processed: number; runs: number }[]; // productive runs, grouped by output
  };
}

// `mailbox` scopes every figure to one mailbox; undefined means every mailbox (an admin looking at
// the lot). The filter goes into each query rather than wrapping the results, so the cadence window
// and the percentiles are computed within the mailbox too — a stall in one mailbox shouldn't be
// hidden by another mailbox running fine.
export async function getTranscribeAnalytics(mailbox?: MailboxScope): Promise<TranscribeAnalytics> {
  const scope = mailboxFilter(mailbox);
  const [totals, sessions, byHour, byWeekday, cadence, perRunStats, distribution] =
    await Promise.all([
    sql`
      SELECT
        coalesce(sum(voicemails), 0)::int AS voicemails,
        coalesce(sum(processed), 0)::int  AS processed,
        coalesce(sum(skipped), 0)::int    AS skipped,
        coalesce(sum(failed), 0)::int     AS failed,
        count(*)::int                     AS runs,
        count(*) FILTER (WHERE voicemails = 0)::int AS "emptyRuns",
        min(created_at)                   AS "firstRunAt",
        max(created_at)                   AS "lastRunAt"
      FROM voicemail_runs
      WHERE ${scope}
    `,
    // The gap is measured against the previous run of ANY kind — including the empty passes — because
    // that is what says whether the app was running while the voicemails piled up. So the window
    // runs over every row and the filter to transcribed sessions happens after it.
    sql`
      WITH ordered AS (
        SELECT id, mailbox_email, voicemails, processed, skipped, failed, created_at,
               extract(epoch FROM created_at - lag(created_at) OVER (ORDER BY created_at)) AS since_prev
        FROM voicemail_runs
        WHERE ${scope}
      )
      SELECT id, voicemails, processed, skipped, failed,
             mailbox_email AS "mailboxEmail",
             created_at AS "createdAt",
             coalesce(since_prev, 0)::int AS "sincePreviousSeconds"
      FROM ordered
      WHERE processed > 0
      ORDER BY created_at DESC
      LIMIT ${SESSION_LIMIT}
    `,
    sql`
      SELECT extract(hour FROM created_at AT TIME ZONE ${TZ})::int AS hour,
             sum(processed)::int AS processed,
             count(*)::int       AS runs
      FROM voicemail_runs
      WHERE ${scope}
      GROUP BY 1
      ORDER BY 1
    `,
    sql`
      SELECT extract(isodow FROM created_at AT TIME ZONE ${TZ})::int AS weekday,
             sum(processed)::int AS processed,
             count(*)::int       AS runs
      FROM voicemail_runs
      WHERE ${scope}
      GROUP BY 1
      ORDER BY 1
    `,
    // The gap before each run, from which the typical cadence and the worst stall both fall out.
    // percentile_DISC, not _cont: the discrete median returns a gap that actually occurred, where
    // the continuous one averages the two middle values and can report a cadence the app has never
    // had (a poller that runs every 30 min but occasionally stalls for days would "typically" run
    // every few hours, which is true of no run at all).
    sql`
      WITH gaps AS (
        SELECT created_at,
               extract(epoch FROM created_at - lag(created_at) OVER (ORDER BY created_at)) AS gap
        FROM voicemail_runs
        WHERE ${scope}
      )
      SELECT
        coalesce(percentile_disc(0.5) WITHIN GROUP (ORDER BY gap), 0)::int AS "medianGapSeconds",
        coalesce(max(gap), 0)::int                                        AS "longestGapSeconds",
        (SELECT created_at FROM gaps WHERE gap = (SELECT max(gap) FROM gaps) ORDER BY created_at LIMIT 1)
                                                                          AS "longestGapEndedAt"
      FROM gaps
      WHERE gap IS NOT NULL
    `,
    // Everything below looks only at runs that transcribed something — the ones an average over all
    // runs quietly dilutes.
    sql`
      SELECT
        count(*)::int AS "productiveRuns",
        coalesce(percentile_disc(0.5) WITHIN GROUP (ORDER BY processed), 0)::int AS "medianProcessed",
        coalesce(max(processed), 0)::int AS "maxProcessed"
      FROM voicemail_runs
      WHERE ${scope} AND processed > 0
    `,
    sql`
      SELECT processed, count(*)::int AS runs
      FROM voicemail_runs
      WHERE ${scope} AND processed > 0
      GROUP BY processed
      ORDER BY processed
    `,
  ]);

  return {
    totals: totals[0] as TranscribeAnalytics["totals"],
    sessions: sessions as unknown as TranscribeAnalytics["sessions"],
    byHour: byHour as unknown as TranscribeAnalytics["byHour"],
    byWeekday: byWeekday as unknown as TranscribeAnalytics["byWeekday"],
    // With fewer than two runs there are no gaps at all, so the row comes back empty.
    cadence: (cadence[0] as TranscribeAnalytics["cadence"] | undefined) ?? {
      medianGapSeconds: 0,
      longestGapSeconds: 0,
      longestGapEndedAt: null,
    },
    perRun: {
      ...(perRunStats[0] as { productiveRuns: number; medianProcessed: number; maxProcessed: number }),
      distribution: distribution as unknown as TranscribeAnalytics["perRun"]["distribution"],
    },
  };
}
