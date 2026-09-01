// Verifies the notifier's contract: it must reach the poller, must keep the request alive on a
// serverless runtime, and must NEVER let a failure reach the caller. Run with `bun test`.
//
// One shared server for the whole suite, and no test tears it down — an earlier version stopped
// and restarted it mid-suite, which broke every test that ran after it. Failure modes are provoked
// with the response code and an artificial delay instead.
import { afterAll, describe, expect, test } from "bun:test";

type Received = { path: string; secret: string | null; body: unknown };

let received: Received[] = [];
let respondWith = 200;
let delayMs = 0;

// ALL of this runs at module scope, in this order, and NOT in beforeAll. The module under test
// reads AGENT_NOTIFY_URL / AGENT_TOOLS_SECRET once at import time, and a top-level `await import`
// executes while the module is being evaluated — i.e. BEFORE beforeAll would have run. Setting the
// env in beforeAll left the notifier permanently disabled, so every assertion about a delivered
// request failed while the "never rejects" tests passed trivially. Order matters here.
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    received.push({
      path: new URL(req.url).pathname,
      secret: req.headers.get("x-agent-secret"),
      body: await req.json().catch(() => null),
    });
    if (delayMs) await Bun.sleep(delayMs);
    return new Response("{}", { status: respondWith });
  },
});
process.env.AGENT_NOTIFY_URL = `http://localhost:${server.port}/poller/lead-due`;
process.env.AGENT_TOOLS_SECRET = "test-secret";

const { notifyAgent } = await import("./agentNotify.js");

afterAll(() => server.stop(true));

const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

describe("notifyAgent", () => {
  test("posts the intake id with the shared secret", async () => {
    received = [];
    await notifyAgent({ intakeId: "lead-1" });
    expect(received).toHaveLength(1);
    const [first] = received;
    expect(first?.path).toBe("/poller/lead-due");
    expect(first?.secret).toBe("test-secret");
    expect(first?.body).toEqual({ intakeId: "lead-1" });
  });

  test("passes notBefore through for a deferred callback", async () => {
    received = [];
    await notifyAgent({ intakeId: "lead-2", notBefore: "2026-09-01T18:30:00.000Z" });
    expect(received).toHaveLength(1);
    expect(received[0]?.body).toEqual({
      intakeId: "lead-2",
      notBefore: "2026-09-01T18:30:00.000Z",
    });
  });

  // The whole reason this module exists: a lead dialed late is a delay; a request that FAILS
  // because an unrelated service is down is data loss.
  test("never rejects when the poller returns an error", async () => {
    received = [];
    respondWith = 500;
    try {
      expect(await notifyAgent({ intakeId: "lead-3" }).then(() => "resolved")).toBe("resolved");
    } finally {
      respondWith = 200;
    }
  });

  test("aborts on timeout and still resolves", async () => {
    received = [];
    delayMs = 3500; // longer than the module's 3s timeout
    try {
      expect(await notifyAgent({ intakeId: "lead-4" }).then(() => "resolved")).toBe("resolved");
    } finally {
      delayMs = 0;
    }
  }, 10_000);

  // On a serverless runtime the function can freeze the instant the response is sent, cutting the
  // fetch. waitUntil is what prevents that, so prove we actually hand the promise over.
  test("hands the promise to the platform's waitUntil when present", async () => {
    const handed: Promise<unknown>[] = [];
    (globalThis as never as Record<symbol, unknown>)[REQUEST_CONTEXT] = {
      get: () => ({ waitUntil: (p: Promise<unknown>) => handed.push(p) }),
    };
    try {
      received = [];
      await notifyAgent({ intakeId: "lead-5" });
      expect(handed).toHaveLength(1);
      await handed[0];
      expect(received).toHaveLength(1);
      expect(received[0]?.body).toEqual({ intakeId: "lead-5" });
    } finally {
      delete (globalThis as never as Record<symbol, unknown>)[REQUEST_CONTEXT];
    }
  });

  test("a broken request-context global does not break the request", async () => {
    (globalThis as never as Record<symbol, unknown>)[REQUEST_CONTEXT] = {
      get: () => {
        throw new Error("boom");
      },
    };
    try {
      received = [];
      expect(await notifyAgent({ intakeId: "lead-6" }).then(() => "resolved")).toBe("resolved");
      expect(received).toHaveLength(1); // still delivered, just without waitUntil
    } finally {
      delete (globalThis as never as Record<symbol, unknown>)[REQUEST_CONTEXT];
    }
  });
});
