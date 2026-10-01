import { describe, expect, it } from "vitest";
import type { AgentServiceStatus } from "../src/api/types";
import { ago, overallState, serviceLine, serviceStateLabel, serviceTitle, uptime } from "../src/agentServices";

const base: AgentServiceStatus = {
  service: "server", label: "Call server", state: "online", lastSeenAt: "2026-10-01T00:00:00Z",
  secondsSinceSeen: 20, intervalSeconds: 60, ok: true, detail: null, startedAt: null,
  uptimeSeconds: 3 * 3600, host: "vps-1", metrics: null,
};
const svc = (o: Partial<AgentServiceStatus>): AgentServiceStatus => ({ ...base, ...o });

describe("serviceStateLabel", () => {
  it("words every state", () => {
    expect(serviceStateLabel({ state: "online" })).toBe("Running");
    expect(serviceStateLabel({ state: "erroring" })).toBe("Running, with a problem");
    expect(serviceStateLabel({ state: "offline" })).toBe("Stopped reporting");
    expect(serviceStateLabel({ state: "never" })).toBe("Never reported");
  });
});

describe("ago / uptime", () => {
  it("scales units", () => {
    expect(ago(20)).toBe("20 seconds ago");
    expect(ago(600)).toBe("10 minutes ago");
    expect(ago(3 * 3600)).toBe("3 hours ago");
    expect(ago(3 * 86400)).toBe("3 days ago");
    expect(uptime(3 * 3600)).toBe("up 3 h");
    expect(uptime(20 * 60)).toBe("up 20 min");
  });
});

describe("serviceLine", () => {
  it("shows last seen, uptime and active calls", () => {
    expect(serviceLine(svc({ metrics: { activeCalls: 2 } }))).toBe(
      "Last seen 20 seconds ago · up 3 h · 2 active calls",
    );
    expect(serviceLine(svc({ metrics: { activeCalls: 1 } }))).toContain("1 active call");
    expect(serviceLine(svc({ metrics: { activeCalls: 1 } }))).not.toContain("1 active calls");
  });
  it("says running a test or idle for the scenario runner", () => {
    expect(serviceLine(svc({ metrics: { activePass: "pass-3" } }))).toContain("running a test");
    expect(serviceLine(svc({ metrics: { activePass: null } }))).toContain("idle");
  });
  it("adds the detail only when not ok", () => {
    expect(serviceLine(svc({ ok: true, detail: "fine" }))).not.toContain("fine");
    expect(serviceLine(svc({ state: "erroring", ok: false, detail: "OpenAI 429" }))).toContain("OpenAI 429");
  });
  it("handles never reported, and omits uptime when unknown", () => {
    expect(
      serviceLine(svc({ state: "never", secondsSinceSeen: null, uptimeSeconds: null, lastSeenAt: null })),
    ).toMatch(/not reported/);
    expect(serviceLine(svc({ uptimeSeconds: null }))).toBe("Last seen 20 seconds ago");
  });
  it("drops stale metrics once offline", () => {
    expect(
      serviceLine(svc({ state: "offline", secondsSinceSeen: 900, metrics: { activeCalls: 2 } })),
    ).not.toContain("active");
  });
  it("says switched off for a disabled scenario runner, and nothing when enabled", () => {
    expect(serviceLine(svc({ metrics: { enabled: false, activePass: null } }))).toContain("switched off");
    expect(serviceLine(svc({ metrics: { enabled: true } }))).toBe("Last seen 20 seconds ago · up 3 h");
  });
  it("words the poller's wakes, singular and plural", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const at = "2026-10-01T11:57:00Z";
    expect(serviceLine(svc({ metrics: { wakes: 12, lastWakeAt: at } }), now)).toContain("12 wakes · last woke 3 minutes ago");
    expect(serviceLine(svc({ metrics: { wakes: 1, lastWakeAt: at } }), now)).toContain("1 wake · last woke");
    expect(serviceLine(svc({ metrics: { wakes: 5 } }), now)).toContain("5 wakes");
    expect(serviceLine(svc({ metrics: { wakes: 5 } }), now)).not.toContain("last woke");
  });
  it("shows a call error only within the last hour, with the text in the tooltip", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const recent = svc({ metrics: { lastCallError: "Twilio 31005", lastCallErrorAt: "2026-10-01T11:48:00Z" } });
    expect(serviceLine(recent, now)).toContain("a call failed 12 minutes ago");
    expect(serviceLine(recent, now)).not.toContain("Twilio");
    expect(serviceTitle(recent, now)).toBe("Twilio 31005");
    const old = svc({ metrics: { lastCallError: "Twilio 31005", lastCallErrorAt: "2026-10-01T10:00:00Z" } });
    expect(serviceLine(old, now)).toBe("Last seen 20 seconds ago · up 3 h");
    expect(serviceTitle(old, now)).toBeUndefined();
  });
  it("words unknown metrics", () => {
    expect(serviceLine(svc({ metrics: { queuedLeads: 4 } }))).toContain("queued leads 4");
  });
});

describe("overallState", () => {
  it("returns the worst state", () => {
    expect(overallState([svc({}), svc({})])).toBe("online");
    expect(overallState([svc({}), svc({ state: "erroring" })])).toBe("erroring");
    expect(overallState([svc({ state: "erroring" }), svc({ state: "offline" })])).toBe("offline");
    expect(overallState([svc({ state: "erroring" }), svc({ state: "never" })])).toBe("never");
    expect(overallState([svc({ state: "never" }), svc({ state: "offline" })])).toBe("offline");
    expect(overallState([svc({}), svc({ state: "never" })])).toBe("never");
    expect(overallState([])).toBe("never");
  });
});
