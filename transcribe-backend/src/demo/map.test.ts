import { describe, expect, it } from "bun:test";
import { toCallRow, toCustomerRow, toEventRow, toNoteRow } from "./map.js";

// Shaped exactly like customers:<id> in the export, trimmed to what the mapping reads.
const FULL = {
  id: "sE8vbvPuW4vY",
  active: true,
  businessName: "Consulate General of the Republic of Korea",
  label: "Seattle",
  contactName: "Dana Reyes",
  contactEmail: "dana@example.test",
  notes: "Met at the expo",
  websiteUrl: "https://example.test",
  mapsUrl: "https://maps.app.goo.gl/x",
  resolvedMapsUrl: "https://www.google.com/maps/place/x",
  researchNotes: "Ask about hours",
  profile: { name: "Consulate", services: ["visas"] },
  dossier: "# Consulate\n\nNotes.",
  sources: [{ title: "Site", url: "https://example.test" }],
  prompts: { live: "You are Alex", backend: "", greeting: "", edited: false },
  callSound: { ambience: "office" },
  voice: "gleam",
  agentName: "Alex",
  language: "ko",
  demoMinutes: 5,
  stage: "new",
  status: "ready",
  error: "",
  lastContactedAt: "2026-09-21T06:00:00.000Z",
  followUpAt: "2026-09-25T06:00:00.000Z",
  createdAt: "2026-09-21T03:19:45.645Z",
  updatedAt: "2026-09-21T06:15:52.686Z",
  researchedAt: "2026-09-21T06:15:52.686Z",
};

// What most of the real export looks like: the optional half is simply absent.
const MINIMAL = {
  id: "ix-TJazEwZw9",
  active: true,
  businessName: "TecAce Software",
  profile: {},
  dossier: "",
  sources: [],
  prompts: {},
  voice: "gleam",
  agentName: "Alex",
  status: "ready",
  createdAt: "2026-09-20T04:40:00.000Z",
  updatedAt: "2026-09-20T04:41:00.000Z",
};

describe("toCustomerRow", () => {
  it("carries every field across, with instants as Dates", () => {
    const row = toCustomerRow(FULL);
    expect(row.id).toBe("sE8vbvPuW4vY");
    expect(row.businessName).toBe("Consulate General of the Republic of Korea");
    expect(row.operatorNotes).toBe("Met at the expo"); // renamed: `notes` is the CRM list
    expect(row.demoMinutes).toBe(5);
    expect(row.stage).toBe("new");
    expect(row.createdAt).toEqual(new Date("2026-09-21T03:19:45.645Z"));
    expect(row.researchedAt).toEqual(new Date("2026-09-21T06:15:52.686Z"));
    // The blobs pass through untouched — they are only ever read whole.
    expect(row.profile).toEqual({ name: "Consulate", services: ["visas"] });
    expect(row.sources).toEqual([{ title: "Site", url: "https://example.test" }]);
    expect(row.callSound).toEqual({ ambience: "office" });
  });

  it("turns an absent optional into null, not undefined or an empty string", () => {
    const row = toCustomerRow(MINIMAL);
    expect(row.label).toBeNull();
    expect(row.contactName).toBeNull();
    expect(row.operatorNotes).toBeNull();
    expect(row.demoMinutes).toBeNull();
    expect(row.stage).toBeNull();
    expect(row.followUpAt).toBeNull();
    expect(row.researchedAt).toBeNull();
    expect(row.callSound).toBeNull();
    // Absent blobs still have to satisfy NOT NULL.
    expect(row.profile).toEqual({});
    expect(row.sources).toEqual([]);
    expect(row.dossier).toBe("");
  });

  it("treats an empty string as absent for `error`, which the promo writes both ways", () => {
    expect(toCustomerRow(FULL).error).toBeNull();
    expect(toCustomerRow({ ...FULL, error: "Research failed" }).error).toBe("Research failed");
  });

  it("refuses a record with no id or no businessName, rather than writing a useless row", () => {
    expect(() => toCustomerRow({ ...MINIMAL, id: "" })).toThrow(/id/);
    expect(() => toCustomerRow({ ...MINIMAL, businessName: undefined })).toThrow(/businessName/);
  });
});

const CALL = {
  id: "YFtOnvfqvaX5",
  customerId: "sE8vbvPuW4vY",
  liveSessionId: "unknown",
  startedAt: "2026-09-21T05:29:34.043Z",
  endedAt: "2026-09-21T05:33:35.345Z",
  status: "completed",
  durationSec: 241,
  turns: 33,
  endReason: "close_requested",
  isTest: true,
  visitorId: "dd2ac8c3-376a-437f-89aa-4fb4c8f47cda",
  userAgent: "Mozilla/5.0",
  transcript: [{ id: "caller-10000-1", speaker: "caller", text: "Hi", startMs: 10000, endMs: 11200 }],
  review: { tested: "Booking", sentiment: "happy", at: "2026-09-21T05:34:00.000Z", model: "x" },
};

describe("toCallRow", () => {
  it("carries the call across, transcript and review intact", () => {
    const row = toCallRow(CALL);
    expect(row.id).toBe("YFtOnvfqvaX5");
    expect(row.customerId).toBe("sE8vbvPuW4vY");
    expect(row.startedAt).toEqual(new Date("2026-09-21T05:29:34.043Z"));
    expect(row.endedAt).toEqual(new Date("2026-09-21T05:33:35.345Z"));
    expect(row.durationSec).toBe(241);
    expect(row.turns).toBe(33);
    expect(row.isTest).toBe(true);
    expect(row.transcript).toEqual(CALL.transcript);
    expect(row.review).toEqual(CALL.review);
  });

  it("handles a call still running: no end, no duration, no review", () => {
    const row = toCallRow({
      id: "x", customerId: "c", startedAt: "2026-09-21T05:29:34.043Z", status: "started",
    });
    expect(row.endedAt).toBeNull();
    expect(row.durationSec).toBeNull();
    expect(row.turns).toBeNull();
    expect(row.review).toBeNull();
    expect(row.isTest).toBe(false); // absent is not a test call
    expect(row.transcript).toEqual([]); // NOT NULL in the table
  });

  it("refuses a call with no customer, which could not be attached to anything", () => {
    expect(() => toCallRow({ ...CALL, customerId: "" })).toThrow(/customerId/);
  });

  it("refuses a status the table's CHECK would reject, naming it", () => {
    expect(() => toCallRow({ ...CALL, status: "wat" })).toThrow(/status.*wat/);
  });
});

describe("toEventRow", () => {
  // The older format: the legacy global list, ipHash and no visitorId.
  it("maps a legacy event and records which list it came from", () => {
    const row = toEventRow(
      { type: "page_view", customerId: "ix-TJazEwZw9", at: "2026-09-20T04:42:10.049Z", ipHash: "ee5c" },
      "legacy",
    );
    expect(row.customerId).toBe("ix-TJazEwZw9");
    expect(row.type).toBe("page_view");
    expect(row.at).toEqual(new Date("2026-09-20T04:42:10.049Z"));
    expect(row.ipHash).toBe("ee5c");
    expect(row.visitorId).toBeNull();
    expect(row.source).toBe("legacy");
  });

  it("maps a per-customer event, which carries a visitorId instead", () => {
    const row = toEventRow(
      { type: "page_view", customerId: "sE8vbvPuW4vY", at: "2026-09-21T03:50:20.109Z", visitorId: "229f" },
      "customer",
    );
    expect(row.visitorId).toBe("229f");
    expect(row.ipHash).toBeNull();
    expect(row.source).toBe("customer");
  });

  it("refuses an event with no type or no instant", () => {
    expect(() => toEventRow({ customerId: "c", at: "2026-09-20T04:42:10.049Z" }, "legacy")).toThrow(/type/);
    expect(() => toEventRow({ type: "page_view", customerId: "c", at: "nope" }, "legacy")).toThrow(/at/);
  });
});

describe("toNoteRow", () => {
  it("maps a CRM note", () => {
    const row = toNoteRow({ id: "n1", at: "2026-09-21T06:00:00.000Z", text: "Called back" }, "sE8vbvPuW4vY");
    expect(row).toEqual({
      id: "n1",
      customerId: "sE8vbvPuW4vY",
      at: new Date("2026-09-21T06:00:00.000Z"),
      text: "Called back",
    });
  });

  it("refuses a note with no text, which would render as an empty row", () => {
    expect(() => toNoteRow({ id: "n1", at: "2026-09-21T06:00:00.000Z", text: "" }, "c")).toThrow(/text/);
  });
});
