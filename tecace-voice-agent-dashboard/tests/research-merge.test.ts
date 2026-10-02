import { describe, expect, it } from "vitest";
import type { BusinessProfile } from "../src/demos/lib/types";
import { mergeResearch } from "../src/settings/researchMerge";

const current: BusinessProfile = {
  name: "Glow Spa",
  category: "Spa",
  address: "5 Pine St, Seattle, WA",
  phone: "+1 206 555 0100",
  hours: [{ day: "Monday", open: "10:00", close: "17:00" }],
  services: [{ name: "Massage", price: "$80" }],
  highlights: ["Quiet rooms"],
  policies: { parking: "Street parking", payment: "Cards only" },
  faqs: [{ q: "Do you sell gift cards?", a: "Yes, at the front desk." }],
};

const found: BusinessProfile = {
  name: "Glow Day Spa",
  category: "Day spa",
  address: "",
  website: "https://glowspa.example",
  hours: [{ day: "Monday", open: "09:00", close: "18:00" }],
  services: [],
  highlights: ["Free parking"],
  policies: { parking: "Free lot behind the building", payment: "" },
  faqs: [
    { q: "do you sell gift cards? ", a: "Online and in store." },
    { q: "Is there parking?", a: "Free parking behind the building." },
  ],
};

describe("mergeResearch", () => {
  it("takes what the run found, and keeps what it left empty", () => {
    const { profile } = mergeResearch(current, found);
    expect(profile.name).toBe("Glow Day Spa");
    expect(profile.address).toBe("5 Pine St, Seattle, WA"); // found nothing: kept
    expect(profile.website).toBe("https://glowspa.example");
    expect(profile.phone).toBe("+1 206 555 0100"); // not in the result: kept
    expect(profile.hours).toEqual(found.hours);
    expect(profile.services).toEqual(current.services); // found none: kept
    expect(profile.policies).toEqual({ parking: "Free lot behind the building", payment: "Cards only" });
  });

  it("names the parts it changed, for the note above the form", () => {
    const { changed } = mergeResearch(current, found);
    expect(changed).toEqual(expect.arrayContaining(["name", "category", "website", "hours", "highlights", "policies"]));
    expect(changed).not.toContain("address");
    expect(changed).not.toContain("services");
  });

  it("adds FAQs after the business's own, never replacing one, and skips a question already there", () => {
    const { profile, faqsAdded } = mergeResearch(current, found);
    expect(profile.faqs).toEqual([
      { q: "Do you sell gift cards?", a: "Yes, at the front desk." },
      { q: "Is there parking?", a: "Free parking behind the building." },
    ]);
    expect(faqsAdded).toBe(1);
  });

  it("stops at the 20-question limit and says how many didn't fit", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ q: `Question ${i}?`, a: `Answer ${i}.` }));
    const { profile, faqsAdded, faqsLeftOut } = mergeResearch(current, { ...found, faqs: many });
    expect(profile.faqs).toHaveLength(20);
    expect(faqsAdded).toBe(19);
    expect(faqsLeftOut).toBe(6);
  });

  it("starts from an empty form when the business has none yet", () => {
    const { profile } = mergeResearch(null, found);
    expect(profile.name).toBe("Glow Day Spa");
    expect(profile.faqs).toHaveLength(2);
  });
});
