import type { BusinessProfile as BusinessRow } from "../db/businessProfiles.js";
import type { Customer } from "../demo/types.js";
import type { SessionRecord } from "./compose.js";

// The two kinds of record a call can be built from, as the one shape the composer takes.

/** A real business: its profile row. Null when it has no structured profile yet. */
export function fromBusinessRow(row: BusinessRow): SessionRecord | null {
  if (!row.profile) return null;
  return {
    profile: row.profile,
    prompts: row.prompts ?? null,
    agentName: row.agentName,
    voice: row.voice,
    language: row.language,
    houseRules: row.houseRules,
    greeting: row.greeting,
    legacyTransferNumber: row.transferNumber,
    legacyTransferTopics: row.transferTopics,
  };
}

/** A demo standing in for a business. It has no typed greeting, instructions or transfer number. */
export function fromDemoCustomer(customer: Customer): SessionRecord {
  return {
    profile: customer.profile,
    prompts: customer.prompts ?? null,
    agentName: customer.agentName || null,
    voice: customer.voice || null,
    language: customer.language ?? null,
  };
}
