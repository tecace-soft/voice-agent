# Syncing the promo's 2026-09-23 update — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring the eight promo commits after `cf5473b` into this dashboard, matching functionality 1:1. Backend/API shapes are ours and deliberately differ; everything a user can see or do must not.

**No commits.** The user handles all git operations.

**Promo repo (READ ONLY):** `C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo`, now at `90869c6`.

---

## The survey (done — do not redo it)

Eight commits, `cf5473b..90869c6`. Two user-visible features and some supporting work:

1. **`cbb0887` — a call ends itself.** New pure module `lib/call-limits.ts` (no imports, no env, no
   fetch): `CALL_MAX_SEC` (10 min), `WRAP_UP_LEAD_SEC`, `IDLE_END_SEC`, `IDLE_CHECK_SEC`,
   `AGENT_QUIET_SEC`, `callLimitSec()`, `shouldWrapUp()`, and a `CallActivity` type. `useLiveCall`
   (+111) uses it to wrap the receptionist up before the limit, ask "are you still there?" after
   caller silence, and hang up on its own. `POST /api/session` returns a new **`maxSec`**, which the
   hook reads as `callLimitSec(data.maxSec)`.
2. **`90869c6` — the admin can add demo time.** New `components/admin/AddDemoTimeMenu.tsx` exporting
   `AddDemoTimeMenu` and `AddDemoTimeSubmenu`; wired into the prospect page, `SharePanel` and
   `CustomerTable`'s row menu. It PATCHes **`{ addDemoMinutes: n }`**, which the server adds to the
   *stored* value via the new `extendDemoMinutes()` — so a stale page cannot undo someone else's
   top-up. `lib/analytics.ts` gains `DEMO_TIME_STEPS` and `extendDemoMinutes`.
3. **`6437467`-era follow-up in `lib/call-clock.ts`**: a new exported `ordinal()`, and the prompt's
   example date is now tomorrow's real date instead of a fixed "Tuesday the 22nd".
4. **`lib/use-cases.ts`** gains `categoryMentions()`. **Only `lib/prompt.ts` calls it.**

### Deliberately out of scope, with reasons

| Changed in the promo | Why it is not ported |
| --- | --- |
| `lib/prompt.ts` (+211), `lib/prompt-eval.ts`, `evals/*`, `docs/prompt-harness-analysis.md`, the prompt tests | We do not generate prompts. That decision is already recorded: `regeneratePrompts` leaves stored prompts alone, and the Prompt tab shows the text the recorded calls actually used. Nothing we render changes. |
| `components/public/Hero.tsx`, `app/c/**` | The public demo page stays on the promo (stage 5). |
| `app/layout.tsx` | Next-specific: suppresses attributes browser extensions stamp on `<body>`. |
| `app/api/**` | Our backend is ours. The *behaviour* is ported (see Task 4); the route shapes are not. |

### Where each file lives here

`analytics.ts` is ported **twice** — `transcribe-backend/src/demo/analytics.ts` (the routes' numbers)
and `tecace-voice-agent-dashboard/src/demos/lib/analytics.ts` (the screens'). Both need the update.
`call-clock.ts` is backend-only. `use-cases.ts` and `voice-level.ts` are dashboard-only.
`call-limits.ts` is new and needed in **both** (the hook and the session route).

---

### Task 1: The two drifted backend ports

**Files:** `transcribe-backend/src/demo/analytics.ts`, `src/demo/callClock.ts`, `src/demo/PORTING.md`

The parity tests already fail on both — that is the detector working, and it is the acceptance
criterion here.

- [x] **Step 1** Re-copy both from the promo's current files, keeping the documented deviations
  (the import header, the `env` reads, the non-null assertions). The new code is `DEMO_TIME_STEPS` +
  `extendDemoMinutes` in analytics, and `ordinal()` + the real-tomorrow example in call-clock.
- [x] **Step 2** Update `PORTING.md`: the recorded line numbers will have moved, and the header
  commit becomes `90869c6`. The parity test greps `<basename>:<line>`, so stale numbers fail it.
- [x] **Step 3** `bun test src/demo/parity.test.ts` — all five pass. Then `bun run typecheck` and the
  full `bun test`.
- [x] **Step 4** Port the promo's new tests for these (`tests/analytics.test.ts` +14,
  `tests/call-clock.test.ts` +14) into wherever this repo keeps their equivalents; if it keeps none,
  say so rather than inventing a location.

---

### Task 2: `call-limits.ts` into both projects

**Files:** create `transcribe-backend/src/demo/callLimits.ts` and `tecace-voice-agent-dashboard/src/demos/lib/call-limits.ts`; modify both `PORTING.md`s and the backend `parity.test.ts`

- [x] **Step 1** Copy `lib/call-limits.ts` verbatim into both. It is pure, so neither copy needs a
  header. Match each project's existing naming: the backend uses camelCase filenames in `src/demo/`,
  the dashboard keeps the promo's kebab-case in `src/demos/lib/`.
- [x] **Step 2** Add the backend copy to the `PORTED` table in `src/demo/parity.test.ts`.
- [x] **Step 3** Port `tests/call-limits.test.ts` (81 lines) into the dashboard's `tests/promo/`.
- [x] **Step 4** Verify both projects typecheck and their suites pass.

---

### Task 3: `maxSec` on the session route

**Files:** `transcribe-backend/src/routes/demo.ts`, `src/routes/demoCall.pg.test.ts`

- [x] **Step 1** Return `maxSec` alongside `{ callId, sessionId, sdp, greeting }`. The promo computes
  it from the allowance for a public call and falls back to `CALL_MAX_SEC`; **our route is admin
  test calls only, which skip the allowance**, so `maxSec` is `CALL_MAX_SEC`. Keep the promo's
  comment about why the browser is told the limit.
- [x] **Step 2** Extend the existing session test to assert `maxSec` is present and equals
  `CALL_MAX_SEC`.

---

### Task 4: `addDemoMinutes` on the customer PATCH

**Files:** `transcribe-backend/src/routes/demo.ts`, `src/db/demoWrite.ts`, `src/routes/demoCall.pg.test.ts` (or the existing route test file)

This is the behaviour behind the new menu. The route shape is ours; the rules are the promo's.

- [x] **Step 1** Accept `addDemoMinutes` on `PATCH /demo/customers/:id`:
  - invalid (not a finite number, or ≤ 0) → **400 `"Minutes to add must be positive."`**
  - valid → the new total is `extendDemoMinutes(stored, add, DEFAULT_DEMO_MINUTES)`, **added to what
    is stored, never to what the browser sent** — that is the whole point of the field.
  - `demoMinutes` on its own keeps setting the value outright (the Share tab's number field).
  `extendDemoMinutes` comes from the updated `src/demo/analytics.ts`. `DEFAULT_DEMO_MINUTES` is a
  promo constant `src/demo/types.ts` may not have yet — copy it verbatim if missing.
- [x] **Step 2** Tests: the 400 for zero/negative/non-numeric; that a top-up adds to the stored value
  and **ignores a stale `demoMinutes` sent in the same body**; that `demoMinutes` alone still sets.
- [x] **Step 3** Prove one is not vacuous: make the add use the request's `demoMinutes` instead of the
  stored value and confirm the stale-value test fails. Report the message.

---

### Task 5: `useLiveCall` — the call that ends itself

**Files:** `tecace-voice-agent-dashboard/src/demos/hooks/useLiveCall.ts`, `src/demos/PORTING.md`

- [x] **Step 1** Apply the promo's +111 to our copy. Ours already deviates in documented ways
  (`demoFetch`, `/session` and `/calls/:id` paths, the `keepalive` unload report, the `aliveRef`
  guards) — **keep every one of them**; this is a merge, not a re-copy. Read the existing
  `PORTING.md` entries for this file first so none is lost.
- [x] **Step 2** The hook reads `data.maxSec` from the session answer — Task 3 supplies it.
- [x] **Step 3** Update `PORTING.md` and verify `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

---

### Task 6: The Add-time menu

**Files:** create `src/demos/components/admin/AddDemoTimeMenu.tsx`; modify `CustomerTable.tsx`, `SharePanel.tsx`, `screens/ProspectScreen.tsx`, `src/demos/lib/analytics.ts`, `src/demos/lib/use-cases.ts`, `src/demos/PORTING.md`

- [x] **Step 1** Bring `DEMO_TIME_STEPS` and `extendDemoMinutes` into the **dashboard's**
  `src/demos/lib/analytics.ts` as well (the menu imports `DEMO_TIME_STEPS` from there).
- [x] **Step 2** Port `AddDemoTimeMenu.tsx` verbatim apart from the porting rules — note it exports
  **two** components, `AddDemoTimeMenu` and `AddDemoTimeSubmenu`. Its `fetch` becomes
  `demoFetch("/customers/:id", …)` with the body unchanged (`{ addDemoMinutes }`).
- [x] **Step 3** Wire the three call sites exactly as the promo does: the prospect page's header
  (with its `addedTime` handler that takes **only** the minutes from the answer, so unsaved edits
  survive), `SharePanel`'s new `onAddedTime` prop and its reworded paragraph, and `CustomerTable`'s
  row submenu.
- [x] **Step 4** Port `categoryMentions` into `src/demos/lib/use-cases.ts` and the promo's added
  `tests/use-cases.test.ts` cases. **It is unused by anything we render** — only `prompt.ts` calls
  it, and we do not port that. It comes across so the next sync stays a plain diff; say so in
  `PORTING.md` rather than leaving a reader wondering why it is dead.
- [x] **Step 5** `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

---

### Task 7: The harness, and looking at it

**Files:** `scripts/regression/fake_backend.py`, `demos_e2e.py`, `README.md`

- [x] **Step 1** Teach `fake_backend.py` `addDemoMinutes` on its customer PATCH (adding to the stored
  fixture value, with the 400) and `maxSec` on `/demo/session`.
- [x] **Step 2** Add checks: the Add-time menu appears on the prospect header, in the Share tab and
  in the customers row menu; choosing a step PATCHes `{ addDemoMinutes: n }`; and the minutes shown
  update without a reload.
- [x] **Step 3** Run all three (`compare.py` IDENTICAL, `tw_probe.py` 19, `demos_e2e.py` all pass)
  and update the README.
- [x] **Step 4** Screenshot the prospect page and the customers table showing the menu.

---

### Task 8: Final verification and report

- [x] Both projects: typecheck, full suites, dashboard build, all three harness scripts.
- [x] Report the results, the file list, what was ported, and — explicitly — the four things
  deliberately left out and why, so the next sync starts from a true picture.
