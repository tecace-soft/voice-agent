import { describe, expect, it } from "bun:test";
import { parseDump, DumpError } from "./dump.js";

const customer = (id: string, businessName: string) => ({
  type: "string",
  ttl: -1,
  value: {
    id, businessName, active: true, profile: {}, dossier: "", sources: [], prompts: {},
    voice: "gleam", agentName: "Alex", status: "ready",
    createdAt: "2026-09-20T04:40:00.000Z", updatedAt: "2026-09-20T04:41:00.000Z",
  },
});

const call = (id: string, customerId: string) => ({
  type: "string",
  ttl: -1,
  value: {
    id, customerId, status: "completed", startedAt: "2026-09-20T04:42:19.298Z",
    endedAt: "2026-09-20T04:44:20.204Z", durationSec: 119, turns: 22, isTest: true, transcript: [],
  },
});

const DUMP = {
  exportedAt: "2026-09-22T21:37:19.717Z",
  source: "Upstash Redis (voiceagent-promo)",
  keyCount: 6,
  data: {
    customers: { type: "set", ttl: -1, value: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"] },
    "customers:aaaaaaaaaaaa": customer("aaaaaaaaaaaa", "Harbor Dental"),
    "customers:bbbbbbbbbbbb": customer("bbbbbbbbbbbb", "Cedar Bakery"),
    "calls:aaaaaaaaaaaa": { type: "set", ttl: -1, value: ["c1"] },
    "calls:aaaaaaaaaaaa:c1": call("c1", "aaaaaaaaaaaa"),
    // A Redis list holds JSON strings, not objects — the parser has to cope with both.
    events: {
      type: "list", ttl: -1,
      value: ['{"type":"page_view","customerId":"aaaaaaaaaaaa","at":"2026-09-20T04:42:10.049Z","ipHash":"ee5c"}'],
    },
    "events:bbbbbbbbbbbb": {
      type: "list", ttl: -1,
      value: [{ type: "page_view", customerId: "bbbbbbbbbbbb", at: "2026-09-21T03:50:20.109Z", visitorId: "229f" }],
    },
  },
};

describe("parseDump", () => {
  it("groups the keys into entities", () => {
    const parsed = parseDump(DUMP);
    expect(parsed.customers.map((c) => c.id).sort()).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
    expect(parsed.calls.map((c) => c.id)).toEqual(["c1"]);
    expect(parsed.notes).toEqual([]);
  });

  it("takes events from BOTH lists and tags each with its source", () => {
    const parsed = parseDump(DUMP);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events.filter((e) => e.source === "legacy")).toHaveLength(1);
    expect(parsed.events.filter((e) => e.source === "customer")).toHaveLength(1);
    // The legacy entry was a JSON string inside the list.
    expect(parsed.events.find((e) => e.source === "legacy")?.ipHash).toBe("ee5c");
  });

  it("refuses a file that is not a dump, rather than importing nothing and reporting success", () => {
    expect(() => parseDump({})).toThrow(DumpError);
    expect(() => parseDump({ data: [] })).toThrow(DumpError);
    expect(() => parseDump(null)).toThrow(DumpError);
  });

  it("names every call whose customer is missing, and imports nothing", () => {
    const orphaned = structuredClone(DUMP) as typeof DUMP & { data: Record<string, unknown> };
    orphaned.data["calls:zzzzzzzzzzzz:c2"] = call("c2", "zzzzzzzzzzzz");
    expect(() => parseDump(orphaned)).toThrow(/c2.*zzzzzzzzzzzz/s);
  });

  it("names an event whose customer is missing", () => {
    const orphaned = structuredClone(DUMP) as typeof DUMP & { data: Record<string, unknown> };
    orphaned.data["events:zzzzzzzzzzzz"] = {
      type: "list", ttl: -1,
      value: [{ type: "page_view", customerId: "zzzzzzzzzzzz", at: "2026-09-21T03:50:20.109Z" }],
    };
    expect(() => parseDump(orphaned)).toThrow(/zzzzzzzzzzzz/);
  });
});
