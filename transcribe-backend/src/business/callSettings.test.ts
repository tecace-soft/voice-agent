import { describe, expect, it } from "bun:test";
import {
  CallSettingsError,
  activeTransfers,
  consentRequestMessage,
  emptyCallSettings,
  inHours,
  linkMessage,
  readCallSettings,
  sameSettings,
  usPhone,
  validateCallSettings,
  type CallSettings,
} from "./callSettings.js";

// The rules a customer's transfer and link settings have to pass, whoever sends them.
//
// Run: bun test src/business/callSettings.test.ts

const ctx = { agentNumber: "+12065550100", waterfallAllowed: false };

function refusal(fn: () => unknown): CallSettingsError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CallSettingsError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

const warm = {
  mode: "warm",
  name: "Billing",
  numbers: ["(206) 555-0134"],
};

describe("phone numbers", () => {
  it("takes the ways a US number gets typed", () => {
    for (const typed of ["2065550134", "(206) 555-0134", "206.555.0134", "+1 206 555 0134", "1-206-555-0134"]) {
      expect(usPhone(typed, "n")).toBe("+12065550134");
    }
  });

  it("refuses extensions rather than dialling them as part of the number", () => {
    for (const typed of ["206-555-0134 x12", "206-555-0134 ext 4", "2065550134#12", "2065550134,,3"]) {
      expect(refusal(() => usPhone(typed, "n")).message).toContain("Extensions");
    }
  });

  it("refuses numbers outside the US and ones that cannot exist", () => {
    for (const typed of ["+44 20 7946 0958", "555-0134", "(106) 555-0134", "+82 10 1234 5678"]) {
      expect(refusal(() => usPhone(typed, "n")).message).toContain("US phone number");
    }
  });
});

describe("transfer scenarios", () => {
  it("fills the defaults a warm transfer needs", () => {
    const settings = validateCallSettings({ transfer: { scenarios: [warm] } }, ctx);
    const [scenario] = settings.transfer.scenarios;
    expect(scenario!.numbers).toEqual(["+12065550134"]);
    expect(scenario!.collectBefore).toContain("name");
    expect(scenario!.holdMusic).toBe("classical");
    expect(scenario!.enabled).toBe(true);
    expect(scenario!.id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("keeps an id it was given, so an edit is not a new scenario", () => {
    const settings = validateCallSettings({ transfer: { scenarios: [{ ...warm, id: "billing-1" }] } }, ctx);
    expect(settings.transfer.scenarios[0]!.id).toBe("billing-1");
  });

  it("does not ask a cold transfer anything first", () => {
    const settings = validateCallSettings(
      { transfer: { scenarios: [{ ...warm, mode: "cold", collectBefore: "their name" }] } },
      ctx,
    );
    expect(settings.transfer.scenarios[0]!.collectBefore).toBe("");
  });

  it("names the field that is wrong", () => {
    const error = refusal(() =>
      validateCallSettings({ transfer: { scenarios: [warm, { ...warm, name: "" }] } }, ctx),
    );
    expect(error.field).toBe("transfer.scenarios[1].name");
  });

  it("refuses the same number in two scenarios", () => {
    const error = refusal(() =>
      validateCallSettings(
        { transfer: { scenarios: [warm, { ...warm, name: "Sam", numbers: ["206 555 0134"] }] } },
        ctx,
      ),
    );
    expect(error.message).toContain('"Billing"');
    expect(error.field).toBe("transfer.scenarios[1].numbers[0]");
  });

  it("refuses the assistant's own number as a target", () => {
    const error = refusal(() =>
      validateCallSettings({ transfer: { scenarios: [{ ...warm, numbers: ["206-555-0100"] }] } }, ctx),
    );
    expect(error.message).toContain("ring itself");
  });

  it("lets a demo with no number of its own save any number", () => {
    const settings = validateCallSettings(
      { transfer: { scenarios: [{ ...warm, numbers: ["206-555-0100"] }] } },
      { waterfallAllowed: false },
    );
    expect(settings.transfer.scenarios).toHaveLength(1);
  });

  it("wants exactly one number for cold and warm", () => {
    expect(
      refusal(() =>
        validateCallSettings({ transfer: { scenarios: [{ ...warm, numbers: [] }] } }, ctx),
      ).field,
    ).toBe("transfer.scenarios[0].numbers");
    expect(() =>
      validateCallSettings(
        { transfer: { scenarios: [{ ...warm, numbers: ["2065550134", "2065550135"] }] } },
        ctx,
      ),
    ).toThrow(CallSettingsError);
  });

  it("keeps a waterfall on an account without the feature, but switched off", () => {
    const waterfall = { ...warm, mode: "waterfall", numbers: ["2065550134", "2065550135"] };
    // Copied from a demo, or kept from before an admin switched the feature off: saved, never on,
    // and never a reason to refuse an unrelated save of the whole object.
    const kept = validateCallSettings({ transfer: { scenarios: [waterfall] } }, ctx).transfer.scenarios[0]!;
    expect(kept.mode).toBe("waterfall");
    expect(kept.enabled).toBe(false);
    const on = { ...ctx, waterfallAllowed: true };
    expect(validateCallSettings({ transfer: { scenarios: [waterfall] } }, on).transfer.scenarios[0]!.enabled).toBe(true);
  });

  it("wants two to five numbers for a waterfall", () => {
    const on = { ...ctx, waterfallAllowed: true };
    const waterfall = { ...warm, mode: "waterfall", numbers: ["2065550134", "2065550135"] };
    expect(() =>
      validateCallSettings({ transfer: { scenarios: [{ ...waterfall, numbers: ["2065550134"] }] } }, on),
    ).toThrow(CallSettingsError);
    const six = ["2065550131", "2065550132", "2065550133", "2065550134", "2065550135", "2065550136"];
    expect(() =>
      validateCallSettings({ transfer: { scenarios: [{ ...waterfall, numbers: six }] } }, on),
    ).toThrow(CallSettingsError);
  });

  it("gives two scenarios with the same id different ids, and refuses two with the same name", () => {
    const twins = validateCallSettings(
      { transfer: { scenarios: [{ ...warm, id: "x" }, { ...warm, id: "x", name: "Sam", numbers: ["2065550199"] }] } },
      ctx,
    );
    expect(new Set(twins.transfer.scenarios.map((s) => s.id)).size).toBe(2);
    expect(
      refusal(() =>
        validateCallSettings({ transfer: { scenarios: [warm, { ...warm, name: "billing", numbers: ["2065550199"] }] } }, ctx),
      ).field,
    ).toBe("transfer.scenarios[1].name");
  });

  it("lets a range end at midnight", () => {
    const settings = validateCallSettings(
      { transfer: { scenarios: [{ ...warm, hours: [{ day: "Friday", open: "6pm", close: "12am" }] }] } },
      ctx,
    );
    expect(settings.transfer.scenarios[0]!.hours).toEqual([{ day: "Friday", open: "18:00", close: "24:00" }]);
  });

  it("caps the number of scenarios", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      ...warm,
      name: `Person ${i}`,
      numbers: [`20655501${String(i).padStart(2, "0")}`],
    }));
    expect(refusal(() => validateCallSettings({ transfer: { scenarios: many } }, ctx)).field).toBe(
      "transfer.scenarios",
    );
  });

  it("reads hours as people type them and refuses a range that ends before it starts", () => {
    const settings = validateCallSettings(
      { transfer: { scenarios: [{ ...warm, hours: [{ day: "tue", open: "9am", close: "5:30 PM" }] }] } },
      ctx,
    );
    expect(settings.transfer.scenarios[0]!.hours).toEqual([{ day: "Tuesday", open: "09:00", close: "17:30" }]);
    expect(() =>
      validateCallSettings(
        { transfer: { scenarios: [{ ...warm, hours: [{ day: "Tuesday", open: "5pm", close: "9am" }] }] } },
        ctx,
      ),
    ).toThrow(CallSettingsError);
  });
});

describe("link scenarios", () => {
  const link = { triggers: ["directions"], url: "https://maps.example.com/acme" };

  it("fills the default text and keeps the link", () => {
    const settings = validateCallSettings({ links: { scenarios: [link] } }, ctx);
    expect(settings.links.scenarios[0]!.text).toContain("[business_name]");
    expect(settings.links.scenarios[0]!.url).toBe("https://maps.example.com/acme");
  });

  it("refuses anything but https", () => {
    for (const url of ["http://example.com", "example.com", "javascript:alert(1)", "https://localhost"]) {
      expect(refusal(() => validateCallSettings({ links: { scenarios: [{ ...link, url }] } }, ctx)).field).toBe(
        "links.scenarios[0].url",
      );
    }
  });

  it("counts the text before the business name is filled in, and refuses past 150", () => {
    expect(() =>
      validateCallSettings({ links: { scenarios: [{ ...link, text: "x".repeat(151) }] } }, ctx),
    ).toThrow(CallSettingsError);
    expect(() =>
      validateCallSettings({ links: { scenarios: [{ ...link, text: "x".repeat(150) }] } }, ctx),
    ).not.toThrow();
  });

  it("needs a keyword", () => {
    expect(refusal(() => validateCallSettings({ links: { scenarios: [{ ...link, triggers: [" "] }] } }, ctx)).field).toBe(
      "links.scenarios[0].triggers",
    );
  });

  it("names the business in what is sent", () => {
    const settings = validateCallSettings({ links: { scenarios: [link] } }, ctx);
    expect(linkMessage(settings.links.scenarios[0]!, "Acme Dental")).toBe(
      "Acme Dental: Here's the link you asked for https://maps.example.com/acme",
    );
  });
});

describe("message scenarios", () => {
  it("wants a name and a brief within 500 characters", () => {
    expect(() => validateCallSettings({ messages: { scenarios: [{ name: "Quotes", brief: "" }] } }, ctx)).toThrow(
      CallSettingsError,
    );
    expect(() =>
      validateCallSettings({ messages: { scenarios: [{ name: "Quotes", brief: "y".repeat(501) }] } }, ctx),
    ).toThrow(CallSettingsError);
    const ok = validateCallSettings(
      { messages: { scenarios: [{ name: "Quotes", brief: "Ask for the address and the size of the job." }] } },
      ctx,
    );
    expect(ok.messages.scenarios[0]!.name).toBe("Quotes");
  });
});

describe("the whole object", () => {
  it("starts with double opt-in on", () => {
    expect(emptyCallSettings().sms.doubleOptIn).toBe(true);
    expect(validateCallSettings({}, ctx).sms.doubleOptIn).toBe(true);
    expect(validateCallSettings({ sms: { doubleOptIn: false } }, ctx).sms.doubleOptIn).toBe(false);
  });

  it("refuses a time zone that doesn't exist", () => {
    expect(refusal(() => validateCallSettings({ timezone: "Mars/Olympus" }, ctx)).field).toBe("timezone");
    expect(validateCallSettings({ timezone: "America/New_York" }, ctx).timezone).toBe("America/New_York");
  });

  it("does not count the plan flag as a change to publish", () => {
    const a = validateCallSettings({}, { ...ctx, waterfallAllowed: false });
    const b = validateCallSettings({}, { ...ctx, waterfallAllowed: true });
    expect(sameSettings(a, b)).toBe(true);
  });

  it("compares drafts regardless of key order", () => {
    const a = validateCallSettings({ transfer: { scenarios: [{ ...warm, id: "a" }] } }, ctx);
    const b = JSON.parse(JSON.stringify(a)) as CallSettings;
    const reordered = { sms: b.sms, links: b.links, messages: b.messages, transfer: b.transfer };
    expect(sameSettings(a, reordered)).toBe(true);
    b.transfer.scenarios[0]!.name = "Accounts";
    expect(sameSettings(a, b)).toBe(false);
  });

  it("reads nothing as empty settings", () => {
    expect(readCallSettings(null)).toEqual(emptyCallSettings());
  });
});

describe("which transfers a call is told about", () => {
  // Tuesday 2026-09-29 10:30 in Los Angeles.
  const tuesdayMorning = new Date("2026-09-29T17:30:00Z");
  const zone = "America/Los_Angeles";

  it("reads the hours in the business's own time zone", () => {
    const hours = [{ day: "Tuesday" as const, open: "09:00", close: "12:00" }];
    expect(inHours(hours, tuesdayMorning, zone)).toBe(true);
    expect(inHours(hours, tuesdayMorning, "America/New_York")).toBe(false); // 13:30 there
    expect(inHours([], tuesdayMorning, zone)).toBe(true);
  });

  it("leaves out what is switched off or outside its hours", () => {
    const settings = validateCallSettings(
      {
        transfer: {
          scenarios: [
            { ...warm, id: "open" },
            { ...warm, id: "off", name: "Off", numbers: ["2065550135"], enabled: false },
            {
              ...warm,
              id: "later",
              name: "Evenings",
              numbers: ["2065550136"],
              hours: [{ day: "Tuesday", open: "18:00", close: "21:00" }],
            },
          ],
        },
      },
      ctx,
    );
    expect(activeTransfers(settings, tuesdayMorning, zone).map((s) => s.id)).toEqual(["open"]);
  });
});

describe("the consent text", () => {
  it("says who is texting, how to stop, and that rates apply", () => {
    const text = consentRequestMessage("Acme Dental", "(206) 555-0100");
    expect(text.startsWith("Acme Dental:")).toBe(true);
    for (const part of ["YES", "STOP", "HELP", "Msg & data rates may apply", "(206) 555-0100"]) {
      expect(text).toContain(part);
    }
  });
});
