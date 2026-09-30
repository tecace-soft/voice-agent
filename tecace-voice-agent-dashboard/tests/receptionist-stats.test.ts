import { describe, expect, it } from "vitest";
import type { CallMinutes, InboundCall } from "../src/api/types";
import {
  callerLabel,
  callsInWindow,
  inboundCallsPerDay,
  outcomeBadge,
  receptionistKpis,
  talkTime,
} from "../src/demos/lib/receptionistStats";
import { formatHash, parseHash } from "../src/routing";

// Noon local time on 30 Sep 2026, so "today" is unambiguous whatever zone the tests run in.
const NOW = new Date(2026, 8, 30, 12, 0, 0).getTime();

function call(overrides: Partial<InboundCall> & { daysAgo?: number }): InboundCall {
  const { daysAgo = 0, ...rest } = overrides;
  return {
    id: Math.random().toString(36).slice(2),
    userId: "u1",
    dialled: "+15550000000",
    caller: "+15551112222",
    callerName: null,
    callbackNumber: null,
    request: null,
    summary: null,
    outcome: null,
    callbackRequested: false,
    durationSeconds: 60,
    turns: [],
    startedAt: new Date(new Date(2026, 8, 30 - daysAgo, 10, 0, 0).getTime()).toISOString(),
    createdAt: new Date(NOW).toISOString(),
    ...rest,
  };
}

describe("callsInWindow", () => {
  it("keeps today and the days before it, up to the period", () => {
    const calls = [call({ daysAgo: 0 }), call({ daysAgo: 6 }), call({ daysAgo: 7 })];
    expect(callsInWindow(calls, 7, NOW)).toHaveLength(2);
    expect(callsInWindow(calls, 30, NOW)).toHaveLength(3);
  });

  it("skips a call with no usable start time", () => {
    expect(callsInWindow([call({ startedAt: "not a date" })], 7, NOW)).toHaveLength(0);
  });
});

describe("inboundCallsPerDay", () => {
  it("fills every day, oldest first, and counts calls and minutes on their local day", () => {
    const days = inboundCallsPerDay(
      [call({ daysAgo: 0, durationSeconds: 90 }), call({ daysAgo: 0, durationSeconds: 30 }), call({ daysAgo: 2 })],
      3,
      NOW,
    );
    expect(days.map((d) => d.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
    expect(days.map((d) => d.calls)).toEqual([1, 0, 2]);
    expect(days[2]?.minutes).toBe(2);
  });

  it("leaves out calls older than the chart", () => {
    expect(inboundCallsPerDay([call({ daysAgo: 5 })], 3, NOW).every((d) => d.calls === 0)).toBe(true);
  });
});

describe("receptionistKpis", () => {
  it("counts calls, minutes, the average and callbacks", () => {
    const kpis = receptionistKpis([
      call({ durationSeconds: 120, callbackRequested: true }),
      call({ durationSeconds: 60 }),
      call({ durationSeconds: null }),
    ]);
    expect(kpis).toEqual({ calls: 3, minutes: 3, avgCallSec: 60, callbacks: 1 });
  });

  it("is all zeroes with no calls", () => {
    expect(receptionistKpis([])).toEqual({ calls: 0, minutes: 0, avgCallSec: 0, callbacks: 0 });
  });
});

describe("talkTime", () => {
  it("sums this month and last across the rows", () => {
    const row = (currentMinutes: number, previousMinutes: number) =>
      ({ currentMinutes, previousMinutes }) as CallMinutes;
    expect(talkTime([row(10.25, 3), row(4, 1.5)])).toEqual({ current: 14.3, previous: 4.5 });
    expect(talkTime([])).toEqual({ current: 0, previous: 0 });
  });
});

describe("outcomeBadge and callerLabel", () => {
  it("names the agent's outcomes and shows an unknown one as it came", () => {
    expect(outcomeBadge(call({ outcome: "booked" }))).toEqual({ label: "Booked", kind: "positive" });
    expect(outcomeBadge(call({ outcome: "something_new" })).label).toBe("something new");
    expect(outcomeBadge(call({ callbackRequested: true })).label).toBe("Callback");
    expect(outcomeBadge(call({})).label).toBe("Answered");
  });

  it("prefers the name the caller gave, then their number", () => {
    expect(callerLabel(call({ callerName: " Sam " }))).toBe("Sam");
    expect(callerLabel(call({}))).toBe("+15551112222");
    expect(callerLabel(call({ caller: null }))).toBe("Unknown caller");
  });
});

describe("Dashboard › Overview route", () => {
  it("has its own path and carries the business an admin picked", () => {
    expect(parseHash("#/dashboard").view).toBe("dashboard");
    expect(formatHash({ view: "dashboard", mailbox: undefined, customer: "sam@tecace.com" })).toBe(
      "#/dashboard?customer=sam%40tecace.com",
    );
  });
});
