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

// One mailbox the transcribe-app has reported for — GET /transcribe/mailboxes (admins only).
// `mailboxEmail` is null for the group of runs reported before mailboxes were recorded.
export interface MailboxSummary {
  mailboxEmail: string | null;
  runs: number;
  voicemails: number;
  processed: number;
  skipped: number;
  failed: number;
  today: number;
  last7Days: number;
  activeDays: number;
  firstRunAt: string | null;
  lastRunAt: string | null;
}

// The mailbox an admin is looking at: undefined = every mailbox, null = the unattributed ones.
export type MailboxScope = string | null | undefined;

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
  // Each run that transcribed something, newest first, with the gap since the run before it.
  sessions: {
    id: string;
    mailboxEmail: string | null;
    voicemails: number;
    processed: number;
    skipped: number;
    failed: number;
    createdAt: string;
    sincePreviousSeconds: number;
  }[];
  byHour: { hour: number; processed: number; runs: number }[];
  byWeekday: { weekday: number; processed: number; runs: number }[]; // 1=Mon … 7=Sun
  cadence: { medianGapSeconds: number; longestGapSeconds: number; longestGapEndedAt: string | null };
  // What a run that actually transcribes does — a distribution, not an average over every run.
  perRun: {
    productiveRuns: number;
    medianProcessed: number;
    maxProcessed: number;
    distribution: { processed: number; runs: number }[];
  };
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
  // A data URL for an image the author attached, or null. The backend only ever stores one it has
  // proved is a raster image, so it is safe to put straight into an <img src>.
  screenshot: string | null;
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
  mailboxEmail: string | null; // the address this run fetched from; null for pre-mailbox runs
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
  // Calendar-month totals in the business timezone. The cap is monthly, so this is what it is
  // measured against — it resets on the 1st rather than trailing 30 days.
  thisMonth: number;
  prevMonth: number;
  // The monthly allowance, from the backend rather than hardcoded here. `limit: 0` means no cap is
  // tracked and nothing about it is shown; `warnAt` is the fraction (0.8 = 80%) past which it
  // becomes visible. Below that the dashboard says nothing, so the warning stays a signal.
  // `overageRate` is dollars per transcript beyond the limit; 0 = don't mention cost.
  cap: { limit: number; warnAt: number; overageRate: number };
  daily: { day: string; processed: number }[]; // last 14 days
  recent: VoicemailRun[]; // newest first — the "Recent runs" table
  runSeries: VoicemailRun[]; // oldest→newest — one point per run for the line chart
}
