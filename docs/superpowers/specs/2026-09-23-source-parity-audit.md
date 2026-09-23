# Full parity audit: the promo's admin surface vs our Demo section

**Date:** 2026-09-23
**Source:** `voiceagent_promo` @ `90869c6`
**Standard set by the user:** do exactly what the source does, with the **only** difference being
that our backend stores the data instead of its Redis/JSON store.

This is a fresh, file-by-file audit rather than a recollection of earlier decisions. Several of
those earlier decisions turn out to be gaps under this standard, and they are listed as such.

## 1. Admin components — complete

Every one of the promo's `components/admin/*` is ported except three, and all three are chrome the
host dashboard already provides:

| Not ported | Why it is not a gap |
| --- | --- |
| `AppSidebar.tsx` | Our Demo tabs live in the transcribe sidebar |
| `AdminBreadcrumb.tsx` | The host topbar renders the breadcrumb |
| `ModeToggle.tsx` | The host has its own theme toggle |

## 2. Routes — one missing

| Promo | Ours | |
| --- | --- | --- |
| `/admin/analytics`, `/admin/crm`, `/admin/customers`, `/admin/customers/[id]`, `…/calls`, `…/notes` | the same under `/demo` | ✅ |
| `/api/session`, `/api/calls/[callId]` | `/demo/session`, `/demo/calls/:callId` | ✅ |
| `/admin/login`, `/admin/health` | the dashboard's own admin session | ✅ by design — one sign-in |
| **`/admin/customers/[id]/research`** | **nothing** | ❌ **gap** |

## 3. The real gaps

### Gap A — prompts are never generated

In the promo this happens **server-side**, in three places, all through `lib/prompt.ts`:

1. `lib/store.ts normalize()` rebuilds any **unedited** prompt whose `version` is behind
   `PROMPT_VERSION` (now 6), on every read;
2. the customer `PATCH` runs `resolvePrompts`, whose two rebuild branches regenerate from the
   profile;
3. `POST /customers` stores `buildPrompts(profile, agentName, language)`.

Our backend has **no `prompt.ts` at all**. Consequently:
- `createCustomer` stores `{ live: "", backend: "", greeting: "", edited: false }` — a new prospect
  has blank prompts and would dial with nothing;
- `resolvePrompts` in `demoWrite.ts` keeps only the merge branch, so `regeneratePrompts` does
  nothing;
- `normalize()` in `demoRead.ts` skips the version rebuild. **8 of the 10 imported customers are
  unedited at versions 3, 4 and none**, so all eight are showing and using stale prompt text that
  the source would have refreshed on read.

This is the gap the user identified, and it is the largest.

### Gap B — the dashboard's `prompt.ts` is stale

`src/demos/lib/prompt.ts` is **213 diff lines** behind the promo's — the whole `483f4c8`
restructure along the GPT-Live guide, plus `d525196`'s five fixes and `d3d4b07`'s register change.
It is imported by `useLiveCall` for `spokenGreeting`.

### Gap C — no research pipeline

`lib/research.ts` (+ `research-runner.ts`, `maps.ts`) is absent, so:
- "Re-research" cannot exist (it was removed for this reason);
- a newly created prospect is never researched, where the promo fires `runResearch` in the
  background from `POST /customers` and then builds prompts from the result;
- `ResearchInputsPanel` keeps its four fields but lost its run button.

**Portability, checked not assumed:** `research.ts` is pure orchestration (no network, no env).
Only `research-runner.ts` touches the outside, and it already prefers the **OpenAI API on a
serverless host** — `createResponse`, which we have ported, with the `OPENAI_API_KEY`
transcribe-backend already holds. No Anthropic SDK and no new key are required for the deployed
path. The Claude-CLI branch spawns a local binary and cannot run on Vercel; the promo knows this and
falls back for exactly that reason.

### Dependencies the backend needs for A and C

All pure, all small: `hours.ts`, `use-cases.ts`, `languages.ts` (for `prompt.ts`), then `maps.ts`
and `research.ts` (for C). `demoWrite.ts` currently inlines a `LANGUAGE_CODES` list copied from
`languages.ts`; that becomes a real import.

## 4. Deliberately still out of scope

| | Why |
| --- | --- |
| The public demo page (`app/c/**`, `Hero`, `StickyCall`, `ScenarioList`, `pricing`) | Stage 5: `/c/<id>` stays on the promo and is only linked to. Unchanged by this audit — but note it is the **only** remaining product surface we do not serve. |
| `evals/*`, `prompt-eval.ts`, `docs/prompt-harness-analysis.md` | A prompt-quality harness for developing prompts, not a runtime behaviour. |
| `app/layout.tsx` | Next-specific hydration guard. |
| `lib/{api,auth,kv,store,calls,crm,visitor}.ts` | The promo's storage and auth layer. Ours is the backend — this is the one permitted difference. |

## 5. What closing the gaps means

1. Port `prompt.ts` + `hours.ts` + `use-cases.ts` + `languages.ts` into the backend, under the
   parity test.
2. Wire it where the promo wires it: `normalize()` on read, `resolvePrompts` on save,
   `createCustomer` on create.
3. Re-copy the dashboard's stale `prompt.ts`.
4. Port `maps.ts` + `research.ts` + the OpenAI branch of `research-runner.ts`; add
   `POST /demo/customers/:id/research`; fire research in the background on create; restore
   "Re-research" and `ResearchInputsPanel`'s run button.
5. Config: `RESEARCH_API_MODEL`, `RESEARCH_MODEL`, `RESEARCH_OPENAI_MODEL`,
   `RESEARCH_SEARCH_CONTEXT`, `RESEARCH_PROVIDER`, defaulting as the promo does.

**A research run is a real, billable model call with web search.** It is gated by the same
`OPENAI_API_KEY` that gates the test call: with no key, research fails with the promo's own message
and every other Demo tab keeps working.
