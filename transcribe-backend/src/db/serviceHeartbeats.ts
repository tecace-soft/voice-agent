import { jsonb } from "./jsonb.js";
import { sql } from "./client.js";

// Proof that each openai-agent-app process is still alive: the call server, the outbound poller and
// the scenario runner. Same idea as `heartbeats.ts` (the voicemail poller): one row per key,
// UPSERTed, with liveness worked out at read time from the service's OWN reported interval so a
// config change on the agent can't make this monitor cry wolf.

export const SERVICES = ["server", "poller", "scenarios"] as const;
export type ServiceName = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<ServiceName, string> = {
  server: "Call server",
  poller: "Outbound poller",
  scenarios: "Scenario runner",
};

export type HeartbeatMetrics = Record<string, number | string | boolean | null>;

export interface ServiceHeartbeatRow {
  service: ServiceName;
  lastSeenAt: string;
  secondsSinceSeen: number;
  intervalSeconds: number;
  ok: boolean;
  detail: string | null;
  startedAt: string | null;
  uptimeSeconds: number | null;
  host: string | null;
  metrics: HeartbeatMetrics | null;
  // Derived, not stored.
  stale: boolean;
}

// Missed beats allowed before a service counts as offline, and a floor so a short interval can't
// make the check hair-trigger. Mirrors the voicemail poller's rule.
const STALE_AFTER_CYCLES = 2.5;
const MIN_STALE_SECONDS = 120;

export async function recordServiceHeartbeat(input: {
  service: ServiceName;
  intervalSeconds: number;
  ok: boolean;
  detail: string | null;
  startedAt: string | null;
  host: string | null;
  metrics: HeartbeatMetrics | null;
}): Promise<void> {
  await sql`
    INSERT INTO service_heartbeats (service, last_seen_at, interval_seconds, ok, detail,
                                    started_at, host, metrics)
    VALUES (${input.service}, now(), ${input.intervalSeconds}, ${input.ok}, ${input.detail},
            ${input.startedAt}, ${input.host}, ${jsonb(input.metrics)})
    ON CONFLICT (service) DO UPDATE SET
      last_seen_at     = now(),
      interval_seconds = EXCLUDED.interval_seconds,
      ok               = EXCLUDED.ok,
      detail           = EXCLUDED.detail,
      started_at       = EXCLUDED.started_at,
      host             = EXCLUDED.host,
      metrics          = EXCLUDED.metrics
  `;
}

/** Every row that exists, with staleness and uptime worked out in the query. */
export async function listServiceHeartbeats(): Promise<ServiceHeartbeatRow[]> {
  const rows = (await sql`
    SELECT service,
           last_seen_at AS "lastSeenAt",
           interval_seconds AS "intervalSeconds",
           ok,
           detail,
           started_at AS "startedAt",
           host,
           metrics,
           extract(epoch FROM now() - last_seen_at)::int AS "secondsSinceSeen",
           CASE WHEN started_at IS NULL THEN NULL
                ELSE greatest(extract(epoch FROM now() - started_at), 0)::int END AS "uptimeSeconds",
           -- The ::float8 casts are load-bearing. Parameters go over untyped, so Postgres infers
           -- them from context: next to the INTEGER interval_seconds it infers integer, and then
           -- rejects 2.5 outright with "invalid input syntax for type integer". Casting states the
           -- type rather than leaving it to be guessed from a neighbouring column.
           (extract(epoch FROM now() - last_seen_at)
              > greatest(interval_seconds::float8 * ${STALE_AFTER_CYCLES}::float8,
                         ${MIN_STALE_SECONDS}::float8)) AS stale
    FROM service_heartbeats
  `) as unknown as Array<
    Omit<ServiceHeartbeatRow, "lastSeenAt" | "startedAt"> & {
      lastSeenAt: Date | string;
      startedAt: Date | string | null;
    }
  >;
  const iso = (v: Date | string) => new Date(v).toISOString();
  return rows.map((r) => ({
    ...r,
    lastSeenAt: iso(r.lastSeenAt),
    startedAt: r.startedAt ? iso(r.startedAt) : null,
  }));
}
