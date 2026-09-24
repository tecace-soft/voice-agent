/**
 * A random id the browser keeps, so the operator can tell three people at a business trying the demo
 * from one person trying it three times. `analytics.distinctVisitors` counts these.
 *
 * It carries nothing else: no name, no address, nothing derived from the visitor. It replaces the IP
 * hash the promo stored before it, which was a truncated, unsalted SHA-256 of an address — so it was
 * reversible by brute force over the IPv4 space, identified the office rather than the person, and
 * was never read by any code.
 *
 * The promo minted this in `middleware.ts` and kept it in a `va_vid` cookie, because its pages were
 * rendered on a server that could set one. There is no middleware here — the demo page is a static
 * document that talks to the backend from the browser — so the browser mints it and keeps it in
 * `localStorage` under the same name.
 *
 * Storage can refuse (a private window, blocked site data), and a demo must not fail to open over an
 * analytics id, so every path here ends in a call that still goes out — just without one.
 */
export const VISITOR_KEY = "va_vid";

/** 22-ish characters of randomness, in the alphabet the promo's ids use. */
function mint(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export function visitorId(): string | undefined {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const next = mint();
    localStorage.setItem(VISITOR_KEY, next);
    return next;
  } catch {
    return undefined;
  }
}
