import { afterAll, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Scenario tests through the real routes against a real Postgres (PGlite), with OpenAI and the
// runner stubbed at `fetch` — no request leaves the process.
//
// Run: bun test src/routes/scenarios.pg.test.ts
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
const BOB = await bearerFor("bob@tecace.com", "user");

const { env } = await import("../config/env.js");
const settable = env as unknown as Record<string, unknown>;
const TEST_ENV: Record<string, unknown> = {
  openaiApiKey: "sk-test-not-a-real-key",
  openaiBaseUrl: "https://openai.invalid/v1",
  scenarioRunnerUrl: "https://runner.invalid/scenarios",
  scenarioRunnerKey: "runner-key",
  scenarioJudgeModel: "gpt-5.6-luna",
};
const ENV_BEFORE = Object.fromEntries(Object.keys(TEST_ENV).map((k) => [k, settable[k]]));
Object.assign(settable, TEST_ENV);

const outbound: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
  const url = typeof input === "string" ? input : input.url;
  outbound.push(url);
  if (url.startsWith("https://runner.invalid/scenarios/passes/")) return new Response('{"accepted":true}', { status: 202 });
  if (url.endsWith("/responses")) {
    const items = Array.from({ length: 12 }, (_, i) => ({ n: i + 1, met: true, evidence: "" }));
    return Response.json({ output_text: JSON.stringify({ items }), usage: { input_tokens: 2000, output_tokens: 100 } });
  }
  return new Response("unexpected", { status: 500 });
}) as typeof fetch;

afterAll(async () => {
  globalThis.fetch = realFetch;
  Object.assign(settable, ENV_BEFORE);
  await db.close();
});

const { app } = await import("../app.js");
const { findUserByEmail } = await import("../db/users.js");
const { saveProfile } = await import("../db/businessProfiles.js");
const { saveCallSettingsDraft, publishCallSettings } = await import("../db/callSettings.js");
const { validateCallSettings } = await import("../business/callSettings.js");

const jane = (await findUserByEmail("jane@tecace.com"))!;

async function call(method: string, path: string, headers: Record<string, string>, payload?: unknown) {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
  return { status: response.status, body: (await response.json()) as any };
}
const asAdmin = { authorization: ADMIN };
const asRunner = { "x-runner-key": "runner-key" };
const Q = `?userId=${jane.id}`;

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

describe("scenario tests", () => {
  it("needs business information, and an admin", async () => {
    expect((await call("GET", `/business/scenarios${Q}`, asAdmin)).status).toBe(409);
    expect((await call("GET", `/business/scenarios${Q}`, { authorization: JANE })).status).toBe(403);
  });

  it("writes in the built-in scenarios that apply", async () => {
    await saveProfile(
      jane.id,
      "Jane's Salon.",
      { businessName: "Jane's Salon", hoursText: null, openHour: null, closeHour: null, website: null, facts: "Cuts." },
      { transferNumber: null, agentName: "Mia", greeting: null, transferTopics: null, houseRules: null },
      {
        profile: {
          name: "Jane's Salon",
          category: "Hair salon",
          address: "1 A St, Tacoma, WA",
          hours: DAYS.map((day) => ({ day, open: "09:00", close: "17:00" })),
          services: [{ name: "Haircut" }],
          highlights: [],
          policies: {},
          faqs: [],
        },
        prompts: null as never,
        voice: "gleam",
        language: null,
      },
    );
    await saveCallSettingsDraft(
      jane.id,
      validateCallSettings(
        {
          appointments: { enabled: true },
          transfer: { scenarios: [{ id: "front", mode: "cold", name: "Front desk", numbers: ["2065550134"] }] },
        },
        { waterfallAllowed: false },
      ),
    );
    const res = await call("GET", `/business/scenarios${Q}`, asAdmin);
    expect(res.status).toBe(200);
    expect(res.body.scenarios.map((s: { templateId: string }) => s.templateId)).toEqual([
      "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12",
    ]);
    expect(res.body.runnerConfigured).toBe(true);
    // Reading again does not write them twice.
    expect((await call("GET", `/business/scenarios${Q}`, asAdmin)).body.scenarios).toHaveLength(12);
  });

  it("refuses a bad custom scenario and keeps a good one", async () => {
    const bad = await call("POST", `/business/scenarios${Q}`, asAdmin, { title: "x", definition: { customerLines: [] } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_scenario");
    expect(bad.body.message).toContain("customer line");
    const good = await call("POST", `/business/scenarios${Q}`, asAdmin, {
      title: "Parking",
      definition: { customerLines: ["Is there parking?"], expect: { judge: ["Does not invent parking"] } },
    });
    expect(good.status).toBe(200);
    expect(good.body.scenario.templateId).toBeNull();
  });

  it("runs a pass once, scenario by scenario, through the sandbox, and stops", async () => {
    const list = (await call("GET", `/business/scenarios${Q}`, asAdmin)).body.scenarios;
    const ids = list.filter((s: { templateId: string }) => s.templateId === "S05" || s.templateId === "S08").map((s: { id: string }) => s.id);

    const started = await call("POST", `/business/scenario-passes${Q}`, asAdmin, { settings: "draft", scenarioIds: ids });
    expect(started.status).toBe(200);
    const passId = started.body.passId;
    expect(outbound).toContain(`https://runner.invalid/scenarios/passes/${passId}`);

    const again = await call("POST", `/business/scenario-passes${Q}`, asAdmin, { settings: "draft", scenarioIds: ids });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("pass_running");

    expect((await call("GET", `/internal/scenario-passes/${passId}/next`, {})).status).toBe(401);

    // S05: book the time the scenario asks for.
    const first = await call("GET", `/internal/scenario-passes/${passId}/next`, asRunner);
    expect(first.body.done).toBe(false);
    expect(first.body.title).toBe("Booking");
    expect(first.body.customerLines[0]).toContain("under the name Kim Minsu");
    expect(first.body.session.tools.map((t: { name: string }) => t.name)).toContain("book_appointment");
    expect(first.body.limits).toEqual({ maxSeconds: 90, maxTurns: 8 });

    const detail = (await call("GET", `/business/scenario-passes/${passId}${Q}`, asAdmin)).body;
    const slotA = detail.runs[0].scenario.expect.tools[0].args.start;
    const booked = await call("POST", `/internal/scenario-runs/${first.body.runId}/tool`, asRunner, {
      name: "book_appointment",
      args: { start: slotA, caller_name: "Kim Minsu" },
    });
    expect(booked.body.output.booked).toBe(true);
    const transcript = [{ id: "t1", speaker: "caller", text: "Please book…", startMs: 0, endMs: 900 }];
    const graded = await call("POST", `/internal/scenario-runs/${first.body.runId}/result`, asRunner, {
      status: "completed",
      startedAt: new Date().toISOString(),
      transcript,
      durationSec: 30,
      costUsd: 0.04,
    });
    expect(graded.body.verdict).toBe("pass");
    // A second report for the same run is refused.
    const repeat = await call("POST", `/internal/scenario-runs/${first.body.runId}/result`, asRunner, {
      status: "completed",
      transcript,
      durationSec: 30,
      costUsd: 0.04,
    });
    expect(repeat.status).toBe(409);

    // S08: the same time is full.
    const second = await call("GET", `/internal/scenario-passes/${passId}/next`, asRunner);
    expect(second.body.title).toBe("Time unavailable");
    const full = await call("POST", `/internal/scenario-runs/${second.body.runId}/tool`, asRunner, {
      name: "book_appointment",
      args: { start: slotA, caller_name: "Kim Minsu" },
    });
    expect(full.body.output.booked).toBe(false);
    await call("POST", `/internal/scenario-runs/${second.body.runId}/result`, asRunner, {
      status: "completed",
      transcript,
      durationSec: 30,
      costUsd: 0.04,
    });

    const done = await call("GET", `/internal/scenario-passes/${passId}/next`, asRunner);
    expect(done.body).toEqual({ done: true });

    const summary = (await call("GET", `/business/scenario-passes/${passId}${Q}`, asAdmin)).body;
    expect(summary.pass).toMatchObject({ status: "completed", runs: 2, done: 2, passed: 2, failed: 0, errors: 0 });
    expect(summary.pass.costUsd).toBeGreaterThan(0.08);
    expect(summary.runs[0].sandbox.calls.map((c: { name: string }) => c.name)).toEqual(["book_appointment"]);
  });

  it("estimates from what runs really cost", async () => {
    const list = (await call("GET", `/business/scenarios${Q}`, asAdmin)).body;
    const s05 = list.scenarios.find((s: { templateId: string }) => s.templateId === "S05");
    // Measured: 0.04 from the runner plus the judge's tokens, 30 s.
    expect(s05.estimate.basedOnRuns).toBe(1);
    expect(s05.estimate.costUsd).toBeGreaterThan(0.04);
    expect(s05.estimate.costUsd).toBeLessThan(0.05);
    expect(s05.estimate.durationSec).toBe(30);
    // A scenario never run gets the average of recent runs.
    const s01 = list.scenarios.find((s: { templateId: string }) => s.templateId === "S01");
    expect(s01.estimate.basedOnRuns).toBe(0);
    expect(list.perRunEstimateUsd).toBe(s01.estimate.costUsd);
  });

  it("stop cancels what has not started", async () => {
    const list = (await call("GET", `/business/scenarios${Q}`, asAdmin)).body.scenarios;
    const started = await call("POST", `/business/scenario-passes${Q}`, asAdmin, {
      settings: "draft",
      scenarioIds: [list[0].id, list[1].id],
    });
    const passId = started.body.passId;
    const stopped = await call("POST", `/business/scenario-passes/${passId}/stop${Q}`, asAdmin);
    expect(stopped.body.pass.status).toBe("cancelled");
    expect((await call("GET", `/internal/scenario-passes/${passId}/next`, asRunner)).body).toEqual({ done: true });
    expect((await call("GET", `/business/scenario-passes${Q}`, asAdmin)).body.passes).toHaveLength(2);
  });

  it("refuses to test published settings that don't exist yet", async () => {
    const list = (await call("GET", `/business/scenarios${Q}`, asAdmin)).body.scenarios;
    const res = await call("POST", `/business/scenario-passes${Q}`, asAdmin, { settings: "published", scenarioIds: [list[0].id] });
    expect(res.status).toBe(409);
  });

  it("decides what applies from the settings being tested", async () => {
    const on = validateCallSettings({ appointments: { enabled: true } }, { waterfallAllowed: false });
    const off = validateCallSettings({ appointments: { enabled: false } }, { waterfallAllowed: false });
    await publishCallSettings(jane.id, off);
    await saveCallSettingsDraft(jane.id, on);
    const list = (await call("GET", `/business/scenarios${Q}`, asAdmin)).body.scenarios;
    const s05 = list.find((s: { templateId: string }) => s.templateId === "S05").id;

    const started = await call("POST", `/business/scenario-passes${Q}`, asAdmin, { settings: "published", scenarioIds: [s05] });
    expect(started.status).toBe(200);
    const passId = started.body.passId;
    const detail = (await call("GET", `/business/scenario-passes/${passId}${Q}`, asAdmin)).body;
    expect(detail.runs[0]).toMatchObject({
      status: "done",
      verdict: "run_error",
      scenario: null,
      errorReason: "Not available with the published settings.",
    });
    expect((await call("GET", `/internal/scenario-passes/${passId}/next`, asRunner)).body).toEqual({ done: true });
  });

  it("never reaches the real OpenAI or a real runner", () => {
    expect(outbound.every((u) => u.startsWith("https://openai.invalid/") || u.startsWith("https://runner.invalid/"))).toBe(true);
  });
});
