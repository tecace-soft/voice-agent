import type { TranscribeStats } from "./types";

// Single place that talks to the backend API. Base URL comes from VITE_BACKEND_URL (set in .env
// locally and in the Vercel project for production).
const BASE_URL: string = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/$/, "");

export class BackendError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BackendError";
    this.status = status;
  }
}

async function request<T>(method: string, path: string): Promise<T> {
  if (!BASE_URL) {
    throw new BackendError("Backend URL is not configured (set VITE_BACKEND_URL).", 0);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { accept: "application/json" },
    });
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

const get = <T>(path: string): Promise<T> => request<T>("GET", path);

// Voicemail transcription stats.
export function getTranscribeStats(): Promise<TranscribeStats> {
  return get<TranscribeStats>("/transcribe/stats");
}
