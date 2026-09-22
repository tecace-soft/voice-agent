# Combined dashboard — stage 5 (public demo page: leave it on the promo) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the combined dashboard: the prospect-facing demo page (`/c/<id>`) stays on the voiceagent_promo deployment, so remove the half-built plumbing that assumed this app would serve it, settle the share-link configuration, and leave the repo with accurate docs and a deployment checklist.

**Architecture:** No new features. The promo already serves `/c/<id>` and brokers its calls (it holds the OpenAI key), so this app links to it rather than re-hosting it. That removes the `/promo-page/c/*` proxy — the one design element that would have run promo-origin HTML where the dashboard's session token lives — and keeps the promo's server-rendered link previews and visitor counting, which a client-rendered port would have lost.

**Decision (2026-09-22, the user's call).** Options weighed: port the page here (~2,700 lines; loses per-link previews; unauthenticated page sharing an origin with the dashboard token; needs a visitor-cookie workaround), port but deploy it on its own origin (safe but a second deployment), or leave it on the promo. Chosen: **leave it on the promo.** The promo's server is required either way, so porting bought a shared domain at the price of link previews and attack surface. This supersedes the spec's original "admin side **and** the public prospect page" scope line.

**Tech Stack:** unchanged (React 19 / Vite 8 / TS / Tailwind-scoped promo screens / Vitest / Playwright).

**Spec:** `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md` — §1 (`src/public-demo/`), §2 (the `/c/:id` path check in `main.tsx`), §5 (the `/promo-page` proxy and the visitor-cookie priming) all describe the *not chosen* option and are corrected here.

**Git:** do **not** commit. The user handles all git.

**Conventions:** paths relative to `tecace-voice-agent-dashboard/` (`APP`) unless starting with `docs/`. Git Bash on Windows. Python scripts one at a time (ports 5198/5199/8898/8899). Never `taskkill` by image name.

**Checks:** `npx vitest run` (245); `npm run build`; `compare.py` (`IDENTICAL` + `expected changes confirmed: admin:apiKeys:light`); `tw_probe.py` (19 ok); `demos_e2e.py` (108 ok).

---

## File map

- Modify `vite.config.ts` (drop the `/promo-page/c/` proxy), `.env.example`, `CLAUDE.md`, `README.md` — Task 1.
- Modify `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md` — Task 2.
- Create `docs/superpowers/combined-dashboard-deployment.md` — Task 3.
- Nothing under `src/` changes. No app behaviour changes.

---

### Task 1: Remove the public-page plumbing from the app

**Files:** Modify `vite.config.ts`, `.env.example`, `CLAUDE.md`, `README.md`

- [ ] **Step 1: Drop the `/promo-page/c/` proxy**

In `vite.config.ts`, delete the `"/promo-page/c/"` entry from the `proxy` object and rewrite the comment above it so it describes what's left: `/promo-api` is proxied so the promo's httpOnly admin cookie is same-origin; the prospect-facing `/c/<id>` page is served by the promo itself and is only ever linked to (`VITE_PUBLIC_DEMO_BASE_URL`), never proxied — promo HTML must not run on this origin, where the dashboard's session token lives in `localStorage`.
Verify: `grep -rn "promo-page" src vite.config.ts vitest.config.ts scripts` prints nothing.

- [ ] **Step 2: `.env.example`**

Rewrite the `VITE_PUBLIC_DEMO_BASE_URL` block so it is no longer described as a stage-5 stopgap:
```bash
# The promo's public origin (no trailing slash). Prospect demo links (/c/<id>) that the Prospects
# and Share screens copy and email point here — the promo serves that page itself. Required for a
# real build; `npm run build` warns when it is unset.
VITE_PUBLIC_DEMO_BASE_URL=http://localhost:3000
```
Leave `PROMO_API_URL` and the optional `VITE_CONTACT_*` lines as they are.

- [ ] **Step 3: `CLAUDE.md`**

Replace the "Proxy only what's needed" bullet with:
```markdown
- Proxy only `/promo-api/*`. The prospect-facing demo page (`/c/<id>`) stays on the promo and is
  linked to via `VITE_PUBLIC_DEMO_BASE_URL` (decided in stage 5) — never proxy promo HTML onto this
  origin: the dashboard's session token lives in localStorage here, and that page is public.
```

- [ ] **Step 4: `README.md`**

In the promo section: the deploy rewrites become **one** — `/promo-api/:path*` → `<promo>/api/:path*` — and the `VITE_PUBLIC_DEMO_BASE_URL` paragraph says the promo serves `/c/<id>` (no "until this app serves the public demo page" wording anywhere). Keep the two "also check at first deploy" bullets (rate-limit IP, research timeout) and the "Trying a real test call" section as they are.

- [ ] **Step 5: Verify**

Run: `npm run build && npx vitest run`
Expected: build clean (the `VITE_PUBLIC_DEMO_BASE_URL` warning still appears — no `.env` here); 245 tests pass.
Run: `grep -rn "promo-page" . --include=*.ts --include=*.tsx --include=*.md --include=*.json --include=*.py --include=*.example | grep -v node_modules | grep -v .regression`
Expected: nothing in `APP`. (Mentions inside `docs/superpowers/plans/` are history — leave them.)

- [ ] **Step 6: Files ready for review** (no commit)

---

### Task 2: Correct the design doc

**Files:** Modify `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`

- [ ] **Step 1: The scope decision**

In the Decisions table, change the "Which promo parts" row to: `Admin side. The public prospect page stays on the promo (decided 2026-09-22 — see §6)`.

- [ ] **Step 2: §1 and §2**

Delete the `src/public-demo/` bullet from §1. In §2, delete the `main.tsx` path-check bullet (`/c/:id` → lazy public demo) and say instead: `Every route in this app is a dashboard route; the prospect page lives on the promo.`

- [ ] **Step 3: §5**

Remove the `/promo-page/c/` dev-proxy and prod-rewrite entries and the visitor-cookie priming bullet (it existed only to make a ported public page count visitors; the promo's own middleware does it). Keep the `/promo-api` entries and the "verify in prod" note about the per-IP limit.

- [ ] **Step 4: Stage list**

Replace stage 5 with:
```markdown
5. **Public demo page — decided, not built (2026-09-22).** It stays on the promo deployment; this
   app links to it. Options weighed and why, in §6. What that leaves: `proof`, `links` and
   `voice-level` are ported promo libs nothing in this app imports (their promo tests still run) —
   kept rather than deleted so a future change of course is a re-port of screens, not of libs.
```

- [ ] **Step 5: New §6, the decision record**

Add a short section "## 6. Why the public page stays on the promo" recording: the promo serves it server-rendered today (per-link title/description previews when a prospect link is pasted into email or Slack, which a client-rendered port loses); the promo's middleware assigns the visitor cookie that makes "three people tried it" different from "one person tried it three times"; the promo's server is needed for the call either way (it holds the OpenAI key and brokers GPT-Live sessions); and a public, unauthenticated page on the dashboard's origin would sit where the dashboard's session token lives in localStorage — proxying the promo's own HTML there would have been worse still. Note the cost accepted: two origins, and the prospect page keeps the promo's look rather than this app's.

- [ ] **Step 6: Files ready for review** (no commit)

---

### Task 3: A deployment checklist

**Files:** Create `docs/superpowers/combined-dashboard-deployment.md`

The front-end work is done; this is what someone needs to put it live. Write it from what the repo actually says (`README.md`, `vite.config.ts`, `vercel.json`, `src/api/backend.ts`, the transcribe-backend's CORS handling) — verify each claim rather than repeating this plan.

- [ ] **Step 1: Write it**

Cover, in order:
1. **What this app is** — one Vite SPA: the transcribe screens plus the admin-only Demos section (the promo's admin side). It talks to `transcribe-backend` (sign-in, transcribe/business/calls/api-keys) and, for Demos, to the promo's API through `/promo-api`.
2. **Build-time env** — `VITE_BACKEND_URL` (transcribe-backend), `VITE_PUBLIC_DEMO_BASE_URL` (the promo's public origin — demo links), optional `VITE_CONTACT_*`. Note the build warns when the demo base URL is unset.
3. **Server-side env** — `PROMO_API_URL` for `vite dev`/`vite preview` only; production uses the rewrite instead.
4. **`vercel.json`** — add `/promo-api/:path*` → `<promo origin>/api/:path*` **above** the SPA fallback, and nothing wider. Say what breaks without it ("Demo service unreachable" on every Demos view).
5. **Other systems to touch** — add this deployment's origin to `transcribe-backend`'s `CORS_ORIGIN`; check the promo's own `NEXT_PUBLIC_BASE_URL` still points at the promo (it's what its share links use, and it must match `VITE_PUBLIC_DEMO_BASE_URL` here); the promo needs its `ADMIN_PASSWORD` (admins unlock Demos with it once per browser) and its storage/research/OpenAI env as its own README describes.
6. **First-run checks** — sign in; a transcribe view loads; Demos asks to unlock and then lists prospects; the prospect page opens; a real test call (see the app README) if an OpenAI key is in play.
7. **Two things to confirm in production, not assume** — the promo's `/api/session` per-IP limit behind the rewrite (it may see the platform's address, not each admin's, and it runs before the test-call check), and whether a >60 s re-research survives the rewrite's own proxy timeout.
8. **Still open, deliberately** — the old `transcribe-dashboard-app` is untouched and still deployed; retiring it is the user's call once this app is live. Moving the promo's backend into `transcribe-backend` remains a separate future piece of work, and `src/demos/api.ts` plus the one rewrite are what would change.

- [ ] **Step 2: Verify the claims**

Re-read each file named above and confirm every variable name, path and behaviour in the checklist matches the code. Fix anything that doesn't.

- [ ] **Step 3: Files ready for review** (no commit)

---

### Task 4: Final verification of the whole project

**Files:** none (runs only)

- [ ] **Step 1: Run everything, one at a time**

```bash
npx tsc --noEmit
npx vitest run
npm run build
python scripts/regression/compare.py
python scripts/regression/tw_probe.py
python scripts/regression/demos_e2e.py
```
Expected: clean; 245 tests; clean build; `IDENTICAL` + `expected changes confirmed: admin:apiKeys:light`; `ALL PROBE CHECKS PASS` (19); `ALL DEMOS CHECKS PASS` (108). Nothing in this stage touches `src/`, so any difference means something else drifted — investigate rather than re-running until green.

- [ ] **Step 2: Report** the results and the full list of files for the user to review and commit. **Stage 5 done — the combined dashboard's front-end work is complete.**
