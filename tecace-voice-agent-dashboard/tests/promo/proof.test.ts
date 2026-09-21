import { describe, expect, it } from "vitest";
import type { BusinessProfile, ResearchSource } from "../../src/demos/lib/types";
import {
  FALLBACK_QUESTIONS,
  headline,
  proofCounts,
  suggestedQuestions,
} from "../../src/demos/lib/proof";

const profile = (faqs: string[], extra: Partial<BusinessProfile> = {}): BusinessProfile => ({
  name: "Tartine Bakery",
  category: "Bakery",
  address: "600 Guerrero St",
  hours: [],
  services: [],
  highlights: [],
  policies: {},
  faqs: faqs.map((q) => ({ q, a: "…" })),
  ...extra,
});

const sources = (n: number): ResearchSource[] =>
  Array.from({ length: n }, (_, i) => ({ url: `https://example.com/${i}`, title: `${i}` }));

describe("suggestedQuestions", () => {
  it("keeps short FAQ questions, in order, up to four", () => {
    const faqs = ["Hours today?", "Do you take reservations?", "Parking?", "Gluten-free?", "Catering?"];
    expect(suggestedQuestions(profile(faqs))).toEqual(faqs.slice(0, 4));
  });

  it("drops questions longer than 36 characters rather than truncating them", () => {
    const long = "Do you accept Delta Dental insurance for new patients?";
    expect(suggestedQuestions(profile([long, "Parking?"]))).not.toContain(long);
    expect(suggestedQuestions(profile([long, "Parking?"]))[0]).toBe("Parking?");
  });

  it("dedupes case-insensitively and ignores surrounding whitespace", () => {
    const out = suggestedQuestions(profile(["Hours today?", "  hours today? ", "Parking?"]));
    expect(out.filter((q) => q.toLowerCase() === "hours today?")).toHaveLength(1);
  });

  it("pads from the fallback list, skipping ones already present", () => {
    const out = suggestedQuestions(profile(["Where do I park?"]));
    expect(out[0]).toBe("Where do I park?");
    expect(out).toHaveLength(4);
    expect(out.filter((q) => q === "Where do I park?")).toHaveLength(1);
  });

  it("returns exactly the fallback list when there are no FAQs", () => {
    expect(suggestedQuestions(profile([]))).toEqual(FALLBACK_QUESTIONS);
  });

  it("never returns an empty string", () => {
    for (const q of suggestedQuestions(profile(["", "   ", "Hours?"]))) {
      expect(q.trim()).not.toBe("");
    }
  });
});

describe("proofCounts", () => {
  const full = profile(["a", "b", "c"], {
    hours: [
      { day: "Monday", open: "07:30", close: "18:00" },
      { day: "Tuesday", open: "07:30", close: "18:00" },
      { day: "Sunday", open: "", close: "", closed: true },
    ],
    services: [{ name: "Croissant" }, { name: "Loaf" }],
  });

  it("names every non-zero fact", () => {
    const labels = proofCounts(full, sources(14), "2026-09-12T10:00:00.000Z")!.map((s) => s.label);
    expect(labels).toEqual([
      "Built from 14 public sources",
      "Open 2 days a week",
      "2 services",
      "3 questions callers ask",
      "Researched 12 Sep 2026",
    ]);
  });

  it("drops zero segments instead of printing a zero", () => {
    const labels = proofCounts(profile(["a"], { services: [] }), sources(3))!.map((s) => s.label);
    expect(labels.join(" ")).not.toMatch(/\b0\b/);
    expect(labels).not.toContain("0 services");
  });

  it("renders nothing at all under two segments", () => {
    expect(proofCounts(profile([]), [])).toBeNull();
    expect(proofCounts(profile(["a"]), [])).toBeNull();
  });

  it("omits the date when researchedAt is missing or unparsable", () => {
    const withoutDate = proofCounts(full, sources(2))!.map((s) => s.key);
    expect(withoutDate).not.toContain("researched");
    const garbage = proofCounts(full, sources(2), "not a date")!.map((s) => s.key);
    expect(garbage).not.toContain("researched");
  });

  // The same slip that once read "undefined" out loud as the opening hours.
  it("never renders undefined", () => {
    const text = JSON.stringify(proofCounts(full, sources(1), undefined));
    expect(text).not.toContain("undefined");
  });
});

describe("headline", () => {
  const opts = { template: "Every call to {name}, answered.", fallback: "Every call, answered." };

  it("uses the display size for a short name", () => {
    expect(headline({ ...opts, name: "Tartine Bakery" })).toEqual({
      text: "Every call to Tartine Bakery, answered.",
      size: "display",
      nameInSubtitle: false,
    });
  });

  it("steps down to the title size when the sentence runs long", () => {
    const out = headline({ ...opts, name: "Factoria Family Dentistry" });
    expect(out.size).toBe("title");
    expect(out.nameInSubtitle).toBe(false);
  });

  it("falls back and moves the name out when the sentence would wrap to four lines", () => {
    const out = headline({ ...opts, name: "Dr. Nguyen Family & Cosmetic Dentistry of Bellevue" });
    expect(out).toEqual({ text: "Every call, answered.", size: "display", nameInSubtitle: true });
  });

  it("measures the rendered sentence, so a different template moves the thresholds with it", () => {
    const short = headline({ template: "{name}, answered.", fallback: "Answered.", name: "Factoria Family Dentistry" });
    expect(short.size).toBe("display");
  });
});
