import { describe, expect, it } from "bun:test";
import type { BusinessProfile } from "../demo/types.js";
import { deriveFromProfile, hourOf, hoursText, openClose, renderFacts } from "./derive.js";

// The structured profile is what a customer now edits; these four values are what the phone agent
// reads. Everything here is about that boundary holding.
//
// The failure this guards against is quiet, not loud: `openai-agent-app` coerces every field with
// `str(... or "")`, so a structured value that leaks through is not an error — it is an agent
// reciting `{'day': 'Monday'...}` to a caller. So the assertions are about the SHAPE (strings and
// ints, never objects) as much as the content.
//
// Run: bun test src/business/derive.test.ts

const empty: BusinessProfile = {
  name: "",
  category: "",
  address: "",
  hours: [],
  services: [],
  highlights: [],
  policies: {},
  faqs: [],
};

const spa: BusinessProfile = {
  name: "Olympus Spa",
  category: "Korean day spa",
  address: "8615 36th Ave W, Lynnwood, WA",
  phone: "+1 425 673 8388",
  website: "https://olympusspa.com",
  hours: [
    { day: "Monday", open: "09:00", close: "21:00" },
    { day: "Tuesday", open: "09:00", close: "21:00" },
    { day: "Wednesday", open: "09:00", close: "21:00" },
    { day: "Thursday", open: "09:00", close: "21:00" },
    { day: "Friday", open: "09:00", close: "21:00" },
    { day: "Saturday", open: "10:00", close: "22:00" },
    { day: "Sunday", open: "", close: "", closed: true },
  ],
  services: [
    { name: "Body scrub", price: "$120", description: "Forty minutes, two passes" },
    { name: "Relaxation massage", price: "$95" },
    { name: "Facial" },
  ],
  highlights: ["Day passes include the pools and sauna", "Free parking"],
  policies: {
    reservations: "Services need booking; day passes are walk-in",
    cancellation: "24 hours notice",
    other: ["Tips for services are cash only"],
  },
  faqs: [{ q: "Do you take walk-ins?", a: "For day passes, yes." }],
};

describe("the hours a caller hears", () => {
  it("collapses consecutive days that keep the same hours", () => {
    expect(hoursText(spa.hours)).toBe(
      "Monday to Friday 09:00 to 21:00, Saturday 10:00 to 22:00, closed Sunday",
    );
  });

  it("says a single day on its own", () => {
    expect(hoursText([{ day: "Monday", open: "09:00", close: "17:00" }])).toBe(
      "Monday 09:00 to 17:00",
    );
  });

  it("treats a day with no times as closed, flag or not", () => {
    expect(hoursText([{ day: "Sunday", open: "", close: "" }])).toBe("closed Sunday");
    expect(hoursText([{ day: "Sunday", open: "09:00", close: "17:00", closed: true }])).toBe(
      "closed Sunday",
    );
  });

  it("only joins days that are actually next to each other", () => {
    // A business open Monday and Friday is not open on Wednesday. Collapsing on position in the
    // array rather than position in the week said it was.
    expect(
      hoursText([
        { day: "Monday", open: "09:00", close: "17:00" },
        { day: "Friday", open: "09:00", close: "17:00" },
      ]),
    ).toBe("Monday 09:00 to 17:00, Friday 09:00 to 17:00");
  });

  it("puts the week in order and keeps one entry per day, whatever it is handed", () => {
    expect(
      hoursText([
        { day: "Friday", open: "09:00", close: "17:00" },
        { day: "Monday", open: "09:00", close: "17:00" },
        { day: "Monday", open: "11:00", close: "15:00" },
        { day: "Notaday", open: "09:00", close: "17:00" },
      ]),
    ).toBe("Monday 09:00 to 17:00, Friday 09:00 to 17:00");
  });

  it("is nothing at all when no hours are recorded", () => {
    // Not an empty string: the agent's `_hours_line` has a third case for "we don't know", and it
    // is reached by null. An empty string would read as "hours: " and say nothing useful.
    expect(hoursText([])).toBeNull();
    expect(hoursText([{ day: "", open: "09:00", close: "17:00" }])).toBeNull();
  });
});

describe("the two ints that decide whether it is open right now", () => {
  it("reads a clock time, however a customer types one", () => {
    expect(hourOf("09:00")).toBe(9);
    expect(hourOf("9:30")).toBe(9);
    expect(hourOf("21:00")).toBe(21);
    // A bare hour is what people type into a box labelled "Opening time".
    expect(hourOf("9")).toBe(9);
  });

  it("reads the afternoon as the afternoon", () => {
    // The one that matters most: the Knowledge tab's times are free text, and reading "9:00 PM" as
    // nine in the morning is a whole evening of telling callers the business is shut.
    expect(hourOf("9:00 PM")).toBe(21);
    expect(hourOf("9pm")).toBe(21);
    expect(hourOf("12:00 AM")).toBe(0);
    expect(hourOf("12 pm")).toBe(12);
  });

  it("refuses anything that is not a time at all", () => {
    for (const bad of ["", "nine", "24:00", "-1:00", "9:99", "later", undefined]) {
      expect(hourOf(bad)).toBeNull();
    }
  });

  it("takes the week's usual hours, not the first day's", () => {
    // Saturday is the odd one out; a caller on a Tuesday must not be judged by it.
    expect(openClose(spa.hours)).toEqual({ openHour: 9, closeHour: 21 });
  });

  it("ignores the days it is closed", () => {
    expect(
      openClose([
        { day: "Sunday", open: "", close: "", closed: true },
        { day: "Monday", open: "08:00", close: "16:00" },
      ]),
    ).toEqual({ openHour: 8, closeHour: 16 });
  });

  it("drops BOTH when they cannot be true together", () => {
    // extractBusiness does the same. An agent that thinks it closes before it opens tells every
    // caller it is shut.
    expect(openClose([{ day: "Monday", open: "17:00", close: "09:00" }])).toEqual({
      openHour: null,
      closeHour: null,
    });
  });

  it("is null when there is nothing to read", () => {
    expect(openClose([])).toEqual({ openHour: null, closeHour: null });
    expect(openClose([{ day: "Monday", open: "morning", close: "evening" }])).toEqual({
      openHour: null,
      closeHour: null,
    });
  });
});

describe("what the agent knows", () => {
  const facts = renderFacts(spa);
  const lines = facts.split("\n");

  it("is the `- ` block the agent already reads", () => {
    expect(lines.every((line) => line.startsWith("- "))).toBe(true);
  });

  it("puts what a caller asks first, first", () => {
    expect(lines[0]).toBe("- The address is 8615 36th Ave W, Lynnwood, WA.");
    expect(lines[1]).toBe("- The phone number is +1 425 673 8388.");
    expect(facts).toContain("- The website is https://olympusspa.com.");
    expect(facts).toContain("- Olympus Spa is a Korean day spa.");
    expect(facts).toContain("- Opening hours: Monday to Friday 09:00 to 21:00");
  });

  it("carries every service, with its price as written", () => {
    expect(facts).toContain("- Body scrub: costs $120 — Forty minutes, two passes.");
    expect(facts).toContain("- Relaxation massage: costs $95.");
    // A service with neither price nor description is still something the agent can name — this is
    // the regression that made an agent say "that's one for the team" about its own service list.
    expect(facts).toContain("- Facial is one of the services.");
  });

  it("carries the policies, the highlights and the questions", () => {
    expect(facts).toContain("- Reservations: Services need booking; day passes are walk-in.");
    expect(facts).toContain("- Cancellation: 24 hours notice.");
    // Verbatim, with no full stop bolted on: these are the customer's own words, and a highlight
    // that already ends in "!" or is a fragment should not be punctuated for them.
    expect(facts).toContain("- Tips for services are cash only\n");
    expect(facts).toContain("- Free parking\n");
    expect(facts).toContain("- Day passes include the pools and sauna\n");
    expect(facts).toContain("- Do you take walk-ins? For day passes, yes.");
  });

  it("says nothing at all about an empty profile, rather than saying nothing useful", () => {
    expect(renderFacts(empty)).toBe("");
  });

  it("keeps the first facts when a profile is too big to send", () => {
    const huge: BusinessProfile = {
      ...spa,
      services: Array.from({ length: 300 }, (_, i) => ({ name: `Service ${i}`, price: "$10" })),
    };
    const kept = renderFacts(huge).split("\n");
    expect(kept.length).toBeLessThanOrEqual(80);
    expect(renderFacts(huge).length).toBeLessThanOrEqual(11_000);
    // The address survived the cull; it is the thing callers ask for most.
    expect(kept[0]).toContain("The address is");
  });

  it("trims a single runaway fact rather than dropping it", () => {
    const wordy: BusinessProfile = {
      ...empty,
      highlights: ["x".repeat(500)],
    };
    const [line = ""] = renderFacts(wordy).split("\n");
    expect(line.length).toBeLessThanOrEqual(203); // "- " + 200 + the ellipsis
    expect(line.endsWith("…")).toBe(true);
  });

  it("flattens anything a browser could put in a text box", () => {
    const messy: BusinessProfile = {
      ...empty,
      highlights: ["line one\nline two\ttabbed", "  padded  "],
    };
    const rendered = renderFacts(messy);
    expect(rendered).toBe("- line one line two tabbed\n- padded");
    // One fact per line is the agent's whole parsing rule.
    expect(rendered.split("\n").length).toBe(2);
  });
});

describe("what GET /business/config is handed", () => {
  const derived = deriveFromProfile(spa);

  it("is flat strings and ints, never the structured profile", () => {
    expect(typeof derived.facts).toBe("string");
    expect(typeof derived.hoursText).toBe("string");
    expect(typeof derived.businessName).toBe("string");
    expect(typeof derived.website).toBe("string");
    expect(typeof derived.openHour).toBe("number");
    expect(typeof derived.closeHour).toBe("number");
    // The failure mode this file exists for: a JSON object stringified into the prompt.
    expect(JSON.stringify(derived)).not.toContain("[object Object]");
    expect(derived.facts).not.toContain("{");
  });

  it("takes the business name and website from what the customer edits", () => {
    expect(derived.businessName).toBe("Olympus Spa");
    expect(derived.website).toBe("https://olympusspa.com");
  });

  it("sends null, not an empty string, for what is not known", () => {
    // The agent's config reader turns null into "" itself; the three-case hours line and the
    // "fall back to Tess" rule both depend on the difference reaching it.
    const derivedEmpty = deriveFromProfile(empty);
    expect(derivedEmpty.businessName).toBeNull();
    expect(derivedEmpty.website).toBeNull();
    expect(derivedEmpty.hoursText).toBeNull();
    expect(derivedEmpty.openHour).toBeNull();
    expect(derivedEmpty.closeHour).toBeNull();
    expect(derivedEmpty.facts).toBe("");
  });
});
