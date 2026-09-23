# Porting notes — `src/demo/`

## `analytics.ts`

`src/demo/analytics.ts` is a **verbatim copy** of the promo's `lib/analytics.ts`
(`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo\lib\analytics.ts`). It is
copied rather than reimplemented so the Overview and CRM numbers this backend serves match the
promo's by construction instead of by re-derivation. `analytics.parity.test.ts` diffs the two files
line by line and requires every difference to be listed here, so the copy cannot quietly drift into
a reimplementation.

Do not reformat, tidy or "improve" that file. If the promo's changes, re-copy it and update this
list.

### Every line that differs

- `analytics.ts:9` — the closing line of the `import type { ... } from "./types"` block. This repo
  compiles with `verbatimModuleSyntax` and resolves relative imports by their emitted specifier, so
  the promo's extensionless `"./types"` becomes `"./types.js"`. Nothing else on the line changed.
- `analytics.ts:10` — the same rewrite on `import { CUSTOMER_STAGES } from "./types"` →
  `from "./types.js"`.

That is the whole list: no `noUncheckedIndexedAccess` fix was needed. The file compiles unchanged
under this repo's `strict` + `noUncheckedIndexedAccess` settings, because every array index it takes
(`real[0]`, `stats[id]`, `buckets.get(key)`) is already guarded by a `??`, an `if`, or a
`Record<CustomerStage, number>` whose keys are a finite literal union.

Line endings are LF here and CRLF in the promo; the parity test normalises both before comparing,
so that is not counted as a difference.

## `types.ts`

`src/demo/types.ts` holds the 24 declarations `analytics.ts` and the demo routes need, each copied
verbatim from the promo's `lib/types.ts`: `BusinessHour`, `BusinessService`, `BusinessPolicies`,
`BusinessFaq`, `BusinessProfile`, `ResearchSource`, `CustomerPrompts`, `CustomerStatus`,
`CUSTOMER_STAGES`, `CustomerStage`, `CrmNote`, `Customer`, `TranscriptSpeaker`, `TranscriptEntry`,
`CallStatus`, `CallSentiment`, `CallReview`, `CallLog`, `Heat`, `Engagement`, `CustomerStats`,
`TrackEvent` and `CallSound`. The 24th, `AmbienceLevel`, is the only one from a different file — it
lives in the promo's `lib/ambience.ts` and `CallSound` references it — and it too is copied verbatim.

The promo's `lib/types.ts` declarations that nothing here reaches (`ResearchInputs`, `CallState`,
`CustomerWithStats`, `VoiceOption`, `LIVE_VOICE_OPTIONS`, `LIVE_VOICES`, `DEFAULT_VOICE`,
`DEFAULT_DEMO_MINUTES`, `DEFAULT_CALL_SOUND`) are left out rather than copied dead.

## `src/db/demoWrite.ts` — 2026-09-22

The writers reproduce the promo's admin route handlers (`app/api/admin/customers/**`). Four things
in them could not come across as they were:

- **`analyze: true` on the calls PATCH is accepted and ignored.** It asked the promo's research
  pipeline (`lib/call-review.ts`) to write a review for a call that reported before reviews existed.
  That pipeline is retired, so `patchCall` returns the call unchanged rather than failing — the
  button is being removed from the dashboard in Task 9, and a 500 in the meantime would say
  something is broken when nothing is. `isTest` in the same request still applies.
- **`buildPrompts` / `resolvePrompts` are not ported.** The promo's PATCH recomputes prompts from
  the profile on every save; that is `lib/prompt.ts`, a prompt-template module outside this stage's
  file list. `patchCustomer` keeps `resolvePrompts`' merge — submitted text that differs from the
  stored text marks the prompts `edited` — and drops the two branches that rebuild, so
  `regeneratePrompts: true` leaves the prompts as they are. `createCustomer` stores empty prompts
  rather than built ones.
- **A new customer is `status: "new"`**, not the promo's `"researching"`, because no research
  follows the create here. Note that `CustomerStatus` (`"researching" | "ready" | "error"`) does not
  include it: the value comes back through `fromCustomerRow`'s cast, and the promo's customers table
  renders anything that is not `ready`/`error` as "Researching".
- **`process.env.LIVE_VOICE || DEFAULT_VOICE` became `DEFAULT_VOICE`.** `LIVE_VOICE` is a promo
  deployment override with no counterpart in this backend's `config/env.ts`.

Constants copied verbatim from the promo because `src/demo/types.ts` deliberately left them out:
`DEFAULT_VOICE = "gleam"` and `DEFAULT_CALL_SOUND = { phoneLine: true, ambience: "quiet" }`
(`lib/types.ts`), `emptyProfile` (`lib/research.ts`), and the ten `code` values of `LANGUAGES` plus
`DEFAULT_LANGUAGE = "en"` (`lib/languages.ts`) — enough to reproduce `languageOf(code).code`, which
is all the merge uses. Ids are minted with `node:crypto` over a 64-character `[A-Za-z0-9_-]`
alphabet, matching `nanoid(12)` for a customer and `nanoid(10)` for a note.

## `src/routes/demo.ts` — the read routes — 2026-09-22

The four GETs are the promo's own handlers (`app/api/admin/analytics/route.ts`,
`customers/route.ts` GET, `customers/[id]/route.ts` GET, `crm/route.ts`), body for body: the same
variable names, the same `slice`/`map`/`sort`, the same response fields and the same comments. Only
the edges changed, because the ported dashboard screens parse these bodies as they are.

- **`lib/store` / `lib/calls` / `lib/crm` reads → `src/db/demoRead.ts`.** `listCustomers`,
  `getCustomer`, `listAllCalls`, `listCalls`, `readEvents` and `listNotes` keep their names and
  their ordering, so each handler's body is unchanged around them.
- **`NextResponse.json(x)` → `return x`; `NextResponse.json(x, { status: n })` → `status(n, x)`.**
  Elysia's `status` comes from the handler context.
- **`new URL(request.url).searchParams` → Elysia's `query`.** `params.get("days") ?? 30` becomes
  `query.days ?? 30` and `params.get("includeTests") === "1"` becomes `query.includeTests === "1"` —
  same values, same fallbacks.
- **The admin guard is new.** The promo's admin routes sat behind its own operator cookie, checked
  in middleware; here every handler opens with
  `authenticateAdmin(headers.authorization, DEMO_IS_ADMIN)` and returns this API's own
  `{ error, message }` denial, as `src/routes/apiKeys.ts` does. That guard resolves a *user* token
  only, so an API key (which `src/routes/usage.ts` accepts) cannot read demo data. Non-auth errors
  keep the promo's `{ error: string }` shape, which is what the screens' `readJson` branches on.
- **`let customers, calls, events;` gained type annotations.** The promo relied on TypeScript's
  evolving-`any`; under this repo's settings the destructuring assignment inside `try` leaves them
  `any`, which would erase the response type. The declarations are otherwise identical.

Three declarations the promo took from files this backend does not have were copied into
`src/routes/demo.ts`:

- **`jsonError` (`lib/api.ts`)** — without its `StoreConfigError` / `OpenAIError` /
  `ClaudeCliError` branches, none of which exists here (no Redis, no OpenAI, no Claude CLI in this
  path). Its fallback is kept verbatim, and it returns the *body* rather than a `NextResponse`,
  since the status belongs to Elysia's `status(500, …)`.
- **`listAllNotes` (`lib/crm.ts`)** — copied verbatim. `demoRead.ts` exposes the per-customer
  `listNotes` the other handlers need, so the CRM feed keeps the promo's fan-out; it is one indexed
  query per customer over an operator-sized list, and the reads go out together.
- **`CustomerWithStats` (`lib/types.ts`)** — the type `src/demo/types.ts` deliberately left out
  when nothing reached it. It lives in the route file rather than being added to `types.ts`.

## `src/routes/demo.ts` — the write routes — 2026-09-22

The six write handlers are the promo's own (`app/api/admin/customers/route.ts` POST,
`customers/[id]/route.ts` PATCH and DELETE, `customers/[id]/notes/route.ts` GET and POST,
`customers/[id]/calls/route.ts` PATCH), with the same rules, the same status codes and the same
`{ error: string }` wording — the create form and the drawer surface those sentences to the operator
verbatim, so they are strings, not paraphrases. Validation stays in the route, as it was in the
promo: `db/demoWrite.ts` trims and stores.

Two declarations were copied in, for the same reason the read routes copied three:

- **`isMapsUrl` (`lib/maps.ts`)** — copied verbatim, minus its `export`. It and its `SHORT_HOSTS`
  are all that the create form's "That does not look like a Google Maps link." 400 needs; the rest
  of that module (`resolveMapsUrl`, `parseMapsUrl`, `fallbackName`) belongs to the retired research
  pipeline and is not ported.
- **`LIVE_VOICES` (`lib/types.ts`)** — the twelve `id` values of `LIVE_VOICE_OPTIONS`, in its order.
  Only the ids: the labels, accents and presentations belong to the promo's voice picker, and
  nothing in this backend renders one.

What differs from the promo, and why:

- **Elysia body schemas are deliberately loose.** Every field is `t.Optional`, the validated strings
  are plain `t.String()` with no `minLength`, and `isTest` / `analyze` on the calls PATCH are
  `t.Unknown()` because the promo's guard tests `typeof body.isTest !== "boolean"` itself. A bad
  value therefore reaches the handler and becomes this API's own 400 rather than the framework's
  422 — the same reasoning as the `query` schema in `src/routes/usage.ts`. A field sent with the
  wrong *type* (a numeric `businessName`, say) is still a 422; the promo would have thrown a
  `TypeError` and 500ed on the same request, so nothing that worked before stops working.
- **`callSound`, `profile` and `prompts` are `t.Unknown()` and cast.** The promo validated none of
  them (`body.profile ?? customer.profile`). Describing them here would turn a field the editor
  gains into a 422 on every save.
- **The PATCH's 400s come before its 404.** The promo read the customer first and 404ed, then
  parsed the body. `patchCustomer` does the read, the merge and the write in one transaction, so
  there is no separate read to 404 on; a request naming both an unknown id and an unknown stage
  gets "Unknown stage." where the promo said "Customer not found.". Every other case is identical.
- **The notes POST and the calls PATCH keep their `getCustomer` read.** Both need it: `demo_notes`
  has a foreign key to `demo_customers`, so without the read an orphaned note is a constraint
  violation and a 500; and `patchCall` returns `null` for "this customer has no call with that id",
  which would collapse the promo's "Customer not found." and "Call not found." into one sentence.
- **The `analyze` branches are gone, not the parameter.** `{ callId, analyze: true }` is still a
  valid request and still returns the call, now unchanged (see the `demoWrite.ts` note above). The
  promo's "This call is too short to say anything about." 400 and its "The review could not be read
  back." 502 have nothing left to raise them and are dropped.
- **No `assertWritableStore()`.** It was the promo's check that Redis was configured for writes;
  this backend has one database and `src/db/client.ts` is the only way to it.

### Correction to the `demoWrite.ts` note above

That section says a new customer is `status: "new"`. It is **`"ready"`** — `createCustomer` writes
`"ready" satisfies CustomerStatus`, and its own doc comment gives the reasoning: `"new"` is outside
the `CustomerStatus` union and the promo's customers table would paint it as a permanent amber
"Researching" badge. The note predates that change.
