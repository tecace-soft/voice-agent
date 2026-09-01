// Tell the voice agent's poller that a lead needs calling, instead of it asking us on a timer.
//
// Why this exists. The poller used to poll `GET /intake?status=new` on a fixed interval forever.
// Every one of those requests woke the Neon compute, so an idle night still billed a full night of
// compute to run trivial SELECTs that found nothing. This inverts it: we already had to touch the
// database to insert the lead (or set its callback), so we tell the poller on the way past. The
// notification rides on a wake that had to happen anyway, and an idle period costs nothing.
//
// Two rules this module exists to enforce:
//
//   1. NEVER let a notification failure affect the caller. The form submitting a lead must succeed
//      whether or not the agent host is reachable — a lead saved but not instantly dialed is a
//      minor delay; a lead rejected because an unrelated service was down is data loss. So every
//      failure here is swallowed and logged, and the call is not awaited by the request path.
//   2. NEVER be the only delivery mechanism. The poller keeps a slow safety poll precisely because
//      this can be lost (agent host restarting, a deploy, a network blip). Fire-and-forget is only
//      acceptable *because* something else eventually reconciles.
//
// Disabled by default: with AGENT_NOTIFY_URL unset this is a no-op and the poller falls back to
// polling alone, exactly as before.

const NOTIFY_URL = process.env.AGENT_NOTIFY_URL?.trim() ?? "";
const SECRET = process.env.AGENT_TOOLS_SECRET?.trim() ?? "";

// --- keeping the request alive long enough to actually send ------------------------
//
// The catch with fire-and-forget on a serverless platform: once the handler returns its response,
// the function can be frozen or torn down immediately, cutting our outbound fetch before it
// leaves. The notification is then silently lost, and the lead waits for the poller's safety poll
// instead of being called now. For a deferred callback ("call me back in ten minutes") that is the
// difference between landing on time and landing half an hour late.
//
// `waitUntil` is the platform's answer: hand it a promise and the runtime stays alive until the
// promise settles, without delaying the response. We look it up through the request-context global
// rather than importing `@vercel/functions`, so this needs no new dependency and no build change.
//
// If it is not there we fall back to plain fire-and-forget, which is correct on a LONG-LIVED
// runtime (Bun locally, a container) — those never freeze, so there is nothing to keep alive. The
// only bad combination is "serverless AND no waitUntil", so we warn loudly for exactly that case
// and let the safety poll cover it.

type WaitUntil = (promise: Promise<unknown>) => void;

function platformWaitUntil(): WaitUntil | null {
  try {
    const ctx = (globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] as
      | { get?: () => { waitUntil?: WaitUntil } | undefined }
      | undefined;
    const waitUntil = ctx?.get?.()?.waitUntil;
    return typeof waitUntil === "function" ? waitUntil : null;
  } catch {
    return null; // never let a probe of an undocumented global break a request
  }
}

let warnedNoWaitUntil = false;

// Short: this runs inside a serverless request, so a hanging agent host must not hold the
// function open (which costs us money and delays the caller's response).
const TIMEOUT_MS = 3000;

export type LeadDueNotice = {
  intakeId: string;
  /** ISO instant. Omit for "due now"; set it and the poller arms a timer instead of dialing. */
  notBefore?: string;
};

/**
 * Tell the poller there is work. Never throws, never rejects, never delays the response.
 *
 * Handlers call this WITHOUT awaiting — see rule 1 above. Delivery is kept alive by the platform's
 * `waitUntil` where one exists; the returned promise is for tests and for any caller that
 * genuinely wants to wait.
 */
export function notifyAgent(notice: LeadDueNotice): Promise<void> {
  const sent = send(notice);
  const waitUntil = platformWaitUntil();
  if (waitUntil) {
    // Response goes out now; the runtime stays alive until the fetch settles.
    waitUntil(sent);
  } else if (process.env.VERCEL && !warnedNoWaitUntil) {
    warnedNoWaitUntil = true;
    console.warn(
      "[agentNotify] running serverless but no waitUntil is available — notifications may be " +
        "cut off when the function freezes; the poller's safety poll is the backstop.",
    );
  }
  return sent;
}

function send(notice: LeadDueNotice): Promise<void> {
  if (!NOTIFY_URL) return Promise.resolve(); // push disabled; the safety poll covers it
  if (!SECRET) {
    console.warn("[agentNotify] AGENT_NOTIFY_URL is set but AGENT_TOOLS_SECRET is not — skipping");
    return Promise.resolve();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  return fetch(NOTIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-agent-secret": SECRET },
    body: JSON.stringify(notice),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) {
        // Not an error we act on — the safety poll will pick the lead up regardless.
        console.warn(`[agentNotify] poller returned ${res.status} for intake ${notice.intakeId}`);
      }
    })
    .catch((err) => {
      console.warn(`[agentNotify] could not notify poller for intake ${notice.intakeId}:`, err);
    })
    .finally(() => clearTimeout(timer));
}
