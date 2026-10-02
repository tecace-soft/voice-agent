import { describe, expect, it } from "vitest";
import type { BusinessProfile } from "../src/demos/lib/types";
import type { Readiness } from "../src/api/types";
import { businessInfoProblem, customerPart, faqsProblem } from "../src/settings/sectionChecks";

const profile = (patch: Partial<BusinessProfile> = {}): BusinessProfile => ({
  name: "Harbor Dental",
  category: "Dentist",
  address: "",
  hours: [],
  services: [],
  highlights: [],
  policies: {} as BusinessProfile["policies"],
  faqs: [{ q: "Do you take walk-ins?", a: "Yes, mornings." }],
  ...patch,
});

describe("businessInfoProblem", () => {
  it("passes a profile with a name", () => {
    expect(businessInfoProblem(profile())).toBeNull();
  });
  it("holds back a profile whose name was cleared", () => {
    expect(businessInfoProblem(profile({ name: "  " }))).toBe("Your business name is empty.");
  });
});

describe("faqsProblem", () => {
  it("passes complete questions", () => {
    expect(faqsProblem(profile())).toBeNull();
  });
  it("holds back a question without its answer, or an answer without its question", () => {
    expect(faqsProblem(profile({ faqs: [{ q: "Parking?", a: "" }] }))).toBe("Each question needs an answer.");
    expect(faqsProblem(profile({ faqs: [{ q: "", a: "Out back." }] }))).toBe("Each question needs an answer.");
  });
});

describe("customerPart", () => {
  const readiness = (patch: Partial<Readiness> = {}): Readiness => ({
    status: "pre-production",
    ready: false,
    items: [
      { id: "business_info", ok: true, required: true, owner: "customer", label: "Business information is filled in" },
      { id: "settings_published", ok: false, required: true, owner: "customer", label: "Call settings are published" },
      { id: "contact_number", ok: false, required: false, owner: "customer", label: "A number to reach the business" },
      { id: "number_assigned", ok: false, required: true, owner: "admin", label: "A phone number is assigned" },
    ],
    ...patch,
  });

  it("counts only the business's own required items", () => {
    expect(customerPart(readiness())).toEqual({ done: 1, total: 2, ready: false });
  });
  it("takes the backend's word for whether the business may ask", () => {
    expect(customerPart(readiness({ customerReady: true })).ready).toBe(true);
  });
});
