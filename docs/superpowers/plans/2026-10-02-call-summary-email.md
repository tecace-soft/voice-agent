# Call summary emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A business can switch on "Call emails" in Business settings; after every inbound call the receptionist answers, the account's registered email gets a short summary with a link to the transcript.

**Architecture:** A boolean `users.email_call_summaries` (default false) in transcribe-backend, read/written by `GET`/`PUT /business/call-emails`. `POST /calls` fires `emailCallSummary(call)` without awaiting it, which builds a plain-text `callSummaryMail` and sends it through the existing best-effort SMTP mailer. The dashboard gets a self-contained `CallEmailsSection` (Tailwind/shadcn, inside `.tw`) in the Calls menu group.

**Tech Stack:** Bun + Elysia + Postgres (PGlite in tests), nodemailer; React + Vite + TS, Tailwind v4 + shadcn (Base UI), Vitest; Python Playwright regression harness.

**Spec:** `docs/superpowers/specs/2026-10-02-call-summary-email-design.md`

**Git:** do NOT commit or push — the user handles all git write operations. Each task ends with a verification step instead of a commit.

---

## File map

| File | Change |
|---|---|
| `transcribe-backend/src/db/client.ts` | add the column to the self-migration |
| `transcribe-backend/src/db/users.ts` | `emailCallSummaries` on `UserRecord` + `COLUMNS`; `setEmailCallSummaries` |
| `transcribe-backend/src/email/mailer.ts` | `callSummaryMail` builder |
| `transcribe-backend/src/routes/business.ts` | `GET`/`PUT /business/call-emails` |
| `transcribe-backend/src/routes/calls.ts` | `emailCallSummary` + call it from `POST /calls` |
| `transcribe-backend/src/routes/callEmails.pg.test.ts` | **new** — all backend tests |
| `tecace-voice-agent-dashboard/src/routing.ts` | `"call-emails"` in `SECTION_IDS` |
| `tecace-voice-agent-dashboard/tests/routing.test.ts` | route test for the new section |
| `tecace-voice-agent-dashboard/src/api/backend.ts` | `CallEmails`, `getCallEmails`, `saveCallEmails` |
| `tecace-voice-agent-dashboard/src/settings/SettingsShell.tsx` | menu label/icon + Calls group |
| `tecace-voice-agent-dashboard/src/settings/sections/CallEmailsSection.tsx` | **new** — the switch |
| `tecace-voice-agent-dashboard/src/settings/BusinessSettings.tsx` | add the section entry |
| `tecace-voice-agent-dashboard/scripts/regression/fake_backend.py` | fake the two routes |
| `tecace-voice-agent-dashboard/scripts/regression/business_tabs.py` | menu item + switch check |
| `tecace-voice-agent-dashboard/CLAUDE.md` | "twelve-item menu" → "thirteen-item menu" |
| `tecace-voice-agent-dashboard/src/changelog.ts` | item in today's 0.0.14 entry |
| `HISTORY.md` | team sync entry on top |

---

### Task 1: Backend test harness + failing tests

**Files:**
- Create: `transcribe-backend/src/routes/callEmails.pg.test.ts`

- [ ] **Step 1: Create the test file with the PGlite harness**

Start the file with the header below, then copy **verbatim** lines 21–109 of `transcribe-backend/src/routes/tenancy.pg.test.ts` (from `process.env.DATABASE_URL ??= …` down to and including the closing `}` of the `for (const [, statement = ""] of body.matchAll(…))` DDL loop). Those lines are the postgres.js-shaped shim over PGlite, the `mock.module("../db/client.js", …)` and the real DDL from `client.ts`. Do **not** copy the demo-import section that follows them.

```ts
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Call summary emails: the switch (GET/PUT /business/call-emails) and the email POST /calls sends
// when it is on. Real app, real DDL on PGlite, real session tokens; the mailer's test outbox.
//
// Run: bun test src/routes/callEmails.pg.test.ts

// <<< paste tenancy.pg.test.ts lines 21–109 here >>>
```

- [ ] **Step 2: Append the fixtures and tests**

```ts
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
      outcome: "message_taken",
      durationSeconds: 125,
      turns: [
        { speaker: "agent", text: "Harbor Dental, how can I help?" },
        { speaker: "caller", text: "I'd like a cleaning." },
      ],
    },
  });

/** The email is sent after the 201, so wait for it rather than assuming it is already there. */
async function waitForMail(count: number) {
  for (let i = 0; i < 100 && outbox.length < count; i++) await Bun.sleep(5);
}

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
    await waitForMail(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(owner.email);
    expect(outbox[0]!.subject).toBe("New call from Jane Doe");
    expect(outbox[0]!.text).toContain("Request: Book a cleaning");
    expect(outbox[0]!.text).toContain("Jane wants a cleaning next week");
    expect(outbox[0]!.text).toContain("View the full transcript: https://dash.test/#/calls");
    // The summary only: the conversation itself stays in the dashboard.
    expect(outbox[0]!.text).not.toContain("how can I help?");
  });

  it("sends nothing when the switch is off", async () => {
    await setFor(owner, false);
    expect((await postCall(OWNED_LINE)).status).toBe(201);
    await Bun.sleep(50);
    expect(outbox).toHaveLength(0);
  });

  it("sends nothing for a number nobody owns", async () => {
    await setFor(owner, true);
    expect((await postCall(UNOWNED_LINE)).status).toBe(201);
    await Bun.sleep(50);
    expect(outbox).toHaveLength(0);
  });

  it("still stores the call when the mail server fails", async () => {
    await setFor(owner, true);
    useTestMailer(outbox, { fail: true });
    expect((await postCall(OWNED_LINE)).status).toBe(201);
    await Bun.sleep(50);
    expect(outbox).toHaveLength(0);
  });
});

describe("callSummaryMail", () => {
  const blank = {
    caller: null,
    callerName: null,
    callbackNumber: null,
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

  it("names an unknown caller as such", () => {
    expect(callSummaryMail("a@b.test", blank).subject).toBe("New call from an unknown caller");
  });
});
```

- [ ] **Step 3: Run the tests and see them fail**

Run (in `transcribe-backend/`): `bun test src/routes/callEmails.pg.test.ts`
Expected: FAIL. The file won't load until `callSummaryMail` exists ("Export named 'callSummaryMail' not found" or similar).

---

### Task 2: Schema column + data layer

**Files:**
- Modify: `transcribe-backend/src/db/client.ts:778` (directly after the `users_signup_source_known` constraint block)
- Modify: `transcribe-backend/src/db/users.ts` (`UserRecord`, `COLUMNS`, new setter after `findUserById`)

- [ ] **Step 1: Add the column to the self-migration**

In `client.ts`, right after the closing `` `; `` of the `ALTER TABLE users ADD CONSTRAINT users_signup_source_known …` statement (line 778), insert:

```ts

  // Email the account a summary after each call the receptionist answers. Off until they switch it
  // on (Business settings › Call emails). On the account, not the business profile: it goes to
  // their inbox, and it must work before any business information has been saved.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_call_summaries BOOLEAN NOT NULL DEFAULT false`;
```

- [ ] **Step 2: Expose it on `UserRecord`**

In `users.ts`, in `interface UserRecord`, after the `emailVerifiedAt` field:

```ts
  /** Email a summary after each call the receptionist answers (Business settings › Call emails). */
  emailCallSummaries: boolean;
```

In `const COLUMNS = sql\`…\``, change the last line from
`  email_verified_at AS "emailVerifiedAt"` to:

```ts
  email_verified_at AS "emailVerifiedAt",
  email_call_summaries AS "emailCallSummaries"
```

- [ ] **Step 3: Add the setter**

In `users.ts`, directly after `findUserById`:

```ts
/** Switch the call summary emails on or off. Null when there is no such account. */
export async function setEmailCallSummaries(id: string, enabled: boolean): Promise<UserRecord | null> {
  if (!isUserId(id)) return null;
  const [row] = await sql`
    UPDATE users SET email_call_summaries = ${enabled} WHERE id = ${id}
    RETURNING ${COLUMNS}
  `;
  return (row as UserRecord | undefined) ?? null;
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS. If any code constructs a `UserRecord` literal (test fixtures, e.g. `src/auth/auth.test.ts`), add `emailCallSummaries: false` to it.

---

### Task 3: The email builder

**Files:**
- Modify: `transcribe-backend/src/email/mailer.ts` (append after `adminNoticeMail`; update the header comment)

- [ ] **Step 1: Mention it in the header comment**

Change lines 3–4 from
```ts
// Transactional email: sign-up codes, password resets, sign-in links, "you can edit now", and the
// admin's new-request notice.
```
to
```ts
// Transactional email: sign-up codes, password resets, sign-in links, "you can edit now", the
// admin's new-request notice, and the summary after each call (when the account switched it on).
```

- [ ] **Step 2: Append `callSummaryMail`**

```ts
/** What the summary email reads from a stored call (`InboundCall` has all of these). */
export interface CallSummaryFields {
  caller: string | null;
  callerName: string | null;
  callbackNumber: string | null;
  request: string | null;
  requestedTime: string | null;
  outcome: string | null;
  durationSeconds: number | null;
  summary: string | null;
}

/** "2:05" for 125 seconds. */
function minutesSeconds(total: number): string {
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The summary after a call: the facts the receptionist captured and its own summary, with a link to
 * the full conversation in the dashboard. The transcript itself is not in the email.
 */
export function callSummaryMail(to: string, call: CallSummaryFields): Mail {
  const who = call.callerName || call.caller || "an unknown caller";
  const fields: [string, string | null][] = [
    ["Caller", [call.callerName, call.caller].filter(Boolean).join(" · ") || null],
    ["Callback number", call.callbackNumber],
    ["Request", call.request],
    ["Requested time", call.requestedTime],
    ["Outcome", call.outcome],
    ["Duration", call.durationSeconds == null ? null : minutesSeconds(call.durationSeconds)],
  ];
  const lines = fields.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
  const open = dashboardLink("/#/calls");
  return {
    to,
    subject: `New call from ${who}`,
    text:
      (lines.length ? `${lines.join("\n")}\n\n` : "") +
      (call.summary ? `${call.summary}\n\n` : "") +
      (open ? `View the full transcript: ${open}` : "The full transcript is under Transcripts in your dashboard.") +
      SIGN,
  };
}
```

- [ ] **Step 3: Run the builder tests**

Run: `bun test src/routes/callEmails.pg.test.ts -t callSummaryMail`
Expected: the two `callSummaryMail` tests PASS. The route tests still fail (404 on `/business/call-emails`).

---

### Task 4: `GET`/`PUT /business/call-emails`

**Files:**
- Modify: `transcribe-backend/src/routes/business.ts:6` (import) and after the `/forward-accept` route (~line 569)

- [ ] **Step 1: Import the setter**

Change line 6 from `import { findUserById } from "../db/users.js";` to:

```ts
import { findUserById, setEmailCallSummaries } from "../db/users.js";
```

- [ ] **Step 2: Add the routes after `.put("/forward-accept", …)`**

Insert immediately after the `/forward-accept` route's closing `)` (before the `// How the assistant introduces itself` comment):

```ts

  // Whether the account is emailed a summary after each call. A setting of the account — it goes to
  // their inbox — so unlike the switches above it works before any business information exists.
  .get(
    "/call-emails",
    async ({ headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const owner = await findUserById(profileTargetFor(user, query.userId));
      if (!owner) return status(404, { error: "not_found", message: "No such account." });
      return { enabled: owner.emailCallSummaries, email: owner.email };
    },
    { query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }) },
  )
  .put(
    "/call-emails",
    async ({ body, headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const owner = await setEmailCallSummaries(profileTargetFor(user, query.userId), body.enabled);
      if (!owner) return status(404, { error: "not_found", message: "No such account." });
      return { enabled: owner.emailCallSummaries, email: owner.email };
    },
    {
      query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }),
      body: t.Object({ enabled: t.Boolean() }),
    },
  )
```

- [ ] **Step 3: Run the route tests**

Run: `bun test src/routes/callEmails.pg.test.ts -t "call-emails"`
Expected: all six `GET/PUT /business/call-emails` tests PASS.

---

### Task 5: Send the summary from `POST /calls`

**Files:**
- Modify: `transcribe-backend/src/routes/calls.ts` (imports, `POST /` handler, new exported function at the end)

- [ ] **Step 1: Imports**

Change the `inboundCalls.js` import to also bring in the type, and add two imports, so the top of the file reads:

```ts
import { Elysia, t } from "elysia";
import { authenticate, UNAUTHORIZED } from "../auth/guard.js";
import { env } from "../config/env.js";
import {
  deleteInboundCall,
  insertInboundCall,
  listAllInboundCalls,
  listCallsAwaitingSheet,
  listInboundCalls,
  listUnassignedInboundCalls,
  markSheetWritten,
  type InboundCall,
} from "../db/inboundCalls.js";
import { findUserById } from "../db/users.js";
import { callSummaryMail, sendMail } from "../email/mailer.js";
```

- [ ] **Step 2: Fire the email after the insert**

In the `POST /` handler, replace

```ts
      const call = await insertInboundCall(body);
      return status(201, { call });
```

with

```ts
      const call = await insertInboundCall(body);
      // Not awaited: the call is stored whether or not the email goes, and the agent shouldn't wait
      // on a mail server to hear so.
      void emailCallSummary(call);
      return status(201, { call });
```

- [ ] **Step 3: Add `emailCallSummary` at the end of the file**

```ts

/**
 * Email the call's owner its summary, if they switched that on (Business settings › Call emails).
 * Best effort and never throws: a call to a number nobody owns, an account that didn't ask, or a
 * mail server that is down all just mean no email.
 */
export async function emailCallSummary(call: InboundCall): Promise<boolean> {
  try {
    if (!call.userId) return false;
    const owner = await findUserById(call.userId);
    if (!owner?.emailCallSummaries) return false;
    return await sendMail(callSummaryMail(owner.email, call));
  } catch (err) {
    console.warn(`[calls] summary email for call ${call.id} failed: ${(err as Error).message}`);
    return false;
  }
}
```

- [ ] **Step 4: Run the whole new test file**

Run: `bun test src/routes/callEmails.pg.test.ts`
Expected: all 12 tests PASS.

- [ ] **Step 5: Run the full backend suite + typecheck**

Run: `bun run typecheck && bun test`
Expected: typecheck clean; every test passes (same count as before + 12).

---

### Task 6: Dashboard route + API client

**Files:**
- Modify: `tecace-voice-agent-dashboard/src/routing.ts:59-73`
- Modify: `tecace-voice-agent-dashboard/tests/routing.test.ts` (after the test at ~line 72)
- Modify: `tecace-voice-agent-dashboard/src/api/backend.ts` (after `saveForwardAcceptPress`, ~line 502)

- [ ] **Step 1: Failing routing test**

In `tests/routing.test.ts`, after the `it(...)` block that asserts `SECTION_IDS` contains `"guided-setup"` (ends ~line 77), add inside the same `describe`:

```ts
  it("opens the Call emails section", () => {
    expect(SECTION_IDS).toContain("call-emails");
    const route = parseHash("#/business/call-emails");
    expect(route).toEqual({ view: "business", mailbox: undefined, section: "call-emails" });
    expect(formatHash(route)).toBe("#/business/call-emails");
  });
```

Run (in `tecace-voice-agent-dashboard/`): `npx vitest run tests/routing.test.ts`
Expected: FAIL — `SECTION_IDS` does not contain `"call-emails"`.

- [ ] **Step 2: Add the section id**

In `src/routing.ts` `SECTION_IDS`, add `"call-emails",` after `"transfers",`:

```ts
  "transfers",
  "call-emails",
  "custom-training",
```

Run: `npx vitest run tests/routing.test.ts` → PASS.
(`npm run typecheck` will now fail in `SettingsShell.tsx` because `SECTION_META` is a `Record<SectionId, …>` — fixed in Task 7.)

- [ ] **Step 3: API client functions**

In `src/api/backend.ts`, directly after `saveForwardAcceptPress`:

```ts
/** Whether the account gets a summary email after each call, and the address it goes to. */
export type CallEmails = { enabled: boolean; email: string };

export function getCallEmails(userId?: string): Promise<CallEmails> {
  return get<CallEmails>(`/business/call-emails${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`);
}

/** Switch the summary emails on or off. Its own endpoint: a setting of the account, not the profile. */
export function saveCallEmails(enabled: boolean, userId?: string): Promise<CallEmails> {
  return request<CallEmails>(
    "PUT",
    `/business/call-emails${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`,
    { body: { enabled } },
  );
}
```

---

### Task 7: The Call emails section

Invoke the `tecace-dashboard-ui` skill before writing this markup (CLAUDE.md requires it): sentence case, tokens/utilities only, no hex.

**Files:**
- Create: `tecace-voice-agent-dashboard/src/settings/sections/CallEmailsSection.tsx`
- Modify: `tecace-voice-agent-dashboard/src/settings/SettingsShell.tsx` (lucide import ~line 19, `SECTION_META`, `SECTION_GROUPS`)
- Modify: `tecace-voice-agent-dashboard/src/settings/BusinessSettings.tsx` (import ~line 39, section list before `forwarding`)

- [ ] **Step 1: Create the section**

```tsx
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { getCallEmails, saveCallEmails, type CallEmails } from "../../api/backend";
import { accountErrorMessage } from "../../auth";
import { SectionIntro } from "../SettingsShell";

// A summary of each call, emailed to the account's own address. One switch, saved on the flip like
// the press-to-accept switch in Call forwarding; a failed save puts it back.
//
// It loads and saves itself (GET/PUT /business/call-emails): the setting is the account's, not the
// business profile's, so it doesn't ride on BusinessSettings' profile saves. Business only — a demo
// has no inbox to send to, so DemoSettings doesn't list it.

export function CallEmailsSection({ userId }: { userId?: string }) {
  const [state, setState] = useState<CallEmails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setState(null);
    setLoadError(null);
    getCallEmails(userId).then(
      (next) => live && setState(next),
      (e) => live && setLoadError(accountErrorMessage(e, "Couldn't load this setting. Try again.")),
    );
    return () => {
      live = false;
    };
  }, [userId]);

  async function flip(on: boolean) {
    setState((s) => s && { ...s, enabled: on });
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      setState(await saveCallEmails(on, userId));
      setSaved(true);
    } catch (e) {
      setState((s) => s && { ...s, enabled: !on });
      setError(accountErrorMessage(e, "Couldn't save that. Nothing was changed."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionIntro>
        Get an email after each call your receptionist answers: who called, what they wanted and how
        the call ended. The full conversation stays under Transcripts.
      </SectionIntro>

      {loadError ? (
        <p className="ta-label-1 text-destructive" role="alert">
          {loadError}
        </p>
      ) : !state ? (
        <p className="ta-body-2 text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-xl border p-4">
          <label className="ta-label-1 flex items-center justify-between gap-4">
            Email me a summary after each call
            <Switch checked={state.enabled} disabled={saving} onCheckedChange={(on) => void flip(on)} />
          </label>
          <p className="ta-caption-1 text-muted-foreground mt-1">Sent to {state.email}</p>
          {error ? (
            <p className="ta-label-1 text-destructive mt-2" role="alert">
              {error}
            </p>
          ) : saved ? (
            <p className="ta-caption-1 text-muted-foreground mt-2">Saved. This applies from the next call.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Menu label, icon and group**

In `SettingsShell.tsx`, add `Mail,` to the `lucide-react` import list (the block ending at line 19). In `SECTION_META`, after the `transfers` line:

```ts
  "call-emails": { label: "Call emails", icon: Mail },
```

In `SECTION_GROUPS`, change the Calls group to:

```ts
  { label: "Calls", ids: ["take-message", "transfers", "text-link", "appointments", "call-emails"] },
```

- [ ] **Step 3: Add the section to the business settings**

In `BusinessSettings.tsx`, after `import { ForwardingSection } from "./sections/ForwardingSection";` add:

```ts
import { CallEmailsSection } from "./sections/CallEmailsSection";
```

In the sections array, immediately before the `{ id: "forwarding", guide: true, … }` entry, add:

```tsx
    {
      id: "call-emails",
      render: () => <CallEmailsSection userId={userId} />,
    },
```

- [ ] **Step 4: Typecheck and unit tests**

Run (in `tecace-voice-agent-dashboard/`): `npm run typecheck && npm test`
Expected: typecheck clean; all Vitest suites pass (including `routing.test.ts` and `styles.test.ts`).

---

### Task 8: Regression harness

**Files:**
- Modify: `tecace-voice-agent-dashboard/scripts/regression/fake_backend.py:1964-1966`
- Modify: `tecace-voice-agent-dashboard/scripts/regression/business_tabs.py:97-101` and after the Forwarding checks (~line 370)
- Modify: `tecace-voice-agent-dashboard/CLAUDE.md` ("twelve-item menu")

- [ ] **Step 1: Fake the two routes**

In `fake_backend.py`, near the other module-level fake state (e.g. next to `CALLS`), add:

```python
# Business settings › Call emails: the one switch, and the address it goes to.
CALL_EMAILS = {"enabled": False, "email": "owner@harbordental.test"}
```

Directly after the `/business/forward-accept` branch (line 1966), add:

```python
    if path == "/business/call-emails":
        if method == "PUT":
            sent = json.loads(body or b"{}")
            CALL_EMAILS["enabled"] = sent.get("enabled") is True
        return 200, dict(CALL_EMAILS)
```

- [ ] **Step 2: Expect the menu item**

In `business_tabs.py`, change `MENU` to:

```python
MENU = (
    "Guided setup", "Business information", "Agent profile", "FAQs", "Take a message", "Appointments",
    "Text a link", "Transfer calls", "Call emails", "Custom training", "Test & improve",
    "Launch instructions", "Call forwarding",
)
```

- [ ] **Step 3: Check the switch saves**

In `business_tabs.py`, directly after the `check("Forwarding: the switch says it saved", …)` line and before `check("...and nothing went to a demo endpoint", …)`, add (same indentation):

```python
                    # ---- Call emails
                    open_section("Call emails")
                    page.wait_for_timeout(300)
                    body = page.inner_text("main")
                    check("Call emails: says where they go", "Sent to owner@harbordental.test" in body, body[:400])
                    page.get_by_role("switch", name="Email me a summary after each call").click()
                    page.wait_for_timeout(300)
                    puts = [x for x in sent if x[0] == "PUT" and "/business/call-emails" in x[1]]
                    check("Call emails: the switch saves",
                          len(puts) == 1 and '"enabled":true' in puts[0][2].replace(" ", ""), str(puts))
                    check("Call emails: the switch says it saved", "applies from the next call" in page.inner_text("main"))
```

- [ ] **Step 4: Update the docs' menu count**

In `tecace-voice-agent-dashboard/CLAUDE.md`, under `business_tabs.py`, change "the twelve-item menu" to "the thirteen-item menu".

- [ ] **Step 5: Run the regression scripts (one at a time)**

Run (in `tecace-voice-agent-dashboard/`), each separately, waiting for the previous to finish:
1. `python scripts/regression/business_tabs.py` → every check passes, including the three `Call emails:` checks.
2. `python scripts/regression/compare.py` → prints `IDENTICAL` (transcribe screens untouched).
3. `python scripts/regression/tw_probe.py` → passes.

---

### Task 9: Changelog and HISTORY.md

**Files:**
- Modify: `tecace-voice-agent-dashboard/src/changelog.ts` (the 0.0.14 entry's `items`)
- Modify: `HISTORY.md` (new entry on top)

- [ ] **Step 1: Changelog item**

Today's release 0.0.14 (2026-10-02) already exists, so no version bump. Add as the **first** item of its `items` array:

```ts
      {
        kind: "new",
        text: "Get a summary of each call by email: turn it on under Business settings › Call emails. It goes to the email you sign in with.",
      },
```

Run: `npx vitest run tests/changelog.test.ts` → PASS.

- [ ] **Step 2: HISTORY.md entry**

Read the top of `HISTORY.md` first. Insert above the newest entry (use the current time):

```markdown
## 2026-10-02 HH:MM · Michael · transcribe-backend + dashboard (call summary emails)
- New column `users.email_call_summaries BOOLEAN NOT NULL DEFAULT false` (self-migrates); new routes `GET`/`PUT /business/call-emails` (`{enabled}` → `{enabled, email}`, admin `?userId=`).
- `POST /calls` now emails the owner a summary + dashboard link when that switch is on (fire-and-forget; the 201 is unchanged, so the agent contract is untouched).
- Dashboard: new settings section `call-emails` (Calls group); `fake_backend.py` and `business_tabs.py` updated.
- ⚠ Production: emails only go out with `SMTP_*` and `DASHBOARD_URL` set on transcribe-backend.
```

---

## Final verification

- [ ] `transcribe-backend`: `bun run typecheck && bun test` — all green.
- [ ] `tecace-voice-agent-dashboard`: `npm run build && npm test` — all green.
- [ ] Regression scripts from Task 8 Step 5 passed, run one at a time.
- [ ] Nothing committed — tell the user which files changed so they can commit.
