import { storeToken } from "../session/token";

// The sign-up calls, for the two public pages that make accounts: the demo page's "Request setup"
// (`/c/<id>`) and self-service sign-up (`/start`). No session token goes out — the caller has none
// yet — and nothing here imports the dashboard's API client (tests/public-entry.test.ts).
//
// Routes: transcribe-backend `routes/signup.ts` and `/auth/setup-state`.

const BASE_URL: string = __BACKEND_URL__;

export type AuthResult<T> = { ok: true; status: number; body: T } | { ok: false; status: number; message: string; code?: string };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, token?: string): Promise<AuthResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/auth${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, status: 0, message: "Couldn't reach the server. Check your connection and try again." };
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return { ok: true, status: response.status, body: data as T };
  // Elysia's own validation answers 422 with a long description; say it plainly instead.
  const message =
    response.status === 422
      ? "Check the details: a valid email, and a password of at least 10 characters."
      : typeof data.message === "string"
        ? data.message
        : typeof data.error === "string" && data.error.includes(" ")
          ? data.error
          : `Something went wrong (${response.status}). Try again.`;
  return { ok: false, status: response.status, message, code: typeof data.error === "string" ? data.error : undefined };
}

export type SignedIn = {
  token: string;
  expiresAt: string;
  customerId: string;
  next: "waiting" | "research";
};

export const signupApi = {
  state: () => call<{ needsSetup: boolean; mail: boolean; signup: boolean }>("GET", "/setup-state"),
  claim: (input: { demoId: string; name: string; email: string; password: string; phone?: string; note?: string; website?: string }) =>
    call<{ next: "code" | "requested" }>("POST", "/signup/claim", input),
  start: (input: {
    name: string;
    email: string;
    password: string;
    business: { businessName: string; websiteUrl?: string; mapsUrl?: string };
    website?: string;
  }) => call<{ next: "code" }>("POST", "/signup/start", input),
  verify: (email: string, code: string) => call<SignedIn>("POST", "/verify", { email, code }),
  resend: (email: string) => call<{ sent: boolean }>("POST", "/verify/resend", { email }),
  research: (token: string) => call<{ status: string; queued: boolean }>("POST", "/signup/research", undefined, token),
};

/** Keep the new session for the dashboard, which reads it on load (`api/backend.ts`). */
export function keepSession(token: string): void {
  storeToken(token);
}

/** The dashboard, signed in. A real navigation: it is another document. */
export function openDashboard(): void {
  window.location.assign("/");
}
