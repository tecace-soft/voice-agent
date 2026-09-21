import { describe, expect, it } from "vitest";
import {
  callsPerDay,
  computeKpis,
  computeStats,
  countableCalls,
  callerSaid,
  gapRollup,
  unreviewedCalls,
  demoAllowance,
  distinctVisitors,
  engagement,
  inFlightCalls,
  inFlightSeconds,
  testCalls,
  withinDays,
  isResearchStalled,
  formatDuration,
  statsByCustomer,
} from "../../src/demos/lib/analytics";
import type { CallLog, CustomerStats, TrackEvent } from "../../src/demos/lib/types";

const NOW = new Date("2026-09-19T12:00:00.000Z").getTime();

function call(overrides: Partial<CallLog> = {}): CallLog {
  return {
    id: "call1",
    customerId: "cust1",
    liveSessionId: "sess1",
    startedAt: new Date(NOW - 60_000).toISOString(),
    status: "completed",
    durationSec: 90,
    transcript: [],
    isTest: false,
    ...overrides,
  };
}

function view(customerId = "cust1", at = new Date(NOW).toISOString()): TrackEvent {
  return { type: "page_view", customerId, at };
}

describe("countableCalls", () => {
  it("keeps finished real calls", () => {
    const calls = [call(), call({ id: "c2", status: "abandoned", durationSec: 10 })];
    expect(countableCalls(calls, NOW)).toHaveLength(2);
  });

  it("drops admin test calls", () => {
    expect(countableCalls([call({ isTest: true })], NOW)).toHaveLength(0);
  });

  it("drops calls still in flight but keeps stale ones", () => {
    const fresh = call({
      id: "fresh",
      status: "started",
      startedAt: new Date(NOW - 5_000).toISOString(),
    });
    const stale = call({
      id: "stale",
      status: "started",
      startedAt: new Date(NOW - 20 * 60_000).toISOString(),
    });
    const kept = countableCalls([fresh, stale], NOW);
    expect(kept.map((entry) => entry.id)).toEqual(["stale"]);
  });
});

describe("computeStats", () => {
  it("sums calls, seconds, and views", () => {
    const stats = computeStats(
      [call(), call({ id: "c2", durationSec: 30 })],
      [view(), view("cust1", new Date(NOW - 3_600_000).toISOString())],
      NOW,
    );
    expect(stats.calls).toBe(2);
    expect(stats.totalSec).toBe(120);
    expect(stats.views).toBe(2);
    expect(stats.lastViewAt).toBe(new Date(NOW).toISOString());
  });

  it("returns zeros with no activity", () => {
    expect(computeStats([], [], NOW)).toEqual({
      views: 0,
      calls: 0,
      totalSec: 0,
      visitors: 0,
      lastCallAt: undefined,
      lastViewAt: undefined,
    });
  });
});

describe("statsByCustomer", () => {
  it("splits activity per customer", () => {
    const stats = statsByCustomer(
      [call(), call({ id: "c2", customerId: "cust2", durationSec: 60 })],
      [view("cust2")],
      NOW,
    );
    expect(stats.cust1!.calls).toBe(1);
    expect(stats.cust1!.views).toBe(0);
    expect(stats.cust2!.views).toBe(1);
    expect(stats.cust2!.totalSec).toBe(60);
  });
});

describe("callsPerDay", () => {
  it("fills empty days and buckets by start date", () => {
    const buckets = callsPerDay([call(), call({ id: "c2", durationSec: 30 })], 7, NOW);
    expect(buckets).toHaveLength(7);
    expect(buckets[0]!.calls).toBe(0);
    expect(buckets[6]!.date).toBe("2026-09-19");
    expect(buckets[6]!.calls).toBe(2);
    expect(buckets[6]!.minutes).toBe(2);
  });
});

describe("computeKpis", () => {
  it("counts only customers with at least one call as tested", () => {
    const stats = statsByCustomer([call()], [view("cust2")], NOW);
    const kpis = computeKpis(["cust1", "cust2", "cust3"], stats);
    expect(kpis.customers).toBe(3);
    expect(kpis.testedCustomers).toBe(1);
    expect(kpis.totalCalls).toBe(1);
    expect(kpis.totalMinutes).toBe(1.5);
    expect(kpis.avgCallSec).toBe(90);
    expect(kpis.totalViews).toBe(1);
  });
});

describe("formatDuration", () => {
  it("renders mm:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(undefined)).toBe("0:00");
    expect(formatDuration(95)).toBe("1:35");
    expect(formatDuration(600)).toBe("10:00");
  });
});

describe("isResearchStalled", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");

  it("leaves a run that only just started alone", () => {
    expect(
      isResearchStalled(
        { status: "researching", updatedAt: "2026-01-01T11:58:00.000Z" },
        now,
      ),
    ).toBe(false);
  });

  it("calls a run stalled once nothing has written for the whole window", () => {
    expect(
      isResearchStalled(
        { status: "researching", updatedAt: "2026-01-01T11:40:00.000Z" },
        now,
      ),
    ).toBe(true);
  });

  it("says nothing about a record that finished", () => {
    expect(
      isResearchStalled({ status: "ready", updatedAt: "2025-01-01T00:00:00.000Z" }, now),
    ).toBe(false);
  });
});

describe("demoAllowance", () => {
  const call = (durationSec: number, extra: Partial<CallLog> = {}): CallLog => ({
    id: "call" + durationSec + (extra.status ?? ""),
    customerId: "abc",
    liveSessionId: "sess",
    startedAt: "2026-01-01T10:00:00.000Z",
    status: "completed",
    durationSec,
    transcript: [],
    isTest: false,
    ...extra,
  });

  it("counts a fresh demo as its full allowance", () => {
    const left = demoAllowance([], 10);
    expect(left.allowedSec).toBe(600);
    expect(left.remainingSec).toBe(600);
    expect(left.exhausted).toBe(false);
  });

  it("spends the seconds that calls actually billed", () => {
    const left = demoAllowance([call(120), call(60)], 10);
    expect(left.usedSec).toBe(180);
    expect(left.remainingSec).toBe(420);
  });

  it("closes the demo once the time is gone", () => {
    const left = demoAllowance([call(400), call(200)], 10);
    expect(left.remainingSec).toBe(0);
    expect(left.exhausted).toBe(true);
  });

  it("never reports a negative remainder when a call overruns", () => {
    expect(demoAllowance([call(900)], 10).remainingSec).toBe(0);
  });

  it("does not spend the prospect's minutes on an admin test call", () => {
    // Trying a customer's own demo is how the operator checks it works.
    const left = demoAllowance([call(300, { isTest: true })], 10);
    expect(left.usedSec).toBe(0);
    expect(left.exhausted).toBe(false);
  });

  it("ignores a call that is still in flight, which has billed nothing yet", () => {
    const live = call(0, { status: "started", startedAt: new Date().toISOString() });
    expect(demoAllowance([live], 10).usedSec).toBe(0);
  });

  it("honours a longer allowance granted to one prospect", () => {
    expect(demoAllowance([call(600)], 30).exhausted).toBe(false);
    expect(demoAllowance([call(600)], 30).remainingSec).toBe(1200);
  });
});

describe("withinDays", () => {
  const now = Date.parse("2026-09-20T12:00:00.000Z");
  const at = (item: { at: string }) => item.at;

  it("keeps what happened inside the period", () => {
    const kept = withinDays(
      [{ at: "2026-09-20T09:00:00.000Z" }, { at: "2026-09-18T09:00:00.000Z" }],
      7,
      at,
      now,
    );
    expect(kept).toHaveLength(2);
  });

  it("drops what fell out of it", () => {
    const kept = withinDays(
      [{ at: "2026-09-19T09:00:00.000Z" }, { at: "2026-08-01T09:00:00.000Z" }],
      7,
      at,
      now,
    );
    expect(kept.map((item) => item.at)).toEqual(["2026-09-19T09:00:00.000Z"]);
  });

  it("drops an unreadable timestamp rather than counting it as now", () => {
    expect(withinDays([{ at: "not a date" }], 30, at, now)).toEqual([]);
  });
});

describe("test calls and the numbers they are missing from", () => {
  const call = (id: string, isTest: boolean): CallLog => ({
    id,
    customerId: "abc",
    liveSessionId: "sess",
    startedAt: "2026-09-20T10:00:00.000Z",
    status: "completed",
    durationSec: 120,
    transcript: [],
    isTest,
  });

  it("counts the operator's own calls separately", () => {
    expect(testCalls([call("a", true), call("b", false), call("c", true)])).toHaveLength(2);
  });

  it("is exactly what countableCalls leaves out", () => {
    const calls = [call("a", true), call("b", false)];
    expect(countableCalls(calls)).toHaveLength(1);
    expect(testCalls(calls)).toHaveLength(1);
  });

  // This is the bug that started it: a call that really happened, tagged as a
  // test because the operator's browser carried an admin cookie, contributing
  // nothing to any number on the dashboard.
  it("reports zero real calls when every call was tagged a test", () => {
    const calls = [call("a", true), call("b", true)];
    expect(countableCalls(calls)).toHaveLength(0);
    expect(testCalls(calls)).toHaveLength(2);
  });
});

describe("distinctVisitors", () => {
  const view = (visitorId?: string): TrackEvent => ({
    type: "page_view",
    customerId: "abc",
    at: "2026-09-20T10:00:00.000Z",
    visitorId,
  });

  it("counts people, not visits", () => {
    expect(distinctVisitors([view("v1"), view("v1"), view("v1")], [])).toBe(1);
  });

  it("counts three people at one business as three", () => {
    expect(distinctVisitors([view("v1"), view("v2"), view("v3")], [])).toBe(3);
  });

  it("treats someone who looked and then called as one person", () => {
    const call = {
      id: "c1",
      customerId: "abc",
      liveSessionId: "s",
      startedAt: "2026-09-20T10:05:00.000Z",
      status: "completed" as const,
      transcript: [],
      isTest: false,
      visitorId: "v1",
    };
    expect(distinctVisitors([view("v1")], [call])).toBe(1);
  });

  it("folds records from before visitor ids into a single unknown", () => {
    expect(distinctVisitors([view(), view(), view("v1")], [])).toBe(2);
  });
});

describe("engagement", () => {
  const now = Date.parse("2026-09-20T12:00:00.000Z");
  const stats = (over: Partial<CustomerStats> = {}): CustomerStats => ({
    views: 0,
    calls: 0,
    totalSec: 0,
    visitors: 0,
    ...over,
  });

  it("calls a prospect who never showed up cold", () => {
    const result = engagement(stats(), [], now);
    expect(result.level).toBe("cold");
    expect(result.reason).toBe("No activity yet");
  });

  it("does not warm up on link opens alone", () => {
    const result = engagement(
      stats({ views: 6, lastViewAt: "2026-09-20T11:00:00.000Z" }),
      [],
      now,
    );
    expect(result.level).toBe("cold");
    expect(result.reason).toContain("never called");
  });

  it("gets hot when someone keeps calling and keeps talking", () => {
    const calls = [1, 2, 3, 4].map((n) => ({
      id: `c${n}`,
      customerId: "abc",
      liveSessionId: "s",
      startedAt: "2026-09-20T10:00:00.000Z",
      status: "completed" as const,
      durationSec: 180,
      turns: 20,
      transcript: [],
      isTest: false,
    }));
    const result = engagement(
      stats({ views: 6, calls: 4, totalSec: 720, lastCallAt: "2026-09-20T10:00:00.000Z" }),
      calls,
      now,
    );
    expect(result.level).toBe("hot");
    expect(result.reason).toContain("4 calls");
    expect(result.reason).toContain("today");
  });

  it("cools the same prospect down once they stop coming back", () => {
    const warmToday = engagement(
      stats({ views: 2, calls: 2, totalSec: 300, lastCallAt: "2026-09-20T09:00:00.000Z" }),
      [],
      now,
    );
    const sameButStale = engagement(
      stats({ views: 2, calls: 2, totalSec: 300, lastCallAt: "2026-07-01T09:00:00.000Z" }),
      [],
      now,
    );
    expect(sameButStale.score).toBeLessThan(warmToday.score);
    expect(sameButStale.reason).toContain("d ago");
  });
});

describe("callerSaid", () => {
  const call = (id: string, texts: string[]): CallLog => ({
    id,
    customerId: "abc",
    liveSessionId: "s",
    startedAt: "2026-09-20T10:00:00.000Z",
    status: "completed",
    isTest: false,
    transcript: texts.map((text, index) => ({
      id: `${id}-${index}`,
      speaker: index % 2 === 0 ? ("caller" as const) : ("receptionist" as const),
      text,
      startMs: index * 1000,
      endMs: index * 1000 + 500,
    })),
  });

  it("keeps what the caller said and drops what the receptionist said", () => {
    expect(
      callerSaid(call("c1", ["Do you deliver?", "We do, within two miles.", "How much?"])),
    ).toBe("Do you deliver? How much?");
  });

  it("puts a sentence back together that a backchannel cut in half", () => {
    // This is the bug the list had: "mm-hm" over the top of someone ends their
    // bubble, so one sentence arrived as several rows starting mid-word.
    expect(
      callerSaid(
        call("c1", [
          "I'd like it sometime next",
          "Mm-hm.",
          "week, I'm pretty flexible",
        ]),
      ),
    ).toBe("I'd like it sometime next week, I'm pretty flexible");
  });

  it("ignores blank fragments the transcript picked up", () => {
    expect(callerSaid(call("c1", ["  ", "x", "Real question"]))).toBe("Real question");
  });

  it("does not leave a space in front of punctuation when joining", () => {
    expect(callerSaid(call("c1", ["Is it open", "Mm.", ", today?"]))).toBe(
      "Is it open, today?",
    );
  });
});

describe("gapRollup", () => {
  const reviewed = (id: string, gaps: string[]): CallLog =>
    call({
      id,
      review: {
        at: "2026-09-20T10:00:00.000Z",
        model: "test",
        tested: "asked about something",
        worked: "",
        struggled: "",
        gaps,
        sentiment: "mixed",
      },
    });

  it("counts the same shortcoming across calls, commonest first", () => {
    const rolled = gapRollup([
      reviewed("a", ["did not know opening hours", "no live calendar"]),
      reviewed("b", ["did not know opening hours"]),
      reviewed("c", ["did not know opening hours"]),
    ]);
    expect(rolled[0]).toMatchObject({ text: "did not know opening hours", count: 3 });
    expect(rolled[0]!.callIds).toEqual(["a", "b", "c"]);
    expect(rolled[1]!.count).toBe(1);
  });

  it("groups past case and a trailing full stop", () => {
    const rolled = gapRollup([
      reviewed("a", ["No live calendar."]),
      reviewed("b", ["no live calendar"]),
    ]);
    expect(rolled).toHaveLength(1);
    expect(rolled[0]!.count).toBe(2);
  });

  it("says nothing about calls nobody reviewed", () => {
    expect(gapRollup([call({ id: "a" }), reviewed("b", [])])).toEqual([]);
  });
});

describe("unreviewedCalls", () => {
  const withCaller = (id: string, lines: number, over: Partial<CallLog> = {}): CallLog =>
    call({
      id,
      transcript: Array.from({ length: lines }, (_, index) => ({
        id: `${id}-${index}`,
        speaker: "caller" as const,
        text: "something",
        startMs: index * 1000,
        endMs: index * 1000 + 500,
      })),
      ...over,
    });

  it("finds a finished call with enough said and no review", () => {
    expect(unreviewedCalls([withCaller("a", 3)]).map((entry) => entry.id)).toEqual(["a"]);
  });

  it("leaves out a call still on the line, and one too short to judge", () => {
    const found = unreviewedCalls([
      withCaller("live", 3, { status: "started" }),
      withCaller("brief", 1),
      withCaller("ok", 2),
    ]);
    expect(found.map((entry) => entry.id)).toEqual(["ok"]);
  });
});

describe("several people on one demo at once", () => {
  const now = Date.parse("2026-09-20T12:00:00.000Z");
  const live = (id: string, startedSecAgo: number, over: Partial<CallLog> = {}): CallLog => ({
    id,
    customerId: "abc",
    liveSessionId: "s",
    startedAt: new Date(now - startedSecAgo * 1000).toISOString(),
    status: "started",
    transcript: [],
    isTest: false,
    ...over,
  });

  it("counts a call that is still on the line", () => {
    expect(Math.round(inFlightSeconds([live("a", 90)], now))).toBe(90);
  });

  it("adds up everyone who is on it right now", () => {
    const seconds = inFlightSeconds([live("a", 60), live("b", 30), live("c", 10)], now);
    expect(Math.round(seconds)).toBe(100);
  });

  it("does not count the operator's own test call against the prospect", () => {
    expect(inFlightSeconds([live("a", 60, { isTest: true })], now)).toBe(0);
  });

  it("stops counting a call that was abandoned without a report", () => {
    // Past the stale window it is written off, and countableCalls picks it up
    // instead; counting it here as well would charge for it twice.
    expect(inFlightSeconds([live("a", 20 * 60)], now)).toBe(0);
  });

  // The bug: the allowance only looked at calls that had already finished, so
  // everyone who dialled together saw a full allowance and got a full call.
  it("spends the allowance while the calls are happening, not after", () => {
    const busy = [live("a", 200), live("b", 200), live("c", 200)];
    const left = demoAllowance(busy, 10, now);
    expect(left.usedSec).toBe(600);
    expect(left.exhausted).toBe(true);
  });

  it("still leaves room when only one person is on a long demo", () => {
    const left = demoAllowance([live("a", 120)], 10, now);
    expect(left.usedSec).toBe(120);
    expect(left.remainingSec).toBe(480);
    expect(left.exhausted).toBe(false);
  });

  it("counts a finished call and a running one together", () => {
    const done: CallLog = {
      id: "done",
      customerId: "abc",
      liveSessionId: "s",
      startedAt: "2026-09-20T11:00:00.000Z",
      status: "completed",
      durationSec: 300,
      transcript: [],
      isTest: false,
    };
    expect(demoAllowance([done, live("a", 60)], 10, now).usedSec).toBe(360);
  });

  it("reports who is on the line, so the session route can cap it", () => {
    const calls = [live("a", 10), live("b", 10), live("c", 10, { isTest: true })];
    expect(inFlightCalls(calls, now).map((call) => call.id)).toEqual(["a", "b"]);
  });
});
