import type { TranscribeStats, VoicemailRun } from "./api/types";
import { recentDayKeys } from "./lib";

// Derived numbers the KPI cards and the activity view need. The backend sends a 14-day daily
// series, which is exactly enough to compare the last 7 Pacific days with the 7 before them.
export interface Derived {
  byDay: Map<string, number>;
  last14: { day: string; processed: number }[]; // gap-filled, oldest→newest
  today: number;
  yesterday: number;
  curr7: number;
  prev7: number;
  attempted: number; // voicemails the app tried to transcribe (succeeded + failed)
  successRate: number; // percent transcribed without error
  runsNewestFirst: VoicemailRun[]; // the run series, flipped for tables
  failedRuns: VoicemailRun[];
  emptyRuns: VoicemailRun[]; // passes that found no voicemails at all
}

const sum = (keys: string[], byDay: Map<string, number>) =>
  keys.reduce((total, key) => total + (byDay.get(key) ?? 0), 0);

export function derive(data: TranscribeStats): Derived {
  const byDay = new Map(data.daily.map((d) => [d.day, d.processed]));
  const last14 = recentDayKeys(14).map((day) => ({ day, processed: byDay.get(day) ?? 0 }));
  const yesterdayKey = recentDayKeys(1, 1)[0]!;

  const runsNewestFirst = [...data.runSeries].reverse();
  const attempted = data.totalProcessed + data.totalFailed;

  return {
    byDay,
    last14,
    today: data.today, // the backend's own Pacific-day bucket stays the authority for "today"
    yesterday: byDay.get(yesterdayKey) ?? 0,
    curr7: sum(recentDayKeys(7), byDay),
    prev7: sum(recentDayKeys(7, 7), byDay),
    attempted,
    successRate: attempted === 0 ? 100 : (data.totalProcessed / attempted) * 100,
    runsNewestFirst,
    failedRuns: runsNewestFirst.filter((r) => r.failed > 0),
    emptyRuns: runsNewestFirst.filter((r) => r.voicemails === 0),
  };
}
