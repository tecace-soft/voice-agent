import type { IntakeInput, IntakeRecord } from "./types";

// Single place that talks to the backend API. Everything the form needs from the server
// goes through here, so the UI never builds URLs or parses responses itself.
//
// The backend base URL comes from an env var (Vite exposes vars prefixed with VITE_).
// Set VITE_BACKEND_URL in .env locally and in the Vercel project for production.
const BASE_URL: string = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/$/, "");

// Error carrying the HTTP status + parsed body, so the UI can show a useful message.
export class BackendError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "BackendError";
    this.status = status;
    this.body = body;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text || undefined;
  }
}

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE_URL) {
    throw new BackendError(
      "Backend URL is not configured (set VITE_BACKEND_URL).",
      0,
    );
  }
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    throw new BackendError("Couldn't reach the server. Please try again.", 0);
  }
  const body = parseJson(await res.text());
  if (!res.ok) {
    throw new BackendError(
      messageFrom(body, `Request failed (${res.status}).`),
      res.status,
      body,
    );
  }
  return body as T;
}

// Submit a completed intake. Returns the stored record (with id/status/timestamps).
export async function submitIntake(input: IntakeInput): Promise<IntakeRecord> {
  const data = await request<{ status: string; intake: IntakeRecord }>("/intake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.intake;
}
