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
