import type {
  AuthUser,
  CreatedAccount,
  Feedback,
  FeedbackCategory,
  FeedbackStatus,
  LoginResponse,
  Role,
  TranscribeStats,
} from "./types";

// Single place that talks to the backend API. Base URL comes from VITE_BACKEND_URL (set in .env
// locally and in the Vercel project for production).
const BASE_URL: string = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/$/, "");

// The session token lives in localStorage so a reload (or a new tab) keeps you signed in. The
// backend's token is stateless and expires on its own; `GET /auth/me` on boot confirms it is still
// good. Note this is readable by any script on this origin — acceptable for an internal metrics
// dashboard, and the reason the token is short-lived and revocable (`auth revoke`).
const TOKEN_KEY = "transcribe.token";

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // private mode / storage disabled — the session just won't survive a reload
  }
}

let token: string | null = readStoredToken();

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  token = next;
  try {
    if (next) localStorage.setItem(TOKEN_KEY, next);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — the in-memory token still works for this tab */
  }
}

// Called when the backend rejects our token mid-session (expired, or revoked from the CLI) so the
// app can drop straight back to the sign-in screen instead of showing a stale error.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export class BackendError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BackendError";
    this.status = status;
  }
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; anonymous?: boolean } = {},
): Promise<T> {
  if (!BASE_URL) {
    throw new BackendError("Backend URL is not configured (set VITE_BACKEND_URL).", 0);
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (token && !options.anonymous) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
    // A rejected token on a normal call means the session is over — but a 401 from the login
    // route is just a wrong password, and must not be treated as a session ending.
    if (res.status === 401 && !options.anonymous) {
      setToken(null);
      onUnauthorized?.();
    }
    throw new BackendError(message, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

const get = <T>(path: string): Promise<T> => request<T>("GET", path);

// ---- auth ----

// Exchange credentials for a session token, and remember it.
export async function login(email: string, password: string): Promise<LoginResponse> {
  const result = await request<LoginResponse>("POST", "/auth/login", {
    body: { email, password },
    anonymous: true,
  });
  setToken(result.token);
  return result;
}

// Who the stored token belongs to — used on boot to restore the session.
export async function fetchMe(): Promise<AuthUser> {
  return (await get<{ user: AuthUser }>("/auth/me")).user;
}

// Tokens are stateless, so signing out is discarding ours; we still tell the backend, and we drop
// the token even if that call fails.
export async function logout(): Promise<void> {
  try {
    await request("POST", "/auth/logout", {});
  } catch {
    /* signing out locally is what matters */
  } finally {
    setToken(null);
  }
}

// ---- first-run setup ----

// Whether this deployment still has no accounts at all. Answered without a session, because the
// dashboard has to ask it before it can know which form to show.
export function getSetupState(): Promise<{ needsSetup: boolean }> {
  return request<{ needsSetup: boolean }>("GET", "/auth/setup-state", { anonymous: true });
}

// Create the very first account and sign straight in. The backend closes this route as soon as any
// account exists.
export async function setupFirstAccount(
  name: string,
  email: string,
  password: string,
): Promise<LoginResponse> {
  const result = await request<LoginResponse>("POST", "/auth/setup", {
    body: { name, email, password },
    anonymous: true,
  });
  setToken(result.token);
  return result;
}

// ---- accounts (signed in) ----

export async function listAccounts(): Promise<AuthUser[]> {
  return (await get<{ users: AuthUser[] }>("/auth/users")).users;
}

// Omit the password to have the backend generate one — it comes back once, in the response.
export function createAccount(
  name: string,
  email: string,
  role: Role,
  password?: string,
): Promise<CreatedAccount> {
  return request<CreatedAccount>("POST", "/auth/users", {
    body: { name, email, role, password: password ?? "" },
  });
}

// Promote to admin or demote to user.
export function setAccountRole(id: string, role: Role): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>("POST", `/auth/users/${id}/role`, { body: { role } });
}

export function resetAccountPassword(id: string, password?: string): Promise<CreatedAccount> {
  return request<CreatedAccount>("POST", `/auth/users/${id}/password`, { body: { password: password ?? "" } });
}

export function revokeAccountSessions(id: string): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>("POST", `/auth/users/${id}/revoke`, { body: {} });
}

export function removeAccount(id: string): Promise<void> {
  return request<void>("DELETE", `/auth/users/${id}`);
}

// ---- feedback ----

// Send a note. The backend takes the author from the session, so there's nothing to pass but the
// note itself.
export function sendFeedback(category: FeedbackCategory, message: string): Promise<{ feedback: Feedback }> {
  return request<{ feedback: Feedback }>("POST", "/feedback", { body: { category, message } });
}

// Your own notes.
export async function listMyFeedback(): Promise<Feedback[]> {
  return (await get<{ feedback: Feedback[] }>("/feedback/mine")).feedback;
}

// Everything anyone has sent (admins only), with the open count.
export function listAllFeedback(): Promise<{ feedback: Feedback[]; open: number }> {
  return get<{ feedback: Feedback[]; open: number }>("/feedback");
}

// Just the open count, for the sidebar badge (admins only).
export async function countOpenFeedback(): Promise<number> {
  return (await get<{ open: number }>("/feedback/open-count")).open;
}

export function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<{ feedback: Feedback }> {
  return request<{ feedback: Feedback }>("POST", `/feedback/${id}/status`, { body: { status } });
}

// ---- data ----

// Voicemail transcription stats (requires a signed-in session).
export function getTranscribeStats(): Promise<TranscribeStats> {
  return get<TranscribeStats>("/transcribe/stats");
}
