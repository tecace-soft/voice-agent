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
  scheduledAt: string;
  status: IntakeStatus;
  notes: string | null;
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
