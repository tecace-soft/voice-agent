import { env } from "../config/env.js";
import { sql } from "./client.js";

// Deeper analysis of the transcribe-app than the dashboard's headline stats: aggregated over the
// WHOLE history in Postgres rather than over the 60 runs `/transcribe/stats` ships to the browser.
// Three questions it exists to answer:
//   - Is the app keeping up?      totals + reliability
//   - Is it running on schedule?  cadence (the gaps between consecutive runs)
//   - When does work arrive?      byHour / byWeekday
//
// Day and hour boundaries follow the business timezone, so "3 PM" means 3 PM to whoever reads it.
const TZ = env.timezone;

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
  daily: {
    day: string;
    voicemails: number;
    processed: number;
    skipped: number;
    failed: number;
    runs: number;
  }[]; // last 90 days
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
    busiest: {
      id: string;
      voicemails: number;
      processed: number;
      skipped: number;
      failed: number;
      createdAt: string;
    }[];
  };
}

export async function getTranscribeAnalytics(): Promise<TranscribeAnalytics> {
  const [totals, daily, byHour, byWeekday, cadence, perRunStats, distribution, busiest] =
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
    `,
    sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS day,
             sum(voicemails)::int AS voicemails,
             sum(processed)::int  AS processed,
             sum(skipped)::int    AS skipped,
             sum(failed)::int     AS failed,
             count(*)::int        AS runs
      FROM voicemail_runs
      WHERE created_at >= now() - interval '90 days'
      GROUP BY 1
      ORDER BY 1
    `,
    sql`
      SELECT extract(hour FROM created_at AT TIME ZONE ${TZ})::int AS hour,
             sum(processed)::int AS processed,
             count(*)::int       AS runs
      FROM voicemail_runs
      GROUP BY 1
      ORDER BY 1
    `,
    sql`
      SELECT extract(isodow FROM created_at AT TIME ZONE ${TZ})::int AS weekday,
             sum(processed)::int AS processed,
             count(*)::int       AS runs
      FROM voicemail_runs
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
      WHERE processed > 0
    `,
    sql`
      SELECT processed, count(*)::int AS runs
      FROM voicemail_runs
      WHERE processed > 0
      GROUP BY processed
      ORDER BY processed
    `,
    sql`
      SELECT id, voicemails, processed, skipped, failed, created_at AS "createdAt"
      FROM voicemail_runs
      WHERE processed > 0
      ORDER BY processed DESC, created_at DESC
      LIMIT 10
    `,
  ]);

  return {
    totals: totals[0] as TranscribeAnalytics["totals"],
    daily: daily as unknown as TranscribeAnalytics["daily"],
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
      busiest: busiest as unknown as TranscribeAnalytics["perRun"]["busiest"],
    },
  };
}
