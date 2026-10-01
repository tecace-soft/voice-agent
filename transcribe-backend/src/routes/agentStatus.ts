import { timingSafeEqual } from "node:crypto";
import { Elysia, t } from "elysia";
import { authenticateAdmin } from "../auth/guard.js";
import { env } from "../config/env.js";
import {
  listServiceHeartbeats,
  recordServiceHeartbeat,
  SERVICE_LABELS,
  SERVICES,
  type HeartbeatMetrics,
  type ServiceName,
} from "../db/serviceHeartbeats.js";

// Is each openai-agent-app process alive? The three processes (call server, outbound poller,
// scenario runner) POST here every ~60 s with AGENT_CONFIG_KEY; an admin reads the result. A process
// that stops posting counts as down. Dashboard only: nothing here emails or schedules anything.

const err = (error: string, message: string) => ({ error, message });

/** Constant-time compare; an empty configured key never matches. */
function validAgentKey(given: string | undefined): boolean {
  const expected = env.agentConfigKey;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const isService = (v: unknown): v is ServiceName => SERVICES.includes(v as ServiceName);

function cleanMetrics(raw: unknown): HeartbeatMetrics | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: HeartbeatMetrics = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= 10) break;
    if (value === null) out[key] = null;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string") out[key] = value.slice(0, 100);
    // Flags such as the scenario runner's `enabled: false` (switched off on purpose, not a fault).
    else if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export const agentStatus = new Elysia({ prefix: "/agent" })
  .post(
    "/heartbeat",
    async ({ headers, body, status }) => {
      if (!validAgentKey(headers["x-agent-key"])) {
        return status(401, err("unauthorized", "Missing or invalid agent key."));
      }
      const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
      if (!isService(b.service)) {
        return status(400, err("unknown_service", `service must be one of: ${SERVICES.join(", ")}.`));
      }
      const interval = Number(b.intervalSeconds);
      const intervalSeconds = Number.isFinite(interval)
        ? Math.min(3600, Math.max(10, Math.round(interval)))
        : 60;
      const started = typeof b.startedAt === "string" ? new Date(b.startedAt) : null;
      await recordServiceHeartbeat({
        service: b.service,
        intervalSeconds,
        ok: b.ok === true,
        detail: typeof b.detail === "string" ? b.detail.slice(0, 300) : null,
        startedAt: started && !Number.isNaN(started.getTime()) ? started.toISOString() : null,
        host: typeof b.host === "string" ? b.host.slice(0, 100) : null,
        metrics: cleanMetrics(b.metrics),
      });
      return { ok: true };
    },
    { body: t.Optional(t.Unknown()) },
  )

  // Admin only: hostnames and internal error text are ours, not the customer's.
  .get("/heartbeats", async ({ headers, status }) => {
    const caller = await authenticateAdmin(headers.authorization, "Only an admin can see service status.");
    if ("denied" in caller) return status(caller.denied, caller.body);
    const rows = new Map((await listServiceHeartbeats()).map((r) => [r.service, r]));
    // Always all three, in a fixed order, including services that have never reported.
    const services = SERVICES.map((service) => {
      const r = rows.get(service);
      return {
        service,
        label: SERVICE_LABELS[service],
        state: !r ? "never" : r.stale ? "offline" : !r.ok ? "erroring" : "online",
        lastSeenAt: r?.lastSeenAt ?? null,
        secondsSinceSeen: r?.secondsSinceSeen ?? null,
        intervalSeconds: r?.intervalSeconds ?? null,
        ok: r?.ok ?? null,
        detail: r?.detail ?? null,
        startedAt: r?.startedAt ?? null,
        uptimeSeconds: r?.uptimeSeconds ?? null,
        host: r?.host ?? null,
        metrics: r?.metrics ?? null,
      };
    });
    return { services };
  });
