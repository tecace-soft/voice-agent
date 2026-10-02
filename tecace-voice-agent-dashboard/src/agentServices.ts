import type { AgentServiceStatus } from "./api/types";

// Words for the "Voice agent services" panel. Pure, so tests/agent-services.test.ts can pin the copy
// without a DOM.

export type ServiceState = AgentServiceStatus["state"];

export const SERVICE_STATE_LABEL: Record<ServiceState, string> = {
  online: "Running",
  erroring: "Running, with a problem",
  offline: "Stopped reporting",
  never: "Never reported",
};

export function serviceStateLabel(s: Pick<AgentServiceStatus, "state">): string {
  return SERVICE_STATE_LABEL[s.state];
}

export function ago(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} seconds ago`;
  const mins = Math.round(seconds / 60);
  if (mins < 90) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`;
}

export function uptime(seconds: number): string {
  if (seconds < 90) return `up ${Math.max(0, Math.round(seconds))} s`;
  const mins = Math.round(seconds / 60);
  if (mins < 90) return `up ${mins} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `up ${hours} h` : `up ${Math.round(hours / 24)} d`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "activeCalls" -> "active calls". Only used for metrics this panel has no wording for.
const humanise = (key: string) => key.replace(/([A-Z])/g, " $1").toLowerCase();

const HOUR_MS = 3_600_000;

// Seconds since an ISO timestamp, or null when it is missing or unparseable.
function secondsSince(iso: unknown, now: number): number | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((now - t) / 1000));
}

// A call error is only news for an hour; after that it is history and the line stays quiet.
function recentCallErrorAge(m: Record<string, number | string | boolean | null>, now: number): number | null {
  const age = secondsSince(m.lastCallErrorAt, now);
  return age !== null && age * 1000 <= HOUR_MS && m.lastCallError ? age : null;
}

export function metricsLine(s: Pick<AgentServiceStatus, "metrics">, now: number = Date.now()): string[] {
  const m = s.metrics;
  if (!m) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(m)) {
    if (key === "activeCalls") {
      if (typeof value === "number") out.push(plural(value, "active call", "active calls"));
    } else if (key === "activePass") {
      out.push(value === null || value === undefined || value === "" ? "idle" : "running a test");
    } else if (key === "enabled") {
      // Switched off on purpose is not a fault; "enabled: true" is the normal case and says nothing.
      if (value === false) out.push("switched off");
    } else if (key === "wakes") {
      if (typeof value === "number") {
        const woke = secondsSince(m.lastWakeAt, now);
        const count = plural(value, "wake", "wakes");
        out.push(woke === null ? count : `${count} · last woke ${ago(woke)}`);
      }
    } else if (key === "lastCallError") {
      const age = recentCallErrorAge(m, now);
      if (age !== null) out.push(`a call failed ${ago(age)}`);
    } else if (key === "lastWakeAt" || key === "lastCallErrorAt") {
      // Folded into the wakes / lastCallError wording above.
    } else if (value !== null && value !== undefined && value !== "") {
      out.push(`${humanise(key)} ${value}`);
    }
  }
  return out;
}

// The text of a recent call error, for a tooltip. Kept out of the line itself: it can be long.
export function serviceTitle(s: Pick<AgentServiceStatus, "metrics">, now: number = Date.now()): string | undefined {
  const m = s.metrics;
  if (!m || recentCallErrorAge(m, now) === null) return undefined;
  return String(m.lastCallError);
}

export function serviceLine(s: AgentServiceStatus, now: number = Date.now()): string {
  if (s.state === "never" || s.secondsSinceSeen === null) {
    return "Has not reported yet. Check that the service is deployed and running.";
  }
  const parts = [`Last seen ${ago(s.secondsSinceSeen)}`];
  if (s.uptimeSeconds !== null) parts.push(uptime(s.uptimeSeconds));
  // Metrics describe a live process; once it has gone quiet they are stale, so they are dropped.
  if (s.state !== "offline") parts.push(...metricsLine(s, now));
  if (s.ok !== true && s.detail) parts.push(s.detail);
  return parts.join(" · ");
}

// Worst first: a stopped service, then one that never reported (usually not deployed, which matters
// more than a soft problem), then one that is running with a problem.
const SEVERITY: ServiceState[] = ["offline", "never", "erroring", "online"];

export function overallState(services: Pick<AgentServiceStatus, "state">[]): ServiceState {
  if (services.length === 0) return "never";
  return SEVERITY.find((st) => services.some((s) => s.state === st)) ?? "online";
}
