import { describe, expect, it } from "bun:test";

// The month arithmetic behind the per-business call-minutes counter. Pure functions — no database.
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { asOf, monthKey, previousMonthKey, toMinutes } = await import("./callMinutes.js");

const stored = (currentMonth: string, currentSeconds: number, previousMonth: string, previousSeconds: number) => ({
  currentMonth, currentSeconds, previousMonth, previousSeconds, updatedAt: "2026-09-15T18:00:00.000Z",
});

describe("call minutes", () => {
  it("buckets a call by the business timezone, not UTC", () => {
    // 06:30Z on 1 October is still 11:30pm on 30 September in Los Angeles.
    expect(monthKey(new Date("2026-10-01T06:30:00Z"), "America/Los_Angeles")).toBe("2026-09");
    expect(monthKey(new Date("2026-10-01T07:30:00Z"), "America/Los_Angeles")).toBe("2026-10");
  });

  it("steps back one calendar month, across a year too", () => {
    expect(previousMonthKey("2026-10")).toBe("2026-09");
    expect(previousMonthKey("2027-01")).toBe("2026-12");
  });

  it("reports minutes to one decimal", () => {
    expect(toMinutes(0)).toBe(0);
    expect(toMinutes(90)).toBe(1.5);
    expect(toMinutes(100)).toBe(1.7);
  });

  it("a business with nothing stored reads as zero this month", () => {
    expect(asOf(null, "2026-09")).toEqual({
      currentMonth: "2026-09", currentSeconds: 0, currentMinutes: 0,
      previousMonth: "2026-08", previousSeconds: 0, previousMinutes: 0, updatedAt: null,
    });
  });

  it("the same month reads as stored", () => {
    const r = asOf(stored("2026-09", 150, "2026-08", 30), "2026-09");
    expect([r.currentSeconds, r.previousSeconds, r.currentMinutes]).toEqual([150, 30, 2.5]);
  });

  it("the next month moves this month into previous and starts at zero", () => {
    const r = asOf(stored("2026-09", 150, "2026-08", 30), "2026-10");
    expect([r.currentMonth, r.currentSeconds, r.previousMonth, r.previousSeconds]).toEqual(["2026-10", 0, "2026-09", 150]);
    expect(r.updatedAt).toBe("2026-09-15T18:00:00.000Z");
  });

  it("after a month with no calls, previous is that empty month", () => {
    const r = asOf(stored("2026-09", 150, "2026-08", 30), "2026-11");
    expect([r.currentMonth, r.currentSeconds, r.previousMonth, r.previousSeconds]).toEqual(["2026-11", 0, "2026-10", 0]);
  });

  it("a stored month ahead of now is shown as stored, not wiped", () => {
    const r = asOf(stored("2026-10", 60, "2026-09", 150), "2026-09");
    expect([r.currentMonth, r.currentSeconds, r.previousSeconds]).toEqual(["2026-10", 60, 150]);
  });
});
