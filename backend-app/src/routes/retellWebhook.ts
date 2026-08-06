import { Elysia } from "elysia";
import { env } from "../config/env.js";
import {
  getIntake,
  scheduleRetry,
  setIntakeNotes,
  updateIntakeStatus,
} from "../db/intakes.js";
import { sendVoicemailFollowUp } from "../services/notify.js";

// Retell post-call webhook. Retell POSTs `{ event, call }` for call_started / call_ended /
// call_analyzed. This closes the loop on OUTBOUND calls so the poller knows what happened:
//   - didn't connect (no answer / voicemail / busy / failed, or a too-short "connect")
//       -> schedule a retry (set callback_after, which the poller honors) up to a cap,
//          then mark the lead `unreachable`.
//   - reached the person but no booking (real conversation, they declined / hung up)
//       -> mark `contacted` so the poller stops calling.
//   - booked (the book tool already set `booked`) or a human callback scheduled mid-call
//       -> leave as-is.
//   - call_analyzed -> attach the AI's summary as notes (dashboard + future scenarios).
// Without this, an outbound lead stays `new` forever and never gets a second attempt.
//
// Auth: the Retell agent webhook can't send custom headers, so we guard with a URL secret —
// configure the webhook as `.../retell/webhook?secret=<AGENT_TOOLS_SECRET>`. (Signature
// verification via x-retell-signature can be added later for defense in depth.)

// disconnection_reason values that mean the call never reached a person → safe to retry.
function didNotConnect(reason: string): boolean {
  return (
    reason.startsWith("dial_") || // dial_no_answer, dial_busy, dial_failed
    reason.startsWith("error") || // telephony / platform errors
    reason === "voicemail_reached" ||
    reason === "machine_detected" ||
    reason === "registered" // dialed but never picked up
  );
}

// A "connected" call this short almost certainly wasn't a real conversation (immediate
// hangup / broken audio), so we treat it like a non-connect and try again.
const SHORT_CALL_MS = 15_000;

interface RetellWebhookCall {
  call_id?: string;
  direction?: string;
  disconnection_reason?: string;
  metadata?: Record<string, unknown>;
  retell_llm_dynamic_variables?: Record<string, unknown>;
  start_timestamp?: number;
  end_timestamp?: number;
  call_analysis?: { call_summary?: string };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// The lead id rides on the call's metadata and dynamic variables (the poller sets both).
function intakeIdOf(call: RetellWebhookCall): string {
  const meta = call.metadata ?? {};
  const dyn = call.retell_llm_dynamic_variables ?? {};
  return str(meta.intake_id) || str(dyn.intake_id) || str(dyn.intakeId);
}

export const retellWebhook = new Elysia({ prefix: "/retell" })
  // URL-secret guard (the agent webhook can't add headers, so we check ?secret=...).
  .onBeforeHandle(({ query, status }) => {
    if (env.agentToolsSecret && (query as { secret?: string }).secret !== env.agentToolsSecret) {
      return status(401, { error: "unauthorized" });
    }
  })
  .post("/webhook", async ({ body }) => {
    const payload = (body ?? {}) as { event?: string; call?: RetellWebhookCall };
    const event = str(payload.event);
    const call = payload.call ?? {};
    const intakeId = intakeIdOf(call);
    // No lead id (e.g. an inbound caller) — nothing to reconcile. Ack so Retell stops retrying.
    if (!intakeId) return { ok: true };

    const intake = await getIntake(intakeId);
    if (!intake) return { ok: true };

    // Attach the AI's call summary once analysis is ready (surfaced in the dashboard).
    if (event === "call_analyzed") {
      const summary = str(call.call_analysis?.call_summary);
      if (summary) await setIntakeNotes(intakeId, summary);
      return { ok: true };
    }

    // Lifecycle is driven only on call_ended.
    if (event !== "call_ended") return { ok: true };

    // Already resolved elsewhere: booked by the tool, retired, canceled, or a human
    // callback was scheduled mid-call (future callback_after) — don't override any of these.
    if (intake.status !== "new") return { ok: true };
    if (intake.callbackAfter && new Date(intake.callbackAfter).getTime() > Date.now()) {
      return { ok: true };
    }

    const reason = str(call.disconnection_reason);

    // Voicemail: Retell already left the spoken message. Send the lead a follow-up email and
    // stop calling (don't keep retrying a voicemail box). Best-effort email — mark contacted
    // either way so the poller stops.
    if (reason === "voicemail_reached" || reason === "machine_detected") {
      await sendVoicemailFollowUp(intake);
      await updateIntakeStatus(intakeId, "contacted");
      return { ok: true, outcome: "voicemail" };
    }

    const durationMs =
      call.start_timestamp && call.end_timestamp
        ? call.end_timestamp - call.start_timestamp
        : null;
    const connected =
      !didNotConnect(reason) && !(durationMs !== null && durationMs < SHORT_CALL_MS);

    if (connected) {
      // Reached the person but no booking happened — stop calling.
      await updateIntakeStatus(intakeId, "contacted");
      return { ok: true, outcome: "contacted" };
    }

    // Didn't connect: retry until the cap, then retire.
    if (intake.attempts >= env.retell.maxAttempts) {
      await updateIntakeStatus(intakeId, "unreachable");
      return { ok: true, outcome: "unreachable" };
    }
    const retryAfter = new Date(
      Date.now() + env.retell.retryDelaySeconds * 1000,
    ).toISOString();
    await scheduleRetry(intakeId, retryAfter);
    return { ok: true, outcome: "retry", retryAfter };
  });
