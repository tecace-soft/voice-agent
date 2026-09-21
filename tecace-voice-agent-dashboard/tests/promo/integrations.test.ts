import { describe, expect, it } from "vitest";
import {
  INTEGRATIONS,
  INTEGRATION_GROUPS,
  integrationGroupsFor,
} from "../../src/demos/lib/integrations";
import { businessNouns } from "../../src/demos/lib/use-cases";

describe("integrationGroupsFor", () => {
  it("leads a restaurant with reservation systems and drops video visits", () => {
    const groups = integrationGroupsFor(businessNouns("Korean BBQ restaurant").booking);
    expect(groups[0]).toBe("tables");
    expect(groups).not.toContain("video");
    expect(groups).toContain("calendar");
  });

  it("never shows a dentist OpenTable", () => {
    const groups = integrationGroupsFor(businessNouns("Dental clinic").booking);
    expect(groups).not.toContain("tables");
    expect(groups).toContain("video");
  });

  it("only names groups that exist and have something in them", () => {
    for (const booking of ["table", "appointment", "pickup", "service visit"]) {
      for (const id of integrationGroupsFor(booking)) {
        expect(INTEGRATION_GROUPS.some((group) => group.id === id)).toBe(true);
        expect(INTEGRATIONS.some((entry) => entry.group === id)).toBe(true);
      }
    }
  });
});

describe("INTEGRATIONS", () => {
  it("has unique ids and a drawable mark for every entry", () => {
    const ids = INTEGRATIONS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of INTEGRATIONS) {
      expect(entry.hex).toMatch(/^#[0-9A-F]{6}$/i);
      expect(entry.path.length).toBeGreaterThan(0);
    }
  });

  it("covers the reservation systems a restaurant owner will ask about", () => {
    const names = INTEGRATIONS.filter((entry) => entry.group === "tables").map(
      (entry) => entry.name,
    );
    expect(names).toEqual(expect.arrayContaining(["OpenTable", "Resy", "Tock", "SevenRooms"]));
  });
});
