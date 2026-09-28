import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Signing up and getting in, end to end against a real Postgres (PGlite behind `db/client.js`, the
// real DDL out of `client.ts`, the real Elysia routes): a prospect claiming their demo from its public
// page, a stranger signing up at /start, the admin's one approval, invite and reset links, and
// changing your own password — with email configured (a test outbox) and without.
//
// Nothing leaves the process: email goes to `useTestMailer`'s outbox, and research runs with no
// OpenAI key, so the run fails the way a real outage does, without a request.
//
// Run: bun test src/routes/signup.pg.test.ts
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
// Settings the routes read per request. `env` is read once at import and shared across test files,
// so these are set on the object and put back (the same approach as `demoResearch.pg.test.ts`).
const { env } = await import("../config/env.js");
const TEST_ENV: Record<string, unknown> = {
  dashboardUrl: "https://dash.test",
  adminNotifyEmail: "ops@tecace.test",
  openaiApiKey: undefined,
  openaiBaseUrl: "https://openai.invalid/v1",
  signupResearchDailyCap: 30,
};
const settings = env as unknown as Record<string, unknown>;
const ENV_BEFORE = Object.fromEntries(Object.keys(TEST_ENV).map((key) => [key, settings[key]]));
Object.assign(settings, TEST_ENV);
beforeEach(() => {
  Object.assign(settings, TEST_ENV);
});

const { useTestMailer } = await import("../email/mailer.js");
type Mail = { to: string; subject: string; text: string };
let outbox: Mail[] = [];

afterAll(async () => {
  Object.assign(settings, ENV_BEFORE);
  useTestMailer(null);
  await db.close();
});

// ----------------------------------------------------------------------------------------------
// Demos a business can claim, and one switched off.
const HARBOR = "harbordental1";
const CAFE = "bluecafe00001";
const PAUSED = "pausedprosp01";

const profile = (name: string) => ({
  name,
  category: "Dental practice",
  address: "12 Wharf St, Portland, ME",
  phone: "+1 207 555 0142",
  hours: [{ day: "Monday", open: "8am", close: "5pm" }],
  services: [{ name: "Cleaning" }],
  faqs: [{ q: "Do you take walk-ins?", a: "Before noon, yes." }],
});
const customer = (id: string, businessName: string, extra: Record<string, unknown> = {}) => ({
  type: "string",
  ttl: -1,
  value: {
    id,
    businessName,
    active: true,
    dossier: `# ${businessName}`,
    sources: [],
    voice: "gleam",
    agentName: "Alex",
    status: "ready",
    profile: profile(businessName),
    prompts: { live: "You are Alex.", backend: "", greeting: "Hello.", edited: false },
    contactEmail: "owner@harbor.test",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    ...extra,
  },
});
const { parseDump } = await import("../demo/dump.js");
const { importDump } = await import("../db/demoImport.js");
await importDump(
  parseDump({
    data: {
      customers: { type: "set", ttl: -1, value: [HARBOR, CAFE, PAUSED, "freshprosp01"] },
      [`customers:${HARBOR}`]: customer(HARBOR, "Harbor Dental"),
      [`customers:${CAFE}`]: customer(CAFE, "Blue Cafe"),
      [`customers:${PAUSED}`]: customer(PAUSED, "Paused Place", { active: false }),
      "customers:freshprosp01": customer("freshprosp01", "Fresh Florist"),
    },
  }),
);

const { createUser, findUserByEmail, findUserById } = await import("../db/users.js");
const { createToken } = await import("../auth/session.js");
const { hashPassword } = await import("../auth/password.js");
const { findProfile } = await import("../db/businessProfiles.js");
const { getCustomer } = await import("../db/demoRead.js");
const { auth } = await import("./auth.js");
const { signup } = await import("./signup.js");
const { lifecycle } = await import("./lifecycle.js");
const { demo } = await import("./demo.js");
const { demoPublic } = await import("./demoPublic.js");
const { Elysia } = await import("elysia");
const app = new Elysia().use(auth).use(signup).use(lifecycle).use(demo).use(demoPublic);

const admin = (await createUser({
  email: "boss@tecace.com",
  name: "Boss",
  passwordHash: hashPassword("boss-password-1"),
  role: "admin",
}))!;
const ADMIN = `Bearer ${createToken(admin.id, admin.tokenVersion).token}`;
const existing = (await createUser({
  email: "taken@example.test",
  name: "Already Here",
  passwordHash: hashPassword("already-here-1"),
}))!;

let ipCounter = 0;
const call = async (
  method: string,
  path: string,
  options: { auth?: string; body?: unknown; ip?: string } = {},
) => {
  ipCounter += 1;
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        "x-forwarded-for": options.ip ?? `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
        ...(options.auth ? { authorization: options.auth } : {}),
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const login = (email: string, password: string) => call("POST", "/auth/login", { body: { email, password } });
const codeIn = (mail: Mail | undefined): string => /Your code: (\d{6})/.exec(mail?.subject ?? "")?.[1] ?? "";
const lastTo = (to: string) => [...outbox].reverse().find((m) => m.to === to);
const PW = "a-good-password-1";

// ----------------------------------------------------------------------------------------------

describe("without email: a claim is a request for an admin", () => {
  beforeEach(() => useTestMailer(null));

  it("says sign-up needs email, and keeps self-service closed", async () => {
    const state = await call("GET", "/auth/setup-state");
    expect(state.body).toEqual({ needsSetup: false, mail: false, signup: false });
    const start = await call("POST", "/auth/signup/start", {
      body: { name: "Sam", email: "sam@new.test", password: PW, business: { businessName: "Sam's", websiteUrl: "https://sams.test" } },
    });
    expect(start.status).toBe(503);
    expect(start.body.error).toBe("signup_closed");
  });

  it("saves the request without making an account, and shows it to the admin", async () => {
    const res = await call("POST", "/auth/signup/claim", {
      body: { demoId: HARBOR, name: "Dana Reed", email: "Dana@Harbor.test", password: PW, phone: "207 555 0100", note: "Start next week" },
    });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ next: "requested" });
    expect(await findUserByEmail("dana@harbor.test")).toBeNull();

    const list = await call("GET", "/demo/setup-requests", { auth: ADMIN });
    expect(list.body.requests).toEqual([
      expect.objectContaining({ kind: "request", customerId: HARBOR, name: "Dana Reed", email: "dana@harbor.test", verified: false }),
    ]);
    const one = await call("GET", `/demo/customers/${HARBOR}`, { auth: ADMIN });
    expect(one.body.customer.request).toEqual(
      expect.objectContaining({ name: "Dana Reed", email: "dana@harbor.test", phone: "207 555 0100", note: "Start next week", openCount: 1 }),
    );
    const page = await call("GET", `/demo/public/customers/${HARBOR}`);
    expect(page.body.customer.setup).toBe("requested");
    // The public page says a request exists, never whose.
    expect(JSON.stringify(page.body)).not.toContain("dana@harbor.test");
  });

  it("refuses a demo that is switched off, and a bot filling the hidden field", async () => {
    const paused = await call("POST", "/auth/signup/claim", { body: { demoId: PAUSED, name: "P", email: "p@p.test", password: PW } });
    expect(paused.status).toBe(404);
    const bot = await call("POST", "/auth/signup/claim", {
      body: { demoId: CAFE, name: "Bot", email: "bot@spam.test", password: PW, website: "http://spam" },
    });
    expect(bot.status).toBe(202);
    expect((await call("GET", "/demo/setup-requests", { auth: ADMIN })).body.requests).toHaveLength(1);
  });

  it("declining answers the request, and the demo is open again", async () => {
    await call("POST", "/auth/signup/claim", { body: { demoId: CAFE, name: "Maybe", email: "maybe@x.test", password: PW } });
    const res = await call("POST", `/demo/customers/${CAFE}/decline-request`, { auth: ADMIN, body: { note: "Call us first" } });
    expect(res.status).toBe(200);
    expect(res.body.customer.request).toBeNull();
    expect((await call("GET", `/demo/public/customers/${CAFE}`)).body.customer.setup).toBe("available");
  });

  it("approving makes the account with the password they chose, so no invite is needed", async () => {
    const res = await call("POST", `/demo/customers/${HARBOR}/onboard`, { auth: ADMIN, body: {} });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(
      expect.objectContaining({ email: "dana@harbor.test", status: "pre-production", signupSource: "claim", emailVerified: false }),
    );
    expect(res.body.invite).toBeNull();
    expect(res.body.emailed).toBe(false);
    expect(res.body.customer.request).toBeNull();
    expect((await findProfile(res.body.user.id))?.profile?.name).toBe("Harbor Dental");

    expect((await login("dana@harbor.test", PW)).status).toBe(200);
    expect((await call("GET", "/demo/setup-requests", { auth: ADMIN })).body.requests).toEqual([]);
    expect((await call("GET", `/demo/public/customers/${HARBOR}`)).body.customer.setup).toBe("onboarding");
  });
});

describe("with email: claiming a demo", () => {
  beforeEach(() => {
    outbox = [];
    useTestMailer(outbox);
  });

  it("refuses a demo that already has its account", async () => {
    const res = await call("POST", "/auth/signup/claim", { body: { demoId: HARBOR, name: "Late", email: "late@x.test", password: PW } });
    expect(res.status).toBe(409);
    expect(outbox).toEqual([]);
  });

  it("sends a code and makes no account until it is used", async () => {
    const res = await call("POST", "/auth/signup/claim", {
      body: { demoId: CAFE, name: "Cam Lee", email: "cam@bluecafe.test", password: PW, note: "Ready to go" },
    });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ next: "code" });
    expect(codeIn(lastTo("cam@bluecafe.test"))).toMatch(/^\d{6}$/);
    expect(await findUserByEmail("cam@bluecafe.test")).toBeNull();
  });

  it("answers an address that has an account the same way, and tells its owner instead", async () => {
    const res = await call("POST", "/auth/signup/claim", { body: { demoId: CAFE, name: "X", email: "taken@example.test", password: PW } });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ next: "code" });
    const mail = lastTo("taken@example.test");
    expect(mail?.subject).toBe("You already have an account");
    expect(codeIn(mail)).toBe("");
    expect((await findUserByEmail("taken@example.test"))?.passwordHash).toBe(existing.passwordHash);
  });

  it("refuses wrong codes, then locks after five", async () => {
    await call("POST", "/auth/signup/claim", { body: { demoId: CAFE, name: "Wren", email: "wren@x.test", password: PW } });
    const right = codeIn(lastTo("wren@x.test"));
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      expect((await call("POST", "/auth/verify", { body: { email: "wren@x.test", code: wrong } })).status).toBe(400);
    }
    const locked = await call("POST", "/auth/verify", { body: { email: "wren@x.test", code: right } });
    expect(locked.status).toBe(429);
    expect(await findUserByEmail("wren@x.test")).toBeNull();
  });

  it("won't resend within a minute", async () => {
    const res = await call("POST", "/auth/verify/resend", { body: { email: "cam@bluecafe.test" } });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("wait");
    // An address with nothing pending gets the same success as one with something.
    expect((await call("POST", "/auth/verify/resend", { body: { email: "nobody@x.test" } })).status).toBe(202);
  });

  it("the right code makes the account, links the demo, records the request, and signs in", async () => {
    await call("POST", "/auth/signup/claim", {
      body: { demoId: CAFE, name: "Cam Lee", email: "cam@bluecafe.test", password: PW, note: "Ready to go" },
    });
    const code = codeIn(lastTo("cam@bluecafe.test"));
    const res = await call("POST", "/auth/verify", { body: { email: "CAM@bluecafe.test", code } });
    expect(res.status).toBe(200);
    expect(res.body.next).toBe("waiting");
    expect(res.body.customerId).toBe(CAFE);
    expect(res.body.user).toEqual(
      expect.objectContaining({ email: "cam@bluecafe.test", status: "demo", businessId: CAFE, signupSource: "claim", emailVerified: true }),
    );
    const me = await call("GET", "/auth/me", { auth: `Bearer ${res.body.token}` });
    expect(me.body.user.email).toBe("cam@bluecafe.test");

    const lifecycle = (await call("GET", `/demo/customers/${CAFE}`, { auth: ADMIN })).body.customer;
    expect(lifecycle.request.note).toBe("Ready to go");
    expect(lifecycle.account).toEqual({ name: "Cam Lee", email: "cam@bluecafe.test", verified: true, source: "claim" });
    expect(lastTo("ops@tecace.test")?.subject).toBe("Setup requested: Blue Cafe");
    // The code is spent.
    expect((await call("POST", "/auth/verify", { body: { email: "cam@bluecafe.test", code } })).status).toBe(400);
    // Their own demo, read-only, is what they can see.
    expect((await call("GET", `/demo/customers/${CAFE}`, { auth: `Bearer ${res.body.token}` })).status).toBe(200);
  });

  it("approving tells them they can edit now", async () => {
    const res = await call("POST", `/demo/customers/${CAFE}/onboard`, { auth: ADMIN, body: {} });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe("pre-production");
    expect(res.body.invite).toBeNull();
    expect(res.body.emailed).toBe(true);
    expect(lastTo("cam@bluecafe.test")?.subject).toBe("You can edit your receptionist now");
  });
});

describe("with email: signing up at /start", () => {
  beforeEach(() => {
    outbox = [];
    useTestMailer(outbox);
  });

  const START = {
    name: "Rae Park",
    email: "rae@noodles.test",
    password: PW,
    business: { businessName: "Rae's Noodles", websiteUrl: "https://raesnoodles.test" },
  };
  let token = "";

  it("needs a way to learn about the business", async () => {
    const res = await call("POST", "/auth/signup/start", { body: { ...START, business: { businessName: "Rae's Noodles" } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("business_link");
  });

  it("the code makes the account and a new demo to research", async () => {
    expect((await call("POST", "/auth/signup/start", { body: START })).status).toBe(202);
    const res = await call("POST", "/auth/verify", { body: { email: START.email, code: codeIn(lastTo(START.email)) } });
    expect(res.status).toBe(200);
    expect(res.body.next).toBe("research");
    token = `Bearer ${res.body.token}`;
    const made = (await getCustomer(res.body.customerId))!;
    expect(made.businessName).toBe("Rae's Noodles");
    expect(made.websiteUrl).toBe("https://raesnoodles.test");
    expect(made.status).toBe("researching");
    expect(res.body.user).toEqual(expect.objectContaining({ status: "demo", signupSource: "start", businessId: made.id }));
    expect(lastTo("ops@tecace.test")?.subject).toBe("New sign-up: Rae's Noodles");
    // No request yet: they ask once they've seen it.
    expect((await call("GET", `/demo/customers/${made.id}`, { auth: ADMIN })).body.customer.request).toBeNull();
  });

  it("waits for an admin past the day's research ceiling", async () => {
    settings.signupResearchDailyCap = 0;
    const res = await call("POST", "/auth/signup/research", { auth: token });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: "researching", queued: true });
  });

  it("gets one research run, and a failure is recorded for the admin", async () => {
    const res = await call("POST", "/auth/signup/research", { auth: token });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("research_failed");
    const me = (await call("GET", "/auth/me", { auth: token })).body.user;
    expect((await getCustomer(me.businessId))!.status).toBe("error");
    // Not a second run.
    const again = await call("POST", "/auth/signup/research", { auth: token });
    expect(again.status).toBe(200);
    expect(again.body.queued).toBe(false);
  });

  it("is only for a self-service sign-up's own demo", async () => {
    expect((await call("POST", "/auth/signup/research")).status).toBe(401);
    expect((await call("POST", "/auth/signup/research", { auth: ADMIN })).status).toBe(403);
  });

  it("slows down one address signing up over and over", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await call("POST", "/auth/signup/start", { ip: "203.0.113.9", body: { ...START, email: `spam${i}@x.test` } });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 202)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("links, and your own password", () => {
  beforeEach(() => {
    outbox = [];
    useTestMailer(outbox);
  });

  it("an approval with no account or request makes one, with an invite", async () => {
    const refused = await call("POST", "/demo/customers/freshprosp01/onboard", { auth: ADMIN, body: {} });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("no_account");

    const res = await call("POST", "/demo/customers/freshprosp01/onboard", {
      auth: ADMIN,
      body: { email: "flo@florist.test", name: "Flo" },
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(expect.objectContaining({ email: "flo@florist.test", status: "pre-production", signupSource: "admin" }));
    expect(res.body.invite.link).toBe(`https://dash.test/#/welcome?token=${res.body.invite.token}`);
    expect(res.body.emailed).toBe(true);
    expect(lastTo("flo@florist.test")?.text).toContain(res.body.invite.link);

    const inspect = await call("POST", "/auth/tokens/inspect", { body: { token: res.body.invite.token } });
    expect(inspect.body).toEqual({ purpose: "invite", name: "Flo", email: "flo@florist.test" });
    const accept = await call("POST", "/auth/tokens/accept", { body: { token: res.body.invite.token, password: "flo-password-1" } });
    expect(accept.status).toBe(200);
    expect(accept.body.user.email).toBe("flo@florist.test");
    expect((await login("flo@florist.test", "flo-password-1")).status).toBe(200);
    // Once only.
    expect((await call("POST", "/auth/tokens/accept", { body: { token: res.body.invite.token, password: "another-pass-1" } })).status).toBe(404);
  });

  it("a new invite retires the old one", async () => {
    const flo = (await findUserByEmail("flo@florist.test"))!;
    const first = await call("POST", `/auth/users/${flo.id}/invite`, { auth: ADMIN });
    const second = await call("POST", `/auth/users/${flo.id}/invite`, { auth: ADMIN });
    expect(first.status).toBe(200);
    expect((await call("POST", "/auth/tokens/inspect", { body: { token: first.body.token } })).status).toBe(404);
    expect((await call("POST", "/auth/tokens/inspect", { body: { token: second.body.token } })).status).toBe(200);
    expect((await call("POST", `/auth/users/${flo.id}/invite`)).status).toBe(401);
  });

  it("forgot password: a reset link for an account, the same answer for none", async () => {
    const none = await call("POST", "/auth/forgot", { body: { email: "ghost@x.test" } });
    expect(none.status).toBe(202);
    expect(outbox).toEqual([]);

    const before = await login("flo@florist.test", "flo-password-1");
    const res = await call("POST", "/auth/forgot", { body: { email: "flo@florist.test" } });
    expect(res.status).toBe(202);
    const token = /token=([\w-]+)/.exec(lastTo("flo@florist.test")?.text ?? "")?.[1] ?? "";
    expect(token).not.toBe("");
    const accept = await call("POST", "/auth/tokens/accept", { body: { token, password: "flo-password-2" } });
    expect(accept.status).toBe(200);
    expect((await login("flo@florist.test", "flo-password-2")).status).toBe(200);
    // The session from before the reset is signed out.
    expect((await call("GET", "/auth/me", { auth: `Bearer ${before.body.token}` })).status).toBe(401);
  });

  it("changing your own password needs the current one, and signs other sessions out", async () => {
    const session = (await login("flo@florist.test", "flo-password-2")).body.token;
    const wrong = await call("POST", "/auth/me/password", {
      auth: `Bearer ${session}`,
      body: { current: "nope", password: "flo-password-3" },
    });
    expect(wrong.status).toBe(403);
    const ok = await call("POST", "/auth/me/password", {
      auth: `Bearer ${session}`,
      body: { current: "flo-password-2", password: "flo-password-3" },
    });
    expect(ok.status).toBe(200);
    expect((await call("GET", "/auth/me", { auth: `Bearer ${ok.body.token}` })).status).toBe(200);
    expect((await call("GET", "/auth/me", { auth: `Bearer ${session}` })).status).toBe(401);
  });

  it("the stage switch won't skip the copy onto a demo-linked account", async () => {
    const rae = (await findUserByEmail("rae@noodles.test"))!;
    const res = await call("POST", `/auth/users/${rae.id}/status`, { auth: ADMIN, body: { status: "pre-production" } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("use_onboard");
    expect((await findUserById(rae.id))?.status).toBe("demo");
  });
});
