import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// The guided setup interview, through the real routes against a real Postgres (PGlite), with OpenAI
// stubbed at `fetch` by a queue of scripted /responses answers in the raw REST `output[]` shape — no
// request leaves the process.
//
// What matters: the server runs the whole tool loop in one request, a refused write goes back to the
// model and a corrected one lands in the DRAFT (never published), a turn that loses OpenAI half-way
// keeps what it saved, and the limits (turn cap, burst, demo stage) refuse before a model is called.
//
// Run: bun test src/routes/setup.pg.test.ts
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

/** Runs once, just before the next query whose text contains `match`: a write landing mid-route. */
let beforeQuery: { match: string; run: () => Promise<void> } | null = null;

const run = async (text: string, values: unknown[]) => {
  const hook = beforeQuery;
  if (hook && text.includes(hook.match)) {
    beforeQuery = null;
    await hook.run();
  }
  return (await db.query(text, values)).rows;
};

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
const BOB = await bearerFor("bob@tecace.com", "user");
// Their own accounts, so the turn cap and the burst limit are not spent by the other scenarios.
const CAROL = await bearerFor("carol@tecace.com", "user");
const DAVE = await bearerFor("dave@tecace.com", "user");

const { env } = await import("../config/env.js");
const settingsEnv = env as unknown as Record<string, unknown>;
const TEST_ENV: Record<string, unknown> = {
  openaiApiKey: "sk-test-not-a-real-key",
  openaiBaseUrl: "https://openai.invalid/v1",
  // A gpt-5 name, so the request asks for encrypted reasoning back and the echo can be checked.
  setupAssistantModel: "gpt-5-setup-under-test",
  setupMaxTurns: 4,
  setupDailyTurnCap: 0,
};
const ENV_BEFORE = Object.fromEntries(Object.keys(TEST_ENV).map((k) => [k, settingsEnv[k]]));
Object.assign(settingsEnv, TEST_ENV);

// ----------------------------------------------------------------------------------------------
// OpenAI: a queue of scripted /responses answers, in the raw REST shape (no `output_text`).
type Attempt = { url: string; body: any };
const attempts: Attempt[] = [];
type Responder = () => Response;
const responders: Responder[] = [];
/** Answers when the queue is empty; null = an unscripted call fails the test loudly. */
let fallback: Responder | null = null;

const answer =
  (...output: unknown[]): Responder =>
  () =>
    Response.json({ id: "resp_x", output, usage: { input_tokens: 1, output_tokens: 1 } });
const msg = (text: string) => ({
  type: "message",
  id: "msg_1",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});
const fc = (name: string, args: Record<string, unknown>, callId = "call_1") => ({
  type: "function_call",
  id: `fc_${callId}`,
  call_id: callId,
  name,
  arguments: JSON.stringify(args),
  status: "completed",
});
const REASONING = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "abc" };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
  const url = typeof input === "string" ? input : input.url;
  attempts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
  if (url.endsWith("/responses")) {
    const next = responders.shift() ?? fallback;
    if (next) return next();
    return Response.json({ error: { message: "no scripted answer" } }, { status: 500 });
  }
  return new Response("unexpected", { status: 500 });
}) as typeof fetch;

afterAll(async () => {
  globalThis.fetch = realFetch;
  Object.assign(settingsEnv, ENV_BEFORE);
  await db.close();
});

const { app } = await import("../app.js");
const { findUserByEmail, setLifecycleById } = await import("../db/users.js");
const { saveProfile } = await import("../db/businessProfiles.js");
const { createAgentNumber, assignAgentNumber } = await import("../db/agentNumbers.js");
const { findActiveSetupSession, saveSetupTurn } = await import("../db/setupSessions.js");
type SetupMessage = import("../setup/types.js").SetupMessage;

const jane = (await findUserByEmail("jane@tecace.com"))!;
const bob = (await findUserByEmail("bob@tecace.com"))!;
const carol = (await findUserByEmail("carol@tecace.com"))!;
const dave = (await findUserByEmail("dave@tecace.com"))!;

async function seedProfile(userId: string, name: string) {
  await saveProfile(
    userId,
    `${name}.`,
    { businessName: name, hoursText: null, openHour: null, closeHour: null, website: null, facts: "Cuts." },
    { transferNumber: null, agentName: "Mia", greeting: null, transferTopics: null, houseRules: null },
    {
      profile: { name, category: "Hair salon", address: "1 A St, Tacoma, WA", hours: [], services: [], highlights: [], policies: {}, faqs: [] },
      prompts: null as never,
      voice: "gleam",
      language: null,
    },
  );
}
await seedProfile(jane.id, "Jane's Salon");
await seedProfile(carol.id, "Carol's Cuts");
await seedProfile(dave.id, "Dave's Barbers");
await assignAgentNumber((await createAgentNumber({ phone: "+12065550100", label: "Jane" })).id, jane.id);

async function call(method: string, path: string, auth: string, payload?: unknown) {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: auth, "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
  return { status: response.status, body: (await response.json()) as any };
}

const turn = (auth: string, message: string, query = "") => call("POST", `/business/setup/turn${query}`, auth, { message });
const sent = (from: number) => attempts.slice(from).filter((a) => a.url.endsWith("/responses"));
const outputsIn = (input: any[]) =>
  input.filter((i) => i.type === "function_call_output").map((i) => ({ callId: i.call_id, ...JSON.parse(i.output) }));

const TOOL_NAMES = [
  "get_current_setup",
  "upsert_transfer_scenario",
  "remove_transfer_scenario",
  "upsert_message_scenario",
  "remove_message_scenario",
  "set_appointments",
  "set_timezone",
  "mark_topic",
  "finish_interview",
];

describe("guided setup interview", () => {
  it("says why it is unavailable, and refuses a stranger", async () => {
    const anonymous = await call("GET", "/business/setup", "");
    expect(anonymous.status).toBe(401);

    const noProfile = await call("GET", "/business/setup", BOB);
    expect(noProfile.status).toBe(200);
    expect(noProfile.body).toMatchObject({ session: null, available: false, unavailableReason: "no_profile", dirty: false });
    expect(noProfile.body.draft.transfer.scenarios).toEqual([]);

    settingsEnv.openaiApiKey = undefined;
    try {
      const noKey = await call("GET", "/business/setup", JANE);
      expect(noKey.body).toMatchObject({ available: false, unavailableReason: "no_openai_key" });
    } finally {
      settingsEnv.openaiApiKey = TEST_ENV.openaiApiKey;
    }

    const ready = await call("GET", "/business/setup", JANE);
    expect(ready.body).toMatchObject({ session: null, available: true });
    expect(ready.body.unavailableReason).toBeUndefined();
  });

  it("opens the conversation with one model call and no user message", async () => {
    const from = attempts.length;
    responders.push(answer(msg("Hi! I'll help you set up who gets calls. Who should billing go to?")));
    const res = await turn(JANE, "");
    expect(res.status).toBe(200);

    const requests = sent(from);
    expect(requests).toHaveLength(1);
    const req = requests[0]!.body;
    expect(req.model).toBe("gpt-5-setup-under-test");
    expect(req.store).toBe(false);
    expect(req.parallel_tool_calls).toBe(false);
    expect(req.include).toEqual(["reasoning.encrypted_content"]);
    expect(req.tools.map((t: { name: string }) => t.name)).toEqual(TOOL_NAMES);
    expect(req.instructions).toContain("Jane's Salon");
    expect(req.instructions).toContain("cannot");
    expect(req.instructions).toContain("DATA about the business");
    expect(req.input).toHaveLength(1);
    expect(req.input[0]).toMatchObject({ type: "message", role: "user" });
    expect(req.input[0].content[0].text).toContain("just opened the setup assistant");

    expect(res.body.session.turnCount).toBe(1);
    expect(res.body.session.maxTurns).toBe(4);
    expect(res.body.session.messages).toHaveLength(1);
    expect(res.body.session.messages[0].role).toBe("assistant");
    expect(res.body.reply.text).toContain("Who should billing go to?");
    expect(res.body.draft.transfer.scenarios).toEqual([]);
    expect(res.body.dirty).toBe(false);
    expect(responders).toHaveLength(0);
  });

  it("runs the tool loop: a refused write goes back to the model, the fix lands in the draft", async () => {
    const from = attempts.length;
    responders.push(
      answer(
        REASONING,
        fc("upsert_transfer_scenario", { name: "Sam", description: "Billing questions", number: "206 555 0134 x12", ask_first: false }, "call_1"),
      ),
      answer(fc("upsert_transfer_scenario", { name: "Sam", description: "Billing questions", number: "2065550134", ask_first: false }, "call_2")),
      answer(msg("Done — Sam, billing.")),
    );
    const res = await turn(JANE, "Send billing to Sam at 206 555 0134 x12");
    expect(res.status).toBe(200);

    const requests = sent(from);
    expect(requests).toHaveLength(3);
    // The transcript carries over: the opener is still the first thing the model reads.
    expect(requests[0]!.body.input[0].content[0].text).toContain("just opened the setup assistant");

    const second = requests[1]!.body.input;
    const refused = outputsIn(second).find((o) => o.callId === "call_1");
    expect(refused.ok).toBe(false);
    expect(refused.field).toMatch(/numbers\[0\]$/);
    expect(second).toContainEqual(REASONING);
    expect(second.some((i: any) => i.type === "function_call" && i.call_id === "call_1")).toBe(true);

    const accepted = outputsIn(requests[2]!.body.input).find((o) => o.callId === "call_2");
    expect(accepted.ok).toBe(true);

    expect(res.body.reply.text).toBe("Done — Sam, billing.");
    expect(res.body.reply.changes).toEqual([
      { kind: "transfer", op: "add", id: expect.any(String), label: expect.stringContaining("Sam") },
    ]);
    expect(res.body.draft.transfer.scenarios[0]).toMatchObject({ name: "Sam", mode: "cold", numbers: ["+12065550134"] });
    expect(res.body.dirty).toBe(true);
    expect(res.body.session.turnCount).toBe(2);
    expect(res.body.session.messages.map((m: { role: string }) => m.role)).toEqual(["assistant", "user", "assistant"]);

    const settings = await call("GET", "/business/call-settings", JANE);
    expect(settings.body.draft).toEqual(res.body.draft);
    expect(settings.body.published).toBeNull();
    expect(responders).toHaveLength(0);
  });

  it("finishes the interview, and the next message starts a new one", async () => {
    responders.push(
      answer(fc("mark_topic", { topic: "transfers", status: "done" }, "call_3")),
      answer(fc("finish_interview", {}, "call_4")),
      answer(msg("All set: Sam takes billing. Nothing is live until you press Publish. Bye!")),
    );
    const done = await turn(JANE, "That's everything, thanks.");
    expect(done.status).toBe(200);
    expect(done.body.session.status).toBe("finished");
    expect(done.body.session.topics).toEqual({ transfers: "done", messages: "skipped", appointments: "skipped" });
    expect(done.body.session.finishedAt).toBeTruthy();
    expect(done.body.reply.text).toContain("Publish");

    responders.push(answer(msg("Welcome back! Anything else to set up?")));
    const again = await turn(JANE, "");
    expect(again.status).toBe(200);
    expect(again.body.session.turnCount).toBe(1);
    expect(again.body.session.status).toBe("active");
    expect(again.body.session.id).not.toBe(done.body.session.id);

    const read = await call("GET", "/business/setup", JANE);
    expect(read.body.session.id).toBe(again.body.session.id);
    expect(read.body.available).toBe(true);
    expect(responders).toHaveLength(0);
  });

  it("stops a conversation at the turn cap without calling the model", async () => {
    for (const text of ["one", "two", "three", "four"]) {
      responders.push(answer(msg(`Got ${text}.`)));
      const ok = await turn(CAROL, text);
      expect(ok.status).toBe(200);
    }
    const from = attempts.length;
    const capped = await turn(CAROL, "five");
    expect(capped.status).toBe(429);
    expect(capped.body.error).toBe("turn_cap");
    expect(sent(from)).toHaveLength(0);
  });

  it("keeps what was saved when OpenAI fails mid-turn", async () => {
    responders.push(
      answer(fc("upsert_transfer_scenario", { name: "Front desk", description: "General questions", number: "2065550177", ask_first: false }, "call_5")),
      () => Response.json({ error: { message: "boom" } }, { status: 500 }),
    );
    const res = await turn(JANE, "Put general questions through to the front desk at 206 555 0177.");
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "openai", message: "boom" });

    const rows = (
      await db.query<{ messages: any[]; busy_until: string | null; turn_count: number }>(
        "SELECT messages, busy_until, turn_count FROM business_setup_sessions WHERE user_id = $1 AND status = 'active'",
        [jane.id],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.busy_until).toBeNull();
    expect(row.turn_count).toBe(2);
    const [user, note] = row.messages.slice(-2);
    expect(user).toMatchObject({ role: "user", text: "Put general questions through to the front desk at 206 555 0177." });
    expect(note.role).toBe("assistant");
    expect(note.text).toContain("lost the connection");
    expect(note.changes).toEqual([expect.objectContaining({ kind: "transfer", op: "add", label: expect.stringContaining("Front desk") })]);

    const settings = await call("GET", "/business/call-settings", JANE);
    expect(settings.body.draft.transfer.scenarios.map((s: { name: string }) => s.name)).toEqual(["Sam", "Front desk"]);
    expect(responders).toHaveLength(0);
  });

  it("is read-only at the demo stage, and an admin can run a turn for a customer", async () => {
    await setLifecycleById(bob.id, { status: "demo" });
    const refused = await turn(BOB, "hello");
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("demo_read_only");
    const reset = await call("POST", "/business/setup/reset", BOB);
    expect(reset.status).toBe(403);
    const read = await call("GET", "/business/setup", BOB);
    expect(read.body).toMatchObject({ available: false, unavailableReason: "demo_stage" });

    responders.push(
      answer(fc("upsert_message_scenario", { name: "Quote request", brief: "Ask what they need and a callback number." }, "call_6")),
      answer(msg("Added a quote request message.")),
    );
    const admin = await turn(ADMIN, "Add a message situation for quotes.", `?userId=${jane.id}`);
    expect(admin.status).toBe(200);
    expect(admin.body.reply.changes).toEqual([expect.objectContaining({ kind: "message", op: "add" })]);

    const settings = await call("GET", "/business/call-settings", JANE);
    expect(settings.body.draft.messages.scenarios.map((s: { name: string }) => s.name)).toEqual(["Quote request"]);
    expect(responders).toHaveLength(0);
  });

  it("resets the conversation and leaves the draft alone", async () => {
    const reset = await call("POST", "/business/setup/reset", JANE);
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ session: null });

    const left = (await db.query("SELECT id FROM business_setup_sessions WHERE user_id = $1", [jane.id])).rows;
    expect(left).toHaveLength(0);

    const read = await call("GET", "/business/setup", JANE);
    expect(read.body.session).toBeNull();
    expect(read.body.dirty).toBe(true);
    expect(read.body.draft.transfer.scenarios.map((s: { name: string }) => s.name)).toEqual(["Sam", "Front desk"]);
  });

  it("retries the opener after it failed, instead of refusing an empty message", async () => {
    responders.push(() => Response.json({ error: { message: "boom" } }, { status: 500 }));
    const failed = await turn(JANE, "");
    expect(failed.status).toBe(500);
    expect(failed.body.error).toBe("openai");

    const between = await call("GET", "/business/setup", JANE);
    expect(between.body.session.messages).toEqual([]);

    responders.push(answer(msg("Hello again! Let's start with transfers.")));
    const retried = await turn(JANE, "");
    expect(retried.status).toBe(200);
    expect(retried.body.session.messages).toHaveLength(1);
    expect(retried.body.session.messages[0]).toMatchObject({ role: "assistant", text: "Hello again! Let's start with transfers." });
    expect(retried.body.session.turnCount).toBe(2);
    expect(responders).toHaveLength(0);
  });

  it("continues from the session as it stands once the turn is claimed", async () => {
    const at = new Date().toISOString();
    const other: SetupMessage[] = [
      { role: "user", text: "From the other tab", at },
      { role: "assistant", text: "Other tab's reply", at },
    ];
    // Another tab's turn saves (and hands the claim back) after this request read the session and
    // before it claims the turn.
    beforeQuery = {
      match: "make_interval",
      run: async () => {
        const row = (await findActiveSetupSession(jane.id))!;
        await saveSetupTurn(row.id, {
          items: [...row.items, { type: "message", role: "user", content: [{ type: "input_text", text: "From the other tab" }] }],
          messages: [...row.messages, ...other],
          topics: row.topics,
          turnCount: row.turnCount + 1,
          finished: false,
        });
      },
    };
    const from = attempts.length;
    responders.push(answer(msg("Hi from this tab's reply.")));
    const res = await turn(JANE, "Hello from this tab");
    expect(beforeQuery).toBeNull();
    expect(res.status).toBe(200);

    const input = sent(from)[0]!.body.input;
    expect(input.some((i: any) => i.type === "message" && i.content[0].text === "From the other tab")).toBe(true);

    const texts = res.body.session.messages.map((m: { text: string }) => m.text);
    expect(texts.slice(-4)).toEqual(["From the other tab", "Other tab's reply", "Hello from this tab", "Hi from this tab's reply."]);
    expect(res.body.session.turnCount).toBe(4);

    const row = (await findActiveSetupSession(jane.id))!;
    expect(row.messages.map((m) => m.text)).toEqual(texts);
    expect(row.busyUntil).toBeNull();
    expect(responders).toHaveLength(0);
  });

  it("throttles a burst of messages", async () => {
    fallback = answer(msg("Sure."));
    try {
      const statuses: { status: number; error?: string }[] = [];
      for (let i = 0; i < 13; i++) {
        const res = await turn(DAVE, `message ${i}`);
        statuses.push({ status: res.status, error: res.body.error });
      }
      expect(statuses).toContainEqual({ status: 429, error: "rate_limited" });
    } finally {
      fallback = null;
    }
  });

  it("never reaches the real OpenAI", () => {
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.every((a) => a.url.startsWith("https://openai.invalid/"))).toBe(true);
  });
});
