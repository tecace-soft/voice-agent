import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// The agent's phone numbers against Twilio, through the real routes on a real Postgres (PGlite), with
// Twilio itself faked at `fetch` as an in-memory account: what it owns, what it sells, and what each
// number's webhooks say. No request leaves the process.
//
// What matters: syncing brings the account's numbers in and matches the ones registered by hand;
// buying puts the webhooks on in the same request and never spends when the assignee already has a
// number; configure repairs a number Twilio has drifted on; release refuses an assigned number; assign
// configures; and without credentials every Twilio action says so instead of failing oddly.
//
// Run: bun test src/routes/numbers.pg.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const db = await PGlite.create();

// A postgres.js-shaped tagged template over PGlite (see testCalls.pg.test.ts for why each piece is here).
const FRAGMENT = Symbol("fragment");
const isFragment = (value: any): boolean =>
  Boolean(value) &&
  typeof value === "object" &&
  Array.isArray(value.strings) &&
  Array.isArray(value.values) &&
  "raw" in value.strings;

const TYPES_URL = new URL("../../node_modules/postgres/src/types.js", import.meta.url).href;
const { serializers } = (await import(TYPES_URL)) as { serializers: Record<number, (x: unknown) => string> };

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

const source = await Bun.file("src/db/client.ts").text();
const body = source.slice(source.indexOf("export async function initDb"), source.indexOf("// On Vercel"));
for (const [, statement = ""] of body.matchAll(/sql`([\s\S]*?)`/g)) {
  try {
    await db.exec(statement);
  } catch (error) {
    throw new Error(`DDL failed: ${statement.trim().slice(0, 90)}\n${(error as Error).message}`);
  }
}

const { createUser } = await import("../db/users.js");
const { createToken } = await import("../auth/session.js");

async function bearerFor(email: string, role: "admin" | "user"): Promise<string> {
  const user = (await createUser({ email, name: email, passwordHash: "x".repeat(60), role }))!;
  return `Bearer ${createToken(user.id, user.tokenVersion).token}`;
}

const ADMIN = await bearerFor("admin@tecace.com", "admin");
const JANE = await bearerFor("jane@tecace.com", "user");
await bearerFor("bob@tecace.com", "user");

const { env } = await import("../config/env.js");
const settingsEnv = env as unknown as Record<string, unknown>;
const PUBLIC_BEFORE = settingsEnv.publicBackendUrl;
const TWILIO_BEFORE = { ...env.twilio };
Object.assign(settingsEnv, { publicBackendUrl: "https://api.test" });
Object.assign(env.twilio, { accountSid: "ACtest", authToken: "tok", enabled: true, agentPublicUrl: "https://agent.test" });

const WANTED = {
  voiceUrl: "https://agent.test/incoming",
  voiceFallbackUrl: "https://agent.test/incoming-fallback",
  statusCallback: "https://api.test/twilio/voice-status",
};

// ----------------------------------------------------------------------------------------------
// A Twilio account in memory: the numbers it owns, what it sells, and every request it saw.
type RawNumber = {
  sid: string;
  phone_number: string;
  friendly_name: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean; fax: boolean };
  voice_url: string;
  voice_fallback_url: string;
  status_callback: string;
  sms_url: string;
};
const account = new Map<string, RawNumber>();
const requests: { method: string; url: string; form: URLSearchParams | null }[] = [];
let purchases = 0;
let nextSid = 100;
let failNext: { status: number; code: number; message: string } | null = null;

function owned(sid: string, phone: string, webhooks: Partial<Pick<RawNumber, "voice_url" | "voice_fallback_url" | "status_callback">> = {}) {
  account.set(sid, {
    sid,
    phone_number: phone,
    friendly_name: phone,
    capabilities: { voice: true, sms: true, mms: false, fax: false },
    voice_url: "",
    voice_fallback_url: "",
    status_callback: "",
    sms_url: "",
    ...webhooks,
  });
}

function applyWebhooks(raw: RawNumber, form: URLSearchParams) {
  for (const [field, key] of [
    ["VoiceUrl", "voice_url"],
    ["VoiceFallbackUrl", "voice_fallback_url"],
    ["StatusCallback", "status_callback"],
    ["SmsUrl", "sms_url"],
    ["FriendlyName", "friendly_name"],
  ] as const) {
    const value = form.get(field);
    if (value !== null) raw[key] = value;
  }
}

const twilioError = (status: number, code: number, message: string) =>
  Response.json({ code, message, more_info: `https://www.twilio.com/docs/errors/${code}`, status }, { status });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
  const url: string = typeof input === "string" ? input : input.url;
  const method = init.method ?? "GET";
  const form = init.body ? new URLSearchParams(String(init.body)) : null;
  requests.push({ method, url, form });
  if (!url.startsWith("https://api.twilio.com/")) return new Response("unexpected", { status: 500 });
  if (failNext) {
    const failure = failNext;
    failNext = null;
    return twilioError(failure.status, failure.code, failure.message);
  }
  const path = new URL(url).pathname;

  if (path.endsWith("/IncomingPhoneNumbers.json")) {
    if (method === "GET") return Response.json({ incoming_phone_numbers: [...account.values()], next_page_uri: null });
    purchases += 1;
    const sid = `PN${nextSid++}`;
    const phone = form!.get("PhoneNumber") ?? `+1${form!.get("AreaCode")}555${String(nextSid).padStart(4, "0")}`;
    owned(sid, phone);
    applyWebhooks(account.get(sid)!, form!);
    return Response.json(account.get(sid), { status: 201 });
  }
  const one = /\/IncomingPhoneNumbers\/(PN\w+)\.json$/.exec(path);
  if (one) {
    const raw = account.get(one[1]!);
    if (!raw) return twilioError(404, 20404, "The requested resource was not found");
    if (method === "DELETE") {
      account.delete(one[1]!);
      return new Response(null, { status: 204 });
    }
    if (method === "POST") applyWebhooks(raw, form!);
    return Response.json(raw);
  }
  if (path.includes("/AvailablePhoneNumbers/US/")) {
    const kind = new URL(url).searchParams.get("AreaCode") ?? (path.endsWith("TollFree.json") ? "833" : "206");
    if (kind === "999") return Response.json({ available_phone_numbers: [] }); // an area code with nothing left
    return Response.json({
      available_phone_numbers: [
        {
          phone_number: `+1${kind}5550199`,
          friendly_name: `(${kind}) 555-0199`,
          locality: kind === "206" ? "Seattle" : null,
          region: kind === "206" ? "WA" : null,
          postal_code: null,
          capabilities: { voice: true, SMS: true, MMS: false },
        },
      ],
    });
  }
  return twilioError(404, 20404, `no fake for ${method} ${path}`);
}) as typeof fetch;

afterAll(async () => {
  globalThis.fetch = realFetch;
  Object.assign(settingsEnv, { publicBackendUrl: PUBLIC_BEFORE });
  Object.assign(env.twilio, TWILIO_BEFORE);
  await db.close();
});

const { app } = await import("../app.js");
const { findUserByEmail } = await import("../db/users.js");
const jane = (await findUserByEmail("jane@tecace.com"))!;
const bob = (await findUserByEmail("bob@tecace.com"))!;

async function call(method: string, path: string, auth: string, payload?: unknown) {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { authorization: auth, "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
  return { status: response.status, body: (await response.json()) as any };
}

const numbersByPhone = async () => {
  const { body } = await call("GET", "/business/numbers", ADMIN);
  return Object.fromEntries(body.numbers.map((n: any) => [n.phoneE164, n]));
};

beforeEach(() => {
  requests.length = 0;
});

describe("GET /business/numbers/webhooks", () => {
  it("says where this server points every managed number, and which half of the setup is present", async () => {
    const { status, body } = await call("GET", "/business/numbers/webhooks", ADMIN);
    expect(status).toBe(200);
    expect(body).toEqual({ configured: true, twilio: true, webhooks: true, ...WANTED });
  });

  it("tells credentials apart from the webhook origins", async () => {
    Object.assign(settingsEnv, { publicBackendUrl: "" });
    try {
      const { body } = await call("GET", "/business/numbers/webhooks", ADMIN);
      expect(body).toEqual({ configured: false, twilio: true, webhooks: false });
    } finally {
      Object.assign(settingsEnv, { publicBackendUrl: "https://api.test" });
    }
  });
});

describe("POST /business/numbers/sync", () => {
  it("imports the account's numbers, matching a hand-registered one by its phone number", async () => {
    // Registered by hand before Twilio was wired up, and pointed at the agent in the console by hand
    // too — so it has a voice URL and no status callback.
    await call("POST", "/business/numbers", ADMIN, { phone: "+1 206 555 0100", label: "Hand-registered" });
    owned("PN1", "+12065550100", { voice_url: WANTED.voiceUrl, voice_fallback_url: WANTED.voiceFallbackUrl });
    owned("PN2", "+18335550100", {
      voice_url: WANTED.voiceUrl,
      voice_fallback_url: WANTED.voiceFallbackUrl,
      status_callback: WANTED.statusCallback,
    });
    account.get("PN2")!.friendly_name = "Pool toll-free";

    const { status, body } = await call("POST", "/business/numbers/sync", ADMIN);
    expect(status).toBe(200);
    expect(body).toMatchObject({ added: 1, updated: 1, missing: [], twilioCount: 2 });

    const numbers = await numbersByPhone();
    expect(numbers["+12065550100"]).toMatchObject({
      label: "Hand-registered",
      twilioSid: "PN1",
      numberType: "local",
      webhookState: "stale",
      capabilities: { voice: true, sms: true, mms: false },
      voiceUrl: WANTED.voiceUrl,
      statusCallbackUrl: null,
    });
    expect(numbers["+18335550100"]).toMatchObject({
      label: "Pool toll-free",
      twilioSid: "PN2",
      numberType: "tollfree",
      webhookState: "ok",
      userId: null,
    });
    expect(numbers["+12065550100"].syncedAt).toBeTruthy();
  });

  it("does not take Twilio's default name, the number written with punctuation, as a label", async () => {
    owned("PN7", "+14255550142");
    account.get("PN7")!.friendly_name = "(425) 555-0142";
    await call("POST", "/business/numbers/sync", ADMIN);
    expect((await numbersByPhone())["+14255550142"].label).toBeNull();

    // A row an earlier sync labelled that way is cleaned, and a real name then fills it.
    await db.exec("UPDATE agent_numbers SET label = '(425) 555-0142' WHERE phone_e164 = '+14255550142'");
    account.get("PN7")!.friendly_name = "Harbor Dental line";
    await call("POST", "/business/numbers/sync", ADMIN);
    expect((await numbersByPhone())["+14255550142"].label).toBe("Harbor Dental line");
    account.delete("PN7");
    await db.exec("DELETE FROM agent_numbers WHERE phone_e164 = '+14255550142'");
  });

  it("names a registered number Twilio no longer has instead of inventing state for it", async () => {
    await call("POST", "/business/numbers", ADMIN, { phone: "+12065559999" });
    const { body } = await call("POST", "/business/numbers/sync", ADMIN);
    expect(body.missing).toEqual(["+12065559999"]);
    const numbers = await numbersByPhone();
    expect(numbers["+12065559999"]).toMatchObject({ twilioSid: null, webhookState: "unknown" });
  });

  it("is admin-only", async () => {
    expect((await call("POST", "/business/numbers/sync", JANE)).status).toBe(403);
  });

  it("marks a managed number Twilio no longer has, instead of leaving it looking configured", async () => {
    owned("PNgone", "+12065550333", { voice_url: WANTED.voiceUrl, voice_fallback_url: WANTED.voiceFallbackUrl, status_callback: WANTED.statusCallback });
    await call("POST", "/business/numbers/sync", ADMIN);
    expect((await numbersByPhone())["+12065550333"].webhookState).toBe("ok");

    account.delete("PNgone"); // released in the console, behind our back
    const { body } = await call("POST", "/business/numbers/sync", ADMIN);
    expect(body.missing).toContain("+12065550333");
    const row = (await numbersByPhone())["+12065550333"];
    expect(row).toMatchObject({ twilioSid: "PNgone", webhookState: "error" });
    expect(row.webhookError).toMatch(/no longer has/);
  });
});

describe("GET /business/numbers/available", () => {
  it("asks Twilio for the kind and area code and hands the results back in our shape", async () => {
    const { status, body } = await call("GET", "/business/numbers/available?type=tollfree&areaCode=833", ADMIN);
    expect(status).toBe(200);
    expect(body.numbers).toEqual([
      {
        phoneNumber: "+18335550199",
        friendlyName: "(833) 555-0199",
        locality: null,
        region: null,
        postalCode: null,
        capabilities: { voice: true, sms: true, mms: false },
        type: "tollfree",
      },
    ]);
    expect(requests[0]!.url).toContain("/AvailablePhoneNumbers/US/TollFree.json?AreaCode=833");
  });

  it("refuses an unknown kind or a malformed area code before asking Twilio", async () => {
    expect((await call("GET", "/business/numbers/available?type=mobile", ADMIN)).body.error).toBe("bad_type");
    expect((await call("GET", "/business/numbers/available?type=local&areaCode=20", ADMIN)).body.error).toBe("bad_area_code");
    expect(requests).toEqual([]);
  });
});

describe("POST /business/numbers/buy", () => {
  it("buys with the webhooks in the same request, records the number as configured, and assigns it", async () => {
    const { status, body } = await call("POST", "/business/numbers/buy", ADMIN, {
      phoneNumber: "+12065550199",
      label: "Jane's line",
      assignTo: jane.id,
    });
    expect(status).toBe(201);
    expect(body.number).toMatchObject({
      phoneE164: "+12065550199",
      label: "Jane's line",
      userId: jane.id,
      numberType: "local",
      webhookState: "ok",
      voiceUrl: WANTED.voiceUrl,
      voiceFallbackUrl: WANTED.voiceFallbackUrl,
      statusCallbackUrl: WANTED.statusCallback,
    });
    expect(body.number.twilioSid).toMatch(/^PN/);
    expect(body.number.purchasedAt).toBeTruthy();

    const purchase = requests.find((r) => r.method === "POST" && r.url.endsWith("/IncomingPhoneNumbers.json"))!;
    expect(Object.fromEntries(purchase.form!)).toMatchObject({
      PhoneNumber: "+12065550199",
      FriendlyName: "Jane's line",
      VoiceUrl: WANTED.voiceUrl,
      VoiceFallbackUrl: WANTED.voiceFallbackUrl,
      StatusCallback: WANTED.statusCallback,
    });
  });

  it("refuses before spending when the assignee already has a number", async () => {
    const before = purchases;
    const { status, body } = await call("POST", "/business/numbers/buy", ADMIN, { type: "local", areaCode: "206", assignTo: jane.id });
    expect(status).toBe(409);
    expect(body.error).toBe("already_has_number");
    expect(purchases).toBe(before);
  });

  it("buys once for one requestId, however many times the click arrives", async () => {
    const before = purchases;
    const first = await call("POST", "/business/numbers/buy", ADMIN, { type: "tollfree", requestId: "click-1" });
    const again = await call("POST", "/business/numbers/buy", ADMIN, { type: "tollfree", requestId: "click-1" });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.number.id).toBe(first.body.number.id);
    expect(purchases).toBe(before + 1);
    expect(first.body.number).toMatchObject({ userId: null, webhookState: "ok" });
  });

  it("replays a buy-and-assign too — the retry the request id exists for", async () => {
    const before = purchases;
    const first = await call("POST", "/business/numbers/buy", ADMIN, { type: "local", areaCode: "360", assignTo: bob.id, requestId: "click-2" });
    const again = await call("POST", "/business/numbers/buy", ADMIN, { type: "local", areaCode: "360", assignTo: bob.id, requestId: "click-2" });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.number).toMatchObject({ id: first.body.number.id, userId: bob.id });
    expect(purchases).toBe(before + 1);
    // Leave Bob without a number again for the tests that follow.
    await call("POST", `/business/numbers/${first.body.number.id}/assign`, ADMIN, { userId: null });
  });

  it("needs either a number or a kind to buy", async () => {
    const { status, body } = await call("POST", "/business/numbers/buy", ADMIN, { label: "nothing" });
    expect(status).toBe(400);
    expect(body.error).toBe("bad_request");
  });

  it("refuses a malformed exact number before asking Twilio", async () => {
    const before = requests.length;
    const { status, body } = await call("POST", "/business/numbers/buy", ADMIN, { phoneNumber: "call me maybe" });
    expect(status).toBe(400);
    expect(body.error).toBe("bad_number");
    expect(requests.length).toBe(before);
  });

  it("says when Twilio has nothing of that kind there", async () => {
    const { status, body } = await call("POST", "/business/numbers/buy", ADMIN, { type: "local", areaCode: "999" });
    expect(status).toBe(409);
    expect(body.error).toBe("no_numbers_in_area");
    expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/IncomingPhoneNumbers.json"))).toBe(false);
  });

  it("tells the admin when the number was taken between the search and the click", async () => {
    failNext = { status: 400, code: 21422, message: "The phone number is not available" };
    const { status, body } = await call("POST", "/business/numbers/buy", ADMIN, { phoneNumber: "+12065550188" });
    expect(status).toBe(409);
    expect(body.error).toBe("number_taken");
  });

  it("will not hand a number to an admin", async () => {
    const admin = (await findUserByEmail("admin@tecace.com"))!;
    const { status, body } = await call("POST", "/business/numbers/buy", ADMIN, { type: "local", assignTo: admin.id });
    expect(status).toBe(400);
    expect(body.error).toBe("admin_cannot_hold_number");
  });
});

describe("POST /business/numbers/:id/configure", () => {
  it("repairs a number Twilio has drifted on", async () => {
    const stale = (await numbersByPhone())["+12065550100"];
    expect(stale.webhookState).toBe("stale");

    const { status, body } = await call("POST", `/business/numbers/${stale.id}/configure`, ADMIN);
    expect(status).toBe(200);
    expect(body.number).toMatchObject({ webhookState: "ok", statusCallbackUrl: WANTED.statusCallback });
    expect(account.get("PN1")).toMatchObject({ status_callback: WANTED.statusCallback, voice_url: WANTED.voiceUrl });
  });

  it("cannot configure a number that is not in the Twilio account", async () => {
    const missing = (await numbersByPhone())["+12065559999"];
    const { status, body } = await call("POST", `/business/numbers/${missing.id}/configure`, ADMIN);
    expect(status).toBe(409);
    expect(body.error).toBe("not_in_twilio");
  });

  it("records Twilio's refusal on the number rather than losing it", async () => {
    const number = (await numbersByPhone())["+12065550100"];
    failNext = { status: 401, code: 20003, message: "Authenticate" };
    const { status, body } = await call("POST", `/business/numbers/${number.id}/configure`, ADMIN);
    expect(status).toBe(502);
    expect(body.error).toBe("twilio_error");
    expect((await numbersByPhone())["+12065550100"]).toMatchObject({ webhookState: "error", webhookError: "Authenticate" });
  });
});

describe("POST /business/numbers/:id/assign", () => {
  it("configures the webhooks once a number has an owner", async () => {
    // Drift PN1 again at Twilio, so the assign has something to fix; resync so the row knows.
    account.get("PN1")!.status_callback = "";
    await call("POST", "/business/numbers/sync", ADMIN);
    const number = (await numbersByPhone())["+12065550100"];
    expect(number.webhookState).toBe("stale");

    const { status, body } = await call("POST", `/business/numbers/${number.id}/assign`, ADMIN, { userId: bob.id });
    expect(status).toBe(200);
    expect(body.number).toMatchObject({ userId: bob.id, webhookState: "ok" });
    expect(account.get("PN1")!.status_callback).toBe(WANTED.statusCallback);
  });

  it("still assigns when Twilio refuses, and says so on the number", async () => {
    const number = (await numbersByPhone())["+12065550100"];
    await call("POST", `/business/numbers/${number.id}/assign`, ADMIN, { userId: null });
    failNext = { status: 500, code: 20500, message: "Internal Server Error" };
    const { status, body } = await call("POST", `/business/numbers/${number.id}/assign`, ADMIN, { userId: bob.id });
    expect(status).toBe(200);
    expect(body.number).toMatchObject({ userId: bob.id, webhookState: "error", webhookError: "Internal Server Error" });
  });
});

describe("readiness", () => {
  it("requires the webhooks of a managed number, and shows what is wrong", async () => {
    // Bob holds PN1, last seen in error. Twilio itself is fine now; a sync would say stale.
    account.get("PN1")!.status_callback = "";
    await call("POST", "/business/numbers/sync", ADMIN);
    const { body } = await call("GET", `/business/readiness?userId=${bob.id}`, ADMIN);
    const item = body.items.find((entry: any) => entry.id === "webhooks_configured");
    expect(item).toMatchObject({ ok: false, required: true });

    const number = (await numbersByPhone())["+12065550100"];
    await call("POST", `/business/numbers/${number.id}/configure`, ADMIN);
    const after = await call("GET", `/business/readiness?userId=${bob.id}`, ADMIN);
    expect(after.body.items.find((entry: any) => entry.id === "webhooks_configured")).toMatchObject({ ok: true, required: true });
  });
});

describe("POST /business/numbers/:id/release", () => {
  it("refuses while the number is assigned", async () => {
    const number = (await numbersByPhone())["+12065550100"];
    const { status, body } = await call("POST", `/business/numbers/${number.id}/release`, ADMIN, { confirm: "+12065550100" });
    expect(status).toBe(409);
    expect(body.error).toBe("number_assigned");
    expect(account.has("PN1")).toBe(true);
  });

  it("wants the number typed back before it lets go of it", async () => {
    const number = (await numbersByPhone())["+18335550100"];
    const { status, body } = await call("POST", `/business/numbers/${number.id}/release`, ADMIN, { confirm: "+18335550199" });
    expect(status).toBe(400);
    expect(body.error).toBe("confirm_mismatch");
  });

  it("will not release a number bought outside the dashboard — that happens in the Twilio console", async () => {
    // Synced in, never bought here: somebody bought it in the console, perhaps for something else.
    const number = (await numbersByPhone())["+18335550100"];
    expect(number.purchasedAt).toBeNull();
    const { status, body } = await call("POST", `/business/numbers/${number.id}/release`, ADMIN, { confirm: "+18335550100" });
    expect(status).toBe(409);
    expect(body.error).toBe("bought_elsewhere");
    expect(account.has("PN2")).toBe(true);
  });

  it("releases at Twilio and hides the row until asked for released numbers", async () => {
    // As if it had been bought through the dashboard.
    await db.exec("UPDATE agent_numbers SET purchased_at = now() WHERE phone_e164 = '+18335550100'");
    const number = (await numbersByPhone())["+18335550100"];
    const { status, body } = await call("POST", `/business/numbers/${number.id}/release`, ADMIN, { confirm: "+18335550100" });
    expect(status).toBe(200);
    expect(body.number.releasedAt).toBeTruthy();
    expect(account.has("PN2")).toBe(false);
    expect((await numbersByPhone())["+18335550100"]).toBeUndefined();
    const all = await call("GET", "/business/numbers?includeReleased=1", ADMIN);
    expect(all.body.numbers.some((n: any) => n.phoneE164 === "+18335550100" && n.releasedAt)).toBe(true);
  });

  it("treats a number Twilio already let go of as released", async () => {
    const bought = await call("POST", "/business/numbers/buy", ADMIN, { type: "local", areaCode: "425" });
    account.delete(bought.body.number.twilioSid);
    const { status } = await call("POST", `/business/numbers/${bought.body.number.id}/release`, ADMIN, { confirm: bought.body.number.phoneE164 });
    expect(status).toBe(200);
  });

  it("has nothing to release for a number registered by hand — that is Delete", async () => {
    const missing = (await numbersByPhone())["+12065559999"];
    const { status, body } = await call("POST", `/business/numbers/${missing.id}/release`, ADMIN, { confirm: "+12065559999" });
    expect(status).toBe(409);
    expect(body.error).toBe("not_in_twilio");
  });

  it("does not let a released number be assigned", async () => {
    const all = await call("GET", "/business/numbers?includeReleased=1", ADMIN);
    const released = all.body.numbers.find((n: any) => n.phoneE164 === "+18335550100");
    const { status, body } = await call("POST", `/business/numbers/${released.id}/assign`, ADMIN, { userId: jane.id });
    expect(status).toBe(409);
    expect(body.error).toBe("number_released");
  });

  it("reads includeReleased as a flag, so 0 and false mean no", async () => {
    for (const value of ["0", "false"]) {
      const { body } = await call("GET", `/business/numbers?includeReleased=${value}`, ADMIN);
      expect(body.numbers.some((n: any) => n.releasedAt)).toBe(false);
    }
  });

  it("no longer answers the agent for a released number", async () => {
    Object.assign(settingsEnv, { agentConfigKey: "agent-key" });
    try {
      const response = await app.handle(
        new Request("http://localhost/business/config?to=%2B18335550100", { headers: { "x-agent-key": "agent-key" } }),
      );
      expect(await response.json()).toMatchObject({ assigned: false, reason: "no_number" });
    } finally {
      Object.assign(settingsEnv, { agentConfigKey: "" });
    }
  });

  it("buying a released number again reuses its row, un-released and configured", async () => {
    const all = await call("GET", "/business/numbers?includeReleased=1", ADMIN);
    const released = all.body.numbers.find((n: any) => n.phoneE164 === "+18335550100");
    const { status, body } = await call("POST", "/business/numbers/buy", ADMIN, { phoneNumber: "+18335550100", label: "Second life" });
    expect(status).toBe(201);
    expect(body.number).toMatchObject({ id: released.id, releasedAt: null, webhookState: "ok", label: "Second life", userId: null });
    expect(body.number.twilioSid).not.toBe("PN2");
  });

  it("forgets a released number's row on Delete — it is history, nothing is billed", async () => {
    const bought = await call("POST", "/business/numbers/buy", ADMIN, { phoneNumber: "+12065550444" });
    await call("POST", `/business/numbers/${bought.body.number.id}/release`, ADMIN, { confirm: "+12065550444" });
    const { status } = await call("DELETE", `/business/numbers/${bought.body.number.id}`, ADMIN);
    expect(status).toBe(200);
    const all = await call("GET", "/business/numbers?includeReleased=1", ADMIN);
    expect(all.body.numbers.some((n: any) => n.phoneE164 === "+12065550444")).toBe(false);
  });

  it("will not Delete a number Twilio still bills — that is Release", async () => {
    const managed = (await numbersByPhone())["+18335550100"];
    const { status, body } = await call("DELETE", `/business/numbers/${managed.id}`, ADMIN);
    expect(status).toBe(409);
    expect(body.error).toBe("use_release");
    expect((await numbersByPhone())["+18335550100"]).toBeTruthy();
  });
});

describe("without Twilio credentials", () => {
  it("every Twilio action says so; listing, registering and assigning by hand still work", async () => {
    Object.assign(env.twilio, { enabled: false });
    try {
      for (const [method, path] of [
        ["POST", "/business/numbers/sync"],
        ["GET", "/business/numbers/available?type=local"],
        ["POST", "/business/numbers/buy"],
      ] as const) {
        const { status, body } = await call(method, path, ADMIN, method === "POST" ? { type: "local" } : undefined);
        expect([status, body.error]).toEqual([409, "twilio_not_configured"]);
      }
      expect((await call("GET", "/business/numbers/webhooks", ADMIN)).body.configured).toBe(false);
      expect((await call("GET", "/business/numbers", ADMIN)).status).toBe(200);
      const registered = await call("POST", "/business/numbers", ADMIN, { phone: "+12065550777" });
      expect(registered.status).toBe(201);
      const assigned = await call("POST", `/business/numbers/${registered.body.number.id}/assign`, ADMIN, { userId: jane.id });
      // Jane already holds a bought number.
      expect(assigned.body.error).toBe("already_has_number");
      expect(requests).toEqual([]);
    } finally {
      Object.assign(env.twilio, { enabled: true });
    }
  });
});
