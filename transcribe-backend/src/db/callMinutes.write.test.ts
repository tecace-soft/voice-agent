import { beforeEach, describe, expect, it, mock } from "bun:test";

// The WRITE half of the call-minutes counter — that a session row and the counter increment really
// do go in together, and under the same owner. Against a stand-in for postgres.js: the claim is
// which statements run, in what order and inside which transaction, and none of that needs a
// database to watch. (callMinutes.test.ts covers the pure month arithmetic.)
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const OWNER = "11111111-1111-1111-1111-111111111111";

interface Statement {
  /** Which transaction ran it; null for one run straight on the pool. */
  tx: number | null;
  /** The SQL with its interpolations blanked out, so a test can say what the statement targeted. */
  text: string;
  values: unknown[];
}

let statements: Statement[] = [];
let transactions = 0;
// Set by the rollback test, so the session insert fails the way a constraint would.
let failSessionInsert = false;

// A tagged template that records rather than executes, and answers with the single row both the
// upsert's RETURNING and the read-back expect.
const record = (tx: number | null) =>
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    statements.push({ tx, text, values });
    if (failSessionInsert && text.includes("agent_call_sessions")) {
      return Promise.reject(new Error("session insert failed"));
    }
    return Promise.resolve([{ ownerKey: OWNER, userId: OWNER }]);
  };

await mock.module("./client.js", () => ({
  sql: Object.assign(record(null), {
    // The real `begin` hands the callback a transaction-scoped handle; here each one is numbered, so
    // a test can tell "both statements, one transaction" from "two statements, two transactions".
    begin: async (fn: (tx: ReturnType<typeof record>) => Promise<unknown>) => {
      transactions += 1;
      return fn(record(transactions));
    },
    end: async () => {},
  }),
  initDb: async () => {},
  ensureDbReady: async () => {},
}));

const { addCallSeconds } = await import("./callMinutes.js");

const inTransaction = () => statements.filter((s) => s.tx !== null);
const onThePool = () => statements.filter((s) => s.tx === null);

describe("addCallSeconds", () => {
  const now = new Date("2026-09-15T07:00:00Z");
  const startedAt = new Date("2026-09-15T06:58:30Z");

  beforeEach(() => {
    statements = [];
    transactions = 0;
    failSessionInsert = false;
  });

  it("writes the counter and the session in one transaction", async () => {
    await addCallSeconds(90, "+12065550100", now, startedAt);

    expect(transactions).toBe(1);
    const inside = inTransaction();
    expect(inside).toHaveLength(2);
    expect(inside.every((s) => s.tx === 1)).toBe(true); // the same one, not one each
    expect(inside[0]!.text).toContain("INSERT INTO agent_call_minutes");
    expect(inside[1]!.text).toContain("INSERT INTO agent_call_sessions");
  });

  it("files the session under the start it was given, and under the owner the counter used", async () => {
    await addCallSeconds(90, "+12065550100", now, startedAt);

    const session = inTransaction()[1]!;
    // started_at then reported_at: the call's own start is what ranges are measured by, and the two
    // differ by the call's length. Passing `now` for both would put every call in the wrong period.
    expect(session.values.filter((v) => v instanceof Date)).toEqual([startedAt, now]);
    expect(session.values).toContain(90);
    // The owner comes from the upsert's RETURNING, not from a second look at the number — so the two
    // rows cannot disagree about who the call belonged to.
    expect(session.values).toContain(OWNER);
    expect(session.text).not.toContain("agent_numbers");
  });

  it("reads the totals back outside the transaction", async () => {
    const owner = await addCallSeconds(90, "+12065550100", now, startedAt);

    expect(owner.userId).toBe(OWNER);
    expect(onThePool().some((s) => s.text.includes("FROM agent_call_minutes"))).toBe(true);
  });

  it("reads nothing back when the write failed, so a rolled-back call is never reported as counted", async () => {
    failSessionInsert = true;

    await expect(addCallSeconds(90, "+12065550100", now, startedAt)).rejects.toThrow("session insert failed");
    expect(onThePool()).toHaveLength(0);
  });
});
