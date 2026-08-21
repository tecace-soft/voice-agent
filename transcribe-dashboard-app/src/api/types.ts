// Shapes shared with the backend API (kept in sync with backend-app's /transcribe/stats).

// One reported transcribe-app run.
export interface VoicemailRun {
  id: string;
  voicemails: number; // messages carrying audio the run found
  processed: number; // transcribed + written to the sheet this run
  skipped: number; // already handled on a prior run
  failed: number; // errored (left for a retry)
  createdAt: string;
}

// Response shape of GET /transcribe/stats.
export interface TranscribeStats {
  totalProcessed: number; // all-time voicemails transcribed
  totalFailed: number;
  runs: number;
  lastRunAt: string | null;
  today: number;
  last7Days: number;
  daily: { day: string; processed: number }[]; // last 14 days
  recent: VoicemailRun[]; // newest first — the "Recent runs" table
  runSeries: VoicemailRun[]; // oldest→newest — one point per run for the line chart
}
