// Shapes shared with the backend API (kept in sync with backend-app's intake model).

// The fields a client submits through the form.
export interface IntakeInput {
  language: string;
  name: string;
  email: string;
  phoneNumber: string;
  purpose: string;
  dateTime: string; // ISO 8601, e.g. "2026-08-01T15:30:00.000Z"
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
  scheduledAt: string;
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
