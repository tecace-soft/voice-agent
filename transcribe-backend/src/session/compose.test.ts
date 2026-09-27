import { describe, expect, it } from "bun:test";
import type { BusinessProfile } from "../demo/types.js";
import { validateCallSettings } from "../business/callSettings.js";
import { BRIDGE_COUPLED_PHRASES } from "./callRules.js";
import { composeSession, LEGACY_SCENARIO_ID, type SessionRecord } from "./compose.js";
import { openState } from "./blocks.js";
import { SESSION_PROMPT_VERSION, buildSessionPrompts } from "./prompts.js";

// What a call is told, per channel. These pin the contract the phone agent, the in-app test call and
// the simulator all depend on: which tools exist, which scenarios are mentioned, and that the rule
// book's load-bearing phrases survive being composed.
//
// Run: bun test src/session/compose.test.ts

const profile: BusinessProfile = {
  name: "Acme Dental",
  category: "dental clinic",
  address: "1 Main Street, Tacoma, WA 98402",
  phone: "(253) 555-0100",
  hours: [
    { day: "Monday", open: "09:00", close: "17:00" },
    { day: "Tuesday", open: "09:00", close: "17:00" },
  ],
  services: [{ name: "Cleaning", price: "$120" }],
  highlights: ["Same-day emergencies"],
  policies: { parking: "Free lot behind the building" },
  faqs: [{ q: "Do you take new patients?", a: "Yes, we are accepting new patients." }],
};

const record: SessionRecord = {
  profile,
  prompts: null,
  agentName: "Mia",
  voice: "gleam",
  language: "en",
  houseRules: "Mention the free parking.",
  greeting: "Thanks for calling {business}, this is {agent}. How can I help?",
};

// Tuesday 2026-09-29, 10:30 in Tacoma.
const now = new Date("2026-09-29T17:30:00Z");
const tz = "America/Los_Angeles";

const settings = validateCallSettings(
  {
    transfer: {
      scenarios: [
        { id: "billing", mode: "warm", name: "Billing", numbers: ["2535550111"], description: "Questions about a bill or insurance." },
        {
          id: "evenings",
          mode: "cold",
          name: "On-call dentist",
          numbers: ["2535550112"],
          hours: [{ day: "Tuesday", open: "18:00", close: "22:00" }],
        },
      ],
    },
    links: { scenarios: [{ id: "map", triggers: ["directions"], url: "https://maps.example.com/acme" }] },
    messages: { scenarios: [{ name: "New patient", brief: "Ask for their insurance provider." }] },
  },
  { waterfallAllowed: false },
);

describe("an in-app test call", () => {
  const session = composeSession({ record, callSettings: settings, channel: "app-test", now, timeZone: tz, waterfallAllowed: false, neverPublished: true, callerNumber: "+12065550199" });

  it("offers only the transfers open right now", () => {
    expect(session.transfers.map((t) => t.id)).toEqual(["billing"]);
    const transfer = session.tools.find((t) => t.name === "transfer_call")!;
    expect(JSON.stringify(transfer.parameters)).toContain('"enum":["billing"]');
    expect(session.live).toContain('scenario_id "billing"');
    expect(session.live).not.toContain("On-call dentist");
  });

  it("carries every tool the settings allow", () => {
    expect(session.tools.map((t) => t.name)).toEqual(["transfer_call", "send_link", "take_message", "end_call"]);
    const message = session.tools.find((t) => t.name === "take_message")!;
    expect(JSON.stringify(message.parameters)).toContain("New patient");
  });

  it("gives both models the rule book, the business's words and the call's facts", () => {
    for (const text of [session.live, session.backend]) {
      expect(text).toContain("Mention the free parking.");
      expect(text).toContain("# Transfers");
      expect(text).toContain("# Date and time");
      expect(text).toContain("Tuesday, September 29");
      expect(text).toContain("OPEN right now");
    }
    expect(session.live).toContain("# This call");
    expect(session.live).toContain("206 555 0199");
    expect(session.backend).toContain("# Business profile (JSON)");
  });

  it("opens with the business's own greeting, placeholders filled", () => {
    expect(session.greetingLine).toBe("Thanks for calling Acme Dental, this is Mia. How can I help?");
    expect(session.greeting).toContain(session.greetingLine);
    expect(session.live).toContain(session.greetingLine);
  });

  it("keeps the phrases the phone bridge listens for", () => {
    for (const phrase of BRIDGE_COUPLED_PHRASES) {
      expect(session.live.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it("leaves nothing unfilled", () => {
    expect(session.live).not.toContain("undefined");
    expect(session.live).not.toMatch(/\{(business|agent|[a-z_]+)\}/);
    expect(session.live).not.toContain("demo line");
  });

  it("stays within a length a voice model handles well", () => {
    // Budget, not target. The rule book is most of it; what grows with a business is its facts and
    // its scenarios, and those should move to the backend's profile before this is raised.
    expect(session.live.length).toBeLessThan(40_000);
  });
});

describe("when nobody can be reached", () => {
  const evening = new Date("2026-09-30T02:00:00Z"); // Tuesday 19:00 in Tacoma
  const onlyDaytime = validateCallSettings(
    { transfer: { scenarios: [{ id: "billing", mode: "warm", name: "Billing", numbers: ["2535550111"], hours: [{ day: "Tuesday", open: "09:00", close: "17:00" }] }] } },
    { waterfallAllowed: false },
  );
  const session = composeSession({ record, callSettings: onlyDaytime, channel: "app-test", now: evening, timeZone: tz, waterfallAllowed: false, neverPublished: true });

  it("has no transfer tool and never mentions one", () => {
    expect(session.reachable).toBe(false);
    expect(session.tools.map((t) => t.name)).toEqual(["take_message", "end_call"]);
    expect(session.live).not.toContain("transfer_call");
    expect(session.live).toContain("CLOSED right now");
  });
});

describe("a business that only ever set one transfer number", () => {
  it("keeps that transfer, as a scenario", () => {
    const session = composeSession({
      record: { ...record, legacyTransferNumber: "+12535550150", legacyTransferTopics: "Gift cards." },
      callSettings: null,
      channel: "phone",
      now,
      timeZone: tz, waterfallAllowed: false, neverPublished: true,
    });
    expect(session.transfers.map((t) => t.id)).toEqual([LEGACY_SCENARIO_ID]);
    expect(session.live).toContain("Gift cards.");
  });

  it("drops it once real scenarios exist", () => {
    const session = composeSession({
      record: { ...record, legacyTransferNumber: "+12535550150" },
      callSettings: settings,
      channel: "phone",
      now,
      timeZone: tz, waterfallAllowed: false, neverPublished: true,
    });
    expect(session.transfers.map((t) => t.id)).toEqual(["billing"]);
  });
});

describe("a business that published on purpose", () => {
  it("does not get the old transfer number back after publishing no transfers", () => {
    const session = composeSession({
      record: { ...record, legacyTransferNumber: "+12535550150" },
      callSettings: null,
      channel: "phone",
      now,
      timeZone: tz,
      waterfallAllowed: false,
      neverPublished: false,
    });
    expect(session.transfers).toEqual([]);
    expect(session.reachable).toBe(false);
  });

  it("offers waterfall only while the account has it, whatever the stored copy says", () => {
    const withWaterfall = validateCallSettings(
      { transfer: { scenarios: [{ id: "all", mode: "waterfall", name: "Anyone", numbers: ["2535550121", "2535550122"] }] } },
      { waterfallAllowed: true },
    );
    const on = composeSession({ record, callSettings: withWaterfall, channel: "phone", now, timeZone: tz, waterfallAllowed: true, neverPublished: false });
    const off = composeSession({ record, callSettings: withWaterfall, channel: "phone", now, timeZone: tz, waterfallAllowed: false, neverPublished: false });
    expect(on.transfers.map((t) => t.id)).toEqual(["all"]);
    expect(off.transfers).toEqual([]);
  });
});

describe("a hand-edited greeting", () => {
  it("is what the call opens with", () => {
    const edited = { ...buildSessionPrompts(profile, "Mia"), greeting: 'Speak first. Say: "Acme Dental, Mia speaking."', edited: true };
    const session = composeSession({ record: { ...record, prompts: edited }, callSettings: null, channel: "sim", now, timeZone: tz, waterfallAllowed: false, neverPublished: true });
    expect(session.greetingLine).toBe("Acme Dental, Mia speaking.");
    expect(session.greeting).toBe(edited.greeting);
  });
});

describe("the phone channel", () => {
  it("leaves 'This call' to the phone agent", () => {
    const session = composeSession({ record, callSettings: settings, channel: "phone", now, timeZone: tz, waterfallAllowed: false, neverPublished: true });
    expect(session.live).not.toContain("# This call");
    expect(session.live).toContain("# Date and time");
  });
});

describe("the public demo", () => {
  it("gets the test call's tools, which the demo page plays out, and says it's a demo", () => {
    const session = composeSession({ record, callSettings: settings, channel: "public-demo", now, timeZone: tz, waterfallAllowed: true, neverPublished: true });
    expect(session.tools.map((t) => t.name)).toEqual(["transfer_call", "send_link", "take_message", "end_call"]);
    expect(session.live).toContain("# Transfers");
    expect(session.live).toContain("This is a demo line");
    expect(session.live).toContain("only shown on their screen");
    expect(session.backend).toContain("This is a demo line");
    // Staff numbers are never read out: the model transfers by scenario id.
    expect(session.live).not.toContain("2535550111");
    expect(session.live).not.toContain("an in-app test call");
  });

  it("never falls back to a legacy transfer number", () => {
    const legacy = { ...record, legacyTransferNumber: "2535550199" };
    const session = composeSession({ record: legacy, callSettings: {}, channel: "public-demo", now, timeZone: tz, waterfallAllowed: true, neverPublished: true });
    expect(session.tools.map((t) => t.name)).not.toContain("transfer_call");
  });
});

describe("stored prompts", () => {
  it("rebuilds prompts nobody edited when the builder moves on", () => {
    const old = { live: "old", backend: "old", greeting: "old", edited: false, version: 6 };
    const session = composeSession({ record: { ...record, prompts: old }, callSettings: null, channel: "sim", now, timeZone: tz, waterfallAllowed: false, neverPublished: true });
    expect(session.live).not.toContain("\nold\n");
    expect(session.live).toContain("You are Mia, the phone receptionist at Acme Dental");
  });

  it("keeps a hand edit", () => {
    const edited = { ...buildSessionPrompts(profile, "Mia"), live: "HAND WRITTEN PERSONA", edited: true };
    const session = composeSession({ record: { ...record, prompts: edited }, callSettings: null, channel: "sim", now, timeZone: tz, waterfallAllowed: false, neverPublished: true });
    expect(session.live).toContain("HAND WRITTEN PERSONA");
    expect(edited.version).toBe(SESSION_PROMPT_VERSION);
  });

  it("names the receptionist even when the business left the name empty", () => {
    const session = composeSession({ record: { ...record, agentName: null, greeting: null }, callSettings: null, channel: "sim", now, timeZone: tz, waterfallAllowed: false, neverPublished: true });
    expect(session.live).not.toContain("You are ,");
    expect(session.greetingLine).toContain("Acme Dental");
  });
});

describe("open or closed", () => {
  const at = (iso: string) => new Date(iso);
  const hours = (rows: BusinessProfile["hours"]) => ({ ...profile, hours: rows });

  it("reads times however a demo typed them", () => {
    // Tuesday 14:30 in Tacoma
    expect(openState(at("2026-09-29T21:30:00Z"), tz, hours([{ day: "Tuesday", open: "9:00 AM", close: "5 pm" }]))).toBe("open");
    expect(openState(at("2026-09-29T21:30:00Z"), tz, hours([{ day: "tue", open: "9", close: "12" }]))).toBe("closed");
  });

  it("follows hours past midnight, into the next morning", () => {
    const late = hours([{ day: "Tuesday", open: "18:00", close: "02:00" }]);
    expect(openState(at("2026-09-30T04:00:00Z"), tz, late)).toBe("open"); // Tue 21:00
    expect(openState(at("2026-09-30T08:30:00Z"), tz, late)).toBe("unknown"); // Wed 01:30, Wednesday not listed
    const withWednesday = hours([
      { day: "Tuesday", open: "18:00", close: "02:00" },
      { day: "Wednesday", open: "", close: "", closed: true },
    ]);
    expect(openState(at("2026-09-30T08:30:00Z"), tz, withWednesday)).toBe("open"); // still Tuesday's night
  });

  it("does not guess when a day is half filled in or missing", () => {
    expect(openState(at("2026-09-29T21:30:00Z"), tz, hours([{ day: "Tuesday", open: "09:00", close: "" }]))).toBe("unknown");
    expect(openState(at("2026-09-29T21:30:00Z"), tz, hours([{ day: "Monday", open: "09:00", close: "17:00" }]))).toBe("unknown");
    expect(openState(at("2026-09-29T21:30:00Z"), tz, hours([{ day: "Tuesday", open: "", close: "", closed: true }]))).toBe("closed");
  });
});
