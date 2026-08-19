// Shapes shared with the backend API (kept in sync with backend-app's intake model).

// The fields a client submits through the form.
export interface IntakeInput {
  language: string;
  name: string;
  email: string;
  phoneNumber: string;
  purpose: string; // what the client is reaching out about (confirmed by the agent on the call)
  requestedDate: string; // the day the lead wants, "YYYY-MM-DD"; the agent asks for the time on the call
}

export type IntakeStatus =
  | "new"
  | "contacted"
  | "booked"
  | "unreachable"
  | "canceled";

// A stored intake as returned by the backend.
export interface IntakeRecord extends IntakeInput {
  id: string;
  scheduledAt: string | null; // confirmed booked time; null until the agent books
  status: IntakeStatus;
  createdAt: string;
  updatedAt: string;
}

// A slot from the schedule grid (used later for showing availability).
export interface Slot {
  start: string;
  end: string;
  available: boolean;
}
