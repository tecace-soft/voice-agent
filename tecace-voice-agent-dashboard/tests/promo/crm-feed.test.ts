import { describe, expect, it } from "vitest";
import { activityFeed, stageCounts } from "../../src/demos/lib/analytics";
import type { CallLog, CrmNote, TrackEvent } from "../../src/demos/lib/types";

const customers = [
  { id: "a", name: "Hearth & Home" },
  { id: "b", name: "Tartine Bakery" },
];

const note = (customerId: string, at: string, text: string): CrmNote & {
  customerId: string;
} => ({ id: `n-${at}`, at, text, customerId });

const view = (customerId: string, at: string): TrackEvent => ({
  type: "page_view",
  customerId,
  at,
});

const call = (customerId: string, at: string, over: Partial<CallLog> = {}): CallLog => ({
  id: `c-${customerId}-${at}`,
  customerId,
  liveSessionId: "s",
  startedAt: at,
  status: "completed",
  durationSec: 90,
  transcript: [],
  isTest: false,
  ...over,
});

describe("activityFeed", () => {
  it("merges every prospect into one column, newest first", () => {
    const feed = activityFeed({
      customers,
      notes: [note("a", "2026-09-20T09:00:00.000Z", "called them back")],
      events: [view("b", "2026-09-20T11:00:00.000Z")],
      calls: [call("a", "2026-09-20T10:00:00.000Z")],
    });
    expect(feed.map((entry) => entry.kind)).toEqual(["view", "call", "note"]);
    expect(feed.map((entry) => entry.customerName)).toEqual([
      "Tartine Bakery",
      "Hearth & Home",
      "Hearth & Home",
    ]);
  });

  it("keeps the customer on every row, so a click knows where to go", () => {
    const feed = activityFeed({
      customers,
      notes: [],
      events: [view("b", "2026-09-20T11:00:00.000Z")],
      calls: [],
    });
    expect(feed[0]!.customerId).toBe("b");
  });

  it("drops what belongs to a customer that no longer exists", () => {
    const feed = activityFeed({
      customers,
      notes: [],
      events: [view("deleted", "2026-09-20T12:00:00.000Z")],
      calls: [call("a", "2026-09-20T10:00:00.000Z")],
    });
    expect(feed).toHaveLength(1);
    expect(feed[0]!.customerId).toBe("a");
  });

  it("marks the operator's own test calls as theirs", () => {
    const feed = activityFeed({
      customers,
      notes: [],
      events: [],
      calls: [call("a", "2026-09-20T10:00:00.000Z", { isTest: true })],
    });
    expect(feed[0]!.text).toContain("Your test call");
  });

  it("holds the feed to the limit it was given", () => {
    const events = Array.from({ length: 50 }, (_, index) =>
      view("a", `2026-09-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`),
    );
    expect(activityFeed({ customers, notes: [], events, calls: [] }, 10)).toHaveLength(10);
  });

  it("says nothing rather than breaking when nothing has happened", () => {
    expect(activityFeed({ customers, notes: [], events: [], calls: [] })).toEqual([]);
  });
});

describe("stageCounts", () => {
  it("counts every stage, including the ones nobody is in", () => {
    expect(
      stageCounts([{ stage: "won" as const }, { stage: "won" as const }, { stage: "lost" as const }]),
    ).toEqual({ new: 0, contacted: 0, interested: 0, won: 2, lost: 1 });
  });

  it("treats a prospect with no stage as new, the way normalize does", () => {
    expect(stageCounts([{}, { stage: "contacted" as const }])).toMatchObject({
      new: 1,
      contacted: 1,
    });
  });
});
