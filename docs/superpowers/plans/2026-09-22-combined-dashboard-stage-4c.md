# Combined dashboard — stage 4c (CRM pipeline) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Demos "Pipeline" placeholder with the promo app's real CRM page — the stage board, the activity feed across every prospect, and the drawer that opens one prospect's timeline, stage, follow-up date and notes — ported near-verbatim. This is the last promo **admin** screen; after it the Demos section is complete (stage 5 is the public demo page).

**Architecture:** The stage-4a/4b method, unchanged: promo files copied **verbatim** from `voiceagent_promo @ f482848` into `src/demos/` in the promo's own layout (`components/admin/*`, the page as `screens/PipelineScreen.tsx`), alias `@/` → `src/demos/`, every deviation logged in `src/demos/PORTING.md`. Fixed edit list: `"use client"` removed; `fetch("/api/…")` → `promoFetch("/api/…")`; `next/link` → `<a href={demoHref("demoProspect", id)}>`; portals already handled by the ported `sheet`; no bare `var(--x)` / `getPropertyValue("--x")`; strictness fixes that keep behaviour identical. Everything the page imports is already ported (verified 2026-09-22): `components/ui/{card,skeleton,button,sheet,input,label,select,separator,textarea}`, `components/admin/shared`, `lib/{analytics,http,types}`.

**Tech Stack:** as 4a/4b — React 19, Vite 8, TS 5 (strict), Tailwind 4 scoped to `.tw`, shadcn on Base UI, Vitest, Python + Playwright (Edge).

**Spec:** `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md` §1, §3, §4, stage 4 (4c). Method and gotchas: the 4a plan; the 4b plan for the same shape of work.

**Size:** 805 lines across 6 files (`page.tsx` 182, `CrmTab` 216, `CrmDrawer` 149, `PipelineBoard` 147, `ActivityFeed` 60, `crm-shared` 51).

**Git:** do **not** commit. The user handles all git.

**Conventions:** paths relative to `tecace-voice-agent-dashboard/` (`APP`) unless starting with `docs/`. `PROMO` = `/c/Users/Michael Knutsen/Documents/projects/test_demo/voiceagent_promo` (Git Bash; quote it). Line endings don't matter (autocrlf); diff against the promo with `diff --strip-trailing-cr`. Python scripts one at a time (ports 5198/5199/8898/8899). Never `taskkill` by image name. Every edit to a ported file gets a line in `src/demos/PORTING.md`.

**Checks:** `npx vitest run` (245 today); `npm run build`; `compare.py` (must stay `IDENTICAL` + `expected changes confirmed: admin:apiKeys:light`); `tw_probe.py` (19 ok); `demos_e2e.py` (87 ok today).

---

## File map

- Create `src/demos/components/admin/{crm-shared,PipelineBoard,ActivityFeed,CrmTab,CrmDrawer}.tsx` and `src/demos/screens/PipelineScreen.tsx` — Task 1.
- Modify `src/demos/DemosView.tsx`; delete `src/demos/pages/DemoPlaceholderPage.tsx` (and the now-empty `src/demos/pages/`) — Task 2.
- Modify `scripts/regression/fake_promo.py` — Task 3.
- Modify `scripts/regression/demos_e2e.py`, `scripts/regression/README.md` — Task 4.
- Modify `src/demos/PORTING.md` (Tasks 1–2), `CLAUDE.md`, the spec — Task 5.

---

### Task 1: Port the CRM components and page

**Files:** Create the 6 files above; Modify `src/demos/PORTING.md`

- [ ] **Step 1: Copy verbatim, strip the directive**

```bash
for f in crm-shared PipelineBoard ActivityFeed CrmTab CrmDrawer; do cp "$PROMO/components/admin/$f.tsx" src/demos/components/admin/; done
cp "$PROMO/app/admin/(dashboard)/crm/page.tsx" src/demos/screens/PipelineScreen.tsx
for f in src/demos/components/admin/{crm-shared,PipelineBoard,ActivityFeed,CrmTab,CrmDrawer}.tsx src/demos/screens/PipelineScreen.tsx; do sed -i '1{/^"use client";\?$/d}' "$f"; done
grep -l "use client" src/demos/components/admin/{crm-shared,PipelineBoard,ActivityFeed,CrmTab,CrmDrawer}.tsx src/demos/screens/PipelineScreen.tsx
```
Expected: the grep prints nothing.

- [ ] **Step 2: Promo API calls → `promoFetch`**

Five calls: `PipelineScreen.tsx` 2 (`GET /api/admin/crm`, `PATCH /api/admin/customers/${customer.id}`), `CrmDrawer.tsx` 2 (`GET`, `PATCH` on `/api/admin/customers/…`), `CrmTab.tsx` 1 (`POST /api/admin/customers/${customer.id}/notes`).
```bash
python - <<'EOF'
import re
from pathlib import Path
expected = {"src/demos/screens/PipelineScreen.tsx": 2, "src/demos/components/admin/CrmDrawer.tsx": 2,
            "src/demos/components/admin/CrmTab.tsx": 1}
for f, want in expected.items():
    p = Path(f); s = p.read_text(encoding="utf-8")
    n = len(re.findall(r"\bfetch\(\s*[`\"]/api/", s))
    assert n == want, (f, n, want)
    s = re.sub(r"\bfetch\((\s*[`\"])/api/", r"promoFetch(\1/api/", s)
    lines = s.split("\n")
    first = next(i for i, l in enumerate(lines) if l.startswith("import "))
    lines.insert(first, 'import { promoFetch } from "@/api";')
    p.write_text("\n".join(lines), encoding="utf-8")
print("ok")
EOF
grep -rn "\bfetch(" src/demos/components/admin src/demos/screens | grep -v promoFetch
```
Expected: `ok`, then the grep prints nothing.

- [ ] **Step 3: The one `next/link`**

In `src/demos/components/admin/CrmDrawer.tsx`: delete `import Link from "next/link";`, add `import { demoHref } from "@/routes";`, and replace
```tsx
                render={<Link href={`/admin/customers/${data.customer.id}`} />}
```
with
```tsx
                render={<a href={demoHref("demoProspect", data.customer.id)} />}
```
Verify: `grep -rn "next/\|<Link" src/demos/components src/demos/screens` prints nothing.

- [ ] **Step 4: Name the screen**

In `src/demos/screens/PipelineScreen.tsx` change `export default function CrmPage()` to `export function PipelineScreen()` (read the actual line first; everything else stays).

- [ ] **Step 5: Type-check and strictness fixes**

Run `npx tsc --noEmit`. Fix each error in the new files with the smallest behaviour-preserving change (bounded index → `!`; otherwise a guard reproducing the original behaviour; unused parameter → `_x`). Log each with file:line, before → after, and why it's safe.

- [ ] **Step 6: Scans**

- `grep -rn "var(--\|getPropertyValue(" src/demos/components/admin/{crm-shared,PipelineBoard,ActivityFeed,CrmTab,CrmDrawer}.tsx src/demos/screens/PipelineScreen.tsx` — any bare `--x` (not `--color-*`, `--radius-*`, `--ui-*`) is rewritten per `CLAUDE.md` and logged.
- The 4a literal-className collision scan (plan 4a, Task 5 Step 6 script) over `src/demos/components` + `src/demos/screens`; allowed: `sr-only`, `grid`. Anything else: rename on the promo side and log.

- [ ] **Step 7: Diff against the promo, log, verify**

For each of the 6 files run `diff --strip-trailing-cr` against its promo source and confirm every difference is one of: the removed directive, the `promoFetch` edits, the `demoHref` edit, the screen rename, a logged strictness fix. Log them all in `PORTING.md` under a new "### CRM pipeline (stage 4c)" heading. Then `npm run build && npx vitest run` → clean; all pass.

- [ ] **Step 8: Files ready for review** (no commit)

---

### Task 2: Show it, and retire the last placeholder

**Files:** Modify `src/demos/DemosView.tsx`, `src/demos/PORTING.md`; Delete `src/demos/pages/DemoPlaceholderPage.tsx`

- [ ] **Step 1: Render the real page**

In `src/demos/DemosView.tsx`: import `{ PipelineScreen } from "./screens/PipelineScreen"`, render it for `demoPipeline`, and remove the `DemoPlaceholderPage` import and its remaining use.

- [ ] **Step 2: Delete the placeholder**

`grep -rn "DemoPlaceholderPage" src` must show nothing, then delete `src/demos/pages/DemoPlaceholderPage.tsx`; if `src/demos/pages/` is now empty, remove the directory. Note in `PORTING.md` that every Demos view is now a ported screen.

- [ ] **Step 3: Verify**

`npm run build && npx vitest run` → clean; all pass. Then `python scripts/regression/compare.py` (ports free first; never two runs at once) → `expected changes confirmed: admin:apiKeys:light` + `IDENTICAL`. Do NOT run `demos_e2e.py` yet — the fake doesn't serve `/api/admin/crm` (Task 3), so the Pipeline checks would fail.

- [ ] **Step 4: Files ready for review** (no commit)

---

### Task 3: The fake promo's CRM routes

**Files:** Modify `scripts/regression/fake_promo.py`

Read the real handlers (`app/api/admin/crm/route.ts`, `app/api/admin/customers/[id]/notes/route.ts`) and `lib/analytics.ts` (`FeedEntry = TimelineEntry & {customerId, customerName}`, `TimelineEntry = {at, kind: "note"|"view"|"call", text, callId?}`; `stageCounts`, `dueFollowUps` run client-side over the customers). Stateless as always.

- [ ] **Step 1: `GET /api/admin/crm`**

Returns `{customers, feed}`:
- `customers`: the same two `CustomerWithStats` records the list route returns (so stage counts and heat agree everywhere). Harbor Dental already has `stage: "interested"`; give Cedar Bakery `stage: "contacted"` and a `followUpAt` a day in the past, so the page's "due follow-ups" section has exactly one entry — and check what the real `dueFollowUps` treats as due before choosing the date.
- `feed`: entries newest first built from the SAME call/event/note table the detail route uses — at least one `call`, one `view` and one `note` entry, each with `customerId`/`customerName`, a `text` in the promo's own wording (read `activityFeed`/`timeline` in `lib/analytics.ts` and mirror it), and `callId` on the call entries.

- [ ] **Step 2: Notes**

- `GET /api/admin/customers/<id>/notes` → `{notes}` (the same list the detail route returns).
- `POST /api/admin/customers/<id>/notes` → `201 {note}` with `{id, at, text}`; blank/whitespace `text` → `400 {error: "Write something first."}`; bad JSON → `400 {error: "Invalid request body."}`; unknown customer → `404 {error: "Customer not found."}`. (Stateless: the note comes back but isn't stored.)

- [ ] **Step 3: Smoke-test and document**

With the fake running and a cookie, `curl` each new route (including the blank-note 400 and an unknown customer) and check status + shape. Add them to the fake's docstring.

- [ ] **Step 4: Files ready for review** (no commit)

---

### Task 4: End-to-end checks for the pipeline

**Files:** Modify `scripts/regression/demos_e2e.py`, `scripts/regression/README.md`

Read the ported components for the real labels before writing locators.

- [ ] **Step 1: Add the checks**

- **Board:** opening "Pipeline" shows a column per stage with the fake's counts, Harbor Dental's card in "Interested" and Cedar's in "Contacted".
- **Follow-ups:** the due-follow-up section names Cedar Bakery.
- **Feed:** the activity feed lists entries from both prospects, newest first, each naming its prospect.
- **Stage move:** the card's move control sends `PATCH /promo-api/admin/customers/<id>` with `{stage: …}` in the body, the card moves column on screen before the answer arrives (read the component — it's an optimistic move), and its toast appears.
- **Drawer:** clicking a card (or its open control) opens the drawer inside `[data-tw-portal]`, shows that prospect's timeline entries, and its "Open" link points at `#/demos/prospects/pr0SPct1`; following it lands on the prospect page.
- **Notes:** writing a note and submitting sends `POST /promo-api/admin/customers/pr0SPct1/notes` with `{text}` and shows its toast; submitting a blank one shows the promo's "Write something first." without a request (or with the 400 — check what the component does and assert what it actually is).
- **Legacy class collisions:** run the existing runtime helper on the pipeline page and with the drawer open.
- The existing "no page errors" check must still pass.

- [ ] **Step 2: Run everything**

One at a time: `demos_e2e.py` → `ALL DEMOS CHECKS PASS`; `compare.py` → `IDENTICAL` (+ apiKeys); `tw_probe.py` → pass. Script problems are yours to fix without weakening intent; an app problem → report with evidence and fix only as a logged, behaviour-preserving port edit.

- [ ] **Step 3: Document** — add the pipeline checks to the `demos_e2e.py` section of `scripts/regression/README.md`.

- [ ] **Step 4: Files ready for review** (no commit)

---

### Task 5: Documentation

**Files:** Modify `CLAUDE.md`, `docs/superpowers/specs/2026-09-21-combined-dashboard-design.md`

- [ ] **Step 1: `CLAUDE.md`** — in the Demos section, say that all three Demos views are now ported promo screens (`screens/{OverviewScreen,ProspectsScreen,ProspectScreen,PipelineScreen}.tsx`) and that `src/demos/pages/` is gone.

- [ ] **Step 2: Spec** — mark stage 4 complete in the stage list: "4a/4b/4c done — the promo's admin side is fully ported; stage 5 (public demo page) is next, starting with the `/promo-page/c/*` security question in §5."

- [ ] **Step 3: Final checks** — one at a time: `npx vitest run`, `npm run build`, `compare.py`, `tw_probe.py`, `demos_e2e.py` → all pass.

- [ ] **Step 4: Files ready for review** (no commit) — **Stage 4c done; the promo admin side is complete.**
