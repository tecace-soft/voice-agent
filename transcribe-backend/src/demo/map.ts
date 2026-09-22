// Redis record -> row object. Pure: no I/O and no SQL, so the shape of the data can be pinned
// without a database. The promo's own field names are on the left (lib/types.ts), ours on the right.

/** A JSON object as it comes out of the dump. */
export type Raw = Record<string, unknown>;

export interface DemoCustomerRow {
  id: string;
  active: boolean;
  businessName: string;
  label: string | null;
  contactName: string | null;
  contactEmail: string | null;
  /** The promo's `Customer.notes`: one free-text operator note, not the CRM note list. */
  operatorNotes: string | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
  resolvedMapsUrl: string | null;
  researchNotes: string | null;
  profile: unknown;
  dossier: string;
  sources: unknown;
  prompts: unknown;
  callSound: unknown;
  voice: string | null;
  agentName: string | null;
  language: string | null;
  demoMinutes: number | null;
  stage: string | null;
  status: string;
  error: string | null;
  lastContactedAt: Date | null;
  followUpAt: Date | null;
  researchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class MappingError extends Error {}

/** A required string. An empty one is as useless as a missing one, so both are refused. */
function required(raw: Raw, field: string): string {
  const value = raw[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new MappingError(`${field} is required (got ${JSON.stringify(value)})`);
  }
  return value;
}

/** An optional string. Absent, null and "" all become null: the promo writes all three. */
function optional(raw: Raw, field: string): string | null {
  const value = raw[field];
  return typeof value === "string" && value !== "" ? value : null;
}

function optionalInt(raw: Raw, field: string): number | null {
  const value = raw[field];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

/** A required instant. A malformed one is a bug worth stopping for, not a null to explain later. */
export function instant(raw: Raw, field: string): Date {
  const value = raw[field];
  const date = typeof value === "string" ? new Date(value) : new Date(NaN);
  if (Number.isNaN(date.getTime())) {
    throw new MappingError(`${field} is not an ISO instant (got ${JSON.stringify(value)})`);
  }
  return date;
}

export function optionalInstant(raw: Raw, field: string): Date | null {
  if (raw[field] === undefined || raw[field] === null || raw[field] === "") return null;
  return instant(raw, field);
}

export function toCustomerRow(raw: Raw): DemoCustomerRow {
  return {
    id: required(raw, "id"),
    active: raw.active !== false, // absent means active, as the promo reads it
    businessName: required(raw, "businessName"),
    label: optional(raw, "label"),
    contactName: optional(raw, "contactName"),
    contactEmail: optional(raw, "contactEmail"),
    operatorNotes: optional(raw, "notes"),
    websiteUrl: optional(raw, "websiteUrl"),
    mapsUrl: optional(raw, "mapsUrl"),
    resolvedMapsUrl: optional(raw, "resolvedMapsUrl"),
    researchNotes: optional(raw, "researchNotes"),
    profile: raw.profile ?? {},
    dossier: typeof raw.dossier === "string" ? raw.dossier : "",
    sources: raw.sources ?? [],
    prompts: raw.prompts ?? {},
    callSound: raw.callSound ?? null,
    voice: optional(raw, "voice"),
    agentName: optional(raw, "agentName"),
    language: optional(raw, "language"),
    demoMinutes: optionalInt(raw, "demoMinutes"),
    stage: optional(raw, "stage"),
    status: optional(raw, "status") ?? "new",
    error: optional(raw, "error"),
    lastContactedAt: optionalInstant(raw, "lastContactedAt"),
    followUpAt: optionalInstant(raw, "followUpAt"),
    researchedAt: optionalInstant(raw, "researchedAt"),
    createdAt: instant(raw, "createdAt"),
    updatedAt: instant(raw, "updatedAt"),
  };
}

/** lib/types.ts CallStatus. Mirrored by the table's CHECK, so a bad one is caught here first. */
export const CALL_STATUSES = ["started", "completed", "failed", "abandoned"] as const;

export interface DemoCallRow {
  id: string;
  customerId: string;
  liveSessionId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  status: string;
  durationSec: number | null;
  turns: number | null;
  endReason: string | null;
  isTest: boolean;
  visitorId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  transcript: unknown;
  review: unknown;
}

export function toCallRow(raw: Raw): DemoCallRow {
  const status = required(raw, "status");
  if (!(CALL_STATUSES as readonly string[]).includes(status)) {
    throw new MappingError(`status ${JSON.stringify(status)} is not one of ${CALL_STATUSES.join(", ")}`);
  }
  return {
    id: required(raw, "id"),
    customerId: required(raw, "customerId"),
    liveSessionId: optional(raw, "liveSessionId"),
    startedAt: instant(raw, "startedAt"),
    endedAt: optionalInstant(raw, "endedAt"),
    status,
    durationSec: optionalInt(raw, "durationSec"),
    turns: optionalInt(raw, "turns"),
    endReason: optional(raw, "endReason"),
    isTest: raw.isTest === true,
    visitorId: optional(raw, "visitorId"),
    ipHash: optional(raw, "ipHash"),
    userAgent: optional(raw, "userAgent"),
    transcript: raw.transcript ?? [],
    review: raw.review ?? null,
  };
}

/** Which list an event came out of. The two eras carry different fields — see the design doc. */
export type EventSource = "legacy" | "customer";

export interface DemoEventRow {
  customerId: string;
  type: string;
  at: Date;
  visitorId: string | null;
  ipHash: string | null;
  source: EventSource;
}

export function toEventRow(raw: Raw, source: EventSource): DemoEventRow {
  return {
    customerId: required(raw, "customerId"),
    type: required(raw, "type"),
    at: instant(raw, "at"),
    visitorId: optional(raw, "visitorId"),
    ipHash: optional(raw, "ipHash"),
    source,
  };
}

export interface DemoNoteRow {
  id: string;
  customerId: string;
  at: Date;
  text: string;
}

/** The customer id comes from the key (`notes:<customerId>`), not from the record. */
export function toNoteRow(raw: Raw, customerId: string): DemoNoteRow {
  return {
    id: required(raw, "id"),
    customerId,
    at: instant(raw, "at"),
    text: required(raw, "text"),
  };
}
