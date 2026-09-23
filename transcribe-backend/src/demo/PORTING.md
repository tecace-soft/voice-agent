# Porting notes — `src/demo/`

## `analytics.ts`

`src/demo/analytics.ts` is a **verbatim copy** of the promo's `lib/analytics.ts`
(`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo\lib\analytics.ts`). It is
copied rather than reimplemented so the Overview and CRM numbers this backend serves match the
promo's by construction instead of by re-derivation. `parity.test.ts` diffs the two files
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

## `openai.ts` — 2026-09-23

`src/demo/openai.ts` is a **verbatim copy** of the promo's `lib/openai.ts`
(`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo\lib\openai.ts`):
`OpenAIError`, `createResponse`, `createLiveSession`, the two timeouts, `readError`'s fallback chain
and the `data.transport?.sdp ?? data.sdp` SDP-answer fallback. It is copied rather than
reimplemented so the live handshake this backend performs is the one the promo already proved
against the real API. `parity.test.ts` covers it by the same mechanism it covers `analytics.ts`:
line-by-line diff, every difference listed below by line number.

Do not reformat, tidy or "improve" that file. If the promo's changes, re-copy it and update this
list.

### Every line that differs

- `openai.ts:1-2` — the **header**: `import { env } from "../config/env.js"` and the blank line
  after it. The promo's file imports nothing, because it reads `process.env` directly; ours reads
  this repo's typed config instead, which needs the import. The parity test knows about this through
  the `header: 2` entry in its `PORTED` table: it checks those lines really are imports or blank,
  skips them, and compares the rest line for line — so the body is still held to a byte-for-byte
  match, and the reported line numbers are the ones an editor shows.
- `openai.ts:5` — `return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");`
  becomes `return env.openaiBaseUrl;`. Neither the default nor the trailing-slash strip was dropped:
  `src/config/env.ts` defines `openaiBaseUrl` as that same expression, so `base()` returns the same
  string for the same environment.
- `openai.ts:18` — `const key = process.env.OPENAI_API_KEY;` becomes
  `const key = env.openaiApiKey;`. `env.openaiApiKey` is `string | undefined`, so the `if (!key)`
  guard on the next line still narrows it to `string`, and the thrown message stays exactly
  `"OPENAI_API_KEY is not set on the server."` — the sentence the promo's UI showed and the one the
  dashboard shows when a deployment has no key.

That is the whole list. No import specifier in this file needed a `.js` suffix: the promo's
`lib/openai.ts` imports nothing, and the `env` import above is new rather than rewritten.

Line endings are LF here and CRLF in the promo; the parity test normalises both before comparing,
so that is not counted as a difference.

## `callClock.ts` and `schedule.ts` — 2026-09-23

`src/demo/callClock.ts` is a **verbatim copy** of the promo's `lib/call-clock.ts`
(`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo\lib\call-clock.ts`):
`CalendarDay`, `zonedToday`, `dayFromKey`, `zonedTime`, `nextDays`, `safeTimeZone` and `callClock`,
with the same `WEEKDAYS`/`MONTHS` tables and the same noon-UTC trick in `calendarDay`. It is copied
rather than reimplemented because the block it builds is pasted straight into both model prompts:
the receptionist's idea of what day it is has to be the promo's, sentence for sentence, or a call
placed from this backend would answer "is tomorrow open?" differently from the one the promo proved.

`src/demo/schedule.ts` came with it, and is a **verbatim copy** of the promo's `lib/schedule.ts`.
It is not in the plan's file list, but `call-clock.ts` opens
`import { datedWeek, hoursUnknown } from "./schedule"`, and those two functions decide the whole
shape of the clock text — whether it prints a seven-day book or a bare list of dates, and which
times it calls taken. Reimplementing them, or inlining a trimmed pair into `callClock.ts`, would
have put the one part of the block that is actually computed outside the parity test. So the module
is copied whole (including `demoWeek`, `slotTimes` and `minutesOf`, which `datedWeek` is built out
of) and added to `PORTED` alongside it. Nothing else in this backend imports it yet.

Do not reformat, tidy or "improve" either file. If the promo's change, re-copy them and update this
list.

### Every line that differs

Neither file has a **header**: the promo's versions already begin with their own imports, so ours
rewrite those two specifiers in place rather than adding lines at the top. `call-clock.ts` reads no
`process.env` at all — `safeTimeZone(value, fallback)` and `callClock(now, timeZone, hours)` take
the timezone as an argument, and it is the *caller* in `src/routes/demo.ts` that will pass
`env.defaultTimezone`. So both files are compared from line 1, and both are exactly the promo's
length (200 and 176 lines).

- `callClock.ts:1` — `from "./schedule"` becomes `from "./schedule.js"`, this repo compiling with
  `verbatimModuleSyntax` and resolving relative imports by their emitted specifier. Nothing else on
  the line changed; the module keeps the promo's contents under this repo's file name.
- `callClock.ts:2` — the same `.js` rewrite on `import type { BusinessHour } from "./types"`. The
  type resolves to the copy already in `src/demo/types.ts`; it was not copied again.
- `callClock.ts:67` — `const weekday = WEEKDAYS[at.getUTCDay()];` gains a `!`. This repo compiles
  with `noUncheckedIndexedAccess`, so the index yields `string | undefined`, which `CalendarDay`'s
  `weekday: string` rejects. `getUTCDay()` returns 0-6 and `WEEKDAYS` has seven entries, so the
  index cannot miss. A **non-null assertion rather than a `?? ""`** on purpose: it is erased at
  compile time, so what runs is byte for byte the promo's, where a fallback would add a branch the
  promo does not have and would quietly paper over a real miss later.
- `callClock.ts:68` — the same `!` on `const monthName = MONTHS[m - 1];`. `m` comes from
  `at.getUTCMonth() + 1`, so it is 1 to 12 and `MONTHS` has twelve entries. Fixed at the declaration
  rather than at its two uses (lines 75 and 76), which is one changed line instead of two.
- `callClock.ts:151` — `` `- Tomorrow is ${days[1].long}.` `` gains a `!` on `days[1]`, for the same
  reason: `days` is `nextDays(today, 7)`, which `Array.from({ length: 7 }, …)` always fills.
- `schedule.ts:1` — `import type { CalendarDay } from "./call-clock"` becomes
  `from "./callClock.js"` — the `.js` suffix and this repo's name for the same module.
- `schedule.ts:2` — the same `.js` rewrite on `import type { BusinessHour } from "./types"`.

That is the whole list. No declaration had to be added to `src/demo/types.ts`: `BusinessHour` is
already there, and `CalendarDay`, `ScheduleDay` and `ScheduleSlot` are declared inside the two
copied files, exactly as the promo declares them. `schedule.ts` needed no
`noUncheckedIndexedAccess` fix at all — its `match[1]`/`match[2]` go straight into `Number()`, and
`NAMES[taken % NAMES.length]` lands on an optional `who?: string`.

Line endings are LF here and CRLF in the promo; the parity test normalises both before comparing,
so that is not counted as a difference.

## `callReview.ts` — 2026-09-23

`src/demo/callReview.ts` is a **verbatim copy** of the promo's `lib/call-review.ts`
(`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo\lib\call-review.ts`):
`INSTRUCTIONS` word for word, `SENTIMENTS`, `line`, `parseReview`, `reviewable` and `reviewCall`,
with the same `TIMEOUT_MS = 45_000`, the same `MIN_CALLER_LINES = 2` and the same
`slice(0, 24_000)` on the transcript. It is copied rather than reimplemented because the review is
a prompt: the three sentences and the `gaps` list the dashboard renders are shaped entirely by
`INSTRUCTIONS`, so a paraphrase would quietly change what the model is asked for and what the cards
say. Both guards are kept exactly as they are — under two caller lines there is nothing to judge,
and with no API key `reviewCall` returns `null` rather than calling out.

Do not reformat, tidy or "improve" that file. If the promo's changes, re-copy it and update this
list.

### Every line that differs

The file has no **header**: the promo's version already opens with four imports, and ours rewrites
them in place. It does have a **footer** — see the section below.

- `callReview.ts:1` — `import { extractJson } from "./claude-cli";` becomes
  `import { env } from "../config/env.js";`. `extractJson` is no longer imported at all: it is
  copied into the footer of this file, so the line it used to occupy is free for the `env` import
  that replaces the promo's `process.env` reads. Taking over this line rather than adding one at
  the top is why the file needs no `header`.
- `callReview.ts:2` — `from "./openai"` becomes `from "./openai.js"`. This repo compiles with
  `verbatimModuleSyntax` and resolves relative imports by their emitted specifier. Nothing else on
  the line changed; it still imports `createResponse` from the copy in `src/demo/openai.ts`.
- `callReview.ts:3` — `import { transcriptText } from "./transcript";` becomes a comment saying
  where `extractJson` and `transcriptText` went. Same reason as line 1: the helper is in the footer,
  so there is nothing to import, and the line is spent pointing a reader at it instead of being
  deleted — deleting it would shift every line below and break the line-for-line comparison.
- `callReview.ts:4` — the same `.js` rewrite on
  `import type { CallLog, CallReview, CallSentiment } from "./types"`. All three types are already
  in `src/demo/types.ts`; none was copied again.
- `callReview.ts:19` — `return process.env.CALL_REVIEW_MODEL || "gpt-5.6-terra";` becomes
  `return env.callReviewModel;`. Neither the variable nor the default was dropped:
  `src/config/env.ts` defines `callReviewModel` as `process.env.CALL_REVIEW_MODEL || "gpt-5.6-terra"`,
  that same expression, so `model()` returns the same string for the same environment — and the
  string it returns is stored on the review as `model`, which the dashboard shows.
- `callReview.ts:93` — `if (!process.env.OPENAI_API_KEY) return null;` becomes
  `if (!env.openaiApiKey) return null;`. `env.openaiApiKey` is `process.env.OPENAI_API_KEY`, so the
  guard is the same guard: a deployment with no key gets no review, and no thrown error.

No `noUncheckedIndexedAccess` fix was needed anywhere in the body — it indexes nothing.

### The footer — `callReview.ts:116-159`

The promo's file ends at line 114. Lines 116 to 159 of ours are an appended **footer**, holding the
two helpers `call-review.ts` imports from modules this backend has no reason to port whole. The
parity test skips them (`footer: 44` in its `PORTED` table, `all.slice(header, all.length - footer)`)
so the body above can still be compared byte for byte, and in exchange it asserts the string
`callReview.ts:116-159` appears here — so the footer cannot grow a line at a time without this note
going stale and the test failing. The last number is the empty line a trailing newline leaves
behind, which is the line number an editor shows.

What is in it:

- **`extractJson` (`lib/claude-cli.ts`)** — copied verbatim, and it is all that `parseReview` needs
  from that module. The rest of `claude-cli.ts` spawns the Claude Code CLI for the retired research
  pipeline: `node:child_process`, `resolveClaudeCli`, the `CANDIDATES` path search. None of that
  belongs in this backend, and importing the module for one function would drag it in.
- **`ClaudeCliError` (`lib/claude-cli.ts`)** — the one other thing copied from that module, against
  the letter of "nothing else": `extractJson`'s last statement is `throw new ClaudeCliError(...)`,
  so it cannot compile without it. It is copied verbatim rather than downgraded to a plain `Error`,
  which would have been a change to the copied line. Nothing catches it by type — `parseReview`
  wraps the call in a bare `try`/`catch` — so the class is here to keep `extractJson` unchanged,
  not because the name is load-bearing.
- **`transcriptText` (`lib/transcript.ts`)** — copied verbatim, and nothing else from that module.
  The rest of it (`BUBBLE_GAP_MS`, `Fragment`, `appendFragment`) joins GPT-Live's timed fragments
  into bubbles in the browser; this backend receives finished transcripts.
- **`import type { TranscriptEntry } from "./types.js";`** — `transcriptText`'s parameter type.
  The import is in the footer rather than added to line 4, so the body's import block stays the
  promo's; ES module imports are hoisted, so its position makes no difference.

One `noUncheckedIndexedAccess` fix, in the footer rather than the body:

- `callReview.ts:137` — `const candidate = fenced ? fenced[1].trim() : trimmed;` gains a `!` on
  `fenced[1]`. The regex `` /```(?:json)?\s*([\s\S]*?)```/ `` has exactly one capturing group, so a
  match always has a `[1]`, but under `noUncheckedIndexedAccess` the index yields
  `string | undefined`. A **non-null assertion rather than a `?? ""`**, following the precedent set
  in `callClock.ts`: `!` is erased at compile time, so what runs is byte for byte the promo's, where
  a fallback would add a branch the promo does not have — and here it would be a worse branch, since
  `""` would send `JSON.parse("")` down the brace-scanning path on a string that is known to have
  none.

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
