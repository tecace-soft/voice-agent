import { describe, expect, it } from "bun:test";
import type { BusinessProfile } from "../demo/types.js";
import { validateCallSettings } from "../business/callSettings.js";
import { composeSession } from "../session/compose.js";
import { SETUP_TOPICS } from "./types.js";
import {
  CAPABILITIES,
  capabilitiesFor,
  playbookFor,
  renderCapabilities,
  renderPlaybook,
} from "./capabilities.js";

// The capability manifest is what the setup consultant quotes when a customer asks for something.
// These pin that it is complete (every topic, every call tool), that every "no" comes with an
// alternative, and that the rendered text says the things customers most often ask for and can't have.
//
// Run: bun test src/setup/capabilities.test.ts

const profile: BusinessProfile = {
  name: "Acme Dental",
  category: "dental clinic",
  address: "1 Main Street, Tacoma, WA 98402",
  hours: [{ day: "Tuesday", open: "09:00", close: "17:00" }],
  services: [],
  highlights: [],
  policies: {},
  faqs: [],
};

describe("the capability manifest", () => {
  it("covers every setup topic", () => {
    for (const topic of SETUP_TOPICS) expect(capabilitiesFor(topic).length).toBeGreaterThan(0);
  });

  it("gives every entry something to say, and every limit an alternative", () => {
    for (const c of CAPABILITIES) {
      expect(c.detail.trim()).not.toBe("");
      if (c.status !== "supported") expect(c.alternative?.trim() ?? "").not.toBe("");
    }
  });

  it("has unique ids", () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("describes every tool a call can be given", () => {
    const callSettings = validateCallSettings(
      {
        transfer: { scenarios: [{ id: "a", mode: "cold", name: "A", numbers: ["2065550134"] }] },
        links: { scenarios: [{ id: "l", triggers: ["map"], url: "https://x.example/" }] },
        messages: { scenarios: [{ id: "m", name: "M", brief: "b" }] },
        appointments: { enabled: true },
      },
      { waterfallAllowed: false },
    );
    const session = composeSession({
      record: { profile, prompts: null, agentName: "Mia", voice: null, language: "en" },
      callSettings,
      channel: "app-test",
      // Tuesday 10:30 in Tacoma, so the transfer (no hours = always) is open either way.
      now: new Date("2026-09-29T17:30:00Z"),
      timeZone: "America/Los_Angeles",
      waterfallAllowed: false,
      neverPublished: false,
      booking: { providerName: "Google Calendar", kind: "calendar" },
    });
    const described = new Set(CAPABILITIES.map((c) => c.callTool).filter(Boolean));
    const tools = session.tools.map((t) => t.name).filter((name) => name !== "end_call");
    // Everything really is on, or this would pass by describing less.
    for (const name of ["transfer_call", "send_link", "take_message", "check_availability", "book_appointment"]) {
      expect(tools).toContain(name);
    }
    for (const name of tools) expect(described.has(name as never)).toBe(true);
  });
});

describe("rendering", () => {
  it("names the limits customers ask about most", () => {
    const text = renderCapabilities();
    for (const phrase of ["hold music", "press", "text", "cancel"]) expect(text).toContain(phrase);
    expect(text).toContain("## What the receptionist can do");
    expect(text).toContain("Instead: ");
  });

  it("keeps one topic to itself", () => {
    expect(renderCapabilities("transfers")).not.toContain("appointment");
  });
});

describe("playbooks", () => {
  it("matches a category by keyword, case-insensitively", () => {
    expect(playbookFor("Dental clinic").key).toBe("clinic");
    expect(playbookFor("Italian RESTAURANT").key).toBe("restaurant");
    expect(playbookFor("HVAC repair").key).toBe("contractor");
  });

  it("falls back to generic", () => {
    expect(playbookFor("").key).toBe("generic");
    expect(playbookFor("something unheard of").key).toBe("generic");
  });

  it("renders as suggestions", () => {
    const text = renderPlaybook(playbookFor("clinic"));
    expect(text.startsWith("Ideas for a")).toBe(true);
    expect(text).toContain("- transfers: ");
    expect(text).toContain("- messages: ");
    expect(text).toContain("- appointments: ");
  });
});
