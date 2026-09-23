import {
  toCallRow, toCustomerRow, toEventRow, toNoteRow,
  type DemoCallRow, type DemoCustomerRow, type DemoEventRow, type DemoNoteRow, type Raw,
} from "./map.js";

// The export's own envelope: { exportedAt, source, keyCount, data }, where data maps a Redis key to
// { type, ttl, value }. Only `data` matters here.

export class DumpError extends Error {}

interface Entry {
  type: string;
  value: unknown;
}

export interface ParsedDump {
  customers: DemoCustomerRow[];
  calls: DemoCallRow[];
  events: DemoEventRow[];
  notes: DemoNoteRow[];
}

/** A Redis list holds strings; an export may have parsed them already. Accept both. */
function listEntries(value: unknown): Raw[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item !== "string") return item as Raw;
    try {
      return JSON.parse(item) as Raw;
    } catch {
      throw new DumpError(`a list entry is not JSON: ${item.slice(0, 80)}`);
    }
  });
}

/** A key only a Redis export of this shape would carry. */
const EXPORT_KEY = /^(customers|events)(:|$)|^calls:/;

/**
 * The export has been seen in two shapes. The 2026-09-22 one wrapped everything in
 * `{ exportedAt, source, keyCount, data }`; a later one is the key map on its own, and its entries
 * carry `{ type, value }` with no `ttl`. Both are accepted — `ttl` was never read.
 *
 * What is NOT relaxed is refusing a file that is not an export at all. Importing zero rows and
 * reporting success is the failure this check exists to prevent, so a bare object still has to
 * carry at least one key that looks like one of Redis's.
 */
function entriesOf(input: unknown): Record<string, Entry> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new DumpError("not a Redis export: expected an object");
  }
  const wrapped = (input as { data?: unknown }).data;
  const map =
    wrapped !== null && typeof wrapped === "object" && !Array.isArray(wrapped) ? wrapped : input;
  const keys = Object.keys(map as object);
  if (!keys.some((k) => EXPORT_KEY.test(k))) {
    throw new DumpError(
      "not a Redis export: no customers, calls or events keys (looked at " +
        `${keys.length} key(s)`,
    );
  }
  return map as Record<string, Entry>;
}

export function parseDump(input: unknown): ParsedDump {
  const entries = entriesOf(input);

  const customers: DemoCustomerRow[] = [];
  const calls: DemoCallRow[] = [];
  const events: DemoEventRow[] = [];
  const notes: DemoNoteRow[] = [];

  for (const [key, entry] of Object.entries(entries)) {
    const value = entry?.value;
    // `customers` and `calls:<id>` are sets of ids — indexes into the records, nothing to import.
    if (key === "customers" || /^calls:[^:]+$/.test(key)) continue;

    if (key.startsWith("customers:")) {
      customers.push(toCustomerRow(value as Raw));
    } else if (/^calls:[^:]+:[^:]+$/.test(key)) {
      calls.push(toCallRow(value as Raw));
    } else if (key === "events") {
      for (const raw of listEntries(value)) events.push(toEventRow(raw, "legacy"));
    } else if (key.startsWith("events:")) {
      for (const raw of listEntries(value)) events.push(toEventRow(raw, "customer"));
    } else if (key.startsWith("notes:")) {
      const customerId = key.slice("notes:".length);
      for (const raw of listEntries(value)) notes.push(toNoteRow(raw, customerId));
    }
    // Anything else is a key this importer does not know about; leaving it is deliberate.
  }

  // Referential integrity up front: the alternative is dropping rows at INSERT time, where a
  // missing prospect becomes a foreign-key error with no indication of which record caused it.
  const known = new Set(customers.map((c) => c.id));
  const orphans = [
    ...calls.filter((c) => !known.has(c.customerId)).map((c) => `call ${c.id} -> ${c.customerId}`),
    ...events.filter((e) => !known.has(e.customerId)).map((e) => `event ${e.type}@${e.at.toISOString()} -> ${e.customerId}`),
    ...notes.filter((n) => !known.has(n.customerId)).map((n) => `note ${n.id} -> ${n.customerId}`),
  ];
  if (orphans.length > 0) {
    throw new DumpError(`${orphans.length} record(s) name a customer the dump does not contain:\n  ${orphans.join("\n  ")}`);
  }

  return { customers, calls, events, notes };
}
