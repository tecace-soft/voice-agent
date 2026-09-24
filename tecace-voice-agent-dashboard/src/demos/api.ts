import { getToken } from "../api/backend";

// The one place that knows where the Demo data lives.
//
// It used to be voiceagent_promo, reached same-origin through a /promo-api proxy so the promo's own
// httpOnly admin cookie would work. It isn't any more: the demo records were imported into
// transcribe-db and transcribe-backend serves them under /demo/*, guarded by this dashboard's own
// admin session. So there is no proxy, no second sign-in and no promo cookie — just the bearer
// token every other screen already sends.
//
// The paths lost their `/api/admin` prefix on the way: `promoFetch("/api/admin/customers")` is now
// `demoFetch("/customers")`. Everything after that base is the promo's own route shape.
const BASE_URL: string = __BACKEND_URL__;

/**
 * The drop-in the ported promo screens use in place of `fetch("/api/…")`. It keeps `promoFetch`'s
 * signature exactly — the Response comes back untouched, so the promo's own `readJson` goes on
 * reading it as before.
 */
export async function demoFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!path.startsWith("/")) throw new Error(`demoFetch takes a /path (got ${path})`);
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  try {
    return await fetch(`${BASE_URL}/demo${path}`, { ...init, headers });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
}

// The prospect's side of the same API lives in `publicApi.ts`, not here: this module reads the
// session token, so importing it pulls the dashboard's auth into whatever bundle does.
