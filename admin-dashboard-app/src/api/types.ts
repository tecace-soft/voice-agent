// Shapes shared with the backend API (kept in sync with backend-app).

export type IntakeStatus =
  | "new"
  | "contacted"
  | "booked"
  | "unreachable"
  | "canceled";

// A stored client intake, as the backend returns it.
export interface IntakeRecord {
  id: string;
  language: string;
  name: string;
  email: string;
  phoneNumber: string;
  purpose: string; // what the lead reached out about
  requestedDate: string | null; // the day the lead picked on the form (YYYY-MM-DD); time set on the call
  scheduledAt: string | null; // the confirmed booked time; null until the agent books
  status: IntakeStatus;
  notes: string | null;
  transcript: string | null; // full text of the agent's last call with this lead (null until a call)
  callbackAfter: string | null; // earliest time the agent will (re)call this lead, if scheduled
  createdAt: string;
  updatedAt: string;
}

// Response shape of GET /intake (list).
export interface IntakeList {
  total: number;
  limit: number;
  offset: number;
  intakes: IntakeRecord[];
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

// Response shape of GET /transcribe/stats (the Transcriptions tab).
export interface TranscribeStats {
  totalProcessed: number; // all-time voicemails transcribed
  totalFailed: number;
  runs: number;
  lastRunAt: string | null;
  today: number;
  last7Days: number;
  daily: { day: string; processed: number }[]; // last 14 days
  recent: VoicemailRun[];
}

// Response shape of GET /prompt (the agent's current prompt + scenario).
export interface AgentPrompt {
  agentName: string;
  systemPrompt: string;
  scenario: string;
  editable: boolean;
}
