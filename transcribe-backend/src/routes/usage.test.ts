import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// The ranged usage read, against in-memory stand-ins for the database modules. Run: bun test
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";
process.env.DATABASE_URL ??= "postgres://unused/unused";

const JANE_ID = "11111111-1111-1111-1111-111111111111";
// A real customer account that exists but has never had a call — the emptyMinutesFor path.
const EMPTY_ID = "22222222-2222-2222-2222-222222222222";

const minutesRow = {
  userId: JANE_ID,
  email: "jane@tecace.com",
  name: "Jane Kim",
  businessName: "Harbor Dental",
  currentMonth: "2026-09",
  currentSeconds: 600,
  currentMinutes: 10,
  previousMonth: "2026-08",
  previousSeconds: 120,
  previousMinutes: 2,
  updatedAt: "2026-09-15T18:00:00.000Z",
};

// The unassigned bucket's own monthly row — a distinct owner from Jane, so a test that asks for it
// and gets Jane's numbers back would be caught rather than passing by coincidence.
const unassignedRow = {
  userId: null,
  email: null,
  name: null,
  businessName: null,
  currentMonth: "2026-09",
  currentSeconds: 300,
  currentMinutes: 5,
  previousMonth: "2026-08",
  previousSeconds: 0,
  previousMinutes: 0,
  updatedAt: "2026-09-14T12:00:00.000Z",
};

// What the range query would return for Jane and for the unassigned bucket; EMPTY_ID is deliberately
// absent, so the tests also pin that a business with no calls in the range reads as zero rather than
// disappearing.
const totals = new Map([
  [JANE_ID, { periodSeconds: 5424, periodMinutes: 90.4, periodCalls: 37 }],
  ["unassigned", { periodSeconds: 738, periodMinutes: 12.3, periodCalls: 4 }],
]);

// What the route last asked the mocked database modules for, so a test can pin the ARGUMENTS and not
// only the answer: which business the range sum was scoped to, and the instant a call is filed under.
let periodQuery: { from: Date; to: Date; ownerKey?: string } | null = null;
let written: { seconds: number; agentNumber?: string; now: Date; startedAt: Date } | null = null;

// The default range-query stand-in, restored after any test that swaps it out.
const callSessionsModule = () => ({
  periodTotalsByOwner: async (from: Date, to: Date, ownerKey?: string) => {
    periodQuery = { from, to, ownerKey };
    return totals;
  },
  earliestSessionAt: async () => "2026-09-01T00:00:00.000Z",
});

await mock.module("../db/client.js", () => ({
  sql: Object.assign(() => [], { end: async () => {} }),
  initDb: async () => {},
  ensureDbReady: async () => {},
}));
await mock.module("../db/callMinutes.js", () => ({
  UNASSIGNED: "unassigned",
  addCallSeconds: async (seconds: number, agentNumber: string | undefined, now: Date, startedAt: Date) => {
    written = { seconds, agentNumber, now, startedAt };
    return minutesRow;
  },
  // Per-user, not a fixed stand-in for Jane's row: the "real customer, no totals yet" tests rely on
  // this actually reading as zero for that user, not as whichever fixture happened to be handy.
  emptyMinutesFor: (user: { id: string; email: string; name: string }) => ({
    userId: user.id,
    email: user.email,
    name: user.name,
    businessName: null,
    currentMonth: "2026-09",
    currentSeconds: 0,
    currentMinutes: 0,
    previousMonth: "2026-08",
    previousSeconds: 0,
    previousMinutes: 0,
    updatedAt: null,
  }),
  // Mirrors the real query's ownerKey narrowing closely enough to drive every answer site: no key =
  // every business, "unassigned" = that bucket, Jane's id = Jane, anything else = not found.
  listCallMinutes: async (ownerKey?: string) => {
    if (ownerKey === undefined) return [minutesRow];
    if (ownerKey === "unassigned") return [unassignedRow];
    if (ownerKey === JANE_ID) return [minutesRow];
    return [];
  },
}));
await mock.module("../db/callSessions.js", callSessionsModule);
await mock.module("../db/users.js", () => ({
  // Only EMPTY_ID resolves to a real account; everything else (including a well-formed but unknown
  // uuid) is "no such account" — the route's own 404, not this route's concern.
  findUserById: async (id: string) =>
    id === EMPTY_ID ? { id: EMPTY_ID, email: "empty@tecace.com", name: "Empty Biz", role: "user" } : null,
  // `mock.module` replaces the module for the whole test run, not just this file, so anything else
  // loaded after this one resolves `db/users.js` to the object above. These are here for those
  // importers: an export this stand-in omits is a module that fails to load, not a failing test.
  toPublicUser: (u: Record<string, unknown>) => u,
  ACCOUNT_STATUSES: ["unassigned", "demo", "pre-production", "production"],
  isAccountStatus: (v: unknown) =>
    typeof v === "string" && ["unassigned", "demo", "pre-production", "production"].includes(v),
  findUserByBusinessId: async () => null,
  setLifecycleById: async () => null,
}));
await mock.module("../auth/guard.js", () => ({
  UNAUTHORIZED: { error: "unauthorized", message: "Sign in to continue." },
  // Three fixed sessions: Jane (a customer with data), Empty (a customer with none yet), and an
  // admin. Anything else is not signed in.
  authenticate: async (authorization?: string) => {
    if (authorization === "Bearer customer-token") {
      return { id: JANE_ID, email: "jane@tecace.com", name: "Jane Kim", role: "user", lastLoginAt: null };
    }
    if (authorization === "Bearer empty-token") {
      return { id: EMPTY_ID, email: "empty@tecace.com", name: "Empty Biz", role: "user", lastLoginAt: null };
    }
    if (authorization === "Bearer admin-token") {
      return { id: "44444444-4444-4444-4444-444444444444", email: "admin@tecace.com", name: "Admin", role: "admin", lastLoginAt: null };
    }
    return null;
  },
}));
await mock.module("../auth/apiKey.js", () => ({
  INVALID_API_KEY: { error: "invalid_api_key", message: "That API key is not valid." },
  looksLikeApiKey: (header?: string) => (header ?? "").startsWith("Bearer ak_"),
  authenticateApiKey: async (header?: string) => (header === "Bearer ak_good" ? { id: "key-1" } : null),
}));

// The three settings the route reads, pinned here rather than through process.env above. Bun runs
// the whole suite in one process and one module registry, so if any earlier test file has already
// imported config/env.js, a variable set in this file arrives too late to mean anything.
//
// 900 rather than the 3600 default: a route that hard-coded the default would satisfy the
// settleSeconds assertion below, and every settled/unsettled test would read the same either way.
//
// Spread over the real env rather than standing in for it: mock.module is process-wide and lasts
// the rest of the run, so a three-key replacement hands `undefined` to anything else that reads env
// (the auth modules read env.authSecret) in whichever file happens to run after this one.
const { env: realEnv } = await import("../config/env.js");
await mock.module("../config/env.js", () => ({
  env: { ...realEnv, timezone: "America/Los_Angeles", settleSeconds: 900, agentConfigKey: "test-agent-key" },
}));

// Both captures above are module-scope and would otherwise survive into the next test: a request
// that stopped reaching the handler (a 401, a renamed body field) would then be judged on its
// predecessor's capture and pass.
beforeEach(() => {
  periodQuery = null;
  written = null;
});

const { usage } = await import("./usage.js");
const { Elysia } = await import("elysia");
const app = new Elysia().use(usage);

const get = (path: string) =>
  app.handle(new Request(`http://localhost${path}`, { headers: { authorization: "Bearer ak_good" } }));

// For the session-token callers (customer / admin), rather than the api-key ones `get` drives.
const getAs = (path: string, token: string) =>
  app.handle(new Request(`http://localhost${path}`, { headers: { authorization: `Bearer ${token}` } }));

// `Response.json()` is typed `unknown`; these are our own fixtures, so read them as records (same
// pattern as ../auth/auth.test.ts).
const json = (res: Response): Promise<Record<string, any>> => res.json() as Promise<Record<string, any>>;

describe("GET /usage/minutes without a range", () => {
  it("answers exactly as it always has", async () => {
    const body = await json(await get("/usage/minutes"));
    // Not sorted: "byte-for-byte identical" includes the order the keys come out in.
    expect(Object.keys(body)).toEqual(["timezone", "minutes"]);
    expect(body.minutes[0].periodMinutes).toBeUndefined();
  });
});

describe("GET /usage/minutes with a range", () => {
  it("adds the period totals and the range fields", async () => {
    const res = await get("/usage/minutes?from=2026-08-15T07:00:00Z&to=2026-09-15T07:00:00Z");
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.from).toBe("2026-08-15T07:00:00.000Z");
    expect(body.to).toBe("2026-09-15T07:00:00.000Z");
    expect(body.settleSeconds).toBe(900);
    expect(body.settled).toBe(true); // the window is long past
    expect(body.coverageFrom).toBe("2026-09-01T00:00:00.000Z");
    expect(body.minutes[0]).toMatchObject({
      periodSeconds: 5424,
      periodMinutes: 90.4,
      periodCalls: 37,
      currentSeconds: 600,
    });
  });

  // Restored here rather than on the last line of the test below: a failure partway through would
  // otherwise leave the empty stand-in installed and take every test after it down with it.
  afterEach(async () => {
    await mock.module("../db/callSessions.js", callSessionsModule);
  });

  it("reports a business with no calls in the range as zero, not as missing", async () => {
    await mock.module("../db/callSessions.js", () => ({
      periodTotalsByOwner: async () => new Map(),
      earliestSessionAt: async () => null,
    }));
    const body = await json(await get("/usage/minutes?from=2026-08-15T07:00:00Z&to=2026-09-15T07:00:00Z"));
    expect(body.minutes[0]).toMatchObject({ periodSeconds: 0, periodMinutes: 0, periodCalls: 0 });
    expect(body.coverageFrom).toBeNull();
  });

  it("is unsettled while a call started before `to` could still be running", async () => {
    const to = new Date(Date.now() - 60_000).toISOString();
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const body = await json(await get(`/usage/minutes?from=${from}&to=${to}`));
    expect(body.settled).toBe(false);
  });
});

describe("GET /usage/minutes range errors", () => {
  const cases: [string, string][] = [
    ["a reversed window", "?from=2026-09-15T07:00:00Z&to=2026-08-15T07:00:00Z"],
    ["an empty window", "?from=2026-09-15T07:00:00Z&to=2026-09-15T07:00:00Z"],
    ["one bound alone", "?from=2026-09-15T07:00:00Z"],
    ["a malformed instant", "?from=2026-08-15&to=2026-09-15"],
  ];
  for (const [what, query] of cases) {
    it(`refuses ${what} with invalid_range`, async () => {
      const res = await get(`/usage/minutes${query}`);
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe("invalid_range");
    });
  }

  it("refuses an over-long bound with its own 400, not the framework's 422", async () => {
    // Longer than the maxLength the schema used to carry. The length is the handler's to judge as
    // well, or an integration sending a padded value gets back a validation shape this API never
    // documented — the very thing keeping the range out of the schema was meant to avoid.
    const from = "2026-08-15T07:00:00Z" + "0".repeat(30);
    const res = await get(`/usage/minutes?from=${from}&to=2026-09-15T07:00:00Z`);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("invalid_range");
  });

  it("refuses a range over the maximum with range_too_long", async () => {
    const res = await get("/usage/minutes?from=2024-01-01T00:00:00Z&to=2026-01-01T00:00:00Z");
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("range_too_long");
  });

  it("refuses a bad range before it checks the key, so the caller learns the real problem", async () => {
    const res = await app.handle(
      new Request("http://localhost/usage/minutes?from=nonsense&to=2026-09-15T07:00:00Z", {
        headers: { authorization: "Bearer ak_bad" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

// The six places `respond()` is called (the plan that shaped this file believed there were five —
// there are six). Every one gets its own test so a return site can never silently drop its period
// totals without a test noticing: the API key with no userId, the API key asking for "unassigned",
// a named business the API key finds, a named business that is a real customer with no totals yet,
// a signed-in customer reading their own business (with and without totals), and an admin (with and
// without a filter).
describe("GET /usage/minutes per-caller answer sites", () => {
  const RANGE = "?from=2026-08-15T07:00:00Z&to=2026-09-15T07:00:00Z";

  it("API key, no userId: every business, each carrying its own period totals", async () => {
    const body = await json(await get(`/usage/minutes${RANGE}`));
    expect(body.minutes).toHaveLength(1);
    expect(body.minutes[0]).toMatchObject({ userId: JANE_ID, periodMinutes: 90.4, periodCalls: 37 });
  });

  it("API key, userId=unassigned: the unassigned bucket's own totals, not Jane's", async () => {
    const body = await json(await get(`/usage/minutes${RANGE}&userId=unassigned`));
    expect(body.minutes).toHaveLength(1);
    expect(body.minutes[0]).toMatchObject({ userId: null, periodMinutes: 12.3, periodCalls: 4 });
  });

  it("API key, a named business the query finds: just that business, with its totals", async () => {
    const body = await json(await get(`/usage/minutes${RANGE}&userId=${JANE_ID}`));
    expect(body.minutes).toHaveLength(1);
    expect(body.minutes[0]).toMatchObject({ userId: JANE_ID, periodMinutes: 90.4, periodCalls: 37 });
  });

  it("API key, a named business that is a real customer with no totals yet: zero, not missing", async () => {
    const body = await json(await get(`/usage/minutes${RANGE}&userId=${EMPTY_ID}`));
    expect(body.minutes).toHaveLength(1);
    expect(body.minutes[0]).toMatchObject({
      userId: EMPTY_ID,
      currentSeconds: 0,
      periodMinutes: 0,
      periodCalls: 0,
    });
  });

  it("a signed-in customer sees their own business's period totals", async () => {
    const body = await json(await getAs(`/usage/minutes${RANGE}`, "customer-token"));
    expect(body.minutes).toHaveLength(1);
    expect(body.minutes[0]).toMatchObject({ userId: JANE_ID, periodMinutes: 90.4, periodCalls: 37 });
  });

  it("a signed-in customer with no calls yet gets a zero row, not an empty list", async () => {
    const body = await json(await getAs(`/usage/minutes${RANGE}`, "empty-token"));
    expect(body.minutes).toHaveLength(1);
    expect(body.minutes[0]).toMatchObject({
      userId: EMPTY_ID,
      currentSeconds: 0,
      periodMinutes: 0,
      periodCalls: 0,
    });
  });

  it("an admin with no filter sees every business, each carrying its own period totals", async () => {
    const body = await json(await getAs(`/usage/minutes${RANGE}`, "admin-token"));
    expect(body.minutes).toHaveLength(1);
    expect(body.minutes[0]).toMatchObject({ userId: JANE_ID, periodMinutes: 90.4, periodCalls: 37 });
  });

  it("an admin filtering by userId sees just that business's period totals", async () => {
    const body = await json(await getAs(`/usage/minutes${RANGE}&userId=unassigned`, "admin-token"));
    expect(body.minutes).toHaveLength(1);
    expect(body.minutes[0]).toMatchObject({ userId: null, periodMinutes: 12.3, periodCalls: 4 });
  });
});

// The range sum is a per-owner query, and every answer site has a business it is answering for. Drop
// the scope and a one-business read quietly totals every business behind it — numbers that look
// plausible and are wrong — so what is pinned here is the argument, not just the answer.
describe("GET /usage/minutes range scope", () => {
  const RANGE = "?from=2026-08-15T07:00:00Z&to=2026-09-15T07:00:00Z";

  it("scopes the sum to the business it answered for", async () => {
    await getAs(`/usage/minutes${RANGE}`, "customer-token");
    expect(periodQuery?.ownerKey).toBe(JANE_ID);

    await get(`/usage/minutes${RANGE}&userId=${JANE_ID}`);
    expect(periodQuery?.ownerKey).toBe(JANE_ID);

    await get(`/usage/minutes${RANGE}&userId=unassigned`);
    expect(periodQuery?.ownerKey).toBe("unassigned");

    await getAs(`/usage/minutes${RANGE}&userId=unassigned`, "admin-token");
    expect(periodQuery?.ownerKey).toBe("unassigned");

    // A real customer with no totals yet is still asked about by name, not by asking about everyone.
    await get(`/usage/minutes${RANGE}&userId=${EMPTY_ID}`);
    expect(periodQuery?.ownerKey).toBe(EMPTY_ID);
  });

  it("asks about every business only when the caller did", async () => {
    await get(`/usage/minutes${RANGE}`);
    expect(periodQuery?.ownerKey).toBeUndefined();

    await getAs(`/usage/minutes${RANGE}`, "admin-token");
    expect(periodQuery?.ownerKey).toBeUndefined();
  });

  it("hands the query the parsed instants, not the caller's strings", async () => {
    await get(`/usage/minutes${RANGE}`);
    expect(periodQuery?.from.toISOString()).toBe("2026-08-15T07:00:00.000Z");
    expect(periodQuery?.to.toISOString()).toBe("2026-09-15T07:00:00.000Z");
  });
});

// The write has one new thing to get right: the instant the session is filed under. Every ranged
// total is measured by it, so a call filed at its arrival rather than its start lands in the wrong
// period whenever one straddles a boundary.
describe("POST /usage/minutes", () => {
  const post = (body: Record<string, unknown>) =>
    app.handle(
      new Request("http://localhost/usage/minutes", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-key": "test-agent-key" },
        body: JSON.stringify(body),
      }),
    );

  it("passes the reported start through, and answers as it always has", async () => {
    const startedAt = new Date(Date.now() - 30_000).toISOString();
    const res = await post({ durationSeconds: 30, agentNumber: "+12065550100", startedAt });
    const body = await json(res);

    expect(res.status).toBe(200);
    expect(Object.keys(body)).toEqual(["timezone", "minutes"]);
    expect(written?.seconds).toBe(30);
    expect(written?.startedAt.toISOString()).toBe(startedAt);
  });

  it("derives the start from arrival when the agent sends none", async () => {
    expect((await post({ durationSeconds: 90, agentNumber: "+12065550100" })).status).toBe(200);

    // Reported as the call ends, so the start is its own length before the instant it arrived.
    expect(written!.now.getTime() - written!.startedAt.getTime()).toBe(90_000);
  });

  it("ignores a start that cannot be right, rather than filing the call in another month", async () => {
    // 120 seconds rather than 90: a different length from the test above, so this assertion cannot
    // be met by the capture that one left behind.
    const res = await post({
      durationSeconds: 120,
      agentNumber: "+12065550100",
      startedAt: "2020-01-01T00:00:00Z",
    });

    expect(res.status).toBe(200);
    expect(written!.now.getTime() - written!.startedAt.getTime()).toBe(120_000);
  });
});
