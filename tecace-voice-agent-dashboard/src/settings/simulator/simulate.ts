import type { ToolResult } from "@/hooks/useLiveCall";
import {
  consentPreview,
  displayPhone,
  linkPreview,
  type CallSettings,
  type LinkScenario,
  type TransferScenario,
} from "../callSettings";

// What the receptionist's tools do on an in-app test call, where there is no phone line to ring and
// no carrier to text through. Each result is worded the way the phone agent's real tool results
// are, so the receptionist reacts on a test call exactly as it will on a real one — only the thing
// in the middle (Twilio) is played by the person testing.
//
// Pure: no React, no timers. `useCallSimulator` holds the state and the buttons.

export type SimEvent = { at: string; type: string; data: Record<string, unknown> };

export function event(type: string, data: Record<string, unknown> = {}): SimEvent {
  return { at: new Date().toISOString(), type, data };
}

/** A transfer in progress, waiting for the person testing to say how the other phone answered. */
export type PendingTransfer = {
  scenario: TransferScenario;
  reason: string;
  callerName: string;
  /** Which of the scenario's numbers is ringing (waterfall steps through them). */
  index: number;
};

export type TransferAnswer = "accepted" | "declined" | "no_answer";

/** What the person being rung hears before they decide — the phone agent reads the same summary. */
export function whisper(pending: PendingTransfer, businessName: string): string {
  const who = pending.callerName.trim() || "A caller";
  const why = pending.reason.trim() || "a question";
  if (pending.scenario.mode === "cold") return "";
  return `${businessName || "Your business"}: ${who} is calling about ${why.replace(/\.$/, "")}. Press 1 to take the call, or 2 to decline.`;
}

export function ringingNumber(pending: PendingTransfer): string {
  return displayPhone(pending.scenario.numbers[pending.index] ?? "");
}

/**
 * The next step after an answer: another number to ring (waterfall), or the result to hand back.
 *
 * Connected: the receptionist leaves the call, as it does when a real transfer is bridged — so
 * nothing more is asked of it, and the test call ends. Nobody: it comes back to the caller, the way
 * the phone agent's return leg does, and takes a message.
 */
export function afterAnswer(
  pending: PendingTransfer,
  answer: TransferAnswer,
): { next: PendingTransfer } | { result: ToolResult; success: boolean } {
  if (answer === "accepted") {
    return {
      success: true,
      result: {
        output: JSON.stringify({
          result: "connected",
          note: `The caller is now talking to ${pending.scenario.name}. You have left the call; say nothing more.`,
        }),
        resume: false,
        hangup: true,
      },
    };
  }
  const more = pending.scenario.mode === "waterfall" && pending.index + 1 < pending.scenario.numbers.length;
  if (more) return { next: { ...pending, index: pending.index + 1 } };
  return {
    success: false,
    result: {
      output: JSON.stringify({
        result: "no_answer",
        note: `Nobody at ${pending.scenario.name} could take the call. Apologise once, say they're not available right now, and take a message — you already have their name and number, so don't ask again.`,
      }),
      resume: true,
    },
  };
}

/** A text on the simulated phone. */
export type SimText = { from: "business" | "caller"; text: string };

export type TextState = {
  consented: boolean;
  optedOut: boolean;
  /** Links asked for before the YES came back. */
  waiting: LinkScenario[];
};

export function initialTextState(): TextState {
  return { consented: false, optedOut: false, waiting: [] };
}

/**
 * send_link, as the backend's `/sms/link` will answer it: a number that said STOP gets nothing; a
 * first text under double opt-in is the consent request, and the link waits for YES; otherwise the
 * link goes straight out.
 */
export function sendLink(
  settings: CallSettings,
  state: TextState,
  scenarioId: string,
  businessName: string,
  businessPhone: string | null,
): { result: ToolResult; state: TextState; texts: SimText[]; events: SimEvent[] } {
  const link = settings.links.scenarios.find((l) => l.id === scenarioId);
  const reply = (result: string) => ({ output: JSON.stringify({ result }), resume: true });
  if (!link) {
    return { result: reply("failed"), state, texts: [], events: [event("sms_failed", { scenarioId, why: "unknown link" })] };
  }
  if (state.optedOut) {
    return { result: reply("opted_out"), state, texts: [], events: [event("link_blocked", { scenarioId, why: "opted out" })] };
  }
  if (settings.sms.doubleOptIn && !state.consented) {
    const first = state.waiting.length === 0;
    return {
      result: reply("consent_requested"),
      state: { ...state, waiting: [...state.waiting, link] },
      texts: first ? [{ from: "business", text: consentPreview(businessName, businessPhone) }] : [],
      events: first ? [event("consent_requested", { scenarioId })] : [event("link_queued", { scenarioId })],
    };
  }
  return {
    result: reply("sent"),
    state,
    texts: [{ from: "business", text: linkPreview(link.text, link.url, businessName) }],
    events: [event("link_sent", { scenarioId })],
  };
}

/** The caller texting back YES or STOP. */
export function replyText(
  state: TextState,
  reply: "YES" | "STOP",
  businessName: string,
): { state: TextState; texts: SimText[]; events: SimEvent[] } {
  if (reply === "STOP") {
    return {
      state: { ...state, optedOut: true, waiting: [] },
      texts: [
        { from: "caller", text: "STOP" },
        { from: "business", text: `${businessName || "This business"}: You're unsubscribed and won't get more texts. Reply START to resubscribe.` },
      ],
      events: [event("consent_reply", { reply: "stop" })],
    };
  }
  return {
    state: { ...state, consented: true, waiting: [] },
    texts: [
      { from: "caller", text: "YES" },
      ...state.waiting.map((l) => ({ from: "business" as const, text: linkPreview(l.text, l.url, businessName) })),
    ],
    events: [event("consent_reply", { reply: "yes" }), ...state.waiting.map((l) => event("link_sent", { scenarioId: l.id }))],
  };
}

/** A message the receptionist took. */
export type SimMessage = { callerName: string; callbackNumber: string; message: string; requestedTime: string; scenario: string };

export function takeMessage(args: Record<string, unknown>): { message: SimMessage; result: ToolResult; event: SimEvent } {
  const text = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : "");
  const message = {
    callerName: text("caller_name"),
    callbackNumber: text("callback_number"),
    message: text("message"),
    requestedTime: text("requested_time"),
    scenario: text("scenario"),
  };
  return { message, result: { output: JSON.stringify({ ok: true }), resume: true }, event: event("message_taken", message) };
}
