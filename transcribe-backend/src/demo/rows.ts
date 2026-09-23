// Row object -> the promo's domain object. The exact inverse of `map.ts`, so a record that went
// into the database through that file comes back out of this one identical to what the promo
// stored. Pure: no I/O and no SQL, so the loaders in `src/db/demoRead.ts` only have to select the
// columns and the shapes are already right.
//
// Two rules do all the work:
//
//  * A `null` column becomes an **absent key**, never `null`. The promo's types use optional
//    properties and `analytics.ts` branches on `undefined` (`call.turns ?? call.transcript.length`,
//    `customer.stage ?? "new"`), so a `null` would quietly change the numbers.
//  * A `Date` column becomes an ISO string via `toISOString()` — what the promo stored, and what
//    the screens format.

import type { DemoCallRow, DemoCustomerRow, DemoEventRow, DemoNoteRow } from "./map.js";
import type {
  BusinessProfile,
  CallLog,
  CallReview,
  CallSound,
  CallStatus,
  CrmNote,
  Customer,
  CustomerPrompts,
  CustomerStage,
  CustomerStatus,
  ResearchSource,
  TrackEvent,
  TranscriptEntry,
} from "./types.js";

/**
 * Drop the keys whose value is `undefined`, so an optional field is absent rather than present and
 * empty. `JSON.stringify` would drop them anyway, but the objects are read in process too — by
 * `analytics.ts` and by the tests — and `"turns" in call` is not the same question as
 * `call.turns === undefined`.
 */
function prune<T>(value: T): T {
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) delete record[key];
  }
  return value;
}

export function fromCustomerRow(row: DemoCustomerRow): Customer {
  return prune({
    id: row.id,
    label: row.label ?? undefined,
    contactName: row.contactName ?? undefined,
    contactEmail: row.contactEmail ?? undefined,
    // `operatorNotes` is the promo's `Customer.notes`; the column was renamed on the way in so it
    // could not be confused with the CRM note list, and the name goes back here.
    notes: row.operatorNotes ?? undefined,
    active: row.active,
    businessName: row.businessName,
    websiteUrl: row.websiteUrl ?? undefined,
    mapsUrl: row.mapsUrl ?? undefined,
    resolvedMapsUrl: row.resolvedMapsUrl ?? undefined,
    researchNotes: row.researchNotes ?? undefined,
    profile: row.profile as BusinessProfile,
    dossier: row.dossier,
    sources: row.sources as ResearchSource[],
    prompts: row.prompts as CustomerPrompts,
    // Required in the promo's type and nullable in the column, because the research writes them
    // and an unresearched row has neither. `""` keeps the type honest; the promo never wrote one.
    voice: row.voice ?? "",
    callSound: (row.callSound as CallSound | null) ?? undefined,
    agentName: row.agentName ?? "",
    language: row.language ?? undefined,
    demoMinutes: row.demoMinutes ?? undefined,
    stage: (row.stage as CustomerStage | null) ?? undefined,
    lastContactedAt: row.lastContactedAt?.toISOString(),
    followUpAt: row.followUpAt?.toISOString(),
    status: row.status as CustomerStatus,
    error: row.error ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    researchedAt: row.researchedAt?.toISOString(),
  });
}

export function fromCallRow(row: DemoCallRow): CallLog {
  return prune({
    id: row.id,
    customerId: row.customerId,
    liveSessionId: row.liveSessionId ?? "",
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString(),
    durationSec: row.durationSec ?? undefined,
    status: row.status as CallStatus,
    endReason: row.endReason ?? undefined,
    turns: row.turns ?? undefined,
    transcript: row.transcript as TranscriptEntry[],
    userAgent: row.userAgent ?? undefined,
    ipHash: row.ipHash ?? undefined,
    visitorId: row.visitorId ?? undefined,
    isTest: row.isTest,
    review: (row.review as CallReview | null) ?? undefined,
  });
}

export function fromEventRow(row: DemoEventRow): TrackEvent {
  // `source` says which list the event came out of, not what it is; it is the importer's own
  // bookkeeping and the promo's `TrackEvent` never had it, so it stops here.
  return prune({
    type: row.type as TrackEvent["type"],
    customerId: row.customerId,
    at: row.at.toISOString(),
    ipHash: row.ipHash ?? undefined,
    visitorId: row.visitorId ?? undefined,
  });
}

/** `customerId` came from the key (`notes:<customerId>`) and is not part of a `CrmNote`. */
export function fromNoteRow(row: DemoNoteRow): CrmNote {
  return {
    id: row.id,
    at: row.at.toISOString(),
    text: row.text,
  };
}
