import { describe, expect, it } from "vitest";
import { SCENARIO_COUNT, businessNouns, buildUseCases } from "../../src/demos/lib/use-cases";

const opts = (category?: string) => ({
  agentName: "Alex",
  businessName: "Factoria Family Dentistry",
  nouns: businessNouns(category),
});

describe("businessNouns", () => {
  it("reads the bucket out of the category", () => {
    expect(businessNouns("Italian Restaurant").booking).toBe("table");
    expect(businessNouns("Dentist").booking).toBe("appointment");
    expect(businessNouns("Hardware Store").booking).toBe("pickup");
    expect(businessNouns("Plumber").booking).toBe("service visit");
  });

  it("does not care about case or surrounding words", () => {
    expect(businessNouns("COFFEE SHOP").booking).toBe("table");
    expect(businessNouns("Family Dental Clinic").booking).toBe("appointment");
  });

  // Substring matching made a barber shop a bar, with a table to book, and a
  // coworking space a spa.
  it("matches whole words, not the middle of one", () => {
    expect(businessNouns("Barber shop").booking).toBe("appointment");
    expect(businessNouns("Barbershop").booking).toBe("appointment");
    expect(businessNouns("Sushi bar").booking).toBe("table");
    expect(businessNouns("Day spa").booking).toBe("appointment");
    expect(businessNouns("Coworking space").statusQuestion).toBe("where is my request?");
  });

  it("still reads stems and plurals", () => {
    expect(businessNouns("Chiropractor").booking).toBe("appointment");
    expect(businessNouns("Automotive repair").booking).toBe("service visit");
    expect(businessNouns("Landscaping").booking).toBe("service visit");
    expect(businessNouns("Nails").booking).toBe("appointment");
  });

  it("falls back to an appointment when the category is missing or unknown", () => {
    expect(businessNouns(undefined).booking).toBe("appointment");
    expect(businessNouns("").booking).toBe("appointment");
    expect(businessNouns("Bespoke Widgetry").booking).toBe("appointment");
    expect(businessNouns("Bespoke Widgetry").statusQuestion).toBe(
      "where is my request?",
    );
  });

  // "is my visit ready?" is what a noun slot in a fixed sentence produces for a
  // dental office. The whole question belongs to the bucket.
  it("asks the status question this kind of business actually gets", () => {
    expect(businessNouns("Artisan bakery").statusQuestion).toBe(
      "is my order ready?",
    );
    expect(businessNouns("Family Dental Clinic").statusQuestion).toBe(
      "are my results back?",
    );
    expect(businessNouns("Plumber").statusQuestion).toBe("how is the job going?");
  });

  // Same reason: "qualifies the job and books the estimate" is a trades line,
  // and a dental office does not have jobs.
  it("frames the money call the way this kind of business gets it", () => {
    expect(businessNouns("Artisan bakery").leadTitle).toContain("catering");
    expect(businessNouns("Family Dental Clinic").leadTitle).toContain(
      "new patients",
    );
    expect(businessNouns("Plumber").leadTitle).toContain("estimate");
    expect(businessNouns("Hardware Store").leadTitle).toContain("special orders");
  });
});

describe("buildUseCases", () => {
  const cases = buildUseCases(opts("Italian Restaurant"));

  it("returns the whole catalog with unique ids", () => {
    expect(cases).toHaveLength(9);
    // The teaser and the scenarios page both say the number out loud.
    expect(SCENARIO_COUNT).toBe(cases.length);
    expect(new Set(cases.map((useCase) => useCase.id)).size).toBe(9);
  });

  it("marks only what this demo actually does as live", () => {
    expect(cases.filter((useCase) => useCase.live).map((useCase) => useCase.id)).toEqual([
      "receptionist",
      "multilingual",
    ]);
  });

  it("leads with the live ones", () => {
    expect(cases[0]!.live).toBe(true);
    expect(cases[1]!.live).toBe(true);
    expect(cases.slice(2).some((useCase) => useCase.live)).toBe(false);
  });

  it("swaps the nouns for the kind of business", () => {
    const text = (list: ReturnType<typeof buildUseCases>, id: string) =>
      JSON.stringify(list.find((useCase) => useCase.id === id));
    const dental = buildUseCases(opts("Dentist"));
    expect(text(cases, "reservations")).toContain("table");
    expect(text(dental, "reservations")).toContain("appointment");
    expect(text(cases, "orderstatus")).toContain("is my order ready?");
    expect(text(dental, "orderstatus")).toContain("are my results back?");
    expect(text(cases, "quotes")).toContain("catering");
    expect(text(dental, "quotes")).toContain("new patients");
  });

  it("says nothing empty", () => {
    for (const useCase of cases) {
      expect(useCase.title.trim()).not.toBe("");
      expect(useCase.tagline.trim()).not.toBe("");
      expect(useCase.body.trim()).not.toBe("");
      expect(useCase.icon.trim()).not.toBe("");
      expect(useCase.example.length).toBeGreaterThanOrEqual(2);
      for (const turn of useCase.example) {
        expect(turn.text.trim()).not.toBe("");
      }
    }
  });

  // A business researched without a category used to leak "undefined" into
  // spoken text; the rail must never read that way either.
  it("never renders undefined, whatever is missing", () => {
    const serialized = JSON.stringify(buildUseCases(opts(undefined)));
    expect(serialized).not.toContain("undefined");
    expect(serialized).not.toContain("[object Object]");
  });

  it("uses the receptionist's own name and the business name", () => {
    const serialized = JSON.stringify(cases);
    expect(serialized).toContain("Alex");
    expect(serialized).toContain("Factoria Family Dentistry");
  });
});
