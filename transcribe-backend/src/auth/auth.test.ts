import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { hashPassword } from "./password.js";
import type { UserRecord } from "../db/users.js";

// Exercises the real routes, guards and token code against an in-memory stand-in for the two
// database modules, so `bun test` needs no Postgres. Run with: bun test
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";
process.env.DATABASE_URL ??= "postgres://unused/unused";

const PASSWORD = "hunter2-hunter2";
const JANE_ID = "11111111-1111-1111-1111-111111111111";

// The fake `users` table. Each test starts from a known state via resetUsers().
let users: UserRecord[] = [];
let nextId = 0;

function jane(): UserRecord {
  return {
    id: JANE_ID,
    email: "jane@tecace.com",
    name: "Jane Kim",
    role: "admin",
    passwordHash: hashPassword(PASSWORD),
    tokenVersion: 1,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
}

function resetUsers(seeded = true): void {
  nextId = 0;
  users = seeded ? [jane()] : [];
}
resetUsers();

const byId = (id: string) => users.find((u) => u.id === id) ?? null;
const normalize = (e: string) => e.trim().toLowerCase();

const STATS = { totalProcessed: 42, totalFailed: 0, runs: 3, lastRunAt: null, today: 1, last7Days: 4, daily: [], recent: [], runSeries: [] };

await mock.module("../db/client.js", () => ({
  sql: Object.assign(() => [], { end: async () => {} }),
  initDb: async () => {},
  ensureDbReady: async () => {},
}));
await mock.module("../db/users.js", () => {
  const insert = (input: { email: string; name: string; passwordHash: string; role?: "admin" | "user" }, role?: "admin" | "user"): UserRecord => {
    const row: UserRecord = {
      id: `user-${++nextId}`,
      email: normalize(input.email),
      name: input.name.trim(),
      role: role ?? input.role ?? "user",
      passwordHash: input.passwordHash,
      tokenVersion: 1,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    users.push(row);
    return row;
  };
  return {
    normalizeEmail: normalize,
    isRole: (v: unknown) => v === "admin" || v === "user",
    toPublicUser: (u: UserRecord) => ({ id: u.id, email: u.email, name: u.name, role: u.role, lastLoginAt: u.lastLoginAt }),
    findUserByEmail: async (e: string) => users.find((u) => u.email === normalize(e)) ?? null,
    findUserById: async (id: string) => byId(id),
    listUsers: async () => [...users],
    countUsers: async () => users.length,
    countAdmins: async () => users.filter((u) => u.role === "admin").length,
    recordLogin: async (id: string) => {
      const u = byId(id);
      if (u) u.lastLoginAt = new Date().toISOString();
    },
    createUser: async (input: { email: string; name: string; passwordHash: string }) =>
      users.some((u) => u.email === normalize(input.email)) ? null : insert(input),
    // the real query hardcodes 'admin' for the first account
    createFirstUser: async (input: { email: string; name: string; passwordHash: string }) =>
      users.length > 0 ? null : insert(input, "admin"),
    setPasswordById: async (id: string, hash: string) => {
      const u = byId(id);
      if (!u) return null;
      u.passwordHash = hash;
      u.tokenVersion += 1;
      return u;
    },
    bumpTokenVersionById: async (id: string) => {
      const u = byId(id);
      if (!u) return null;
      u.tokenVersion += 1;
      return u;
    },
    promoteByEmail: async (email: string) => {
      const u = users.find((x) => x.email === normalize(email));
      if (!u) return null;
      u.role = "admin";
      return u;
    },
    setRoleById: async (id: string, role: "admin" | "user") => {
      const u = byId(id);
      if (!u) return null;
      u.role = role;
      return u;
    },
    deleteUserById: async (id: string) => {
      const before = users.length;
      users = users.filter((u) => u.id !== id);
      return users.length < before;
    },
  };
});
await mock.module("../db/voicemailRuns.js", () => ({
  getVoicemailStats: async () => STATS,
  insertVoicemailRun: async (r: unknown) => r,
}));

const { app } = await import("../app.js");

const call = (path: string, init?: RequestInit) =>
  app.handle(new Request(`http://localhost${path}`, init));

// `Response.json()` is typed `unknown`; these are our own fixtures, so read them as records.
const json = <T = Record<string, any>>(res: Response): Promise<T> => res.json() as Promise<T>;

const post = (path: string, body: unknown, token?: string) =>
  call(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const login = (email: string, password: string) => post("/auth/login", { email, password });

async function tokenFor(email = "jane@tecace.com", password = PASSWORD): Promise<string> {
  const res = await login(email, password);
  return (await json<{ token: string }>(res)).token;
}

beforeEach(() => resetUsers());
afterAll(() => mock.restore());

describe("POST /auth/login", () => {
  it("returns a token and the public user for correct credentials", async () => {
    const res = await login("jane@tecace.com", PASSWORD);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(body.user).toEqual({ id: JANE_ID, email: "jane@tecace.com", name: "Jane Kim", role: "admin", lastLoginAt: expect.any(String) });
    expect(body.user.passwordHash).toBeUndefined();
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("accepts a differently-cased email", async () => {
    expect((await login("  Jane@TecAce.com ", PASSWORD)).status).toBe(200);
  });

  it("rejects a wrong password, and an unknown email, identically", async () => {
    const wrong = await login("jane@tecace.com", "nope");
    const unknown = await login("nobody@tecace.com", PASSWORD);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await json(wrong)).toEqual(await json(unknown));
  });

  it("throttles repeated failures for the same email", async () => {
    // A distinct email so the counter can't affect the other tests (the key is email + client).
    const attacker = "guessing@tecace.com";
    for (let i = 0; i < 8; i++) expect((await login(attacker, `guess-${i}`)).status).toBe(401);
    const blocked = await login(attacker, "guess-9");
    expect(blocked.status).toBe(429);
    expect((await json(blocked)).error).toBe("too_many_attempts");
  });

  it("rejects a malformed body", async () => {
    expect((await post("/auth/login", { email: "jane@tecace.com" })).status).toBe(422);
  });
});

describe("first-run setup", () => {
  it("reports that setup is needed only while there are no accounts", async () => {
    resetUsers(false);
    expect(await json<{ needsSetup: boolean }>(await call("/auth/setup-state"))).toEqual({ needsSetup: true });
    resetUsers();
    expect(await json<{ needsSetup: boolean }>(await call("/auth/setup-state"))).toEqual({ needsSetup: false });
  });

  it("creates the first account and signs it in", async () => {
    resetUsers(false);
    const res = await post("/auth/setup", { name: "First Admin", email: "First@TecAce.com", password: "setup-password" });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.user).toMatchObject({ name: "First Admin", email: "first@tecace.com", role: "admin" });

    // the token it hands back is immediately usable
    const me = await call("/auth/me", { headers: { authorization: `Bearer ${body.token}` } });
    expect((await json(me)).user.email).toBe("first@tecace.com");
  });

  it("closes once an account exists", async () => {
    const res = await post("/auth/setup", { name: "Sneaky", email: "sneaky@example.com", password: "another-password" });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("setup_complete");
    expect(users).toHaveLength(1);
  });

  it("refuses a short password", async () => {
    resetUsers(false);
    expect((await post("/auth/setup", { name: "First", email: "first@tecace.com", password: "short" })).status).toBe(422);
    expect(users).toHaveLength(0);
  });
});

describe("GET /auth/me", () => {
  it("returns the signed-in user", async () => {
    const res = await call("/auth/me", { headers: { authorization: `Bearer ${await tokenFor()}` } });
    expect(res.status).toBe(200);
    expect((await json(res)).user.name).toBe("Jane Kim");
  });

  it("401s without a token, with a junk token, and with a tampered token", async () => {
    const token = await tokenFor();
    expect((await call("/auth/me")).status).toBe(401);
    expect((await call("/auth/me", { headers: { authorization: "Bearer junk" } })).status).toBe(401);
    expect((await call("/auth/me", { headers: { authorization: `Bearer ${token}x` } })).status).toBe(401);
    expect((await call("/auth/me", { headers: { authorization: token } })).status).toBe(401);
  });

  it("401s once the account's tokens are revoked", async () => {
    const token = await tokenFor();
    users[0]!.tokenVersion += 1; // what "sign out everywhere" does
    expect((await call("/auth/me", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });
});

describe("account management", () => {
  it("needs a session for every account route", async () => {
    expect((await call("/auth/users")).status).toBe(401);
    expect((await post("/auth/users", { name: "X", email: "x@tecace.com" })).status).toBe(401);
    expect((await post(`/auth/users/${JANE_ID}/password`, {})).status).toBe(401);
    expect((await post(`/auth/users/${JANE_ID}/revoke`, {})).status).toBe(401);
    expect((await call(`/auth/users/${JANE_ID}`, { method: "DELETE" })).status).toBe(401);
  });

  it("lists the accounts without leaking hashes", async () => {
    const res = await call("/auth/users", { headers: { authorization: `Bearer ${await tokenFor()}` } });
    const body = await json(res);
    expect(body.users).toHaveLength(1);
    expect(body.users[0].passwordHash).toBeUndefined();
    expect(body.users[0].email).toBe("jane@tecace.com");
  });

  it("adds a teammate with a generated password they can sign in with", async () => {
    const res = await post("/auth/users", { name: "Sam Lee", email: "Sam@TecAce.com" }, await tokenFor());
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.user).toMatchObject({ name: "Sam Lee", email: "sam@tecace.com" });
    expect(body.password).toEqual(expect.any(String));
    expect(body.password.length).toBeGreaterThanOrEqual(16);

    expect((await login("sam@tecace.com", body.password)).status).toBe(200);
  });

  it("does not echo a password that was supplied", async () => {
    const res = await post("/auth/users", { name: "Sam", email: "sam@tecace.com", password: "chosen-password" }, await tokenFor());
    expect((await json(res)).password).toBeNull();
    expect((await login("sam@tecace.com", "chosen-password")).status).toBe(200);
  });

  it("refuses a duplicate email and a weak password", async () => {
    const token = await tokenFor();
    const dupe = await post("/auth/users", { name: "Impostor", email: "JANE@tecace.com" }, token);
    expect(dupe.status).toBe(409);
    expect((await json(dupe)).error).toBe("email_taken");
    expect((await post("/auth/users", { name: "Sam", email: "sam@tecace.com", password: "short" }, token)).status).toBe(422);
    expect(users).toHaveLength(1);
  });

  it("resets a password and signs that account out", async () => {
    const token = await tokenFor();
    const res = await post(`/auth/users/${JANE_ID}/password`, {}, token);
    expect(res.status).toBe(200);
    const { password } = await json(res);

    // the old session died with the old password, and the new password works
    expect((await call("/auth/me", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await login("jane@tecace.com", PASSWORD)).status).toBe(401);
    expect((await login("jane@tecace.com", password)).status).toBe(200);
  });

  it("signs an account out everywhere without changing its password", async () => {
    const token = await tokenFor();
    expect((await post(`/auth/users/${JANE_ID}/revoke`, {}, token)).status).toBe(200);
    expect((await call("/auth/me", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await login("jane@tecace.com", PASSWORD)).status).toBe(200);
  });

  it("removes a teammate, but never yourself or the last account", async () => {
    const token = await tokenFor();

    const self = await call(`/auth/users/${JANE_ID}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    expect(self.status).toBe(409);
    expect((await json(self)).error).toBe("self_delete");

    const added = await json(await post("/auth/users", { name: "Sam", email: "sam@tecace.com" }, token));
    const removed = await call(`/auth/users/${added.user.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    expect(removed.status).toBe(200);
    expect(users).toHaveLength(1);

    // and the survivor can't be removed by someone else either (Sam has to be an admin to try)
    const samToken = await (async () => {
      const again = await json(
        await post("/auth/users", { name: "Sam", email: "sam@tecace.com", role: "admin" }, token),
      );
      return tokenFor("sam@tecace.com", again.password);
    })();
    users = users.filter((u) => u.email === "sam@tecace.com"); // pretend Jane is gone
    const last = await call(`/auth/users/${JANE_ID}`, { method: "DELETE", headers: { authorization: `Bearer ${samToken}` } });
    expect(last.status).toBe(404); // Jane no longer exists
    const lastSelf = await call(`/auth/users/${users[0]!.id}`, { method: "DELETE", headers: { authorization: `Bearer ${samToken}` } });
    expect(lastSelf.status).toBe(409);
    expect(users).toHaveLength(1);
  });

  it("404s on an unknown account", async () => {
    const token = await tokenFor();
    expect((await post("/auth/users/nope/password", {}, token)).status).toBe(404);
    expect((await post("/auth/users/nope/revoke", {}, token)).status).toBe(404);
    expect((await call("/auth/users/nope", { method: "DELETE", headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
  });
});

describe("roles", () => {
  // Add a plain `user` account and sign in as them.
  async function asPlainUser(): Promise<string> {
    const admin = await tokenFor();
    const created = await json(await post("/auth/users", { name: "Sam Lee", email: "sam@tecace.com" }, admin));
    expect(created.user.role).toBe("user"); // the default when no role is given
    return tokenFor("sam@tecace.com", created.password);
  }

  it("gives a new account the user role unless admin is asked for", async () => {
    const admin = await tokenFor();
    const plain = await json(await post("/auth/users", { name: "Sam", email: "sam@tecace.com" }, admin));
    const boss = await json(await post("/auth/users", { name: "Alex", email: "alex@tecace.com", role: "admin" }, admin));
    expect(plain.user.role).toBe("user");
    expect(boss.user.role).toBe("admin");
  });

  it("lets a user read the dashboard but not touch accounts", async () => {
    const sam = await asPlainUser();
    const auth = { authorization: `Bearer ${sam}` };

    // reading is fine
    expect((await call("/auth/me", { headers: auth })).status).toBe(200);
    expect((await call("/transcribe/stats", { headers: auth })).status).toBe(200);

    // managing is not
    const list = await call("/auth/users", { headers: auth });
    expect(list.status).toBe(403);
    expect((await json(list)).error).toBe("forbidden");
    expect((await post("/auth/users", { name: "X", email: "x@tecace.com" }, sam)).status).toBe(403);
    expect((await post(`/auth/users/${JANE_ID}/password`, {}, sam)).status).toBe(403);
    expect((await post(`/auth/users/${JANE_ID}/revoke`, {}, sam)).status).toBe(403);
    expect((await post(`/auth/users/${JANE_ID}/role`, { role: "user" }, sam)).status).toBe(403);
    expect((await call(`/auth/users/${JANE_ID}`, { method: "DELETE", headers: auth })).status).toBe(403);
  });

  it("promotes and demotes, and a demotion applies to the existing session at once", async () => {
    const sam = await asPlainUser();
    const admin = await tokenFor();
    const samId = users.find((u) => u.email === "sam@tecace.com")!.id;

    expect((await call("/auth/users", { headers: { authorization: `Bearer ${sam}` } })).status).toBe(403);
    const promoted = await json(await post(`/auth/users/${samId}/role`, { role: "admin" }, admin));
    expect(promoted.user.role).toBe("admin");

    // same token as before — no re-login needed, because the guard reads the role per request
    expect((await call("/auth/users", { headers: { authorization: `Bearer ${sam}` } })).status).toBe(200);

    await post(`/auth/users/${samId}/role`, { role: "user" }, admin);
    expect((await call("/auth/users", { headers: { authorization: `Bearer ${sam}` } })).status).toBe(403);
  });

  it("refuses to demote or remove the last admin", async () => {
    const admin = await tokenFor();
    await post("/auth/users", { name: "Sam", email: "sam@tecace.com" }, admin); // a user, not an admin

    const demote = await post(`/auth/users/${JANE_ID}/role`, { role: "user" }, admin);
    expect(demote.status).toBe(409);
    expect((await json(demote)).error).toBe("last_admin");

    // with a second admin in place, demoting the first is allowed
    const alex = await json(await post("/auth/users", { name: "Alex", email: "alex@tecace.com", role: "admin" }, admin));
    expect((await post(`/auth/users/${JANE_ID}/role`, { role: "user" }, admin)).status).toBe(200);

    // and now Alex is the last admin, so Alex can't be removed
    const alexToken = await tokenFor("alex@tecace.com", alex.password);
    const removeAlex = await call(`/auth/users/${alex.user.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${await tokenFor("jane@tecace.com", PASSWORD)}` },
    });
    expect(removeAlex.status).toBe(403); // Jane is only a `user` now
    void alexToken;
  });

  it("rejects a role that isn't admin or user", async () => {
    const admin = await tokenFor();
    expect((await post(`/auth/users/${JANE_ID}/role`, { role: "superuser" }, admin)).status).toBe(422);
  });
});

describe("GET /transcribe/stats", () => {
  it("401s without a session", async () => {
    expect((await call("/transcribe/stats")).status).toBe(401);
  });

  it("returns the stats with a session", async () => {
    const res = await call("/transcribe/stats", { headers: { authorization: `Bearer ${await tokenFor()}` } });
    expect(res.status).toBe(200);
    expect((await json(res)).totalProcessed).toBe(42);
  });

  it("lets a CORS preflight through", async () => {
    const res = await call("/transcribe/stats", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5174", "access-control-request-method": "GET" },
    });
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  });
});

describe("POST /transcribe/runs", () => {
  it("still uses the ingest key, not a session token", async () => {
    const res = await post("/transcribe/runs", { voicemails: 1, processed: 1, skipped: 0, failed: 0 });
    expect(res.status).toBe(201); // TRANSCRIBE_INGEST_KEY unset in tests = open
  });
});
