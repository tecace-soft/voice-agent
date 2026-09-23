# Demo test call — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the "Call now" panel on a prospect's detail page, served by transcribe-backend, together with the post-call review and the "Analyze" button it makes meaningful again.

**Architecture:** Three of the promo's server modules are copied verbatim (`openai.ts`, `call-clock.ts`, `call-review.ts`) and covered by the same parity test that protects `analytics.ts`. Two new admin-guarded routes sit on top. The client files are re-ported from the promo, because the earlier stage deleted them and they were never committed.

**Tech stack:** Bun, Elysia, postgres.js, `bun test` + PGlite; React/Vite; Python/Playwright.

**Source of truth:** `docs/superpowers/specs/2026-09-23-demo-test-call-design.md`. Read it first — in particular the table showing how much of the promo's session route does *not* apply to an admin test call.

**Promo repo (READ ONLY):** `C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo`

**No commits.** The user handles all git operations.

**No test may make a real OpenAI request.** Every test stubs `fetch` at the boundary. A test that dials for real is a defect in the test.

---

## File structure

**transcribe-backend**

| File | Responsibility |
| --- | --- |
| `src/config/env.ts` (modify) | `openaiApiKey`, `openaiBaseUrl`, `openaiLiveModel`, `openaiBackendModel`, `callReviewModel`, `defaultTimezone` |
| `src/demo/openai.ts` (new) | Verbatim `lib/openai.ts` — `OpenAIError`, `createLiveSession`, `createResponse` |
| `src/demo/callClock.ts` (new) | Verbatim `lib/call-clock.ts` — today's date + opening hours for the prompt |
| `src/demo/callReview.ts` (new) | Verbatim `lib/call-review.ts` + `extractJson` + `transcriptText` |
| `src/demo/parity.test.ts` (rename) | `analytics.parity.test.ts` generalised over a table of ported files |
| `src/routes/demo.ts` (modify) | `POST /demo/session`, `POST /demo/calls/:callId` |
| `src/routes/demoCall.pg.test.ts` (new) | Both routes against PGlite, `fetch` stubbed |

**tecace-voice-agent-dashboard**

| File | Responsibility |
| --- | --- |
| `src/demos/hooks/useLiveCall.ts` (re-port) | WebRTC, microphone, live transcript, end-of-call report |
| `src/demos/components/call/CallPanel.tsx` (re-port) | The panel |
| `src/demos/lib/ringtone.ts` (re-port) | Ring while connecting |
| `src/demos/screens/ProspectScreen.tsx` (modify) | The right-hand column returns |
| `src/demos/components/admin/ActivityTab.tsx` (modify) | "Analyze" returns |
| `scripts/regression/fake_backend.py`, `demos_e2e.py` (modify) | `/demo/session`, `/demo/calls/:id`, and the test-call checks |

---

### Task 1: Configuration

**Files:** modify `src/config/env.ts`, `.env.example`, `README.md`

- [ ] **Step 1: Add the settings**

In `src/config/env.ts`, following the existing `geminiApiKey` precedent (optional, no throw at
import — the other Demo tabs must keep working on a deployment with no key):

```ts
// The Demo test call runs on OpenAI's live API, the same key and model openai-agent-app uses
// (its .env.example: OPENAI_API_KEY, OPENAI_LIVE_MODEL=gpt-live-1). Optional here on purpose: a
// deployment without it serves every other Demo route normally and refuses only the dial, with
// the message the promo used.
const openaiApiKey = process.env.OPENAI_API_KEY?.trim() || undefined;
```

and in the exported `env` object:

```ts
  openaiApiKey,
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  openaiLiveModel: process.env.OPENAI_LIVE_MODEL || "gpt-live-1",
  openaiBackendModel: process.env.OPENAI_BACKEND_MODEL || "gpt-5.6-terra",
  callReviewModel: process.env.CALL_REVIEW_MODEL || "gpt-5.6-terra",
  // A browser that sends no timezone, or a value that is not one.
  defaultTimezone: process.env.DEFAULT_TIMEZONE || "America/Los_Angeles",
```

- [ ] **Step 2: Document them**

Add all six to `.env.example` with comments in that file's voice, grouped under a
`# ---- Demo test call ----` heading, saying plainly that without `OPENAI_API_KEY` the Demo tabs
work and only the test call is refused. Add a short subsection to the README's Demo data section.

- [ ] **Step 3: Verify** — `bun run typecheck` silent, `bun test` still passing.

---

### Task 2: Port the OpenAI client, and generalise the parity test

**Files:** create `src/demo/openai.ts`; rename `src/demo/analytics.parity.test.ts` → `src/demo/parity.test.ts`; modify `src/demo/PORTING.md`

- [ ] **Step 1: Copy `lib/openai.ts` verbatim**

Copy to `src/demo/openai.ts`. The only permitted changes:
- `process.env.OPENAI_BASE_URL` / `OPENAI_API_KEY` reads become `env.openaiBaseUrl` / `env.openaiApiKey`, with `import { env } from "../config/env.js"` added;
- the missing-key message stays **exactly** `"OPENAI_API_KEY is not set on the server."`;
- import specifiers gain `.js`.

Change nothing else — not a comment, not the `OpenAIError` shape, not the SDP-answer fallback
(`data.transport?.sdp ?? data.sdp`), not the timeouts.

- [ ] **Step 2: Generalise the parity test**

Rename the file and replace its single hard-coded path with a table, keeping the existing mechanism
(compare line by line; every differing line number must appear in `PORTING.md`):

```ts
const PORTED: { ours: string; theirs: string }[] = [
  { ours: "src/demo/analytics.ts", theirs: "lib/analytics.ts" },
  { ours: "src/demo/openai.ts", theirs: "lib/openai.ts" },
];

const PROMO = String.raw`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo`;

describe("ported promo modules stay verbatim copies", () => {
  for (const { ours, theirs } of PORTED) {
    it(`${ours} differs from ${theirs} only by the documented lines`, async () => {
      const promoFile = Bun.file(`${PROMO}\\${theirs.replace(/\//g, "\\")}`);
      if (!(await promoFile.exists())) return; // the promo repo is not on every machine
      const them = (await promoFile.text()).replace(/\r\n/g, "\n").split("\n");
      const us = (await Bun.file(ours).text()).replace(/\r\n/g, "\n").split("\n");
      expect(us.length).toBe(them.length);
      const differing = us
        .map((line, i) => (line === them[i] ? null : i + 1))
        .filter((n): n is number => n !== null);
      const porting = await Bun.file("src/demo/PORTING.md").text();
      const name = ours.split("/").pop();
      for (const line of differing) expect(porting).toContain(`${name}:${line}`);
    });
  }
});
```

The existing `analytics.ts:9` / `analytics.ts:10` entries in `PORTING.md` must keep working
unchanged — do not renumber or reword them.

- [ ] **Step 3: Record the deviations** in `PORTING.md` as `openai.ts:<line> — <why>`, then run
`bun test src/demo/parity.test.ts`, `bun run typecheck`, and the full `bun test`.

- [ ] **Step 4: Prove the new entry is not vacuous** — change one character in `src/demo/openai.ts`,
confirm the test fails naming the line, restore. Report the message.

---

### Task 3: Port the call clock

**Files:** create `src/demo/callClock.ts`; modify `src/demo/parity.test.ts`, `PORTING.md`

- [ ] **Step 1: Copy `lib/call-clock.ts` verbatim**, adding `.js` to import specifiers and routing
any `process.env` read through `env`.

Put the imports in a **header**: the parity test (generalised in Task 2, then extended during its
review) takes a `header: <n>` per entry, checks those top-of-file lines really are imports or
blank, skips them, and compares the rest line for line — reporting real editor line numbers. Record
the header in `PORTING.md` as `<file>:1-<n>`. Do **not** staple an import onto the first line of a
comment to keep the line counts equal; that was tried in Task 2 and undone.

It exports `callClock` and `safeTimeZone`; it reads
`profile.hours`, whose type comes from `src/demo/types.ts` — check the import resolves there rather
than copying the type again.

- [ ] **Step 2: Add it to `PORTED`**, record deviations in `PORTING.md`, run the parity test.

- [ ] **Step 3: Verify** — `bun run typecheck`, full `bun test`.

---

### Task 4: Port the post-call review

**Files:** create `src/demo/callReview.ts`; modify `src/demo/parity.test.ts`, `PORTING.md`

- [ ] **Step 1: Copy `lib/call-review.ts` verbatim.** It needs two helpers from elsewhere in the
promo, which come across as verbatim copies too, at the bottom of the same file (noting their origin
in a comment, as Task 1 of the previous stage did for `AmbienceLevel`):
- `extractJson` from `lib/claude-cli.ts` (nothing else from that module);
- `transcriptText` from `lib/transcript.ts` (nothing else).

The `header` mechanism covers the imports, but the two copied helpers go at the **bottom**, so the file is longer than the promo's and `callReview.ts` cannot be line-compared as a whole. Add
it to `PORTED` with a marker meaning "compare only up to the copied-helpers boundary", or leave it
out of `PORTED` and say in `PORTING.md` exactly which promo lines it contains. Choose one, implement
it, and say which you chose and why.

- [ ] **Step 2: Route the model name** through `env.callReviewModel`, and keep the two guards
exactly: `MIN_CALLER_LINES`, and returning `null` when there is no API key.

- [ ] **Step 3: Verify** — `bun run typecheck`, full `bun test`.

---

### Task 5: `POST /demo/session`

**Files:** modify `src/routes/demo.ts`

- [ ] **Step 1: Read the promo's route first**

`app/api/session/route.ts`. Reproduce the body for the `isTest === true` path only. The design doc's
table says what drops out; everything it marks **Skipped** or **Not needed** must not appear here.

- [ ] **Step 2: Write it**

```
POST /demo/session   body { customerId, sdp, timeZone? }  ->  { callId, sessionId, sdp, greeting }
```

In order, with the promo's own status codes and error strings:
1. `authenticateAdmin(headers.authorization, DEMO_IS_ADMIN)`.
2. `!customerId || !sdp` → 400 `"Missing customerId or sdp."`.
3. The promo's IP rate limit, verbatim: `RATE_LIMIT = 5`, `RATE_WINDOW_MS = 60_000`, the
   `recentByIp` map and its 5000-entry sweep, `clientIp` reading `x-forwarded-for`. 429
   `"Too many calls in a row. Wait a minute and try again."`.
4. `getCustomer` → 404 `"This demo isn't available."`; `!active` → 403 `"This demo is paused."`;
   `status !== "ready"` → 409 `"This demo is still being prepared."`.
5. Insert the call row **before** contacting OpenAI, `status: "started"`, `is_test: true`,
   `user_agent` from the request, a `newId(12)`. Keep the promo's comment explaining the ordering.
6. `callClock(new Date(), safeTimeZone(body.timeZone, env.defaultTimezone), customer.profile.hours)`,
   appended to `customer.prompts.live` and `customer.prompts.backend` exactly as the promo does.
7. `createLiveSession(...)` with `env.openaiLiveModel`, `audio.output.voice = customer.voice`, the
   `responses` delegation on `env.openaiBackendModel`, `store: false`.
8. On success save `liveSessionId` and answer. **On any failure delete the call row** and forward
   `OpenAIError.status` (else 500) with the error's message — a phantom `started` row otherwise sits
   in the Activity tab and counts as in-flight for ten minutes.

You will need a writer for steps 5 and 8. `demoWrite.ts` has no "create a call" or "delete a call";
add `startCall(...)`, `finishCall(...)` and `deleteCall(...)` there rather than writing SQL inside
the route — every other route in this file delegates. Bind JSONB with `sql.json()` (see
`jsonbBinding.test.ts`; pre-stringifying is the bug that shipped once already).

- [ ] **Step 3: Verify** — `bun run typecheck`, full `bun test`.

---

### Task 6: `POST /demo/calls/:callId`

**Files:** modify `src/routes/demo.ts`, `src/db/demoWrite.ts`

- [ ] **Step 1: Read `app/api/calls/[callId]/route.ts`**, then reproduce it:

```
POST /demo/calls/:callId  body { customerId?, status, durationSec, endReason, transcript }
                          ->  { ok, reviewed } | { ok: true, alreadyReported: true }
```

- Admin guard; unknown call → 404 `"Call not found."`.
- **`status !== "started"` → `{ ok: true, alreadyReported: true }`, changing nothing.** A beacon can
  land after the normal report; the first result wins. This is the property to get right.
- `status` must be one of `completed` / `failed` / `abandoned`, else `abandoned`; transcript capped
  at 500 entries; `durationSec` rounded and non-negative; `endReason` sliced to 120 chars;
  `turns = transcript.length`.
- Then `reviewCall(ended)`; if it returns a review, save it. **A failed review is saved as no
  review** — never a failed call. Answer `{ ok: true, reviewed: Boolean(review) }`.

- [ ] **Step 2: Verify** — `bun run typecheck`, full `bun test`.

---

### Task 7: Both routes against a real Postgres

**Files:** create `src/routes/demoCall.pg.test.ts`

- [ ] **Step 1: Write it**

Reuse the shim from `src/routes/demo.pg.test.ts` **including its `bind()`/`sql.json` handling** —
that is what makes JSONB faithful. Stub `globalThis.fetch` so no request leaves the process; assert
on the request it *would* have made.

Cover:
1. A session writes a `started`, `is_test = true` row and returns `{ callId, sessionId, sdp, greeting }`.
2. The outgoing OpenAI request carries the model from `env.openaiLiveModel`, the customer's voice,
   and an `instructions` string containing both the stored prompt **and** the clock text.
3. **An OpenAI failure deletes the row** — no `started` call is left behind. Assert the row count.
4. `OpenAIError`'s status is forwarded (e.g. 429 stays 429, not 500).
5. Missing `customerId`/`sdp` → 400; inactive → 403; not `ready` → 409; unknown → 404.
6. A report completes the call: status, `durationSec`, `endReason`, transcript stored, `turns` set.
7. **A second report is a no-op** returning `alreadyReported`, and does not overwrite the first.
8. A review is saved when the stubbed model returns one; a failing review still completes the call.
9. A non-admin gets 403 on both routes.

- [ ] **Step 2: Prove three are not vacuous**

Break each, confirm the named test fails, restore, re-run:
1. Delete the row-cleanup in the session route's failure path → check 3 fails.
2. Make the report handler ignore `status !== "started"` → check 7 fails.
3. Make a failing review throw instead of being swallowed → check 8 fails.

Record all three failure messages.

- [ ] **Step 3: Verify** — `bun run typecheck`, full `bun test`, and confirm **no test performed a
real network call** (the stub should record every attempted URL; assert the list is empty of
`api.openai.com`).

---

### Task 8: The client

**Files:** re-port `src/demos/hooks/useLiveCall.ts`, `src/demos/components/call/CallPanel.tsx`, `src/demos/lib/ringtone.ts`; modify `src/demos/screens/ProspectScreen.tsx`, `src/demos/components/admin/ActivityTab.tsx`, `src/demos/PORTING.md`

- [ ] **Step 1: Re-port the three files** from the promo, applying the porting rules already in
`PORTING.md`: `fetch("/api/…")` → `demoFetch("/…")` (so `/api/session` → `/session` and
`/api/calls/${callId}` → `/calls/${callId}`), `next/link` → `demoHref`, `next-themes` →
`useDocumentTheme`, pop-ups into `twPortalContainer()`, `process.env.NEXT_PUBLIC_*` →
`import.meta.env.VITE_*`, no bare `var(--x)`.

`useLiveCall` used `navigator.sendBeacon(promoUrl(url), …)` for the unload path. `promoUrl` is gone;
`demoFetch` cannot serve a beacon because it is not same-origin and carries a bearer header. Decide
how the unload report is sent now — `fetch(..., { keepalive: true })` with the auth header is the
obvious candidate — implement it, and **write down the trade-off** in `PORTING.md`.

- [ ] **Step 2: Restore the layout.** `ProspectScreen`'s wrapper goes back to
`grid grid-cols-1 gap-4 lg:grid-cols-3` with the tabs card regaining `lg:col-span-2` and
`<CallPanel>` in the third column — as the promo has it.

- [ ] **Step 3: Restore "Analyze"** in `ActivityTab.tsx`: the button, its `onAnalyze` prop and type,
the `Sparkles` and `Button` imports, and the fuller "Not reviewed — …" sentence. The
`PORTING.md` section that recorded its removal gains a line saying it came back and why.

- [ ] **Step 4: Verify** — `npx tsc --noEmit`, `npx vitest run`, `npm run build`, all clean.

---

### Task 9: The harness

**Files:** modify `scripts/regression/fake_backend.py`, `demos_e2e.py`, `README.md`

- [ ] **Step 1: Answer the two new routes in `fake_backend.py`** — `POST /demo/session` returning a
plausible `{ callId, sessionId, sdp, greeting }`, and `POST /demo/calls/<id>` returning
`{ ok: true, reviewed: false }`, both behind the admin token, in the same fixture style as the rest.

- [ ] **Step 2: Bring back the test-call checks** `demos_e2e.py` lost when the panel was removed —
they are in git history at the commit before that change, and are the best statement of what to
re-assert: the session POST and its SDP, the busy refusal, the microphone opened and stopped, "Call
again", the retry, leaving mid-dial, the late microphone, the abandoned/unmounted report, and that
nothing threw. Restore the ones that still apply; delete any that only made sense against the promo,
and say which.

Edge's fake microphone comes back with them: `--use-fake-device-for-media-stream`,
`--use-fake-ui-for-media-stream`, and the `microphone` permission grant.

- [ ] **Step 3: Run all three** — `compare.py` IDENTICAL, `tw_probe.py` 19, `demos_e2e.py` all pass —
and update `scripts/regression/README.md`.

---

### Task 10: Final verification

- [ ] **Step 1**

```bash
cd transcribe-backend && bun test && bun run typecheck
cd ../tecace-voice-agent-dashboard && npx tsc --noEmit && npx vitest run && npm run build
python scripts/regression/compare.py && python scripts/regression/tw_probe.py && python scripts/regression/demos_e2e.py
```

- [ ] **Step 2: Screenshot** the prospect detail page and confirm the call panel is back in the
right-hand column with the tabs at two thirds, and that "Analyze" is on an unreviewed call.

- [ ] **Step 3: Report** — results, the file list, the three mutation messages from Task 7, and the
deployment note: **`OPENAI_API_KEY` must be set on transcribe-backend's Vercel project** or the dial
is refused with `"OPENAI_API_KEY is not set on the server."` while every other Demo tab keeps
working; `OPENAI_LIVE_MODEL` defaults to `gpt-live-1`. Say plainly that **no test made a real
OpenAI call**, so the first genuine dial is the first exercise of the handshake, and that a test
call spends real realtime minutes with no allowance behind it — admin auth and 5/minute are the
only limits.

**Stage done.**

---

## Review note after Task 7: the transcript came from the browser uncheckcked

Task 7 reported that `POST /demo/calls/:callId` cast `body.transcript` to `TranscriptEntry[]`
without looking at the entries, and that an entry with no `text` made `reviewable()` throw out of
`callReview` — a module documented as never throwing — leaving the route's catch as the only thing
holding the line. It flagged this rather than changing it, correctly, since the behaviour was safe.

It is fixed now, because the entries are no longer transient: they are stored permanently and read
back later by `analytics.ts` (`gapRollup`, `callerSaid`) and by `callReview`, all of which reach
into `entry.text` and `entry.speaker`. A malformed entry is a row that makes some *later* read throw,
long after the call that produced it. `isTranscriptEntry` now drops entries that are not well
formed — dropped rather than rejected, because the recorded call matters more than a line of it —
and `turns` counts what was kept.

**Two mistakes I made fixing it, both caught by mutation:**

1. The existing "review throws outright" test used a malformed entry as its *mechanism*. Validating
   entries removed that mechanism, so I re-staged the test on a throwing `fetch` — which does not
   work: `openai.ts` turns a failing fetch into an `OpenAIError` and `reviewCall` swallows it and
   returns `null`. The route's catch was then never exercised, and the test asserted nothing about
   containment. Making the review `catch` rethrow failed no test, which is how this surfaced.
   `reviewCall` itself is now wrapped behind a flag so it can genuinely throw.
2. That wrapper first read `reviewCall` back off the module namespace *after* `mock.module` had
   replaced it, so it called itself — a stack overflow rather than a test failure. The original is
   captured into a local before the mock is installed.

Both are pinned: removing the entry guard fails the new malformed-entry test, and making the review
catch rethrow fails the containment test. The lesson is the general one — a test whose *mechanism*
is removed by a fix does not fail, it goes quiet, and only a mutation check notices.
