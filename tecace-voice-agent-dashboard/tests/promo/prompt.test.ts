import { describe, expect, it } from "vitest";
import {
  buildPrompts,
  city,
  quotedGreeting,
  resolvePrompts,
  safetyLines,
  spokenGreeting,
  withArticle,
} from "../../src/demos/lib/prompt";
import type { BusinessProfile } from "../../src/demos/lib/types";

const profile: BusinessProfile = {
  name: "Joe's Pizza",
  category: "pizzeria",
  address: "7 Carmine St, New York, NY 10014",
  phone: "(212) 366-1182",
  hours: [
    { day: "Monday", open: "10:00", close: "05:00" },
    { day: "Sunday", open: "", close: "", closed: true },
  ],
  services: [{ name: "Cheese slice", price: "$3.75" }],
  highlights: ["Classic New York slice"],
  policies: { reservations: "No reservations", parking: "Street parking" },
  faqs: [{ q: "Do you deliver?", a: "Through delivery apps." }],
};

describe("buildPrompts", () => {
  const prompts = buildPrompts(profile, "Alex");

  it("keeps the blank lines that separate sections", () => {
    expect(prompts.live).toContain("\n\n# Personality and tone\n");
    expect(prompts.live).toContain("\n\n# What you know without checking\n");
  });

  it("puts the agent, business, and city in the opening sentence", () => {
    expect(prompts.live.split("\n")[1]).toMatch(
      /^You are Alex, the phone receptionist at Joe's Pizza, a pizzeria in New York\. /,
    );
  });

  it("states hours, services, and policies as facts the voice layer owns", () => {
    expect(prompts.live).toContain("Monday: 10:00 to 05:00");
    expect(prompts.live).toContain("Sunday: Closed");
    expect(prompts.live).toContain("Cheese slice ($3.75)");
    expect(prompts.live).toContain("Reservations: No reservations");
  });

  it("omits an unknown phone line instead of leaving a blank", () => {
    const withoutPhone = buildPrompts({ ...profile, phone: undefined }, "Alex");
    expect(withoutPhone.live).not.toContain("- Phone:");
    expect(withoutPhone.live).not.toMatch(/\n\n\n/);
  });

  it("gives the backend the whole profile as JSON", () => {
    expect(prompts.backend).toContain('"name": "Joe\'s Pizza"');
    expect(prompts.backend).toContain("Do you deliver?");
  });

  it("pins the accent and the energy so the voice does not drift", () => {
    expect(prompts.live).toContain("standard American accent");
    expect(prompts.live).toContain("upbeat");
    expect(prompts.greeting).toContain("standard American accent");
  });

  it("names the business and the agent in the greeting", () => {
    expect(prompts.greeting).toContain("Thanks for calling Joe's Pizza, this is Alex!");
  });

  it("starts unedited", () => {
    expect(prompts.edited).toBe(false);
  });
});

describe("the guide's policies", () => {
  const { live, backend } = buildPrompts(profile, "Alex");

  it("says what the backend can do, when to hand over, and when not to", () => {
    expect(live).toContain("Backend capabilities:");
    expect(live).toContain("Delegate to the backend when:");
    expect(live).toContain("Do not delegate when:");
    expect(live).toContain("Do not guess the result while waiting.");
  });

  it("uses this business's word for a booking", () => {
    expect(live).toContain("book, change, or cancel a table");
    expect(buildPrompts({ ...profile, category: "dental clinic" }, "Alex").live).toContain(
      "book, change, or cancel an appointment",
    );
  });

  it("asks about the part it did not catch instead of guessing", () => {
    expect(live).toContain("ask about that part only. Never guess it.");
  });

  it("is honest that this is a demo, and an AI", () => {
    expect(live).toContain("say once, briefly, that this is a demo");
    expect(live).toContain("say you are an AI receptionist");
    expect(backend).toContain("Never call it confirmed or booked.");
    expect(backend).not.toContain("confirm the details back");
  });

  it("sends an emergency to the emergency number, whatever the business", () => {
    expect(live).toContain("call their local emergency number now");
  });

  it("answers the short common questions without checking, and only those", () => {
    expect(live).toContain('"Do you deliver?" Through delivery apps.');
    const long = buildPrompts(
      { ...profile, faqs: [{ q: "Tell me everything", a: "x".repeat(300) }] },
      "Alex",
    );
    expect(long.live).not.toContain("Common questions:");
  });
});

describe("register", () => {
  // A test call switched from English to Korean in 반말 and the receptionist
  // answered in 반말. The language follows the caller; the politeness does not.
  it("follows the caller's language but never their register, whatever it opens in", () => {
    for (const language of ["en", "ko"]) {
      const { live } = buildPrompts(profile, "Alex", language);
      expect(live).toContain("Switch language, never register");
      expect(live).toContain("존댓말");
      expect(live).toContain("고객님");
      expect(live).toContain("never 반말");
    }
  });

  it("gives no casual phrases to translate into casual speech", () => {
    const { live } = buildPrompts(profile, "Alex");
    expect(live).not.toContain("sure thing");
    expect(live).not.toContain("you got it");
  });

  it("holds the backend to the polite register too", () => {
    expect(buildPrompts(profile, "Alex").backend).toContain(
      "always in its polite customer-service register",
    );
  });
});

describe("safetyLines", () => {
  it("keeps a clinic from giving medical advice", () => {
    expect(safetyLines("Dental clinic")[0]).toContain("Never give medical advice");
    expect(safetyLines("Veterinary hospital")[0]).toContain("Never give medical advice");
  });

  it("keeps a law or accounting office from giving advice", () => {
    expect(safetyLines("Immigration law firm")[0]).toContain("Never give legal, tax, or financial advice");
    expect(safetyLines("CPA")[0]).toContain("financial advice");
  });

  it("keeps a restaurant from promising a dish is allergy-safe", () => {
    expect(safetyLines("Italian restaurant")[0]).toContain("allergy");
  });

  it("adds nothing for everyone else", () => {
    expect(safetyLines("Barber shop")).toEqual([]);
    expect(safetyLines("Lawn care")).toEqual([]);
    expect(safetyLines(undefined)).toEqual([]);
  });
});

describe("city", () => {
  it("reads the town off a US address, with or without the country", () => {
    expect(city("7 Carmine St, New York, NY 10014")).toBe("New York");
    expect(city("500 Pine St, Suite 200, Seattle, WA 98101, USA")).toBe("Seattle");
    expect(city("1 Main St, Austin, TX, United States")).toBe("Austin");
  });

  // Each of these used to put a street, a postcode or a whole address where
  // the town goes.
  it("says nothing rather than something wrong", () => {
    expect(city("서울특별시 강남구 테헤란로 123")).toBe("");
    expect(city("10 Downing St, London SW1A 2AA, UK")).toBe("");
    expect(city("1 Main St")).toBe("");
    expect(city(undefined)).toBe("");
  });

  it("leaves the town out of the first line when it cannot find one", () => {
    const seoul = buildPrompts(
      { ...profile, category: "immigration law firm", address: "서울특별시 강남구 테헤란로 123" },
      "Alex",
    );
    expect(seoul.live.split("\n")[1]).toMatch(
      /^You are Alex, the phone receptionist at Joe's Pizza, an immigration law firm\. /,
    );
  });
});

describe("withArticle", () => {
  it("picks a or an by the sound, not just the letter", () => {
    expect(withArticle("pizzeria")).toBe("a pizzeria");
    expect(withArticle("immigration law firm")).toBe("an immigration law firm");
    expect(withArticle("Italian restaurant")).toBe("an Italian restaurant");
    expect(withArticle("university clinic")).toBe("a university clinic");
  });
});

describe("backendProfile", () => {
  it("keeps ratings, reviews and coordinates away from the receptionist", () => {
    const rated = buildPrompts(
      {
        ...profile,
        rating: 3.1,
        reviewSummary: "Reviews mention long waits.",
        lat: 40.73,
        lng: -74.0,
      },
      "Alex",
    );
    expect(rated.backend).not.toContain("long waits");
    expect(rated.backend).not.toContain('"rating"');
    expect(rated.backend).not.toContain('"lat"');
    expect(rated.backend).toContain("Do you deliver?");
  });
});

describe("resolvePrompts", () => {
  const cafe: BusinessProfile = {
    name: "Blue Bottle",
    category: "Coffee shop",
    address: "1 Main St",
    hours: [],
    services: [],
    highlights: [],
    policies: {},
    faqs: [],
  };

  it("keeps generated prompts in step with the data when nobody has edited them", () => {
    const current = buildPrompts(cafe, "Alex");
    // The editor posts the prompts back untouched alongside a new agent name.
    const next = resolvePrompts({
      current,
      submitted: current,
      profile: cafe,
      agentName: "Sam",
    });
    expect(next.edited).toBe(false);
    expect(next.greeting).toContain("this is Sam!");
  });

  it("does not mark prompts edited when a save carries them back unchanged", () => {
    const current = buildPrompts(cafe, "Alex");
    const next = resolvePrompts({
      current,
      submitted: current,
      profile: cafe,
      agentName: "Alex",
    });
    expect(next.edited).toBe(false);
  });

  it("marks prompts edited once the text actually differs", () => {
    const current = buildPrompts(cafe, "Alex");
    const next = resolvePrompts({
      current,
      submitted: { ...current, greeting: "Say hi." },
      profile: cafe,
      agentName: "Alex",
    });
    expect(next.edited).toBe(true);
    expect(next.greeting).toBe("Say hi.");
  });

  it("leaves hand-written prompts alone when the data changes", () => {
    const current = { ...buildPrompts(cafe, "Alex"), edited: true };
    const next = resolvePrompts({
      current,
      submitted: current,
      profile: { ...cafe, address: "2 Main St" },
      agentName: "Sam",
    });
    expect(next).toEqual(current);
  });

  it("rebuilds hand-written prompts when asked to", () => {
    const current = { ...buildPrompts(cafe, "Alex"), edited: true };
    const next = resolvePrompts({
      current,
      submitted: current,
      profile: cafe,
      agentName: "Sam",
      regenerate: true,
    });
    expect(next.edited).toBe(false);
    expect(next.greeting).toContain("this is Sam!");
  });
});

describe("hours that research could not find", () => {
  const noHours: BusinessProfile = {
    name: "TecAce Software",
    category: "Software company",
    address: "840 140th Ave NE, Bellevue, WA 98005",
    // What a B2B company's research honestly returns: the days, no times.
    hours: [
      { day: "Monday", open: "", close: "", closed: false },
      { day: "Tuesday", open: "", close: "", closed: false },
    ],
    services: [],
    highlights: [],
    policies: {},
    faqs: [],
  };

  it("never puts undefined in front of the receptionist", () => {
    const prompts = buildPrompts(noHours, "Alex");
    expect(prompts.live).not.toContain("undefined");
    expect(prompts.backend).not.toContain("undefined");
  });

  it("says the hours are unknown and what to do about it", () => {
    const prompts = buildPrompts(noHours, "Alex");
    expect(prompts.live).toContain("Hours: unknown.");
    expect(prompts.live).toContain("offer to take a message");
  });

  it("still reports the days it does know", () => {
    const partial = buildPrompts(
      {
        ...noHours,
        hours: [
          { day: "Monday", open: "09:00", close: "17:00", closed: false },
          { day: "Tuesday", open: "", close: "", closed: false },
          { day: "Sunday", open: "", close: "", closed: true },
        ],
      },
      "Alex",
    );
    expect(partial.live).toContain("Monday: 09:00 to 17:00");
    expect(partial.live).toContain("Sunday: Closed");
    expect(partial.live).not.toContain("Tuesday");
  });
});

describe("speaking the caller's language", () => {
  const prompts = buildPrompts(profile, "Alex");

  it("opens in English", () => {
    expect(prompts.live).toContain("Open in English");
    expect(prompts.greeting).toContain("Greet them in English");
  });

  it("tells the receptionist to follow the caller into another language", () => {
    expect(prompts.live).toContain("switch to that language on your very next turn");
    expect(prompts.live).toContain("keep speaking it until they go back");
  });

  it("does not let it retreat to English or ask permission first", () => {
    expect(prompts.live).toContain("Do not fall back to English to be safe");
    expect(prompts.live).toContain("do not ask permission to switch");
  });

  it("stops it apologising for the accent it cannot change", () => {
    // The voice is fixed for the session, so its accent carries into every
    // language. Saying sorry for that every turn would be worse than the accent.
    expect(prompts.live).toContain("Never apologise for it");
  });

  it("keeps the old rule that English must not drift, without blocking other languages", () => {
    expect(prompts.live).toContain(
      "While you are speaking English, never drift into a British, Australian, or Irish accent",
    );
  });

  it("asks the backend to answer in the language it was asked in", () => {
    expect(prompts.backend).toContain("Reply in the same language the question was asked in");
  });
});

describe("opening the call", () => {
  const prompts = buildPrompts(profile, "Alex");

  it("says plainly that the receptionist goes first", () => {
    expect(prompts.greeting).toContain("Speak first.");
    expect(prompts.greeting).toContain("Do not wait for the caller");
  });

  it("hands the rescue the words, not the instruction", () => {
    expect(spokenGreeting(prompts.greeting)).toBe(
      "Thanks for calling Joe's Pizza, this is Alex! How can I help you today?",
    );
  });

  it("falls back to the whole text when an operator rewrites it without quotes", () => {
    expect(spokenGreeting("Say hello and ask what they need.")).toBe(
      "Say hello and ask what they need.",
    );
  });

  it("ignores a stray pair of quotes too short to be a greeting", () => {
    expect(spokenGreeting('Greet them. Use "hi" and nothing else.')).toBe(
      'Greet them. Use "hi" and nothing else.',
    );
  });
});

/**
 * The demo page shows the greeting as a bubble before anyone calls. Unlike
 * the rescue, it must never show the instruction itself — an unquoted
 * operator rewrite is an instruction, not something the receptionist says.
 */
describe("quotedGreeting", () => {
  const prompts = buildPrompts(profile, "Alex");

  it("returns the quoted sentence", () => {
    expect(quotedGreeting(prompts.greeting)).toBe(
      "Thanks for calling Joe's Pizza, this is Alex! How can I help you today?",
    );
  });

  it("returns null, not the instruction, when nothing is quoted", () => {
    expect(quotedGreeting("Say hello and ask what they need.")).toBeNull();
  });

  it("returns null for a quote too short to be a greeting", () => {
    expect(quotedGreeting('Greet them. Use "hi" and nothing else.')).toBeNull();
  });
});
