// The prospect's side of the Demo API, in a module of its own.
//
// It is separate from `api.ts` for one reason: that file reads the dashboard's session token, so
// anything importing it pulls `api/backend.ts` into the bundle. Keeping this apart is what lets the
// public entry (`c.html`) be built without the admin's auth code in it at all.
//
// To be clear about what that does and does not buy: the two documents share an origin, so any
// script running on it could read `localStorage` whatever was bundled. What this gets is a smaller
// public bundle and a graph you can check — `src/public/` reaches none of the dashboard's auth, and
// the test in `tests/public-entry.test.ts` fails if that stops being true. A real boundary would be
// a separate origin.

const BASE_URL: string = __BACKEND_URL__;

/**
 * Like `demoFetch`, with two differences, and both are the point.
 *
 * It carries **no bearer token**: whoever opens a demo link has no account, and the nanoid in the
 * link is the only credential the backend gets. And it goes to `/demo/public/*`, which is the only
 * part of the Demo API that is not behind the admin guard.
 *
 * The raw `Response` comes back untouched, as `demoFetch` does it, because the ported promo code
 * calls `readJson(response)` itself.
 */
export async function publicFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!path.startsWith("/")) throw new Error(`publicFetch takes a /path (got ${path})`);
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  try {
    return await fetch(`${BASE_URL}/demo/public${path}`, { ...init, headers });
  } catch {
    throw new Error("Couldn't reach the server.");
  }
}
