import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Service heartbeats from the openai-agent-app processes, through the real routes against a real
// Postgres (PGlite): the agent key guards the write, an admin reads all three services, and a
// service that stops reporting turns offline.
//
// Run: bun test src/routes/agentStatus.pg.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const db = await PGlite.create();

// A postgres.js-shaped tagged template over PGlite: it builds $1..$n and splices a nested fragment
// (sql`business_id`) as text with its values merged, which is what postgres.js itself does. The
// nested-fragment case is not decoration here — `setLifecycleById` leaves a column alone by
// assigning it to itself, and a shim that could not splice would silently test something else.
const FRAGMENT = Symbol("fragment");

// A fragment is recognised by its SHAPE, not by a private symbol.
//
// Module instances are shared across test files in one `bun test` run, while `mock.module` rebinds
// their imports retroactively. So `businessProfiles.ts`'s module-level COLUMNS list can have been
// built by another test file's tag and then be executed by this one's. A shim that recognised only
// its own symbol treated that list as a VALUE, and the query became `SELECT $1 FROM ...` — which
// fails in a way that looks like a bug in the route. Anything carrying a template's `strings` and
// `values` is a fragment, whoever made it.
const isFragment = (value: any): boolean =>
  Boolean(value) &&
  typeof value === "object" &&
  Array.isArray(value.strings) &&
  Array.isArray(value.values) &&
  "raw" in value.strings;

// postgres.js decides a parameter's wire text with `options.serializers[type](x)` (connection.js),
// and `sql.json(x)` tags the parameter as OID 3802. Reproducing that here — with postgres.js's real
// serializer table — is what makes these tests able to catch a double-encoded JSON value.
const TYPES_URL = new URL("../../node_modules/postgres/src/types.js", import.meta.url).href;
const { serializers } = (await import(TYPES_URL)) as {
  serializers: Record<number, (x: unknown) => string>;
};

function bind(value: unknown): unknown {
  const parameter = value as { value?: unknown; type?: number } | null;
  if (parameter && typeof parameter === "object" && "type" in parameter && "value" in parameter) {
    const serialize = serializers[parameter.type as number];
    return serialize ? serialize(parameter.value) : parameter.value;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function build(strings: TemplateStringsArray, values: unknown[], counter: { n: number }) {
  let text = "";
  const out: unknown[] = [];
  strings.forEach((part, i) => {
    text += part;
    if (i >= values.length) return;
    const value = values[i] as any;
    if (isFragment(value)) {
      const inner = build(value.strings, value.values, counter);
      text += inner.text;
      out.push(...inner.values);
    } else {
      counter.n += 1;
      text += "$" + counter.n;
      out.push(bind(value));
    }
  });
  return { text, values: out };
}

const run = async (text: string, values: unknown[]) => (await db.query(text, values)).rows;

const makeTag = () => (strings: TemplateStringsArray, ...values: unknown[]) => ({
  [FRAGMENT]: true,
  strings,
  values,
  then(resolve: any, reject: any) {
    const built = build(strings, values, { n: 0 });
    return run(built.text, built.values).then(resolve, reject);
  },
});

const sqlShim: any = Object.assign(makeTag(), {
  begin: async (fn: (tx: any) => Promise<unknown>) => {
    await db.exec("BEGIN");
    try {
      const out = await fn(makeTag());
      await db.exec("COMMIT");
      return out;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  },
  json: (value: unknown) => ({ value, type: 3802 }),
  end: async () => {},
});

await mock.module("../db/client.js", () => ({
  sql: sqlShim,
  initDb: async () => {},
  ensureDbReady: async () => {},
}));

// initDb closes over client.ts's own `sql`, so mocking the module cannot redirect it. Run the real
// DDL text instead, lifted out of the source — which is the point: these are the real statements,
// including the CHECK constraint and the unique partial index this file leans on.
const source = await Bun.file("src/db/client.ts").text();
const body = source.slice(source.indexOf("export async function initDb"), source.indexOf("// On Vercel"));
for (const [, statement = ""] of body.matchAll(/sql`([\s\S]*?)`/g)) {
  try {
    await db.exec(statement);
  } catch (error) {
    throw new Error(`DDL failed: ${statement.trim().slice(0, 90)}\n${(error as Error).message}`);
  }
}

// ----------------------------------------------------------------------------------------------
// The callers, as real accounts with real session tokens.
//
// NOT a stubbed guard. `mock.module` replaces a module for the whole test run, so a stand-in for
// `auth/guard.js` here is the guard every later test file gets too — which is fine until one of them
// is about authorization, and then it silently tests the stand-in. Minting a token is two lines
// against the users table this file already has, and it costs one query per request.
const { createUser } = await import("../db/users.js");
const { createToken } = await import("../auth/session.js");

async function bearerFor(email: string, role: "admin" | "user"): Promise<string> {
  const user = (await createUser({
    email,
    name: email,
    // Never verified on this path — the token is signed, and a request carries no password.
    passwordHash: "x".repeat(60),
    role,
  }))!;
  return `Bearer ${createToken(user.id, user.tokenVersion).token}`;
}

const ADMIN = await bearerFor("admin@tecace.com", "admin");
const JANE = await bearerFor("jane@tecace.com", "user");

const { env } = await import("../config/env.js");
const settingsEnv = env as unknown as Record<string, unknown>;
const KEY_BEFORE = settingsEnv.agentConfigKey;
const AGENT_KEY = "agent-key-under-test";
settingsEnv.agentConfigKey = AGENT_KEY;
afterAll(async () => {
  settingsEnv.agentConfigKey = KEY_BEFORE;
  await db.close();
});

const { app } = await import("../app.js");

async function send(method: string, path: string, headers: Record<string, string>, payload?: unknown) {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
  return { status: response.status, body: (await response.json()) as any };
}

const beat = (payload: unknown, key: string | null = AGENT_KEY) =>
  send("POST", "/agent/heartbeat", key === null ? {} : { "x-agent-key": key }, payload);
const list = (auth: string = ADMIN) => send("GET", "/agent/heartbeats", { authorization: auth });

describe("agent service heartbeats", () => {
  it("shows all three services as never before anything reports", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.services.map((s: any) => s.service)).toEqual(["server", "poller", "scenarios"]);
    expect(res.body.services.map((s: any) => s.label)).toEqual(["Call server", "Outbound poller", "Scenario runner"]);
    for (const s of res.body.services) {
      expect(s.state).toBe("never");
      expect(s.lastSeenAt).toBeNull();
      expect(s.metrics).toBeNull();
    }
  });

  it("rejects a missing or wrong key with 401", async () => {
    const body = { service: "server", intervalSeconds: 60, ok: true };
    const none = await beat(body, null);
    expect(none.status).toBe(401);
    expect(none.body).toEqual({ error: "unauthorized", message: "Missing or invalid agent key." });
    expect((await beat(body, "wrong")).status).toBe(401);
    expect((await beat(body, AGENT_KEY + "x")).status).toBe(401);
  });

  it("refuses everything when the configured key is empty", async () => {
    settingsEnv.agentConfigKey = "";
    try {
      const body = { service: "server", intervalSeconds: 60, ok: true };
      expect((await beat(body, "")).status).toBe(401);
      expect((await beat(body, null)).status).toBe(401);
    } finally {
      settingsEnv.agentConfigKey = AGENT_KEY;
    }
  });

  it("rejects an unknown service with 400", async () => {
    const res = await beat({ service: "database", intervalSeconds: 60, ok: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unknown_service");
    expect((await beat({ intervalSeconds: 60, ok: true })).status).toBe(400);
  });

  it("marks a healthy server online, with metrics and uptime", async () => {
    const startedAt = new Date(Date.now() - 3600_000).toISOString();
    const res = await beat({
      service: "server",
      intervalSeconds: 60,
      ok: true,
      startedAt,
      host: "vps-1",
      metrics: { activeCalls: 2, version: "1.2", gone: null, bad: { nested: true }, flag: true },
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });

    const server = (await list()).body.services[0];
    expect(server.state).toBe("online");
    expect(server.ok).toBe(true);
    expect(server.intervalSeconds).toBe(60);
    expect(server.host).toBe("vps-1");
    expect(server.secondsSinceSeen).toBeLessThan(5);
    expect(server.uptimeSeconds).toBeGreaterThanOrEqual(3599);
    expect(server.uptimeSeconds).toBeLessThan(3620);
    expect(server.metrics).toEqual({ activeCalls: 2, version: "1.2", gone: null, flag: true });
    const others = (await list()).body.services.slice(1);
    expect(others.map((s: any) => s.state)).toEqual(["never", "never"]);
  });

  it("clamps the interval, trims text and stores null for a bad startedAt", async () => {
    await beat({ service: "scenarios", intervalSeconds: 1, ok: true, startedAt: "not a date", detail: "d".repeat(500), host: "h".repeat(300) });
    const s = (await list()).body.services[2];
    expect(s.intervalSeconds).toBe(10);
    expect(s.startedAt).toBeNull();
    expect(s.uptimeSeconds).toBeNull();
    expect(s.detail).toHaveLength(300);
    expect(s.host).toHaveLength(100);
  });

  it("marks a fresh heartbeat with ok:false as erroring, with its detail", async () => {
    await beat({ service: "poller", intervalSeconds: 60, ok: false, detail: "Sheets quota exceeded" });
    const poller = (await list()).body.services[1];
    expect(poller.state).toBe("erroring");
    expect(poller.ok).toBe(false);
    expect(poller.detail).toBe("Sheets quota exceeded");
  });

  it("marks a stale row offline", async () => {
    // Interval 60 -> window max(150, 120) = 150 s; 10 minutes of silence is well past it.
    await db.exec("UPDATE service_heartbeats SET last_seen_at = now() - interval '10 minutes' WHERE service = 'server'");
    const server = (await list()).body.services[0];
    expect(server.state).toBe("offline");
    expect(server.secondsSinceSeen).toBeGreaterThanOrEqual(599);
    // A new heartbeat brings it back.
    await beat({ service: "server", intervalSeconds: 60, ok: true });
    expect((await list()).body.services[0].state).toBe("online");
  });

  it("is admin only to read", async () => {
    expect((await list(JANE)).status).toBe(403);
    expect((await send("GET", "/agent/heartbeats", {})).status).toBe(401);
  });
});
