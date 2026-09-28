// Where the dashboard keeps its session token, in a module of its own.
//
// Two documents write it: the dashboard (`api/backend.ts`, on sign-in) and the public pages
// (`/c/<id>` and `/start`), which sign a new customer in the moment their email code is right and
// then send them to the dashboard. The public pages may not import `api/backend.ts`
// (tests/public-entry.test.ts), so the key and the two storage calls live here, where both can.
//
// The token lives in localStorage so a reload (or a new tab) keeps you signed in. The backend's
// token is stateless and expires on its own; `GET /auth/me` on boot confirms it is still good.

export const TOKEN_KEY = "transcribe.token";

export function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // private mode / storage disabled — the session just won't survive a reload
  }
}

export function storeToken(next: string | null): void {
  try {
    if (next) localStorage.setItem(TOKEN_KEY, next);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — the in-memory token still works for this tab */
  }
}
