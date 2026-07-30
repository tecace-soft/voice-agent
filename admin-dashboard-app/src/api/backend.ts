import type { AgentPrompt, IntakeList, IntakeStatus } from "./types";

// Single place that talks to the backend API. Every screen reads through here, so the
// UI never builds URLs or parses responses itself. Base URL comes from VITE_BACKEND_URL
// (set in .env locally and in the Vercel project for production).
const BASE_URL: string = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/$/, "");

export class BackendError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BackendError";
    this.status = status;
  }
}

async function get<T>(path: string): Promise<T> {
  if (!BASE_URL) {
    throw new BackendError("Backend URL is not configured (set VITE_BACKEND_URL).", 0);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { headers: { accept: "application/json" } });
  } catch {
    throw new BackendError("Couldn't reach the server.", 0);
  }
  const text = await res.text();
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const body = JSON.parse(text);
      if (body?.message) message = body.message;
    } catch {
      /* keep the default */
    }
    throw new BackendError(message, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface IntakeQuery {
  status?: IntakeStatus;
  q?: string;
  scheduledFrom?: string; // ISO
  scheduledTo?: string; // ISO
  limit?: number;
  offset?: number;
}

// List clients/intakes, newest first, with optional filters.
export function listIntakes(query: IntakeQuery = {}): Promise<IntakeList> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return get<IntakeList>(`/intake${qs ? `?${qs}` : ""}`);
}

// The agent's current prompt + scenario (read-only for now).
export function getPrompt(): Promise<AgentPrompt> {
  return get<AgentPrompt>("/prompt");
}
