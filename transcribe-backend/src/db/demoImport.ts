import type { ParsedDump } from "../demo/dump.js";
import { sql } from "./client.js";

/** How many rows each entity newly inserted. A re-import of the same file reports all zeros. */
export interface ImportCounts {
  customers: number;
  calls: number;
  events: number;
  notes: number;
}

// JSONB columns are passed as text with an explicit ::jsonb cast rather than as objects: an untyped
// parameter resolves to text, and the cast is what makes the intent unambiguous — the same reason
// the counter's upsert casts its parameters.
const json = (value: unknown) => JSON.stringify(value ?? null);

/** Thrown to force a ROLLBACK at the end of a dry run. Never escapes importDump. */
class DryRun extends Error {}

/**
 * Load one parsed dump. Everything goes in ONE transaction: a half-finished import is worse than
 * none, because the Demo numbers would be quietly short and nothing would say so.
 *
 * Every write is an upsert, so a re-run is safe — the export is final, but an import that fails
 * halfway must be runnable again without cleaning up first.
 *
 * `dryRun` does the whole import and then rolls it back. That is deliberate: the counts it reports
 * are the counts a real run would produce, because they were produced — by the same statements,
 * against the same rows, through the same constraints. A dry run that only inspected the file could
 * not tell you that 10 customers are already present and only 2 would be new, and would not notice
 * a CHECK the data violates.
 */
export async function importDump(
  parsed: ParsedDump,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<ImportCounts> {
  let counts: ImportCounts = { customers: 0, calls: 0, events: 0, notes: 0 };
  try {
    counts = await sql.begin(async (tx) => {
    let customers = 0;
    for (const c of parsed.customers) {
      const rows = await tx`
        INSERT INTO demo_customers (
          id, active, business_name, label, contact_name, contact_email, operator_notes,
          website_url, maps_url, resolved_maps_url, research_notes, profile, dossier, sources,
          prompts, call_sound, voice, agent_name, language, demo_minutes, stage, status, error,
          last_contacted_at, follow_up_at, researched_at, created_at, updated_at
        ) VALUES (
          ${c.id}, ${c.active}, ${c.businessName}, ${c.label}, ${c.contactName}, ${c.contactEmail},
          ${c.operatorNotes}, ${c.websiteUrl}, ${c.mapsUrl}, ${c.resolvedMapsUrl}, ${c.researchNotes},
          ${json(c.profile)}::jsonb, ${c.dossier}, ${json(c.sources)}::jsonb, ${json(c.prompts)}::jsonb,
          ${c.callSound === null ? null : json(c.callSound)}::jsonb, ${c.voice}, ${c.agentName},
          ${c.language}, ${c.demoMinutes}, ${c.stage}, ${c.status}, ${c.error},
          ${c.lastContactedAt}, ${c.followUpAt}, ${c.researchedAt}, ${c.createdAt}, ${c.updatedAt}
        )
        ON CONFLICT (id) DO UPDATE SET
          active = EXCLUDED.active, business_name = EXCLUDED.business_name, label = EXCLUDED.label,
          contact_name = EXCLUDED.contact_name, contact_email = EXCLUDED.contact_email,
          operator_notes = EXCLUDED.operator_notes, website_url = EXCLUDED.website_url,
          maps_url = EXCLUDED.maps_url, resolved_maps_url = EXCLUDED.resolved_maps_url,
          research_notes = EXCLUDED.research_notes, profile = EXCLUDED.profile,
          dossier = EXCLUDED.dossier, sources = EXCLUDED.sources, prompts = EXCLUDED.prompts,
          call_sound = EXCLUDED.call_sound, voice = EXCLUDED.voice, agent_name = EXCLUDED.agent_name,
          language = EXCLUDED.language, demo_minutes = EXCLUDED.demo_minutes, stage = EXCLUDED.stage,
          status = EXCLUDED.status, error = EXCLUDED.error,
          last_contacted_at = EXCLUDED.last_contacted_at, follow_up_at = EXCLUDED.follow_up_at,
          researched_at = EXCLUDED.researched_at, created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
        RETURNING (xmax = 0) AS inserted
      `;
      // xmax = 0 on a row the INSERT created; non-zero when ON CONFLICT updated an existing one.
      if ((rows[0] as { inserted: boolean } | undefined)?.inserted) customers += 1;
    }

    let calls = 0;
    for (const c of parsed.calls) {
      const rows = await tx`
        INSERT INTO demo_calls (
          id, customer_id, live_session_id, started_at, ended_at, status, duration_sec, turns,
          end_reason, is_test, visitor_id, ip_hash, user_agent, transcript, review
        ) VALUES (
          ${c.id}, ${c.customerId}, ${c.liveSessionId}, ${c.startedAt}, ${c.endedAt}, ${c.status},
          ${c.durationSec}, ${c.turns}, ${c.endReason}, ${c.isTest}, ${c.visitorId}, ${c.ipHash},
          ${c.userAgent}, ${json(c.transcript)}::jsonb,
          ${c.review === null ? null : json(c.review)}::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          customer_id = EXCLUDED.customer_id, live_session_id = EXCLUDED.live_session_id,
          started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, status = EXCLUDED.status,
          duration_sec = EXCLUDED.duration_sec, turns = EXCLUDED.turns,
          end_reason = EXCLUDED.end_reason, is_test = EXCLUDED.is_test,
          visitor_id = EXCLUDED.visitor_id, ip_hash = EXCLUDED.ip_hash,
          user_agent = EXCLUDED.user_agent, transcript = EXCLUDED.transcript, review = EXCLUDED.review
        RETURNING (xmax = 0) AS inserted
      `;
      if ((rows[0] as { inserted: boolean } | undefined)?.inserted) calls += 1;
    }

    // No target on the conflict: the identity is an expression index, and DO NOTHING against any
    // unique violation is exactly the intent — an event already loaded is simply already loaded.
    let events = 0;
    for (const e of parsed.events) {
      const rows = await tx`
        INSERT INTO demo_call_events (customer_id, type, at, visitor_id, ip_hash, source)
        VALUES (${e.customerId}, ${e.type}, ${e.at}, ${e.visitorId}, ${e.ipHash}, ${e.source})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (rows.length > 0) events += 1;
    }

    let notes = 0;
    for (const n of parsed.notes) {
      const rows = await tx`
        INSERT INTO demo_notes (id, customer_id, at, text)
        VALUES (${n.id}, ${n.customerId}, ${n.at}, ${n.text})
        ON CONFLICT (id) DO UPDATE SET
          customer_id = EXCLUDED.customer_id, at = EXCLUDED.at, text = EXCLUDED.text
        RETURNING (xmax = 0) AS inserted
      `;
      if ((rows[0] as { inserted: boolean } | undefined)?.inserted) notes += 1;
    }

      const written = { customers, calls, events, notes };
      // Thrown AFTER every statement has run, so the rollback undoes real work rather than
      // skipping it. postgres.js rolls the transaction back on any throw.
      if (dryRun) throw Object.assign(new DryRun(), { written });
      return written;
    });
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
    counts = (error as DryRun & { written: ImportCounts }).written;
  }
  return counts;
}
