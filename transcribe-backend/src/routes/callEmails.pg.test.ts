import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Call summary emails: the switch (GET/PUT /business/call-emails) and the email POST /calls sends
// when it is on. Real app, real DDL on PGlite, real session tokens; the mailer's test outbox.
//
// Run: bun test src/routes/callEmails.pg.test.ts

process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const db = await PGlite.create();

// A postgres.js-shaped tagged template over PGlite. A fragment is recognised by its shape rather
// than a private symbol — see `auth/auth.test.ts` for what that guards against when several test
// files share one module registry.
const isFragment = (value: any): boolean =>
  Boolean(value) &&
  typeof value === "object" &&
  Array.isArray(value.strings) &&
  Array.isArray(value.values) &&
  "raw" in value.strings;

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

const makeTag = () => (strings: TemplateStringsArray, ...values: unknown[]) => ({
  strings,
  values,
  then(resolve: any, reject: any) {
    const built = build(strings, values, { n: 0 });
    return db.query(built.text, built.values).then((r) => r.rows).then(resolve, reject);
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

const source = await Bun.file("src/db/client.ts").text();
const body = source.slice(source.indexOf("export async function initDb"), source.indexOf("// On Vercel"));
for (const [, statement = ""] of body.matchAll(/sql`([\s\S]*?)`/g)) {
  try {
    await db.exec(statement);
  } catch (error) {
    throw new Error(`DDL failed: ${statement.trim().slice(0, 90)}\n${(error as Error).message}`);
  }
}

// The phone agent's key and the dashboard's address. Spread over the real env: mock.module is
// process-wide (see usage.test.ts for why a partial env breaks later files).
const AGENT_KEY = "test-agent-key";
const { env: realEnv } = await import("../config/env.js");
await mock.module("../config/env.js", () => ({
  env: { ...realEnv, agentConfigKey: AGENT_KEY, dashboardUrl: "https://dash.test" },
}));

const { createUser } = await import("../db/users.js");
const { createToken } = await import("../auth/session.js");
const { createAgentNumber, assignAgentNumber } = await import("../db/agentNumbers.js");
const { useTestMailer, callSummaryMail } = await import("../email/mailer.js");
type Mail = import("../email/mailer.js").Mail;
const { app } = await import("../app.js");

const hash = "x".repeat(60);
async function account(email: string, role?: "admin" | "user") {
  const user = (await createUser({ email, name: email, passwordHash: hash, role }))!;
  return { id: user.id, email, token: createToken(user.id, user.tokenVersion).token };
}

const admin = await account("admin@tecace.com", "admin");
const owner = await account("owner@harbordental.test");
const other = await account("owner@bakery.test");

const OWNED_LINE = "+12065550100";
const UNOWNED_LINE = "+12065550199";
const line = await createAgentNumber({ phone: OWNED_LINE, label: null });
await assignAgentNumber(line.id, owner.id);
await createAgentNumber({ phone: UNOWNED_LINE, label: null });

const outbox: Mail[] = [];
beforeEach(() => {
  outbox.length = 0;
  useTestMailer(outbox);
});
afterAll(() => useTestMailer(null));

async function send(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const postCall = (dialled: string) =>
  send("POST", "/calls", {
    headers: { "x-agent-key": AGENT_KEY },
    body: {
      dialled,
      caller: "+14255550123",
      callerName: "Jane Doe",
      callbackNumber: "+14255550123",
      request: "Book a cleaning",
      requestedTime: "Tuesday morning",
      summary: "Jane wants a cleaning next week and asked for a call back.",
      outcome: "message",
      durationSeconds: 125,
      turns: [
        { speaker: "agent", text: "Harbor Dental, how can I help?" },
        { speaker: "caller", text: "I'd like a cleaning." },
      ],
    },
  });

const setFor = (who: { token: string }, enabled: boolean, userId?: string) =>
  send("PUT", `/business/call-emails${userId ? `?userId=${userId}` : ""}`, {
    token: who.token,
    body: { enabled },
  });

describe("GET/PUT /business/call-emails", () => {
  it("needs a session", async () => {
    expect((await send("GET", "/business/call-emails")).status).toBe(401);
  });

  it("is off by default and names the account's own email", async () => {
    const res = await send("GET", "/business/call-emails", { token: other.token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, email: other.email });
  });

  it("saves the switch and reads it back", async () => {
    expect((await setFor(other, true)).body).toEqual({ enabled: true, email: other.email });
    expect((await send("GET", "/business/call-emails", { token: other.token })).body.enabled).toBe(true);
    await setFor(other, false);
  });

  it("lets an admin set it for a customer", async () => {
    const res = await setFor(admin, true, other.id);
    expect(res.body).toEqual({ enabled: true, email: other.email });
    expect((await send("GET", "/business/call-emails", { token: other.token })).body.enabled).toBe(true);
    await setFor(admin, false, other.id);
  });

  it("ignores a customer's ?userId= and changes only their own", async () => {
    const res = await setFor(other, true, owner.id);
    expect(res.body.email).toBe(other.email);
    const ownerNow = await send("GET", `/business/call-emails?userId=${owner.id}`, { token: admin.token });
    expect(ownerNow.body.enabled).toBe(false);
    await setFor(other, false);
  });

  it("answers 404 for an account that does not exist", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    expect((await setFor(admin, true, missing)).status).toBe(404);
  });
});

describe("POST /calls sends the summary", () => {
  it("emails the owner when the switch is on", async () => {
    await setFor(owner, true);
    const res = await postCall(OWNED_LINE);
    expect(res.status).toBe(201);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(owner.email);
    expect(outbox[0]!.subject).toBe("New call from Jane Doe");
    expect(outbox[0]!.text).toContain("Request: Book a cleaning");
    expect(outbox[0]!.text).toContain("Outcome: message");
    expect(outbox[0]!.text).toContain("Jane wants a cleaning next week");
    expect(outbox[0]!.text).toContain("View the full transcript: https://dash.test/#/calls");
    // The summary only: the conversation itself stays in the dashboard.
    expect(outbox[0]!.text).not.toContain("how can I help?");
  });

  it("sends nothing when the switch is off", async () => {
    await setFor(owner, false);
    expect((await postCall(OWNED_LINE)).status).toBe(201);
    expect(outbox).toHaveLength(0);
  });

  it("sends nothing for a number nobody owns", async () => {
    await setFor(owner, true);
    expect((await postCall(UNOWNED_LINE)).status).toBe(201);
    expect(outbox).toHaveLength(0);
  });

  it("still stores the call when the mail server fails", async () => {
    await setFor(owner, true);
    useTestMailer(outbox, { fail: true });
    const res = await postCall(OWNED_LINE);
    expect(res.status).toBe(201);
    expect(outbox).toHaveLength(0);
    const stored = await send("GET", "/calls", { token: owner.token });
    expect(stored.body.calls.some((c: { id: string }) => c.id === res.body.call.id)).toBe(true);
  });
});

describe("callSummaryMail", () => {
  const blank = {
    caller: null,
    callerName: null,
    callbackNumber: null,
    callbackRequested: false,
    request: null,
    requestedTime: null,
    outcome: null,
    durationSeconds: null,
    summary: null,
  };

  it("leaves out what the call didn't capture", () => {
    const mail = callSummaryMail("a@b.test", { ...blank, caller: "+14255550123", durationSeconds: 125 });
    expect(mail.subject).toBe("New call from +14255550123");
    expect(mail.text).toContain("Caller: +14255550123");
    expect(mail.text).toContain("Duration: 2:05");
    expect(mail.text).not.toContain("Request:");
    expect(mail.text).not.toContain("Callback number:");
  });

  it("says when the caller wants a callback", () => {
    const mail = callSummaryMail("a@b.test", { ...blank, callbackRequested: true });
    expect(mail.text).toContain("Callback requested: yes");
  });

  it("reads the outcome as words", () => {
    const mail = callSummaryMail("a@b.test", { ...blank, outcome: "transfer_failed" });
    expect(mail.text).toContain("Outcome: transfer failed");
  });

  it("names an unknown caller as such", () => {
    expect(callSummaryMail("a@b.test", blank).subject).toBe("New call from an unknown caller");
  });
});
