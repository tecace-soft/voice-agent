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

// Response shape of GET /prompt (the agent's current prompt + scenario).
export interface AgentPrompt {
  agentName: string;
  systemPrompt: string;
  scenario: string;
  editable: boolean;
}
