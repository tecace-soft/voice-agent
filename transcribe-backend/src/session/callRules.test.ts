import { describe, expect, it } from "bun:test";
import {
  BACKEND_PREAMBLE,
  BRIDGE_COUPLED_PHRASES,
  callRules,
  voicePreamble,
  type RuleTool,
} from "./callRules.js";

// The rule book was ported from openai-agent-app, where two things read its wording from outside:
// scripts/checks/verify_behaviour_list.py (the dashboard's "on every call" list must stay backed by
// the prompt) and live_bridge.py (regexes over the model's English). Neither can see this file, so
// the phrases they rely on are pinned here. A failure means a promise to customers or a bridge
// safety net quietly stopped working — reword the test only if the other side changed too.
//
// Run: bun test src/session/callRules.test.ts

const base = { businessName: "Harbor Dental", agentName: "Tess" };
const reachable = callRules({ ...base, reachable: true });
const unreachable = callRules({ ...base, reachable: false });

// verify_behaviour_list.py PROMISES, every phrase that lived in instructions_inbound.py or faq.py.
// Kept in the Python's casing; the Python check is case-insensitive, this one is stricter.
const PROMISE_PHRASES = [
  "receptionist",
  "comes from the facts",
  "never speculate",
  "Ask before you answer",
  "ask ONE short question",
  "you do not know the answer",
  "OFFERING A PERSON",
  "ASK FIRST, ALWAYS",
  "Wait for their answer",
  "NEVER say or imply that anything is booked",
  "NEVER promise what a person will do",
  "You ALREADY HAVE their number",
  "Do not ask for a phone number",
  "Sharing the business's address is always allowed",
  "you are an AI assistant answering the phone",
  "NEVER claim to be human",
  "Let them finish",
  "never rush to wrap up",
];

const GOODBYE = "Say one short goodbye yourself, then call end_call in the same turn.";

const tools: RuleTool[] = [
  { name: "transfer_call", description: "Hand the caller to a person.\n  Use the scenario_id  from Transfers." },
  { name: "take_message", description: "Record a message for the team." },
  { name: "end_call", description: "Hang up the phone." },
];

describe("the reachable rule book", () => {
  it("keeps every phrase the dashboard's behaviour list depends on", () => {
    for (const phrase of PROMISE_PHRASES) expect(reachable).toContain(phrase);
  });

  it("keeps every bridge-matched line verbatim", () => {
    expect(BRIDGE_COUPLED_PHRASES).toContain("Of course, let me put you through. One moment.");
    expect(BRIDGE_COUPLED_PHRASES).toContain(
      "Got it — I'll pass that to the team and someone will get back to you.",
    );
    expect(BRIDGE_COUPLED_PHRASES).toContain("Anything else?");
    expect(BRIDGE_COUPLED_PHRASES).toContain("Thanks for calling — have a lovely day");
    for (const phrase of BRIDGE_COUPLED_PHRASES) expect(reachable).toContain(phrase);
  });

  it("puts callers through with transfer_call and the Transfers section", () => {
    expect(reachable).toContain("transfer_call");
    expect(reachable).toContain("Transfers section");
    expect(reachable).not.toContain("transfer_to_human");
  });

  it("states the one goodbye rule", () => {
    expect(reachable).toContain(GOODBYE);
  });

  it("names the business and the agent", () => {
    expect(reachable).toContain("You are Tess, the AI receptionist answering the main phone line for Harbor Dental.");
  });

  it("points at the per-call block instead of carrying runtime details", () => {
    expect(reachable).toContain('the opening line given in the call details under "This call"');
    expect(reachable).toContain('"What you know" section');
    // Runtime and customer-written slots stay out; other blocks supply them.
    expect(reachable).not.toContain("Facts you may state");
    expect(reachable).not.toContain("What this business has asked for");
    expect(reachable).not.toContain("failed transfer");
  });
});

describe("the unreachable rule book", () => {
  it("never offers or scripts a transfer", () => {
    expect(unreachable).not.toContain("transfer_call");
    expect(unreachable).not.toContain("put you through");
    expect(unreachable).not.toContain("Transfers section");
    expect(unreachable).not.toContain("OFFERING A PERSON");
    expect(unreachable).not.toContain("Do not transfer");
  });

  it("routes everything it cannot finish to a message", () => {
    expect(unreachable).toContain("## Route C — a message");
    expect(unreachable).toContain("This is the main route on this call.");
    expect(unreachable).toContain("THERE IS NOBODY TO PUT THEM THROUGH TO");
    expect(unreachable).toContain("take_message");
    // The bridge's message regex matches these; they replace the reachable offers.
    expect(unreachable).toContain("Got it, someone will get back to you about that");
    expect(unreachable).toContain(
      "That one's for the team — I'll pass it on and someone will get back to you.",
    );
    expect(unreachable).toContain("Got it — I'll pass that to the team and someone will get back to you.");
  });

  it("still keeps the promises that do not depend on a person", () => {
    for (const phrase of PROMISE_PHRASES.filter((p) => p !== "OFFERING A PERSON" && p !== "ASK FIRST, ALWAYS" && p !== "Wait for their answer")) {
      expect(unreachable).toContain(phrase);
    }
    expect(unreachable).toContain(GOODBYE);
  });
});

describe("the voice preamble", () => {
  const preamble = voicePreamble(tools);

  it("lists each tool as name: description, whitespace collapsed", () => {
    for (const tool of tools) expect(preamble).toContain(`- ${tool.name}: `);
    expect(preamble).toContain("- transfer_call: Hand the caller to a person. Use the scenario_id from Transfers.");
  });

  it("states the same goodbye rule as the rule book", () => {
    expect(preamble).toContain(GOODBYE);
    expect(preamble).not.toContain("closing words are handled for you");
  });

  it("only illustrates a transfer when the call has one", () => {
    expect(preamble).toContain("let me put you through");
    const noTransfer = voicePreamble(tools.filter((tool) => tool.name !== "transfer_call"));
    expect(noTransfer).not.toContain("put you through");
    expect(noTransfer).not.toContain("transfer_call");
  });
});

describe("clean output", () => {
  const outputs = {
    reachable,
    unreachable,
    voice: voicePreamble(tools),
    backend: BACKEND_PREAMBLE,
  };

  for (const [name, text] of Object.entries(outputs)) {
    it(`${name}: no template leftovers, no company text, no undefined`, () => {
      expect(text).not.toContain("{");
      expect(text).not.toContain("}");
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("null");
      // verify_faq.py's list: facts from one business must never ride along in the shared rules.
      for (const specific of ["TecAce", "Bellevue", "Seoul", "Samsung", "Anthropic", "Claude", "2000", "Olympus", "spa", "sauna", "body scrub"]) {
        expect(text).not.toMatch(new RegExp(`\\b${specific}\\b`, "i"));
      }
    });
  }

  it("backend preamble keeps the report-only-what-a-tool-returned rule", () => {
    expect(BACKEND_PREAMBLE).toContain("report only what a tool returned");
    expect(BACKEND_PREAMBLE).toContain("Call end_call only when the call rules below say the conversation is over.");
  });
});

// Python's rendered prompt was ~25k characters with facts and runtime lines included. The port
// drops those and the repeats, never a rule; the budget keeps it from growing back.
describe(`length (reachable=${reachable.length}, unreachable=${unreachable.length} chars)`, () => {
  it("stays under 24,000 characters when reachable", () => {
    expect(reachable.length).toBeLessThan(24_000);
  });
  it("stays under 24,000 characters when unreachable", () => {
    expect(unreachable.length).toBeLessThan(24_000);
  });
});
