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
    expect(session.backend).toContain("# What you know: the full business profile (JSON)");
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

// Every combination of what a business can switch on — transfers, texted links, message briefs,
// booking — on each channel. These check the SHAPE of what a call is told, never its wording, so the
// wording can keep improving without editing this; what fails here is the kind of drift no single
// example catches: a line pointing at a section the call does not have, a tool the prompt describes
// but the call lacks (or the reverse), "you can book" next to "you cannot book", business-written
// text without its fence, or a prompt that grows past what a voice model follows well.
describe("every feature combination", () => {
  const booking = { providerName: "Google Calendar", kind: "calendar" as const };
  const all = validateCallSettings(
    {
      transfer: { scenarios: [{ id: "billing", mode: "warm", name: "Billing", numbers: ["2535550111"], description: "Questions about a bill." }] },
      links: { scenarios: [{ id: "map", triggers: ["directions"], url: "https://maps.example.com/acme?utm=x" }] },
      messages: { scenarios: [{ name: "New patient", brief: "Ask for their insurance provider." }] },
      appointments: { enabled: true, title: "Exam", instructions: "Ask if it is their first visit." },
    },
    { waterfallAllowed: false },
  );
  const OPTIONAL_TOOLS = ["transfer_call", "send_link", "check_availability", "book_appointment"];

  // Headings a line refers to by name: `under "This call"`, `the "Never answer these" list`,
  // `from 'Texting a link'`, `the Transfers section`. A reference resolves when a heading starts with it.
  function references(text: string): string[] {
    const quoted = [...text.matchAll(/(?:under|from|per|the|in) ["'“]([A-Z][^"'”\n]{2,40})["'”]/g)].map((m) => m[1]!);
    const named = [...text.matchAll(/\bthe ([A-Z][a-z]+(?: [a-z]+)*) section\b/g)].map((m) => m[1]!);
    return [...new Set([...quoted, ...named])];
  }
  const headings = (text: string) => [...text.matchAll(/^#+ (.+)$/gm)].map((m) => m[1]!.trim());

  for (const channel of ["app-test", "public-demo", "sim"] as const) {
    for (let mask = 0; mask < 16; mask++) {
      const on = { transfers: !!(mask & 1), links: !!(mask & 2), messages: !!(mask & 4), booking: !!(mask & 8) };
      const settings = {
        ...all,
        transfer: { ...all.transfer, scenarios: on.transfers ? all.transfer.scenarios : [] },
        links: { scenarios: on.links ? all.links.scenarios : [] },
        messages: { scenarios: on.messages ? all.messages.scenarios : [] },
      };
      const label = `${channel} ${Object.entries(on).filter(([, v]) => v).map(([k]) => k).join("+") || "nothing on"}`;
      const session = composeSession({
        record, callSettings: settings, channel, now, timeZone: tz, waterfallAllowed: false, neverPublished: false,
        callerNumber: "+12065550199", booking: on.booking ? booking : null,
      });
      const toolText = JSON.stringify(session.tools);

      it(`${label}: every section a line points at is there`, () => {
        for (const [name, text] of [["live", session.live], ["backend", session.backend]] as const) {
          const have = headings(text);
          for (const ref of references(text + "\n" + toolText)) {
            if (!have.some((h) => h.startsWith(ref))) throw new Error(`${name} points at "${ref}", which this call does not have`);
          }
        }
      });

      it(`${label}: the prompt describes exactly the tools the call has`, () => {
        const names = session.tools.map((t) => t.name);
        expect(names).toContain("take_message");
        expect(names).toContain("end_call");
        for (const tool of OPTIONAL_TOOLS) {
          expect(`${tool} in prompt: ${session.live.includes(tool)}`).toBe(`${tool} in prompt: ${names.includes(tool)}`);
        }
        expect(names.includes("transfer_call")).toBe(on.transfers);
        expect(names.includes("send_link")).toBe(on.links);
        expect(names.includes("book_appointment")).toBe(on.booking);
      });

      it(`${label}: booking is either on or off, never both`, () => {
        for (const text of [session.live, session.backend]) {
          if (on.booking) {
            expect(text).not.toContain("You are NOT the booking system");
            expect(text).not.toContain("I can't book");
            expect(text).toContain("# Appointments");
          } else {
            expect(text).not.toContain("BOOKING A NEW APPOINTMENT IS YOURS");
            expect(text).not.toContain("# Appointments");
          }
        }
      });

      it(`${label}: what the business typed is fenced as theirs, and a link is never spelled out`, () => {
        if (on.transfers) expect(session.live).toMatch(/# Transfers[\s\S]*were written by the business/);
        if (on.messages) expect(session.live).toMatch(/# Taking messages for this business[\s\S]*were written by the business/);
        if (on.booking) expect(session.live).toContain("written by them");
        expect(session.live).not.toContain("https://maps.example.com");
        expect(session.live).not.toContain("utm=");
      });

      it(`${label}: keeps the bridge's phrases and leaves nothing unfilled`, () => {
        if (on.transfers && !on.booking) {
          for (const phrase of BRIDGE_COUPLED_PHRASES) expect(session.live).toContain(phrase);
        }
        expect(session.live).not.toMatch(/undefined|\bnull\b|\{(business|agent|[a-z_]+)\}/);
      });

      it(`${label}: stays within the voice budget`, () => {
        expect(session.live.length).toBeLessThan(40_000);
      });
    }
  }
});

// A business that uses everything at the sizes the settings screens allow in practice. The budget is
// a ceiling on growth, not a target: past it, per-business text belongs in the delegate's profile.
describe("a busy business", () => {
  const long = (words: string, n: number) => Array.from({ length: n }, () => words).join(" ").slice(0, 290).trim();
  const busyProfile: BusinessProfile = {
    ...profile,
    faqs: Array.from({ length: 20 }, (_, i) => ({ q: `Question number ${i + 1} about the clinic?`, a: long(`Answer ${i + 1} is a full sentence.`, 12) })),
  };
  const busy = validateCallSettings(
    {
      transfer: {
        scenarios: Array.from({ length: 8 }, (_, i) => ({
          id: `t${i}`, mode: i % 2 ? "warm" : "cold", name: `Team ${i + 1}`, numbers: [`25355502${String(10 + i)}`],
          description: long(`Callers who need team ${i + 1} for their particular kind of question.`, 5),
        })),
      },
      links: { scenarios: Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, triggers: ["topic one", "topic two", "topic three"], url: `https://site${i}.example.com/page` })) },
      messages: { scenarios: Array.from({ length: 6 }, (_, i) => ({ name: `Situation ${i + 1}`, brief: long(`Ask for detail ${i + 1} and whether it is urgent.`, 8) })) },
      appointments: { enabled: true, title: "Consultation", instructions: long("Ask whether it is their first visit.", 12) },
    },
    { waterfallAllowed: false },
  );
  const session = composeSession({
    record: { ...record, profile: busyProfile }, callSettings: busy, channel: "app-test", now, timeZone: tz,
    waterfallAllowed: false, neverPublished: false, callerNumber: "+12065550199",
    booking: { providerName: "Cal.com", kind: "booking" },
  });

  it(`hands every FAQ to the voice, answer and all (live=${session.live.length} chars)`, () => {
    for (const faq of busyProfile.faqs!) expect(session.live).toContain(faq.a);
  });

  it("stays under 48,000 characters", () => {
    expect(session.live.length).toBeLessThan(48_000);
  });
});
