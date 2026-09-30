# Twilio numbers in the backend — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `transcribe-backend` lists the numbers on our Twilio account and can point one at the voice agent; the dashboard's Agent numbers page shows them.

**Architecture:** A pure Twilio REST client (`src/twilio/numbers.ts`, config passed in, global `fetch`) + an admin-only Elysia controller (`src/routes/twilioNumbers.ts`, prefix `/business/numbers/twilio`) that merges Twilio's list with `agent_numbers`. Dashboard: a new card component on `NumbersPage`. No schema change. Spec: `docs/superpowers/specs/2026-09-28-twilio-numbers-design.md`.

**Tech Stack:** Bun + Elysia + postgres.js (PGlite in tests), React 19 + Vite, hand-rolled CSS (transcribe side).

**Git:** the user handles all commits — no commit steps.

---

## File map

| File | Change |
|---|---|
| `transcribe-backend/src/config/env.ts` | + `twilioAccountSid`, `twilioApiKeySid`, `twilioApiKeySecret`, `twilioAuthToken`, `twilioApiBase`, `agentPublicUrl` |
| `transcribe-backend/src/twilio/numbers.ts` | **new** — config, list (paged), connect, status, `TwilioError` |
| `transcribe-backend/src/twilio/numbers.test.ts` | **new** — unit tests, stubbed `fetch` |
| `transcribe-backend/src/routes/twilioNumbers.ts` | **new** — `GET /business/numbers/twilio`, `POST /business/numbers/twilio/:sid/connect` |
| `transcribe-backend/src/routes/twilioNumbers.pg.test.ts` | **new** — route tests on PGlite + stubbed `fetch` |
| `transcribe-backend/src/app.ts` | `.use(twilioNumbers)` |
| `transcribe-backend/.env.example` | + Twilio block |
| `tecace-voice-agent-dashboard/src/api/types.ts` | + `TwilioNumber`, `TwilioNumbersResponse` |
| `tecace-voice-agent-dashboard/src/api/backend.ts` | + `listTwilioNumbers`, `connectTwilioNumber` |
| `tecace-voice-agent-dashboard/src/pages/TwilioNumbersCard.tsx` | **new** card |
| `tecace-voice-agent-dashboard/src/pages/NumbersPage.tsx` | render card, reload key |
| `tecace-voice-agent-dashboard/src/styles/legacy.css` | `.twilio-actions` |
| `tecace-voice-agent-dashboard/scripts/regression/fake_backend.py` | 503 for the new GET |
| `tecace-voice-agent-dashboard/scripts/regression/compare.py` | HIDE `.twilio-numbers` |
| `tecace-voice-agent-dashboard/src/changelog.ts`, `package.json`, `package-lock.json` | 0.0.10 |
| `HISTORY.md` | entry on top |

---

### Task 1: env

- [ ] Add to `src/config/env.ts` before `export const env`:

```ts
// Twilio: listing the numbers we own and pointing one at the voice agent (src/twilio/numbers.ts).
// A restricted API key (phone numbers read + write) is preferred; the account's auth token is the
// fallback. All optional — unset, the Agent numbers page just says Twilio isn't connected, and
// numbers can still be typed in by hand.
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
const twilioApiKeySid = process.env.TWILIO_API_KEY_SID?.trim() ?? "";
const twilioApiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim() ?? "";
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
// The voice agent's public origin (openai-agent-app). "Connect" sets a number's voice URL to
// <this>/incoming and its fallback to <this>/incoming-fallback.
const agentPublicUrl = (process.env.AGENT_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
```

and inside `env`:

```ts
  twilioAccountSid,
  twilioApiKeySid,
  twilioApiKeySecret,
  twilioAuthToken,
  // Only tests point this elsewhere.
  twilioApiBase: (process.env.TWILIO_API_BASE || "https://api.twilio.com").replace(/\/+$/, ""),
  agentPublicUrl,
```

### Task 2: Twilio client (TDD)

- [ ] Write `src/twilio/numbers.test.ts` (see file in repo — covers: config from API key / auth token / missing; list maps + follows `next_page_uri`; Basic auth header; `agentStatus` connected/not_connected/elsewhere/trailing slash/host case/null base; connect form body; 401 → `kind: "auth"`, 404 → `not_found`, 500 → `other` with Twilio's message).
- [ ] `bun test src/twilio/numbers.test.ts` → FAIL (module missing).
- [ ] Write `src/twilio/numbers.ts` exporting `TwilioConfig`, `twilioConfigFrom(env)`, `TwilioNumber`, `AgentStatus`, `TwilioError`, `listOwnedNumbers(cfg)`, `connectNumber(cfg, sid, agentBase)`, `agentIncomingUrl(base)`, `agentStatus(voiceUrl, base)`.
- [ ] Re-run → PASS.

### Task 3: routes (TDD)

- [ ] Write `src/routes/twilioNumbers.pg.test.ts`: PGlite shim copied from `appointments.e2e.pg.test.ts`; env mocked as a mutable spread of the real env with Twilio fields; `globalThis.fetch` stubbed as a fake Twilio holding 3 numbers (one pointing at the agent, one empty, one elsewhere). Cases: 401 signed out, 403 customer, 200 admin list with statuses + `registered` merge + `agentUrl`; 503 when account SID cleared; connect 404 unknown sid; 409 `points_elsewhere` without overwrite; 200 with overwrite (fake stores new URL; POST body checked); 200 connect on the empty one; 503 `agent_url_not_configured`; 502 `twilio_auth` when fake answers 401.
- [ ] Run → FAIL.
- [ ] Write `src/routes/twilioNumbers.ts`; add `.use(twilioNumbers)` in `src/app.ts`.
- [ ] Run → PASS. Then `bun run typecheck` and full `bun test`.

### Task 4: backend docs

- [ ] `.env.example`: Twilio block with the five vars + `AGENT_PUBLIC_URL=https://31-97-214-59.sslip.io` example in a comment.

### Task 5: dashboard

- [ ] Types + client functions.
- [ ] `TwilioNumbersCard.tsx`: loads on `reloadKey`; 503 → muted not-configured line; table Number / Agent / In our list / actions; Connect (409 → `window.confirm(message)` → retry with overwrite); Add to list → `registerAgentNumber(phone, "")`; after action → `onChanged()`.
- [ ] `NumbersPage.tsx`: `reloadKey` state bumped in `load()`; render `<TwilioNumbersCard reloadKey onChanged={load} />` first.
- [ ] CSS `.twilio-actions`.
- [ ] `npm run typecheck`, `npm test`.

### Task 6: regression + release notes

- [ ] `fake_backend.py`: `GET /business/numbers/twilio` → 503 `twilio_not_configured`.
- [ ] `compare.py`: HIDE `.twilio-numbers`.
- [ ] Changelog 0.0.10 + `package.json`/lock root → `npm test` (changelog test).
- [ ] Run `compare.py` (must print IDENTICAL).
- [ ] HISTORY.md entry.
