# Porting notes — `src/demo/`

**Source commit.** Every copy below was last re-taken from the promo
(`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo`) at `90869c6`
("Let the admin add demo time to a prospect from a menu"). `parity.test.ts` compares against that
checkout's *working tree*, so this line is what says which commit the line numbers below belong to;
update it whenever a file here is re-copied.

## `analytics.ts` — re-copied at `90869c6`

`src/demo/analytics.ts` is a **verbatim copy** of the promo's `lib/analytics.ts`
(`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo\lib\analytics.ts`). It is
copied rather than reimplemented so the Overview and CRM numbers this backend serves match the
promo's by construction instead of by re-derivation. `parity.test.ts` diffs the two files
line by line and requires every difference to be listed here, so the copy cannot quietly drift into
a reimplementation.

Do not reformat, tidy or "improve" that file. If the promo's changes, re-copy it and update this
list.

`90869c6` added two exports at the end of the file — `DEMO_TIME_STEPS` (the minute steps the admin's
"Add time" menu offers) and `extendDemoMinutes(current, add, fallback)`, which returns the new total
or `null` when `add` is not a positive number. They came across with the re-copy; the file is 546
lines now rather than 128, and the two differing lines are still the two imports. `extendDemoMinutes`
is what makes the customer PATCH add to the *stored* minutes instead of to the browser's copy.

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

## `callClock.ts` and `schedule.ts` — re-copied at `90869c6`

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
length (212 and 176 lines).

`90869c6` changed `call-clock.ts` in two ways, both carried over by the re-copy: a new exported
`ordinal(n)` ("1st", "22nd", "24th"), and the prompt's read-back example is now built from
tomorrow's real date (`days[1].weekday` + `ordinal(days[1].day)`) instead of a fixed
"Tuesday the 22nd" — the promo's own comment explaining why is kept with it. `ordinal` needed no
`noUncheckedIndexedAccess` fix: its `["th", "st", "nd", "rd"][n % 10]` already ends in `?? "th"`.
`schedule.ts` did not change at `90869c6`; it is listed here because `callClock.ts` imports it.

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
- `callClock.ts:159` — `` `- Tomorrow is ${days[1].long}.` `` gains a `!` on `days[1]`, for the same
  reason: `days` is `nextDays(today, 7)`, which `Array.from({ length: 7 }, …)` always fills. (It was
  line 151 before `ordinal()` was inserted above it at `90869c6`.)
- `callClock.ts:200` — `days[1].weekday` gains the same `!`, in the read-back example `90869c6`
  added. It sits alone on its line inside a template literal's `${ … }`, which is why the assertion
  shows up on a line of its own.
- `callClock.ts:201` — the same `!` on `ordinal(days[1].day)`, on the line that closes that
  template literal. Two lines rather than one because the promo wraps the interpolation across
  three; joining them would have been a change to the copy.
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

## `callLimits.ts` — new at `90869c6`

`src/demo/callLimits.ts` is a **byte-for-byte copy** of the promo's `lib/call-limits.ts`
(`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo\lib\call-limits.ts`):
`CALL_MAX_SEC`, `WRAP_UP_LEAD_SEC`, `IDLE_END_SEC`, `IDLE_CHECK_SEC`, `AGENT_QUIET_SEC`, the
`CallEnd` and `CallActivity` types, `callLimitSec`, `callEnd`, `shouldWrapUp`, `shouldCheckIn` and
the two instruction strings. It is copied rather than reimplemented because the same rules have to
hold on both sides of the wire: the browser hook counts a call down and the session route tells it
what the cap is, so a backend that disagreed about `CALL_MAX_SEC` would hand out a limit the browser
would not honour.

### Every line that differs

**None.** The file has no `header` and no `footer` in `parity.test.ts`, because there was nothing to
rewrite: it imports nothing, reads no `process.env`, calls no `fetch` and indexes no array, so
neither the `.js`-specifier rule nor `noUncheckedIndexedAccess` has anything to act on. The only
transformation was the file name — `call-limits.ts` becomes `callLimits.ts`, this directory's
camelCase convention, as `callClock.ts` and `callReview.ts` already do.

The dashboard has its own copy at `tecace-voice-agent-dashboard/src/demos/lib/call-limits.ts`,
keeping the promo's kebab-case name there; the two are the same file.

`src/routes/demo.ts` imports `CALL_MAX_SEC` from here for the `maxSec` it returns from
`POST /demo/session`. `callLimitSec` stays unimported on this side: the promo used it to narrow the
cap to what was left of a public prospect's allowance, and this route places admin test calls,
which spend no allowance — so `maxSec` here is the ceiling itself. The dashboard's copy is where
`callLimitSec` and the rest of the module are read.

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

## `prompt.ts`, `hours.ts`, `useCases.ts` and `languages.ts` — 2026-09-23

`src/demo/prompt.ts` is a **verbatim copy** of the promo's `lib/prompt.ts`
(`C:\Users\Michael Knutsen\Documents\projects\test_demo\voiceagent_promo\lib\prompt.ts`):
`hoursLine`, `servicesLine`, `policiesLine`, `COUNTRIES`, `city`, `capitalise`, `withArticle`,
`backendProfile`, `FAQ_LIMIT`/`FAQ_ANSWER_MAX`, `faqLines`, `MEDICAL`, `ADVISORY`, `safetyLines`,
`buildLivePrompt`, `buildBackendPrompt`, `buildGreetingPrompt`, `spokenGreeting`, `quotedGreeting`,
`PROMPT_VERSION` (6, with the whole changelog comment above it), `buildPrompts` and
`resolvePrompts`. It is copied rather than reimplemented for the reason `callClock.ts` is: this
file **is** the receptionist. Every heading, every bullet and every "never" in it is what the model
is told, so a paraphrase would quietly change what a call sounds like — and the same text is shown
to the operator in the prompt editor, where it is meant to be the promo's.

Its three dependencies came with it, all pure and all copied whole:

- `src/demo/hours.ts` — the promo's `lib/hours.ts` (`describeHours`, `knownHours`).
- `src/demo/useCases.ts` — the promo's `lib/use-cases.ts`. Only the file name changed, to this
  directory's camelCase convention, as `callClock.ts` and `callLimits.ts` already do. `prompt.ts`
  reaches `businessNouns` and `categoryMentions` in it; the rest of the module (`buildUseCases`,
  `SCENARIO_COUNT` and the nine scenarios) is the promo's public scenario page and is unreached
  here. It is copied whole rather than trimmed so the next sync stays a plain diff, exactly as the
  dashboard's copy of the same file is.
- `src/demo/languages.ts` — the promo's `lib/languages.ts` (`Language`, the ten `LANGUAGES` with
  their greetings and sign-offs, `DEFAULT_LANGUAGE`, `languageOf`, `languageName`). This is the
  file `src/db/demoWrite.ts` used to inline ten `code` strings from; that copy is gone and the
  module is imported, which is what lets `buildPrompts` quote a real greeting instead of a code.

Do not reformat, tidy or "improve" any of the four. If the promo's change, re-copy them and update
this list.

### Every line that differs

None of the four has a **header** or a **footer**. `prompt.ts` and `hours.ts` already open with
their own imports, so ours rewrite those specifiers in place; `languages.ts` and `use-cases.ts`
import nothing at all. None reads `process.env`, so no `env` import had to be added anywhere, and
all four are compared from line 1 to the last line.

- `prompt.ts:1` — `import { knownHours } from "./hours";` becomes `from "./hours.js";`. This repo
  compiles with `verbatimModuleSyntax` and resolves relative imports by their emitted specifier.
- `prompt.ts:2` — the same `.js` rewrite on `import { languageOf } from "./languages";`.
- `prompt.ts:3` — `import { businessNouns, categoryMentions } from "./use-cases";` becomes
  `from "./useCases.js";` — the `.js` suffix and this directory's name for the same module.
- `prompt.ts:4` — the same `.js` rewrite on
  `import type { BusinessProfile, CustomerPrompts } from "./types";`. Both types are already in
  `src/demo/types.ts`; neither was copied again, and nothing new had to be added there — `city`
  reads `profile.address`, `backendProfile` strips `rating`/`reviewSummary`/`lat`/`lng`, and
  `faqLines` reads `profile.faqs`, all of which that file already declares.
- `prompt.ts:54` — `COUNTRIES.has(segments[segments.length - 1].toLowerCase())` gains a `!` on the
  index. This repo compiles with `noUncheckedIndexedAccess`, so the index yields
  `string | undefined`, which has no `.toLowerCase()`. The `while` condition tests
  `segments.length` first, so the index cannot miss. A **non-null assertion rather than a
  `?? ""`**, following the precedent in `callClock.ts`: `!` is erased at compile time, so what runs
  is byte for byte the promo's, where a fallback would add a branch the promo does not have — and
  here `""` would be a wrong one, since `COUNTRIES.has("")` is false and the loop would stop early.
- `prompt.ts:58` — the same `!` on `const candidate = segments[segments.length - 2];`, which
  `/\d/.test(candidate)` on the next line needs to be a `string`. Guarded by the
  `if (segments.length < 2) return "";` two lines above.
- `prompt.ts:289` — `return quoted ? quoted[1].trim() : null;` gains a `!` on `quoted[1]`. The
  regex `/"([^"]{4,})"/` has exactly one capturing group, so a match always has a `[1]`. Same
  reasoning as `callReview.ts:137`.
- `hours.ts:1` — the `.js` rewrite on `import type { BusinessHour } from "./types";`. That is the
  file's only difference; it indexes nothing and needed no `noUncheckedIndexedAccess` fix.

`useCases.ts` and `languages.ts` have **no differing line at all** — the whole file is compared
line for line and this section lists nothing for either. Neither indexes an array in a way
`noUncheckedIndexedAccess` objects to: `useCases.ts` builds its scenarios with `.map`/`.find`, and
`languageOf`'s `LANGUAGES.find(...)` chain already ends in a `!` the promo itself wrote.

### Where the three wirings are

The promo builds prompts in three places, and each one now has its counterpart here:

1. **`src/db/demoRead.ts` `normalize()`** — the promo's `lib/store.ts normalize()` rebuild,
   condition for condition: `if (!customer.prompts?.edited && customer.prompts?.version !==
   PROMPT_VERSION)` then `buildPrompts(customer.profile, customer.agentName, customer.language)`.
   Both `listCustomers` and `getCustomer` already ran `normalize`, so both read routes and
   everything that loads through them pick it up. This is what refreshes the eight imported
   customers that sit at versions 3, 4 and none; the two `edited` ones are untouched.
2. **`src/db/demoWrite.ts` `patchCustomer`** — the local two-argument `resolvePrompts` is deleted
   and the promo's is imported, called with the promo's own object literal (`current`, `submitted`,
   `profile: next.profile`, `agentName: next.agentName`, `language: next.language`,
   `regenerate: patch.regeneratePrompts`), which is `app/api/admin/customers/[id]/route.ts:155-162`
   verbatim. `regeneratePrompts: true` now regenerates, and a save that types nothing into the
   prompts refreshes them from the profile instead of returning them unchanged.
3. **`src/db/demoWrite.ts` `createCustomer`** — `buildPrompts(profile, agentName, language)` in
   place of `{ live: "", backend: "", greeting: "", edited: false }`.

`languageOf` is now the real one, so both call sites take `.code` off it, as the promo's routes do
(`languageOf(body.language).code`). In `createCustomer` the `?? ""` the inlined helper needed is
gone too — the promo passes `body.language` straight in, and `languageOf(undefined)` already
answers English.

Line endings are LF here and CRLF in the promo; the parity test normalises both before comparing,
so that is not counted as a difference.

## `types.ts`

`src/demo/types.ts` holds the 25 declarations `analytics.ts` and the demo routes need, each copied
verbatim from the promo's `lib/types.ts`: `BusinessHour`, `BusinessService`, `BusinessPolicies`,
`BusinessFaq`, `BusinessProfile`, `ResearchSource`, `CustomerPrompts`, `DEFAULT_DEMO_MINUTES`,
`CustomerStatus`, `CUSTOMER_STAGES`, `CustomerStage`, `CrmNote`, `Customer`, `TranscriptSpeaker`,
`TranscriptEntry`, `CallStatus`, `CallSentiment`, `CallReview`, `CallLog`, `Heat`, `Engagement`,
`CustomerStats`, `TrackEvent` and `CallSound`. The 25th, `AmbienceLevel`, is the only one from a
different file — it lives in the promo's `lib/ambience.ts` and `CallSound` references it — and it
too is copied verbatim.

`DEFAULT_DEMO_MINUTES` (with its doc comment, and in the promo's position between `CustomerPrompts`
and `CustomerStatus`) joined the list at `90869c6`: it was listed below as unreachable until the
"Add time" menu arrived, and `extendDemoMinutes(stored, add, DEFAULT_DEMO_MINUTES)` in
`src/db/demoWrite.ts` is what now reaches it — a prospect with no stored figure is topping up the
default, not zero.

`ResearchInputs` joined the list on 2026-09-23, copied verbatim with its doc comment and in the
promo's own position between `ResearchSource` and `CustomerPrompts`. It was listed below as
unreachable until the research pipeline was ported; `src/demo/research.ts` is what now reaches it.

The promo's `lib/types.ts` declarations that nothing here reaches (`CallState`,
`CustomerWithStats`, `VoiceOption`, `LIVE_VOICE_OPTIONS`, `LIVE_VOICES`, `DEFAULT_VOICE`,
`DEFAULT_CALL_SOUND`) are left out rather than copied dead.

## `src/db/demoWrite.ts` — 2026-09-22

The writers reproduce the promo's admin route handlers (`app/api/admin/customers/**`). Four things
in them could not come across as they were:

- **`analyze: true` on the calls PATCH is accepted and ignored.** It asked the promo's research
  pipeline (`lib/call-review.ts`) to write a review for a call that reported before reviews existed.
  That pipeline is retired, so `patchCall` returns the call unchanged rather than failing — the
  button is being removed from the dashboard in Task 9, and a 500 in the meantime would say
  something is broken when nothing is. `isTest` in the same request still applies.
- ~~**`buildPrompts` / `resolvePrompts` are not ported.**~~ **No longer true (2026-09-23).** That
  bullet said the promo's rebuild branches were dropped because `lib/prompt.ts` was outside the
  stage's file list. It has since been ported — see the `prompt.ts` section above — so
  `patchCustomer` imports the promo's own `resolvePrompts` whole (the merge *and* both rebuild
  branches), `regeneratePrompts: true` regenerates, and `createCustomer` stores
  `buildPrompts(profile, agentName, language)` rather than empty prompts. Nothing about the merge
  itself changed: submitted text that differs from the stored text still marks the prompts
  `edited`, and an `edited` record is still left alone.
- **A new customer is `status: "new"`**, not the promo's `"researching"`, because no research
  follows the create here. Note that `CustomerStatus` (`"researching" | "ready" | "error"`) does not
  include it: the value comes back through `fromCustomerRow`'s cast, and the promo's customers table
  renders anything that is not `ready`/`error` as "Researching".
- **`process.env.LIVE_VOICE || DEFAULT_VOICE` became `DEFAULT_VOICE`.** `LIVE_VOICE` is a promo
  deployment override with no counterpart in this backend's `config/env.ts`.

Constants copied verbatim from the promo because `src/demo/types.ts` deliberately left them out:
`DEFAULT_VOICE = "gleam"` and `DEFAULT_CALL_SOUND = { phoneLine: true, ambience: "quiet" }`
(`lib/types.ts`), and
`emptyProfile` (`lib/research.ts`). The ten `code` values of `LANGUAGES` plus
`DEFAULT_LANGUAGE = "en"` were copied in here too, as enough to reproduce `languageOf(code).code`;
that copy is **gone** — `src/demo/languages.ts` is the real module now, and this file imports
`languageOf` from it. Ids are minted with `node:crypto` over a 64-character `[A-Za-z0-9_-]`
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
- **`addDemoMinutes` is checked in the route and applied in the writer** (`90869c6`). The promo did
  both in the handler, which had the customer in hand; here the stored figure only exists inside
  `patchCustomer`'s locked transaction, and adding to anything else would defeat the field. So the
  route asks `extendDemoMinutes(undefined, body.addDemoMinutes, DEFAULT_DEMO_MINUTES) === null` —
  which is null for exactly the amounts the promo refuses, whatever they are added to — and answers
  the promo's 400 `"Minutes to add must be positive."` before any write; `demoWrite.ts` then adds
  the amount to `customer.demoMinutes`. The promo's `!` on the second call becomes
  `?? customer.demoMinutes` there, unreachable through this API and a kept value for any other
  caller. `addDemoMinutes` is `t.Unknown()` in the body schema for the reason the first bullet
  gives: `"ten"` has to reach the handler to become that sentence rather than a 422.
- **`POST /demo/session` answers with `maxSec`** (`90869c6`), alongside `callId`, `sessionId`, `sdp`
  and `greeting`, so the browser hangs up on its own at the limit. The promo narrowed it to the
  prospect's remaining allowance; this route is admin test calls, which skip the allowance, so it
  is `CALL_MAX_SEC` — see the `callLimits.ts` note above.

### Correction to the `demoWrite.ts` note above

That section says a new customer is `status: "new"`. It is **`"ready"`** — `createCustomer` writes
`"ready" satisfies CustomerStatus`, and its own doc comment gives the reasoning: `"new"` is outside
the `CustomerStatus` union and the promo's customers table would paint it as a permanent amber
"Researching" badge. The note predates that change.


## `maps.ts`, `research.ts` and `researchRunner.ts` — 2026-09-23

The research pipeline, the backend half of **Gap C** in
`docs/superpowers/specs/2026-09-23-source-parity-audit.md`. Three promo modules
(`lib/maps.ts`, `lib/research.ts`, `lib/research-runner.ts`), two of them verbatim and under the
parity test, one of them not — and the one that is not is the decision worth reading.

### The Anthropic decision, and what it cost

The promo's `lib/research-runner.ts` picks one of three providers: the Claude Code CLI, the OpenAI
Responses API, or the Anthropic API. The third opens with `import Anthropic from
"@anthropic-ai/sdk"` — a dependency this repo does not have.

**Chosen: port without the Anthropic branch, and without the CLI branch, and say so here.** No
dependency was added; `package.json` is untouched.

Why. This service deploys to Vercel with `OPENAI_API_KEY` set (`package.json`: "Bun locally,
Vercel/Node in prod"), and the promo's own `resolveProvider()` answers `"openai"` for exactly that
host — `if (process.env.VERCEL) return process.env.OPENAI_API_KEY ? "openai" : "anthropic"`. So
adding `@anthropic-ai/sdk` would have bought a code path the deployed service can never take, plus
a second SDK, a second key (`ANTHROPIC_API_KEY`) and a second model setting (`RESEARCH_API_MODEL`)
in the config surface. The CLI branch goes for a related reason of fact rather than of taste: it
spawns a `claude` binary through `node:child_process`, and there is no such binary in this service's
image on either side of the `VERCEL` test. Porting it would have meant copying `lib/claude-cli.ts`'s
`runClaude` as well — 100 lines of process handling for something that cannot run where this runs.

**What it costs, stated plainly:**

- a deployment that has an Anthropic key and no OpenAI key cannot research at all, where the promo
  could. There is no such deployment today, and the same `OPENAI_API_KEY` already gates the test
  call, so this loses no capability that is in use;
- running the backend locally no longer researches on the operator's Claude subscription. Local
  research bills the OpenAI key like production does. That is a real per-run cost the promo did not
  pay locally;
- `RESEARCH_API_MODEL` and `RESEARCH_MODEL` are not read anywhere here, because the branches that
  read them are gone. They are not in `.env.example` either — dead config is worse than absent
  config. The audit's section 5 lists all five settings; the three that are implemented
  (`RESEARCH_PROVIDER`, `RESEARCH_OPENAI_MODEL`, `RESEARCH_SEARCH_CONTEXT`) are there.

**This is the user's to reverse.** Adding `@anthropic-ai/sdk` and pasting `runViaApi` back is a
dozen lines: `resolveProvider` still returns `"anthropic"`, and `runResearchPrompt` already
switches on it — it just throws instead of running. Nothing was designed around the branch's
absence.

The two missing providers are **named, not silent**. `ResearchProvider` still has all three members
and `RESEARCH_PROVIDER` still accepts all three; `runResearchPrompt` answers `cli` and `anthropic`
with `Research is set to the "<name>" provider, which this backend does not carry. Unset
RESEARCH_PROVIDER, or set it to openai.` A provider that is configured and quietly does something
else is the failure mode that was worth avoiding.

### `maps.ts` — every line that differs

Copied from `lib/maps.ts`. It imports nothing and reads no `process.env`, so there is no header and
no footer and the whole file is compared.

- `maps.ts:70` — `decodePlaceName(placeMatch[1])` → `decodePlaceName(placeMatch[1]!)`. Under
  `noUncheckedIndexedAccess` a regex capture group reads as `string | undefined`, and
  `decodePlaceName` takes a `string`. A matched group always exists, so this is `!` rather than a
  branch, as elsewhere in this directory.

That is the only one. Nothing else in the file needed touching — the other five indexed reads all
feed `Number()` or a `??=` onto an optional field, neither of which minds `undefined`.

### `research.ts` — every line that differs

Copied from `lib/research.ts`. Four lines differ and they are its first four, all imports:

- `research.ts:1` — `import { ClaudeCliError, extractJson } from "./claude-cli"` →
  `from "./callReview.js"`. **Not just a specifier rewrite.** The promo's `lib/claude-cli.ts` is the
  CLI runner, which is not ported; its two pure helpers were already copied into the footer of
  `src/demo/callReview.ts` (see `callReview.ts:116-159` above) and are exported from there. Copying
  them a second time would give this directory two `ClaudeCliError` classes and an `instanceof` that
  answers differently depending on which module threw — so `research.ts` imports the copy that
  already exists. `researchRunner.ts` throws the same class from the same place, for the same
  reason.
- `research.ts:2` — `"./research-runner"` → `"./researchRunner.js"`: this directory's camelCase file
  names, and the emitted specifier `verbatimModuleSyntax` wants.
- `research.ts:3` — `"./maps"` → `"./maps.js"`.
- `research.ts:4` — `"./types"` → `"./types.js"`.

The body is untouched, including `researchBusiness`'s two-pass structure, `stripEmpties`,
`cleanSourceUrl`'s tracking-parameter and search-page rules, `dedupeSources`' 25-source cap and
`emptyProfile`.

`emptyProfile` being a real export now has one consequence outside this directory:
`src/db/demoWrite.ts` used to carry its own copy of it, with a comment saying it was copied because
`lib/research.ts` was not ported. That copy is deleted and the import is the promo's function.

`research.ts` needs `ResearchInputs`, which `src/demo/types.ts` had left out as unreachable. It is
copied verbatim from the promo's `lib/types.ts` (with its doc comment, in its own position between
`ResearchSource` and `CustomerPrompts`), and struck from the list of deliberately-omitted
declarations in the `types.ts` section above.

### `researchRunner.ts` — not a verbatim copy, and not in the parity table

`src/demo/researchRunner.ts` is `lib/research-runner.ts` with two of three providers removed, per
the decision above. It is therefore **not** listed in `parity.test.ts`'s `PORTED` table: that table
asserts a file is a copy, and this one is not. What survives from the promo, unchanged:

- `ResearchProvider`, `ResearchRun` and the `PROVIDERS` list — all three names intact;
- `runViaOpenAI` in full, including `max_output_tokens: 8000`, the `web_search` tool with its
  `search_context_size`, and the two timeouts `SEARCH_TIMEOUT_MS = 180_000` /
  `PLAIN_TIMEOUT_MS = 90_000` with the comment that explains them;
- `searchContextSize()`'s rule (anything but `low`/`high` is `medium`) and `openaiModel()`'s default
  of `gpt-5.6-terra`;
- `runResearchPrompt(prompt, { withSearch })` as the single seam `research.ts` calls.

What changed:

- `import Anthropic from "@anthropic-ai/sdk"`, `runViaApi`, `runViaCli`, `apiModel()`, `cliModel()`
  and `import { ClaudeCliError, runClaude } from "./claude-cli"` are gone;
- `ClaudeCliError` is imported from `./callReview.js`, as in `research.ts`;
- the three `process.env` reads go through `../config/env.js` — `env.researchProvider`,
  `env.researchOpenaiModel`, `env.researchSearchContext` — which is this repo's rule and is also
  what lets a test set them on the `env` object per run, the way `demoCall.pg.test.ts` already does
  for the OpenAI settings;
- `resolveProvider()` no longer asks `process.env.VERCEL`. The promo asked because it had a CLI to
  prefer when the answer was no; there is no CLI here on either branch, so an unset or unrecognised
  `RESEARCH_PROVIDER` lands on `openai` directly.

### Config

`src/config/env.ts` gains `researchProvider`, `researchOpenaiModel` and `researchSearchContext`,
next to `openaiApiKey` and following its precedent exactly: **none of them throws at import.** A
deployment with no `OPENAI_API_KEY` serves every other Demo route normally, and only a research
attempt fails — with `src/demo/openai.ts`'s own "OPENAI_API_KEY is not set on the server.", which
is the promo's message because that file is a verbatim copy of `lib/openai.ts`. The route turns it
into the promo's 502 like any other research failure. All three settings are in `.env.example`.

## `src/db/demoWrite.ts` — the research writes — 2026-09-23

Three new writers, one per `saveCustomer` call in the promo's research paths
(`app/api/admin/customers/[id]/research/route.ts` and `runResearch` at the bottom of
`app/api/admin/customers/route.ts`). No inline SQL reached the route: JSONB binds through the
existing `jsonb()` helper, never pre-stringified and never `::jsonb`.

- **`startResearch(id, inputs)`** — the first `saveCustomer`: the four research inputs,
  `status: "researching"`, `error` cleared. It does not touch `updated_at`, because the promo's
  spread does not either — nothing a reader cares about has changed yet.
- **`saveResearch(id, result, { regeneratePrompts })`** — the second: `business_name` (the promo's
  `result.businessName ||` the name we ran with), `resolved_maps_url`, `profile`, `dossier`,
  `sources`, `prompts`, `status: "ready"`, `error` cleared, `researched_at` and `updated_at`. **The
  prompts are the reason this is a writer and not an UPDATE in the route:** the promo's rule is
  `keepPrompts = customer.prompts.edited && !regeneratePrompts`, else
  `buildPrompts(result.profile, agentName, language)`, and `edited`, `agentName` and `language` all
  have to be read from the row being written. It is one transaction on a `FOR UPDATE` row for the
  same reason `patchCustomer` is — a research run takes over a minute, which is a wide window for a
  drawer save to land in. `null` when the record has gone, which is the promo's
  `if (!current) return;`.
- **`failResearch(id, message)`** — the third: `status: "error"`, the message, `updated_at`. It
  touches nothing else, which is what "the record stays usable" means concretely — the profile, the
  dossier and the prompts are exactly what they were, so a prospect that had been researched before
  keeps the receptionist it had.

Three fields the promo writes on the success path are not written there here — `website_url`,
`maps_url` and `research_notes`. `startResearch` wrote them a minute earlier from the same values
and nothing in between can change them, so the stored result is identical; the promo only repeats
them because it is spreading a whole object. The same applies to the four it repeats on its failure
path.

**`createCustomer` now writes `status: "researching"`, not `"ready"`.** That supersedes the
"Correction to the `demoWrite.ts` note above" section: `"ready"` was right while nothing was ever
going to research a new prospect, and now the route fires a run the moment it answers. The record
is the promo's again, `"researching"` included.

## `src/routes/demo.ts` — the research route — 2026-09-23

**`POST /demo/customers/:id/research`** is `app/api/admin/customers/[id]/research/route.ts`, behind
the same `authenticateAdmin` guard as every other handler in this file (the promo used its own
operator password; a signed-in non-admin gets 403 with `DEMO_IS_ADMIN`, nobody gets 401). Its status
codes and error strings are the promo's verbatim:

| | |
| --- | --- |
| no such customer | `404 { error: "Customer not found." }` |
| no business name, stored or sent | `400 { error: "Enter the business name." }` |
| the run failed | `502 { error: <the error's own message> }`, with the record marked `error` |
| deleted mid-run | `404 { error: "Customer not found." }` |

The body is optional whole — "No body is fine: re-research with what is stored" — and its four
input fields follow the customer PATCH's rule: `""` clears, an absent key leaves the stored value,
a blank `businessName` is a no-op. `regeneratePrompts` is passed to `saveResearch`.

One deviation, in the 404-vs-500 ordering: the promo's `getCustomer` cannot throw (a Redis read
returning null), while ours can (a database that is down), so the read is wrapped and a failed read
is a 500 rather than being reported as "Customer not found."

`isMapsUrl` is no longer inlined in this file. It was copied here with a comment saying the rest of
`lib/maps.ts` belonged to a retired pipeline; the pipeline is back, so the copy is deleted and the
import is `../demo/maps.js`.

### Research on create, and what happens if the process goes away

The promo's `POST /customers` ends with Next's `after(async () => runResearch(...))` and returns 201
immediately. There is no `after` in Elysia, and the **behaviour** is reproduced rather than the
call: `startBackgroundResearch(customer.id, inputs)` starts `runResearch` and does not await it, the
handler returns the 201 it has already built, and the run carries on in the same process, updating
the record through `saveResearch` / `failResearch` when it lands. That is what the promo's own
comment says `after` degrades to off a serverless host — "locally it behaves like a plain background
call".

`runResearch` itself is the promo's, in substance line for line: research, save, and on a throw
record the message. It can never reject, because nothing awaits it — an unhandled rejection is not a
way to report that one prospect's research failed — so even the failure write is guarded.

**The failure mode.** `after()`'s one real guarantee is the one this cannot reproduce: keeping the
invocation alive. If the process is torn down between the response and the end of the run — a
deploy, a container restart, or a serverless host freezing the function the moment the response is
flushed — the run dies where it stood. Neither `saveResearch` nor `failResearch` ever fires, so
**the prospect is left at `status: "researching"` with nothing attached to it, indefinitely.** This
is not hypothetical and it is not ours alone: the promo has the same hole, and names it —
`isResearchStalled` reads a `"researching"` record older than 15 minutes as stalled, which is the
dashboard's cue to offer "Re-research". `POST /demo/customers/:id/research` is that way out, and it
runs *inside* the request precisely so it cannot be lost the same way: it either finishes or returns
a 502 saying why.

`pendingResearch()` is exported from `src/routes/demo.ts` for that reason too. It resolves when
every background run started so far has finished — a handle for a test that would otherwise be
racing a background promise, and for a graceful shutdown that wants to give one a chance to land.
It does not, and cannot, make the run survive the process.
