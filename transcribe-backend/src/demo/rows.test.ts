import { describe, expect, it } from "bun:test";
import { toCallRow, toCustomerRow, toEventRow, toNoteRow } from "./map.js";
import { fromCallRow, fromCustomerRow, fromEventRow, fromNoteRow } from "./rows.js";

const DUMP = process.env.DEMO_DUMP ?? "data/redis-full-dump-2026-09-22.json";

// Absent optionals are dropped by the promo's own writer too, so compare only the keys it sets.
const defined = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

describe("row -> domain is the inverse of domain -> row", () => {
  it("round-trips every real customer, call and event", async () => {
    const file = Bun.file(DUMP);
    if (!(await file.exists())) return; // the export is git-ignored; skip where it is absent
    const data = (await file.json()).data as Record<string, { value: any }>;
    let customers = 0, calls = 0, events = 0;
    for (const [key, entry] of Object.entries(data)) {
      if (key.startsWith("customers:")) {
        expect(defined(fromCustomerRow(toCustomerRow(entry.value)))).toEqual(defined(entry.value));
        customers += 1;
      } else if (/^calls:[^:]+:[^:]+$/.test(key)) {
        expect(defined(fromCallRow(toCallRow(entry.value)))).toEqual(defined(entry.value));
        calls += 1;
      }
    }
    for (const [key, entry] of Object.entries(data)) {
      if (key !== "events" && !key.startsWith("events:")) continue;
      const source = key === "events" ? "legacy" : "customer";
      for (const raw of (entry.value as unknown[]).map((v) => (typeof v === "string" ? JSON.parse(v) : v))) {
        expect(defined(fromEventRow(toEventRow(raw, source)))).toEqual(defined(raw));
        events += 1;
      }
    }
    expect({ customers, calls, events }).toEqual({ customers: 10, calls: 21, events: 51 });
  });

  // The export carries no `notes:<customerId>` key — the operator wrote none before it was taken —
  // so the fourth mapper has no real record to mirror. It is still the inverse of `toNoteRow`, and
  // the loaders in the next stage read it, so it is pinned here against a record shaped like the
  // promo's `CrmNote` rather than left unexercised.
  it("round-trips a note, which the export has none of", () => {
    const raw = { id: "n1Qc0d3fGh7i", at: "2026-09-18T17:04:11.238Z", text: "Left a voicemail." };
    expect(defined(fromNoteRow(toNoteRow(raw, "5WF6lF21lPnL")))).toEqual(raw);
  });
});
