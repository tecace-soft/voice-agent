import { describe, expect, it } from "bun:test";

// Pure range arithmetic for the ranged usage totals — no database, no clock of its own.
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { MAX_RANGE_DAYS, isSettled, parseRange, startedAtFor } = await import("./range.js");

describe("parseRange", () => {
  it("is absent when neither bound is given", () => {
    expect(parseRange(undefined, undefined)).toEqual({ kind: "absent" });
  });

  it("accepts an offset or Z, and keeps the instant", () => {
    const utc = parseRange("2026-08-15T07:00:00Z", "2026-09-15T07:00:00Z");
    const offset = parseRange("2026-08-15T00:00:00-07:00", "2026-09-15T00:00:00-07:00");
    expect(utc.kind).toBe("range");
    expect(offset.kind).toBe("range");
    if (utc.kind !== "range" || offset.kind !== "range") return;
    expect(utc.from.toISOString()).toBe("2026-08-15T07:00:00.000Z");
    expect(offset.from.getTime()).toBe(utc.from.getTime());
  });

  it("refuses one bound without the other", () => {
    expect(parseRange("2026-08-15T07:00:00Z", undefined)).toEqual({ kind: "error", error: "invalid_range" });
    expect(parseRange(undefined, "2026-09-15T07:00:00Z")).toEqual({ kind: "error", error: "invalid_range" });
  });

  it("refuses a malformed timestamp", () => {
    expect(parseRange("last tuesday", "2026-09-15T07:00:00Z").kind).toBe("error");
    expect(parseRange("2026-13-45T00:00:00Z", "2026-09-15T07:00:00Z").kind).toBe("error");
    // A date with no time has no instant: two callers in two timezones would mean different things.
    expect(parseRange("2026-08-15", "2026-09-15").kind).toBe("error");
  });

  it("refuses a day the month does not have, rather than rolling it over", () => {
    // Date reads these as 2 March, 1 March and 1 May — a boundary that quietly moved is worse than
    // one that was refused, so they are errors rather than answers about another day.
    const to = "2026-09-15T07:00:00Z";
    expect(parseRange("2026-02-30T00:00:00Z", to).kind).toBe("error");
    expect(parseRange("2026-02-29T00:00:00Z", to).kind).toBe("error"); // 2026 is not a leap year
    expect(parseRange("2026-04-31T00:00:00Z", to).kind).toBe("error");
    // A real leap day in a real leap year still parses, as does the last day of a 31-day month.
    expect(parseRange("2024-02-29T00:00:00Z", "2024-03-01T00:00:00Z").kind).toBe("range");
    expect(parseRange("2026-01-31T00:00:00Z", "2026-02-01T00:00:00Z").kind).toBe("range");
  });

  it("refuses a reversed or empty window", () => {
    expect(parseRange("2026-09-15T07:00:00Z", "2026-08-15T07:00:00Z")).toEqual({ kind: "error", error: "invalid_range" });
    expect(parseRange("2026-09-15T07:00:00Z", "2026-09-15T07:00:00Z")).toEqual({ kind: "error", error: "invalid_range" });
  });

  it("refuses a window longer than the maximum", () => {
    const from = "2026-01-01T00:00:00Z";
    const ok = new Date(Date.parse(from) + MAX_RANGE_DAYS * 86400_000).toISOString();
    const tooLong = new Date(Date.parse(from) + (MAX_RANGE_DAYS * 86400_000) + 1000).toISOString();
    expect(parseRange(from, ok).kind).toBe("range");
    expect(parseRange(from, tooLong)).toEqual({ kind: "error", error: "range_too_long" });
  });
});

describe("isSettled", () => {
  const to = new Date("2026-09-15T07:00:00Z");

  it("is unsettled until the window has passed", () => {
    expect(isSettled(to, new Date("2026-09-15T07:30:00Z"), 3600)).toBe(false);
  });

  it("is settled once it has", () => {
    expect(isSettled(to, new Date("2026-09-15T08:00:00Z"), 3600)).toBe(true);
    expect(isSettled(to, new Date("2026-09-15T09:00:00Z"), 3600)).toBe(true);
  });
});

describe("startedAtFor", () => {
  const reportedAt = new Date("2026-09-15T07:00:00Z");

  it("derives the start from the report when none is sent", () => {
    expect(startedAtFor(undefined, 90, reportedAt).toISOString()).toBe("2026-09-15T06:58:30.000Z");
  });

  it("uses a sensible reported start", () => {
    expect(startedAtFor("2026-09-15T06:55:00Z", 90, reportedAt).toISOString()).toBe("2026-09-15T06:55:00.000Z");
  });

  it("ignores a start that can't be right, rather than moving usage into another month", () => {
    // A clock ahead of ours, a clock far behind, and nonsense: all fall back to the derived value.
    const derived = "2026-09-15T06:58:30.000Z";
    expect(startedAtFor("2026-09-15T07:30:00Z", 90, reportedAt).toISOString()).toBe(derived);
    expect(startedAtFor("2026-09-13T07:00:00Z", 90, reportedAt).toISOString()).toBe(derived);
    expect(startedAtFor("whenever", 90, reportedAt).toISOString()).toBe(derived);
  });
});
