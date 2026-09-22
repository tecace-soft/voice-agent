// The one place that knows where the promo backend is.
//
// Every request goes to the same-origin /promo-api prefix, which the dev and preview servers
// (vite.config.ts) forward to voiceagent_promo's /api — and, once deployed, a Vercel rewrite will.
// Same origin is what lets the promo's own httpOnly admin cookie work with no change on its side.
// When the promo backend moves into transcribe-backend, this file and the proxy entries change;
// nothing that calls these functions should have to.
export const PROMO_API = "/promo-api";

/**
 * What went wrong, in the three ways the UI treats differently:
 * - `unreachable` — nothing answered, or a gateway in front of the promo did (502/503/504: the
 *   promo isn't running, or the proxy points at the wrong place);
 * - `locked` — the promo refused us (401): its admin cookie is missing or expired;
 * - `failed` — the promo answered with an error of its own, or with something we didn't ask for
 *   (an unexpected status with a non-JSON body, or JSON that isn't the shape we expected).
 */
export type PromoErrorKind = "unreachable" | "locked" | "failed";

export class PromoError extends Error {
  kind: PromoErrorKind;
  status: number;
  /**
   * Whether the promo itself sent this (a JSON object answer). Only such an answer proves the
   * promo's auth let us through — an SPA fallback's index.html or some other server doesn't.
   */
  fromPromo: boolean;
  constructor(kind: PromoErrorKind, message: string, status: number, fromPromo = false) {
    super(message);
    this.name = "PromoError";
    this.kind = kind;
    this.status = status;
    this.fromPromo = fromPromo;
  }
}

// Told when any promo call comes back 401, so the Demos views can swap in the unlock card. It never
// signs anyone out of the dashboard: the two sign-ins are separate until the backend is merged.
let onLocked: (() => void) | null = null;
export function setPromoLockedHandler(handler: (() => void) | null): void {
  onLocked = handler;
}

/** A promo `/api/…` path as the same-origin proxy URL — for what can't use promoFetch (a beacon). */
export function promoUrl(path: string): string {
  if (!path.startsWith("/api/")) {
    throw new Error(`promoFetch only takes /api/ paths (got ${path})`);
  }
  return `${PROMO_API}${path.slice("/api".length)}`;
}

/**
 * The drop-in the ported promo screens use in place of `fetch("/api/…")`: it sends the request
 * through the /promo-api proxy with the cookie and returns the Response untouched, so the promo's
 * own `readJson` goes on reading it exactly as before. The one addition: a 401 tells the gate, which
 * swaps in the unlock card.
 */
export async function promoFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = promoUrl(input);
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      ...init,
    });
  } catch {
    throw new Error("Couldn't reach the demo service.");
  }
  if (response.status === 401) onLocked?.();
  return response;
}

export async function promoRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${PROMO_API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new PromoError("unreachable", "Couldn't reach the demo service.", 0);
  }

  // No body to read — nothing to classify.
  if (res.status === 204) return undefined as T;

  // The promo answers everything, errors included, with a JSON object. Anything else came from
  // something in front of it: a gateway's own error page (502/503/504 — the promo isn't running,
  // or the proxy points at the wrong place) is `unreachable`; any other status with a body that
  // isn't the JSON object we expected is `failed` — worth surfacing, not silently swallowed as if
  // nothing had answered.
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  let data: unknown = null;
  if (isJson) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new PromoError("unreachable", `The demo service didn't answer (${res.status}).`, res.status);
    }
    throw new PromoError(
      "failed",
      `The demo service sent an unexpected response (${res.status}).`,
      res.status,
    );
  }

  const parsed = data as { error?: string };
  if (res.status === 401) {
    onLocked?.();
    throw new PromoError("locked", parsed.error ?? "Demos are locked.", 401, true);
  }
  if (!res.ok) {
    throw new PromoError("failed", parsed.error ?? `Request failed (${res.status}).`, res.status, true);
  }
  return data as T;
}

export type PromoAccess = "unlocked" | "locked" | "unreachable";

/**
 * Whether this browser can use the demos right now. Any answer the promo itself sent from the admin
 * health route means its auth let us through — including its 503, which only says the promo's own
 * config is incomplete (e.g. no research key), not that we're locked out. An answer that isn't the
 * promo's (an SPA fallback serving index.html because a deploy lacks the /promo-api rewrite, or
 * another server on PROMO_API_URL) is `unreachable`: the promo was never actually reached.
 */
export async function probePromo(): Promise<PromoAccess> {
  try {
    await promoRequest("GET", "/admin/health");
    return "unlocked";
  } catch (error) {
    if (error instanceof PromoError) {
      if (error.kind === "locked") return "locked";
      if (error.kind === "unreachable") return "unreachable";
      return error.fromPromo ? "unlocked" : "unreachable";
    }
    return "unreachable";
  }
}

/** Sets the promo's own 7-day admin cookie on this origin. A wrong password is a `locked` error. */
export async function unlockPromo(password: string): Promise<void> {
  await promoRequest("POST", "/admin/login", { password });
}

/** Clears the promo cookie. Fire-and-forget: signing out must never fail because of the promo. */
export async function lockPromo(): Promise<void> {
  try {
    await promoRequest("DELETE", "/admin/login");
  } catch {
    /* already locked, or the promo isn't running — either way there's nothing left to clear */
  }
}
