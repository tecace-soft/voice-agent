import { describe, expect, it } from "vitest";
import { emptyCallSettings, type CallSettings, type TransferScenario } from "../src/settings/callSettings";
import {
  afterAnswer,
  initialTextState,
  replyText,
  sendLink,
  takeMessage,
  whisper,
  type PendingTransfer,
} from "../src/settings/simulator/simulate";

// The simulated phone line of an in-app test call: what each tool hands back to the receptionist.
// Worded like the phone agent's real results, so the receptionist behaves on a test as on a call.

const billing: TransferScenario = {
  id: "billing",
  enabled: true,
  mode: "warm",
  name: "Billing",
  description: "",
  numbers: ["+12065550134"],
  collectBefore: "Name and reason",
  holdMusic: "classical",
  hours: [],
};

const pending = (scenario: TransferScenario): PendingTransfer => ({
  scenario,
  reason: "Question about an invoice.",
  callerName: "Jordan",
  index: 0,
});

describe("transfers", () => {
  it("tells the person being rung who is calling and why", () => {
    expect(whisper(pending(billing), "Acme")).toBe(
      "Acme: Jordan is calling about Question about an invoice. Press 1 to take the call, or 2 to decline.",
    );
    expect(whisper(pending({ ...billing, mode: "cold" }), "Acme")).toBe("");
  });

  it("hands the call over on an accept: no more words, and the call ends", () => {
    const step = afterAnswer(pending(billing), "accepted");
    expect("result" in step && step.success).toBe(true);
    if ("result" in step) {
      expect(JSON.parse(step.result.output).result).toBe("connected");
      expect(step.result.resume).toBe(false);
      expect(step.result.hangup).toBe(true);
    }
  });

  it("comes back to take a message when nobody picks up", () => {
    const step = afterAnswer(pending(billing), "declined");
    expect("result" in step && !step.success).toBe(true);
    if ("result" in step) {
      expect(JSON.parse(step.result.output).result).toBe("no_answer");
      expect(step.result.resume).toBe(true);
    }
  });

  it("walks a waterfall to the next number before giving up", () => {
    const waterfall = { ...billing, mode: "waterfall" as const, numbers: ["+12065550134", "+12065550135"] };
    const first = afterAnswer(pending(waterfall), "no_answer");
    expect("next" in first && first.next.index).toBe(1);
    if ("next" in first) {
      const last = afterAnswer(first.next, "no_answer");
      expect("result" in last && !last.success).toBe(true);
    }
  });
});

describe("texting a link", () => {
  const settings: CallSettings = {
    ...emptyCallSettings(),
    links: { scenarios: [{ id: "map", enabled: true, triggers: ["directions"], text: "[business_name]: map", url: "https://m.example.com" }] },
  };

  it("asks for consent first under double opt-in, then sends on YES", () => {
    const first = sendLink(settings, initialTextState(), "map", "Acme", "(206) 555-0100");
    expect(JSON.parse(first.result.output).result).toBe("consent_requested");
    expect(first.texts[0]!.text).toContain("Reply YES");
    const yes = replyText(first.state, "YES", "Acme");
    expect(yes.texts.map((t) => t.text)).toEqual(["YES", "Acme: map https://m.example.com"]);
    const again = sendLink(settings, yes.state, "map", "Acme", null);
    expect(JSON.parse(again.result.output).result).toBe("sent");
  });

  it("sends straight away with double opt-in off", () => {
    const off = { ...settings, sms: { doubleOptIn: false } };
    expect(JSON.parse(sendLink(off, initialTextState(), "map", "Acme", null).result.output).result).toBe("sent");
  });

  it("never texts a number that replied STOP", () => {
    const stop = replyText(initialTextState(), "STOP", "Acme");
    const blocked = sendLink(settings, stop.state, "map", "Acme", null);
    expect(JSON.parse(blocked.result.output).result).toBe("opted_out");
    expect(blocked.texts).toEqual([]);
  });

  it("asks for consent once, however many links wait for it", () => {
    const first = sendLink(settings, initialTextState(), "map", "Acme", null);
    const second = sendLink(settings, first.state, "map", "Acme", null);
    expect(second.texts).toEqual([]);
    expect(second.state.waiting).toHaveLength(2);
  });
});

describe("taking a message", () => {
  it("keeps what the receptionist wrote down", () => {
    const taken = takeMessage({ caller_name: "Jordan", message: "Call back about the invoice.", scenario: "Billing" });
    expect(taken.message).toMatchObject({ callerName: "Jordan", message: "Call back about the invoice.", scenario: "Billing" });
    expect(JSON.parse(taken.result.output)).toEqual({ ok: true });
  });
});
