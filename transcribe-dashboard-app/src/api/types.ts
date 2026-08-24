// Shapes shared with the backend API (kept in sync with transcribe-backend's routes).

// What an account may do: `admin` manages accounts, `user` reads the dashboard.
export type Role = "admin" | "user";

// A signed-in dashboard user, as GET /auth/me and POST /auth/login return them. The backend never
// sends the password hash or token version.
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  lastLoginAt: string | null;
}

// Response shape of GET /transcribe/analytics — aggregated over the backend's whole history,
// unlike /transcribe/stats which ships a 60-run window.
export interface TranscribeAnalytics {
  totals: {
    voicemails: number;
    processed: number;
    skipped: number;
    failed: number;
    runs: number;
    emptyRuns: number;
    firstRunAt: string | null;
    lastRunAt: string | null;
  };
  daily: { day: string; voicemails: number; processed: number; skipped: number; failed: number; runs: number }[];
  byHour: { hour: number; processed: number; runs: number }[];
  byWeekday: { weekday: number; processed: number; runs: number }[]; // 1=Mon … 7=Sun
  cadence: { medianGapSeconds: number; longestGapSeconds: number; longestGapEndedAt: string | null };
}

// A note someone sent from the Feedback page. `authorName`/`authorEmail` are snapshots taken at
// submit time, so a note still says who wrote it after that account is removed.
export type FeedbackCategory = "bug" | "idea" | "data" | "other";
export type FeedbackStatus = "open" | "resolved";

export interface Feedback {
  id: string;
  userId: string | null;
  authorName: string;
  authorEmail: string;
  category: FeedbackCategory;
  message: string;
  status: FeedbackStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

// POST /auth/users and POST /auth/users/:id/password. `password` is the generated one, returned
// exactly once — it is null when the caller supplied a password of their own.
export interface CreatedAccount {
  user: AuthUser;
  password: string | null;
}

// POST /auth/login and POST /auth/setup
export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

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
