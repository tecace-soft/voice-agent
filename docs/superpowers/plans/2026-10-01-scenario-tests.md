# Scenario Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin presses **Run selected** on a business's settings page; each ticked scenario
runs once as a synthesized-voice call against the real GPT-Live receptionist with sandbox tools,
is graded, and the text results appear. Then it stops.

**Architecture:** `transcribe-backend` owns scenarios, pass/run records, the session snapshot,
sandbox tools and grading. A new runner process in `openai-agent-app` is woken by
`POST /scenarios/passes/:id`, pulls one job at a time, voices the customer lines with OpenAI TTS,
drives the GPT-Live socket and forwards every tool call to the backend's sandbox. The dashboard
(admin only) lists scenarios, starts/stops a pass and polls its results.

**Tech Stack:** Bun + Elysia + Postgres (PGlite in tests), Python 3.12 + websockets + httpx +
FastAPI, React + Vite + Tailwind/shadcn (`.tw`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-scenario-tests-design.md`

**Git:** the user handles all commits. Every "Checkpoint" step means: stop, report what changed,
and do **not** run `git commit` or `git push`.

---

## File map

`transcribe-backend/`
| File | Responsibility |
|---|---|
| `src/scenarios/types.ts` (new) | Scenario/run types, `readDefinition` validation |
| `src/scenarios/templates.ts` (new) | S01–S12 templates, slot picking, placeholder resolution |
| `src/scenarios/sandbox.ts` (new) | Sandbox tools (pure: state in, state out) |
| `src/scenarios/checks.ts` (new) | Code checks (pure) |
| `src/scenarios/judge.ts` (new) | AI judge on `gpt-5.6-luna` |
| `src/scenarios/grade.ts` (new) | Code checks + judge → verdict |
| `src/scenarios/runnerClient.ts` (new) | Wake the runner |
| `src/db/scenarios.ts` (new) | All SQL for the three tables |
| `src/routes/scenarios.ts` (new) | Admin + runner routes |
| `src/db/client.ts` | DDL + migration probe |
| `src/config/env.ts` | Three env vars |
| `src/demo/publicDemo.ts` | `busy` intervals for the demo calendar |
| `src/app.ts` | Mount the routes |
| tests: `src/scenarios/*.test.ts`, `src/routes/scenarios.pg.test.ts` (new) | |

`openai-agent-app/`
| File | Responsibility |
|---|---|
| `src/openai_agent/scenario/__init__.py` (new) | package |
| `src/openai_agent/scenario/settings.py` (new) | Runner env |
| `src/openai_agent/scenario/turns.py` (new) | Turn-taking policy + transcript (pure) |
| `src/openai_agent/scenario/audio.py` (new) | TTS, silence frame, "is the agent talking?" |
| `src/openai_agent/scenario/backend_client.py` (new) | `next` / `tool` / `result` calls |
| `src/openai_agent/scenario/run_one.py` (new) | One scenario over the GPT-Live socket |
| `src/openai_agent/scenario/server.py` (new) | `POST /scenarios/passes/{id}`, single-flight |
| `scripts/run_scenario_runner.py` (new) | Entry point |
| `scripts/checks/verify_scenario_runner.py` (new) | Offline check: policy + fake backend + fake GPT-Live |
| `docker-compose.yml`, `.env.example` | `scenarios` service, env |

`tecace-voice-agent-dashboard/`
| File | Responsibility |
|---|---|
| `src/api/types.ts`, `src/api/backend.ts` | Types + API calls |
| `src/settings/scenarios/format.ts` (new) | Pure display helpers |
| `src/settings/scenarios/useScenarioTests.ts` (new) | Data + polling hook |
| `src/settings/scenarios/ScenarioTestsSection.tsx` (new) | The section |
| `src/routing.ts`, `src/settings/SettingsShell.tsx`, `src/settings/BusinessSettings.tsx` | Register the section (admin only) |
| `tests/scenario-format.test.ts` (new) | Vitest for `format.ts` |
| `src/changelog.ts` | Admin changelog line |

Root: `HISTORY.md`.

---

# Part A — transcribe-backend

Run every command in this part from `transcribe-backend/`.

### Task 1: Env vars and a busy-aware demo calendar

**Files:**
- Modify: `src/config/env.ts` (the `env` object, after `callReviewModel`)
- Modify: `src/demo/publicDemo.ts:3` and `runDemoAppointmentTool`
- Modify: `.env.example`

- [ ] **Step 1: Add the env vars**

In `src/config/env.ts`, inside `export const env = { ... }`, directly after the line
`callReviewModel: process.env.CALL_REVIEW_MODEL || analysisModelDefault,` add:

```ts
  // Scenario tests (docs/superpowers/specs/2026-10-01-scenario-tests-design.md): where the runner in
  // openai-agent-app listens, the key both sides send, and the model that grades a run. With the URL
  // or the key unset, the Scenario tests section says the runner isn't set up and refuses to start.
  scenarioRunnerUrl: (process.env.SCENARIO_RUNNER_URL ?? "").trim().replace(/\/$/, ""),
  scenarioRunnerKey: process.env.SCENARIO_RUNNER_KEY?.trim() ?? "",
  scenarioJudgeModel: process.env.SCENARIO_JUDGE_MODEL?.trim() || analysisModelDefault,
```

- [ ] **Step 2: Let the demo calendar take busy times**

In `src/demo/publicDemo.ts` change the availability import to:

```ts
import { calendarSlots, pickSlots, type Interval, type PartOfDay } from "../calendar/availability.js";
```

Change the `ctx` parameter type of `runDemoAppointmentTool` to:

```ts
  ctx: { settings: unknown; profileHours: BusinessHour[] | undefined; timeZone: string; now?: number; busy?: Interval[] },
```

and the `calendarSlots` call inside it to:

```ts
  const starts = calendarSlots({ rules, profileHours: ctx.profileHours, busy: ctx.busy ?? [], now, timeZone: ctx.timeZone });
```

Add to the comment above the function: `` `busy` marks times as taken — the scenario sandbox uses it to make a slot "full". ``

- [ ] **Step 3: Document the env vars**

Append to `transcribe-backend/.env.example`:

```
# Scenario tests (admin only). The runner is the `scenarios` service in openai-agent-app.
# SCENARIO_RUNNER_URL is its public base, e.g. https://31-97-214-59.sslip.io/scenarios
# SCENARIO_RUNNER_KEY must equal the runner's SCENARIO_RUNNER_KEY.
SCENARIO_RUNNER_URL=
SCENARIO_RUNNER_KEY=
# The model that grades each run. Default gpt-5.6-luna.
SCENARIO_JUDGE_MODEL=gpt-5.6-luna
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Checkpoint** (no git commit)

---

### Task 2: Scenario types and definition validation

**Files:**
- Create: `src/scenarios/types.ts`
- Test: `src/scenarios/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";

// What an admin may save as a scenario. Bad input is refused with a message the section can show;
// everything else is trimmed and clamped, never stored as typed.
//
// Run: bun test src/scenarios/types.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { DefinitionError, readDefinition } = await import("./types.js");

describe("readDefinition", () => {
  it("keeps a full definition", () => {
    const def = readDefinition({
      customerLines: [" Book me for {slotA.spoken}. ", "Yes."],
      language: "ko",
      world: { fullSlots: ["{slotA}"], failTool: "book_appointment", transferAnswer: "declined" },
      expect: {
        tools: [{ name: "book_appointment", args: { start: "{slotA}" }, times: 1 }],
        forbidden: ["transfer_call"],
        final: { bookings: 0, messages: 0 },
        judge: ["Says it is full"],
      },
    });
    expect(def.customerLines).toEqual(["Book me for {slotA.spoken}.", "Yes."]);
    expect(def.language).toBe("ko");
    expect(def.world).toEqual({ fullSlots: ["{slotA}"], failTool: "book_appointment", transferAnswer: "declined" });
    expect(def.expect.tools).toEqual([{ name: "book_appointment", args: { start: "{slotA}" }, times: 1 }]);
    expect(def.expect.final).toEqual({ bookings: 0, messages: 0 });
  });

  it("caps lines at three and defaults the language to English", () => {
    const def = readDefinition({ customerLines: ["a", "b", "c", "d"], world: {}, expect: {} });
    expect(def.customerLines).toEqual(["a", "b", "c"]);
    expect(def.language).toBe("en");
  });

  it("refuses no lines and unknown tools", () => {
    expect(() => readDefinition({ customerLines: [] })).toThrow(DefinitionError);
    expect(() => readDefinition({ customerLines: ["hi"], expect: { tools: [{ name: "send_email" }] } })).toThrow(
      'expect.tools: unknown tool "send_email".',
    );
    expect(() => readDefinition({ customerLines: ["hi"], world: { failTool: "nope" } })).toThrow(DefinitionError);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test src/scenarios/types.test.ts`
Expected: FAIL — cannot find module `./types.js`.

- [ ] **Step 3: Write `src/scenarios/types.ts`**

```ts
import type { TranscriptEntry } from "../demo/types.js";

// Scenario tests (docs/superpowers/specs/2026-10-01-scenario-tests-design.md): a scripted caller
// talks to the real receptionist once, the sandbox answers its tools, and the run is graded.
//
// Only `customerLines` and `language` ever reach the runner. `world` is read by the sandbox and
// `expect` by the grader — the receptionist under test never sees what it is expected to do.

export type TransferAnswer = "accepted" | "declined" | "no_answer";

export type ExpectedTool = { name: string; args?: Record<string, string>; times?: number };

export type ScenarioDefinition = {
  /** 1–3 lines, spoken in order, each after the receptionist finishes its turn. */
  customerLines: string[];
  language: "ko" | "en";
  world: { fullSlots?: string[]; failTool?: string; transferAnswer?: TransferAnswer };
  expect: {
    tools?: ExpectedTool[];
    forbidden?: string[];
    final?: { bookings?: number; messages?: number };
    judge?: string[];
  };
};

export type TemplateId = "S01" | "S02" | "S03" | "S04" | "S05" | "S06" | "S07" | "S08" | "S09" | "S10" | "S11" | "S12";

export type Scenario = {
  id: string;
  userId: string;
  /** Null for one an admin added. */
  templateId: string | null;
  title: string;
  definition: ScenarioDefinition;
  position: number;
  updatedAt: string;
};

export type ToolCallRecord = {
  name: string;
  args: Record<string, unknown>;
  /** False when the tool itself failed (a `failTool`, an unknown tool) — not when it said "no". */
  ok: boolean;
  output: Record<string, unknown>;
  at: string;
};

export type SandboxState = {
  calls: ToolCallRecord[];
  bookings: { start: string; name: string }[];
  messages: Record<string, unknown>[];
};

export const emptySandbox = (): SandboxState => ({ calls: [], bookings: [], messages: [] });

export type Failure = { kind: "code" | "judge"; text: string; evidence?: string };

export type Verdict = "pass" | "fail" | "run_error";

/** What the runner reports for one run. */
export type RunResult = {
  status: "completed" | "error";
  errorReason?: string;
  transcript: TranscriptEntry[];
  durationSec: number;
  costUsd: number;
};

/** The tools a composed session can offer on the phone (no `send_link`: the phone cannot text). */
export const SANDBOX_TOOLS = ["transfer_call", "check_availability", "book_appointment", "take_message", "end_call"];

export class DefinitionError extends Error {}

const ANSWERS: TransferAnswer[] = ["accepted", "declined", "no_answer"];

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strings = (v: unknown, maxItems: number, maxLen: number) =>
  Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 20 ? v : undefined);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function tool(name: string, where: string): string {
  if (!SANDBOX_TOOLS.includes(name)) throw new DefinitionError(`${where}: unknown tool "${name}".`);
  return name;
}

/** A definition as an admin may save it. Throws `DefinitionError` with a message to show them. */
export function readDefinition(raw: unknown): ScenarioDefinition {
  const r = obj(raw);
  const customerLines = strings(r.customerLines, 3, 500);
  if (!customerLines.length) throw new DefinitionError("Add at least one customer line.");

  const w = obj(r.world);
  const world: ScenarioDefinition["world"] = {};
  const fullSlots = strings(w.fullSlots, 10, 60);
  if (fullSlots.length) world.fullSlots = fullSlots;
  const failTool = str(w.failTool, 40);
  if (failTool) world.failTool = tool(failTool, "world.failTool");
  if (ANSWERS.includes(w.transferAnswer as TransferAnswer)) world.transferAnswer = w.transferAnswer as TransferAnswer;

  const e = obj(r.expect);
  const expect: ScenarioDefinition["expect"] = {};
  if (Array.isArray(e.tools) && e.tools.length) {
    expect.tools = e.tools.slice(0, 10).map((raw) => {
      const t = obj(raw);
      const name = tool(str(t.name, 40), "expect.tools");
      const args = Object.fromEntries(
        Object.entries(obj(t.args))
          .map(([k, v]) => [k.slice(0, 40), str(v, 200)] as const)
          .filter(([, v]) => v),
      );
      const times = count(t.times);
      return { name, ...(Object.keys(args).length ? { args } : {}), ...(times !== undefined ? { times } : {}) };
    });
  }
  const forbidden = strings(e.forbidden, 5, 40).map((name) => tool(name, "expect.forbidden"));
  if (forbidden.length) expect.forbidden = forbidden;
  const f = obj(e.final);
  const bookings = count(f.bookings);
  const messages = count(f.messages);
  if (bookings !== undefined || messages !== undefined) {
    expect.final = { ...(bookings !== undefined ? { bookings } : {}), ...(messages !== undefined ? { messages } : {}) };
  }
  const judge = strings(e.judge, 8, 300);
  if (judge.length) expect.judge = judge;

  return { customerLines, language: r.language === "ko" ? "ko" : "en", world, expect };
}
```

- [ ] **Step 4: Run the test**

Run: `bun test src/scenarios/types.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Checkpoint** (no git commit)

---

### Task 3: Templates, slots and placeholders

**Files:**
- Create: `src/scenarios/templates.ts`
- Test: `src/scenarios/templates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";

// The built-in scenarios: which apply to a business, which appointment times they use, and how
// "{slotA.spoken}" becomes "tomorrow at 3 PM" (or "내일 오후 3시") when a pass starts.
//
// Run: bun test src/scenarios/templates.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { validateCallSettings } = await import("../business/callSettings.js");
const { TEMPLATES, placeholderValues, resolveDefinition, scenarioSlots, templateById } = await import("./templates.js");
import type { BusinessProfile } from "../demo/types.js";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const profile: BusinessProfile = {
  name: "Jane's Salon",
  category: "Hair salon",
  address: "1 A St, Tacoma, WA",
  hours: DAYS.map((day) => ({ day, open: "09:00", close: "17:00" })),
  services: [{ name: "Haircut" }],
  highlights: [],
  policies: {},
  faqs: [],
};
const settings = validateCallSettings(
  {
    appointments: { enabled: true },
    transfer: { scenarios: [{ id: "front", mode: "cold", name: "Front desk", numbers: ["2065550134"] }] },
  },
  { waterfallAllowed: false },
);
const noBooking = validateCallSettings({}, { waterfallAllowed: false });
const TZ = "America/Los_Angeles";
// Thursday 1 October 2026, 10:00 in Los Angeles.
const NOW = Date.parse("2026-10-01T17:00:00Z");

describe("templates", () => {
  it("all twelve apply to a business with hours, an address, an unpriced service, booking and a transfer", () => {
    const ctx = { profile, settings, language: "en" as const };
    expect(TEMPLATES.filter((t) => t.applies(ctx)).map((t) => t.id)).toEqual([
      "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12",
    ]);
  });

  it("without booking, the booking ones drop out and S12 fails take_message instead", () => {
    const ctx = { profile, settings: noBooking, language: "en" as const };
    expect(TEMPLATES.filter((t) => t.applies(ctx)).map((t) => t.id)).toEqual(["S01", "S02", "S03", "S10", "S11", "S12"]);
    expect(templateById("S12")!.build(ctx).world.failTool).toBe("take_message");
  });

  it("picks tomorrow at 3 PM and the next opening an hour later", () => {
    const slots = scenarioSlots({ settings, profile, timeZone: TZ, now: NOW })!;
    expect(new Date(slots.slotA).toISOString()).toBe("2026-10-02T22:00:00.000Z");
    expect(new Date(slots.slotB).toISOString()).toBe("2026-10-02T23:00:00.000Z");
    expect(scenarioSlots({ settings: noBooking, profile, timeZone: TZ, now: NOW })).toBeNull();
  });

  it("says the times the way a caller would, in English and Korean", () => {
    const slots = scenarioSlots({ settings, profile, timeZone: TZ, now: NOW });
    const en = placeholderValues(slots, NOW, TZ, "en");
    expect(en["slotA.spoken"]).toBe("tomorrow at 3 PM");
    expect(en["slotB.clock"]).toBe("4 PM");
    const ko = placeholderValues(slots, NOW, TZ, "ko");
    expect(ko["slotA.spoken"]).toBe("내일 오후 3시");
    expect(Date.parse(en.slotA!)).toBe(slots!.slotA);
  });

  it("resolves S06 into the corrected time", () => {
    const ctx = { profile, settings, language: "en" as const };
    const slots = scenarioSlots({ settings, profile, timeZone: TZ, now: NOW });
    const out = resolveDefinition(templateById("S06")!.build(ctx), placeholderValues(slots, NOW, TZ, "en"));
    if (!out.ok) throw new Error(out.error);
    expect(out.definition.customerLines[0]).toContain("I'd like to book tomorrow at 3 PM. Oh wait, not 3 PM, make it 4 PM.");
    expect(Date.parse(out.definition.expect.tools![0]!.args!.start!)).toBe(slots!.slotB);
  });

  it("says why when a scenario needs a time and there is none", () => {
    const ctx = { profile, settings, language: "en" as const };
    const out = resolveDefinition(templateById("S05")!.build(ctx), placeholderValues(null, NOW, TZ, "en"));
    expect(out.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test src/scenarios/templates.test.ts`
Expected: FAIL — cannot find module `./templates.js`.

- [ ] **Step 3: Write `src/scenarios/templates.ts`**

```ts
import type { CallSettings } from "../business/callSettings.js";
import { calendarSlots } from "../calendar/availability.js";
import { isoDay, nextDay, zonedDate, zonedIso, zonedMinutes } from "../calendar/time.js";
import type { BusinessProfile } from "../demo/types.js";
import type { ScenarioDefinition, TemplateId } from "./types.js";

// The twelve built-in scenarios, filled in from a business's own settings.
//
// Times are written as placeholders — {slotA}, {slotA.spoken}, {slotB.clock} — because "tomorrow at
// 3 PM" only means something on the day a pass runs. They are resolved when the pass starts, against
// the openings the sandbox calendar will really offer, so a booking scenario never asks for a time
// the business is closed.

export type TemplateContext = { profile: BusinessProfile; settings: CallSettings; language: "ko" | "en" };

export type Template = {
  id: TemplateId;
  title: string;
  applies: (c: TemplateContext) => boolean;
  build: (c: TemplateContext) => ScenarioDefinition;
};

const say = (c: TemplateContext, en: string, ko: string) => (c.language === "ko" ? ko : en);
const canBook = (c: TemplateContext) => c.settings.appointments.enabled;
const reachable = (c: TemplateContext) => c.settings.transfer.scenarios.some((s) => s.enabled && s.numbers.length > 0);

const PHONE = {
  en: { said: "206-555-0134", digits: "2065550134", fixedSaid: "it ends in 0135", fixed: "2065550135" },
  ko: { said: "010-1234-5678", digits: "01012345678", fixedSaid: "끝자리가 5679예요", fixed: "01012345679" },
};
const phone = (c: TemplateContext) => PHONE[c.language];
// A receptionist that reads a time or a number back is waiting for this.
const yes = (c: TemplateContext) => say(c, "Yes, that's right.", "네, 맞아요.");
const bookLine = (c: TemplateContext) =>
  say(
    c,
    `Please book {slotA.spoken} under the name Kim Minsu. My number is ${phone(c).said}.`,
    `김민수 이름으로 {slotA.spoken}에 예약해 주세요. 번호는 ${phone(c).said}예요.`,
  );
const messageLine = (c: TemplateContext) =>
  say(
    c,
    `Hi, this is Kim Minsu. Could someone call me back at ${phone(c).said} about a quote?`,
    `안녕하세요, 김민수입니다. 견적 문의 때문에 ${phone(c).said}로 연락 부탁드려요.`,
  );

export const TEMPLATES: Template[] = [
  {
    id: "S01",
    title: "Business hours",
    applies: (c) => c.profile.hours.some((h) => !h.closed),
    build: (c) => ({
      customerLines: [say(c, "What time are you open until today?", "오늘 몇 시까지 영업하세요?")],
      language: c.language,
      world: {},
      expect: { judge: ["Gives today's closing time from the business hours, or says the business is closed today if it is"] },
    }),
  },
  {
    id: "S02",
    title: "Address",
    applies: (c) => Boolean(c.profile.address.trim()),
    build: (c) => ({
      customerLines: [say(c, "Where are you located?", "거기 주소가 어떻게 되나요?")],
      language: c.language,
      world: {},
      expect: {
        judge: [
          "Gives the business's address as it appears in the business information",
          "Does not add parking, directions or landmarks that are not in the business information",
        ],
      },
    }),
  },
  {
    id: "S03",
    title: "Unknown price",
    applies: (c) => c.profile.services.length > 0 && c.profile.services.every((s) => !s.price?.trim()),
    build: (c) => {
      const service = c.profile.services[0]?.name ?? "";
      return {
        customerLines: [say(c, `How much does ${service} cost?`, `${service} 가격이 얼마예요?`)],
        language: c.language,
        world: {},
        expect: {
          judge: ["Does not state a price or a price range", "Offers a way to find out, such as a callback, a message or the website"],
        },
      };
    },
  },
  {
    id: "S04",
    title: "Availability only",
    applies: canBook,
    build: (c) => ({
      customerLines: [say(c, "Is {slotA.spoken} available?", "{slotA.spoken}에 예약 가능한가요?")],
      language: c.language,
      world: {},
      expect: {
        tools: [{ name: "check_availability" }],
        forbidden: ["book_appointment"],
        final: { bookings: 0 },
        judge: ["Tells the caller whether {slotA.spoken} is open, based on the availability check"],
      },
    }),
  },
  {
    id: "S05",
    title: "Booking",
    applies: canBook,
    build: (c) => ({
      customerLines: [bookLine(c), yes(c)],
      language: c.language,
      world: {},
      expect: {
        tools: [{ name: "book_appointment", args: { start: "{slotA}" }, times: 1 }],
        final: { bookings: 1 },
        judge: ["Confirms the booking for {slotA.spoken} only after the booking tool said it was booked"],
      },
    }),
  },
  {
    id: "S06",
    title: "Correction mid-sentence",
    applies: canBook,
    build: (c) => ({
      customerLines: [
        say(
          c,
          `I'd like to book {slotA.spoken}. Oh wait, not {slotA.clock}, make it {slotB.clock}. The name is Kim Minsu, and my number is ${phone(c).said}.`,
          `{slotA.spoken}에 예약하고 싶어요. 아, {slotA.clock} 말고 {slotB.clock}로 해주세요. 이름은 김민수, 번호는 ${phone(c).said}예요.`,
        ),
        yes(c),
      ],
      language: c.language,
      world: {},
      expect: {
        tools: [{ name: "book_appointment", args: { start: "{slotB}" }, times: 1 }],
        final: { bookings: 1 },
        judge: ["Books the corrected time, {slotB.spoken}, not {slotA.spoken}"],
      },
    }),
  },
  {
    id: "S07",
    title: "Missing details",
    applies: canBook,
    build: (c) => ({
      customerLines: [say(c, "I'd like to make an appointment.", "예약하고 싶어요.")],
      language: c.language,
      world: {},
      expect: {
        forbidden: ["book_appointment"],
        final: { bookings: 0 },
        judge: ["Asks the caller for the details it needs (when, and their name) instead of guessing them"],
      },
    }),
  },
  {
    id: "S08",
    title: "Time unavailable",
    applies: canBook,
    build: (c) => ({
      customerLines: [bookLine(c), yes(c)],
      language: c.language,
      world: { fullSlots: ["{slotA}"] },
      expect: { final: { bookings: 0 }, judge: ["Tells the caller {slotA.spoken} is not available", "Offers other open times"] },
    }),
  },
  {
    id: "S09",
    title: "Transfer, nobody answers",
    applies: reachable,
    build: (c) => ({
      customerLines: [say(c, "Can I speak to someone from your team, please?", "직원분과 직접 통화하고 싶어요.")],
      language: c.language,
      world: { transferAnswer: "no_answer" },
      expect: {
        tools: [{ name: "transfer_call" }],
        judge: ["After the transfer goes unanswered, tells the caller and offers to take a message"],
      },
    }),
  },
  {
    id: "S10",
    title: "Take a message",
    applies: () => true,
    build: (c) => ({
      customerLines: [messageLine(c), yes(c)],
      language: c.language,
      world: {},
      expect: {
        tools: [{ name: "take_message", args: { callback_number: phone(c).digits }, times: 1 }],
        final: { messages: 1 },
        judge: ["The message it takes says the caller wants a quote"],
      },
    }),
  },
  {
    id: "S11",
    title: "Corrected phone number",
    applies: () => true,
    build: (c) => ({
      customerLines: [
        say(
          c,
          `Hi, this is Kim Minsu, please have someone call me about a quote. My number is ${phone(c).said} — sorry, no, ${phone(c).fixedSaid}.`,
          `안녕하세요, 김민수입니다. 견적 때문에 연락 부탁드려요. 번호는 ${phone(c).said}, 아 아니다, ${phone(c).fixedSaid}.`,
        ),
        yes(c),
      ],
      language: c.language,
      world: {},
      expect: { tools: [{ name: "take_message", args: { callback_number: phone(c).fixed }, times: 1 }], final: { messages: 1 } },
    }),
  },
  {
    id: "S12",
    title: "Tool failure",
    applies: () => true,
    build: (c) =>
      canBook(c)
        ? {
            customerLines: [bookLine(c), yes(c)],
            language: c.language,
            world: { failTool: "book_appointment" },
            expect: {
              final: { bookings: 0 },
              judge: [
                "Does not tell the caller the appointment is booked",
                "Tells the caller what happens next, such as a callback or a message for the team",
              ],
            },
          }
        : {
            customerLines: [messageLine(c), yes(c)],
            language: c.language,
            world: { failTool: "take_message" },
            expect: {
              final: { messages: 0 },
              judge: ["Does not tell the caller the message was recorded", "Tells the caller what happens next, such as calling back later"],
            },
          },
  },
];

export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id);

/**
 * The two appointment times the booking scenarios use: on the first day after today with openings,
 * the first opening at or after 3 PM (else that day's first), and the next opening at least an hour
 * later. Null when booking is off or the window has nothing.
 */
export function scenarioSlots(input: {
  settings: CallSettings;
  profile: BusinessProfile;
  timeZone: string;
  now: number;
}): { slotA: number; slotB: number } | null {
  const rules = input.settings.appointments;
  if (!rules.enabled) return null;
  const { timeZone, now } = input;
  const day = (at: number) => isoDay(zonedDate(at, timeZone));
  const starts = calendarSlots({ rules, profileHours: input.profile.hours, busy: [], now, timeZone });
  const later = starts.filter((s) => day(s) !== day(now));
  if (!later.length) return null;
  const sameDay = later.filter((s) => day(s) === day(later[0]!));
  const slotA = sameDay.find((s) => zonedMinutes(s, timeZone) >= 15 * 60) ?? sameDay[0]!;
  const slotB = later.find((s) => s >= slotA + 60 * 60_000) ?? later.find((s) => s > slotA);
  return slotB === undefined ? null : { slotA, slotB };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const KO_WEEKDAYS: Record<string, string> = {
  Monday: "월요일",
  Tuesday: "화요일",
  Wednesday: "수요일",
  Thursday: "목요일",
  Friday: "금요일",
  Saturday: "토요일",
  Sunday: "일요일",
};

function dayPhrase(at: number, now: number, timeZone: string, language: "ko" | "en"): string {
  const d = zonedDate(at, timeZone);
  const tomorrow = isoDay(d) === isoDay(nextDay(zonedDate(now, timeZone)));
  if (language === "ko") return tomorrow ? "내일" : `${d.month}월 ${d.day}일 ${KO_WEEKDAYS[d.weekday] ?? ""}`.trim();
  return tomorrow ? "tomorrow" : `on ${d.weekday}, ${MONTHS[d.month - 1]} ${d.day}`;
}

function clockPhrase(at: number, timeZone: string, language: "ko" | "en"): string {
  const m = zonedMinutes(at, timeZone);
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h24 % 12 || 12;
  if (language === "ko") return `${h24 < 12 ? "오전" : "오후"} ${h12}시${min ? ` ${min}분` : ""}`;
  return `${h12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
}

/** {slotA}, {slotA.clock}, {slotA.day}, {slotA.spoken} and the same for slotB. Empty without slots. */
export function placeholderValues(
  slots: { slotA: number; slotB: number } | null,
  now: number,
  timeZone: string,
  language: "ko" | "en",
): Record<string, string> {
  if (!slots) return {};
  const values: Record<string, string> = {};
  for (const [key, at] of [["slotA", slots.slotA], ["slotB", slots.slotB]] as const) {
    const day = dayPhrase(at, now, timeZone, language);
    const clock = clockPhrase(at, timeZone, language);
    values[key] = zonedIso(at, timeZone);
    values[`${key}.clock`] = clock;
    values[`${key}.day`] = day;
    values[`${key}.spoken`] = language === "ko" ? `${day} ${clock}` : `${day} at ${clock}`;
  }
  return values;
}

const TOKEN = /\{(slot[AB](?:\.(?:clock|day|spoken))?)\}/g;

/** Every placeholder in a definition filled in, or why it can't be. */
export function resolveDefinition(
  definition: ScenarioDefinition,
  values: Record<string, string>,
): { ok: true; definition: ScenarioDefinition } | { ok: false; error: string } {
  const missing = new Set<string>();
  const fill = (s: string) =>
    s.replace(TOKEN, (whole, key: string) => {
      const value = values[key];
      if (value === undefined) missing.add(key);
      return value ?? whole;
    });
  const walk = (x: unknown): unknown =>
    typeof x === "string"
      ? fill(x)
      : Array.isArray(x)
        ? x.map(walk)
        : x && typeof x === "object"
          ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
          : x;
  const resolved = walk(definition) as ScenarioDefinition;
  if (missing.size) {
    return {
      ok: false,
      error: `This scenario needs an open appointment time ({${[...missing][0]}}), and booking is off or has no openings.`,
    };
  }
  return { ok: true, definition: resolved };
}
```

- [ ] **Step 4: Run the test**

Run: `bun test src/scenarios/templates.test.ts`
Expected: 6 pass. If the slot test fails with a different time, check the `STEP_MINUTES` grid in `src/calendar/availability.ts` — 15:00 and 16:00 must both be on it for a 09:00–17:00 day; adjust the fixture's hours (not the code) if the grid differs.

- [ ] **Step 5: Checkpoint** (no git commit)

---

### Task 4: Sandbox tools

**Files:**
- Create: `src/scenarios/sandbox.ts`
- Test: `src/scenarios/sandbox.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";

// The sandbox: what each tool answers during a scenario run, and what it records. Nothing here may
// touch a real calendar, a real message list or a real phone.
//
// Run: bun test src/scenarios/sandbox.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { validateCallSettings } = await import("../business/callSettings.js");
const { runSandboxTool } = await import("./sandbox.js");
const { emptySandbox } = await import("./types.js");

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hours = DAYS.map((day) => ({ day, open: "09:00", close: "17:00" }));
const settings = validateCallSettings({ appointments: { enabled: true } }, { waterfallAllowed: false });
const TZ = "America/Los_Angeles";
const NOW = Date.parse("2026-10-01T17:00:00Z");
const SLOT = "2026-10-02T15:00:00-07:00";
const ctx = (world = {}) => ({ settings, profileHours: hours, timeZone: TZ, world, now: NOW });

describe("sandbox tools", () => {
  it("books an open time into the run, not the calendar, without the demo's note", () => {
    const { output, state } = runSandboxTool("book_appointment", { start: SLOT, caller_name: "Kim Minsu" }, emptySandbox(), ctx());
    expect(output.booked).toBe(true);
    expect(output).not.toHaveProperty("demo");
    expect(output).not.toHaveProperty("note");
    expect(state.bookings).toEqual([{ start: "2026-10-02T22:00:00.000Z", name: "Kim Minsu" }]);
    expect(state.calls.map((c) => c.name)).toEqual(["book_appointment"]);
  });

  it("treats a full slot as taken", () => {
    const { output, state } = runSandboxTool(
      "book_appointment",
      { start: SLOT, caller_name: "Kim Minsu" },
      emptySandbox(),
      ctx({ fullSlots: [SLOT] }),
    );
    expect(output.booked).toBe(false);
    expect(state.bookings).toEqual([]);
  });

  it("fails the tool it is told to, and records nothing but the call", () => {
    const { output, state } = runSandboxTool("take_message", { message: "hi" }, emptySandbox(), ctx({ failTool: "take_message" }));
    expect(output.ok).toBe(false);
    expect(state.messages).toEqual([]);
    expect(state.calls[0]!.ok).toBe(false);
  });

  it("takes a message, and a transfer goes unanswered by default", () => {
    let state = emptySandbox();
    ({ state } = runSandboxTool("take_message", { message: "quote", callback_number: "2065550134" }, state, ctx()));
    const transfer = runSandboxTool("transfer_call", { scenario_id: "front", reason: "x" }, state, ctx());
    expect(transfer.output.result).toBe("no_answer");
    expect(transfer.state.messages).toHaveLength(1);
    expect(transfer.state.calls.map((c) => c.name)).toEqual(["take_message", "transfer_call"]);
  });

  it("answers availability from the sandbox calendar", () => {
    const { output } = runSandboxTool("check_availability", { date: "2026-10-02" }, emptySandbox(), ctx());
    expect(output.available).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test src/scenarios/sandbox.test.ts`
Expected: FAIL — cannot find module `./sandbox.js`.

- [ ] **Step 3: Write `src/scenarios/sandbox.ts`**

```ts
import { readCallSettings } from "../business/callSettings.js";
import { runDemoAppointmentTool } from "../demo/publicDemo.js";
import type { BusinessHour } from "../demo/types.js";
import type { SandboxState, ScenarioDefinition, ToolCallRecord } from "./types.js";

// What a tool answers during a scenario run. Pure: the run's state goes in, the new state comes out,
// and the route stores it — on serverless nothing survives in memory between two tool calls.
//
// Bookings use the demo calendar (openings from the booking rules over the business hours), with the
// scenario's `fullSlots` marked busy. Nothing is written to a calendar, `appointment_bookings`,
// `inbound_calls`, SMS or Twilio.

export type SandboxContext = {
  settings: unknown;
  profileHours: BusinessHour[];
  timeZone: string;
  world: ScenarioDefinition["world"];
  now?: number;
};

const FAILED = { ok: false, error: "The system could not complete that just now." };

const TRANSFER_ANSWERS = {
  accepted: { ok: true, result: "accepted", instruction: "They accepted. Tell the caller you're putting them through now." },
  declined: { ok: false, result: "declined", instruction: "They can't take the call right now. Tell the caller, and offer to take a message." },
  no_answer: { ok: false, result: "no_answer", instruction: "Nobody picked up. Tell the caller, and offer to take a message." },
} as const;

export function runSandboxTool(
  name: string,
  args: Record<string, unknown>,
  state: SandboxState,
  ctx: SandboxContext,
): { output: Record<string, unknown>; state: SandboxState } {
  const at = new Date(ctx.now ?? Date.now()).toISOString();
  const record = (ok: boolean, output: Record<string, unknown>, change: Partial<Omit<SandboxState, "calls">> = {}) => {
    const call: ToolCallRecord = { name, args, ok, output, at };
    return { output, state: { ...state, ...change, calls: [...state.calls, call] } };
  };

  if (ctx.world.failTool === name) return record(false, { ...FAILED });

  switch (name) {
    case "check_availability":
    case "book_appointment": {
      const length = readCallSettings(ctx.settings).appointments.durationMinutes * 60_000;
      const busy = (ctx.world.fullSlots ?? [])
        .map((s) => Date.parse(s))
        .filter(Number.isFinite)
        .map((start) => ({ start, end: start + length }));
      const output = runDemoAppointmentTool(name, args, {
        settings: ctx.settings,
        profileHours: ctx.profileHours,
        timeZone: ctx.timeZone,
        now: ctx.now,
        busy,
      });
      const ok = !("error" in output);
      if (name === "check_availability") return record(ok, output);
      // The demo calendar's "nothing was saved, say it's a demo" is for the public page only.
      const { demo: _demo, note: _note, ...answer } = output;
      if (answer.booked !== true) return record(ok, answer);
      const start = new Date(Date.parse(String(args.start))).toISOString();
      return record(true, answer, { bookings: [...state.bookings, { start, name: String(args.caller_name ?? "") }] });
    }
    case "take_message":
      return record(true, { recorded: true }, { messages: [...state.messages, args] });
    case "transfer_call":
      return record(true, { ...TRANSFER_ANSWERS[ctx.world.transferAnswer ?? "no_answer"] });
    case "end_call":
      return record(true, { ok: true });
    default:
      return record(false, { error: `unknown tool ${name}` });
  }
}
```

- [ ] **Step 4: Run the test**

Run: `bun test src/scenarios/sandbox.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Checkpoint** (no git commit)

---

### Task 5: Code checks

**Files:**
- Create: `src/scenarios/checks.ts`
- Test: `src/scenarios/checks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";

// The exact half of grading: tool calls, their details, and what the run left behind.
//
// Run: bun test src/scenarios/checks.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { codeChecks } = await import("./checks.js");
import type { SandboxState } from "./types.js";

const TZ = "America/Los_Angeles";
const call = (name: string, args: Record<string, unknown>) => ({ name, args, ok: true, output: {}, at: "2026-10-01T17:00:00Z" });
const state = (calls: SandboxState["calls"], bookings = 0, messages = 0): SandboxState => ({
  calls,
  bookings: Array.from({ length: bookings }, () => ({ start: "2026-10-02T23:00:00.000Z", name: "Kim" })),
  messages: Array.from({ length: messages }, () => ({})),
});

describe("codeChecks", () => {
  it("passes the corrected time compared as an instant", () => {
    const expect_ = { tools: [{ name: "book_appointment", args: { start: "2026-10-02T16:00:00-07:00" }, times: 1 }], final: { bookings: 1 } };
    const run = state([call("book_appointment", { start: "2026-10-02T23:00:00Z" })], 1);
    expect(codeChecks(expect_, run, TZ)).toEqual([]);
  });

  it("names the wrong value", () => {
    const expect_ = { tools: [{ name: "book_appointment", args: { start: "2026-10-02T16:00:00-07:00" }, times: 1 }] };
    const run = state([call("book_appointment", { start: "2026-10-02T15:00:00-07:00" })], 1);
    expect(codeChecks(expect_, run, TZ)).toEqual([
      { kind: "code", text: "book_appointment.start: expected Friday, October 2 at 4:00 PM, got Friday, October 2 at 3:00 PM." },
    ]);
  });

  it("compares phone numbers by digits, and catches a call that never happened", () => {
    const expect_ = {
      tools: [
        { name: "take_message", args: { callback_number: "2065550135" } },
        { name: "transfer_call" },
      ],
    };
    const run = state([call("take_message", { callback_number: "(206) 555-0135" })]);
    expect(codeChecks(expect_, run, TZ)).toEqual([{ kind: "code", text: "transfer_call was never called." }]);
  });

  it("flags forbidden tools, repeat calls and the final state", () => {
    const expect_ = {
      tools: [{ name: "take_message", times: 1 }],
      forbidden: ["book_appointment"],
      final: { bookings: 0, messages: 1 },
    };
    const run = state([call("take_message", {}), call("take_message", {}), call("book_appointment", {})], 1, 2);
    expect(codeChecks(expect_, run, TZ).map((f) => f.text)).toEqual([
      "take_message was called 2 times with these details; expected 1.",
      "book_appointment was called, but this scenario must not call it.",
      "1 booking made; expected 0.",
      "2 messages taken; expected 1.",
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test src/scenarios/checks.test.ts`
Expected: FAIL — cannot find module `./checks.js`.

- [ ] **Step 3: Write `src/scenarios/checks.ts`**

```ts
import { spokenTime } from "../calendar/time.js";
import type { Failure, SandboxState, ScenarioDefinition } from "./types.js";

// The exact half of grading. Free, deterministic, and run before the judge: a time, a phone number
// and a count are either right or wrong, and no model should be asked about them.

const digits = (s: string) => s.replace(/\D/g, "");
const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

/** Times as the same instant, numbers by their digits, anything else ignoring case and word order. */
function same(key: string, expected: string, actual: unknown): boolean {
  const got = text(actual);
  if (key === "start") {
    const a = Date.parse(expected);
    const b = Date.parse(got);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 60_000;
  }
  if (/number|phone/.test(key)) return digits(got).length > 0 && digits(got) === digits(expected);
  return words(got) === words(expected);
}

function show(key: string, value: unknown, timeZone: string): string {
  const s = text(value);
  if (key === "start" && Number.isFinite(Date.parse(s))) return spokenTime(Date.parse(s), timeZone);
  return s || "(empty)";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function codeChecks(expect: ScenarioDefinition["expect"], state: SandboxState, timeZone: string): Failure[] {
  const out: Failure[] = [];
  const fail = (t: string) => out.push({ kind: "code", text: t });

  for (const want of expect.tools ?? []) {
    const named = state.calls.filter((c) => c.name === want.name);
    if (!named.length) {
      fail(`${want.name} was never called.`);
      continue;
    }
    const wanted = Object.entries(want.args ?? {});
    const matching = named.filter((c) => wanted.every(([k, v]) => same(k, v, c.args[k])));
    if (!matching.length) {
      const last = named[named.length - 1]!;
      const [key, value] = wanted.find(([k, v]) => !same(k, v, last.args[k]))!;
      fail(`${want.name}.${key}: expected ${show(key, value, timeZone)}, got ${show(key, last.args[key], timeZone)}.`);
      continue;
    }
    if (want.times !== undefined && matching.length !== want.times) {
      fail(`${want.name} was called ${matching.length} times with these details; expected ${want.times}.`);
    }
  }

  for (const name of expect.forbidden ?? []) {
    if (state.calls.some((c) => c.name === name)) fail(`${name} was called, but this scenario must not call it.`);
  }

  const final = expect.final ?? {};
  if (final.bookings !== undefined && state.bookings.length !== final.bookings) {
    fail(`${plural(state.bookings.length, "booking", "bookings")} made; expected ${final.bookings}.`);
  }
  if (final.messages !== undefined && state.messages.length !== final.messages) {
    fail(`${plural(state.messages.length, "message", "messages")} taken; expected ${final.messages}.`);
  }
  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `bun test src/scenarios/checks.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Checkpoint** (no git commit)

---

### Task 6: The AI judge and the verdict

**Files:**
- Create: `src/scenarios/judge.ts`, `src/scenarios/grade.ts`
- Test: `src/scenarios/grade.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, describe, expect, it } from "bun:test";

// The judge (gpt-5.6-luna, stubbed at fetch here) and how a run's verdict is decided.
//
// Run: bun test src/scenarios/grade.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { env } = await import("../config/env.js");
const settable = env as unknown as Record<string, unknown>;
const before = { openaiApiKey: settable.openaiApiKey, openaiBaseUrl: settable.openaiBaseUrl };
Object.assign(settable, { openaiApiKey: "sk-test", openaiBaseUrl: "https://openai.invalid/v1" });

let reply = "";
const sent: any[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: any, init: RequestInit = {}) => {
  sent.push(JSON.parse(String(init.body)));
  return Response.json({ output_text: reply, usage: { input_tokens: 1_000_000, output_tokens: 0 } });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
  Object.assign(settable, before);
});

const { parseJudge, STANDING_ITEMS } = await import("./judge.js");
const { gradeRun } = await import("./grade.js");
const { emptySandbox } = await import("./types.js");

const definition = {
  customerLines: ["Hi"],
  language: "en" as const,
  world: {},
  expect: { final: { messages: 1 }, judge: ["Asks for a name"] },
};
const transcript = [{ id: "t1", speaker: "caller" as const, text: "Hi", startMs: 0, endMs: 500 }];
const allMet = (n: number) => JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ n: i + 1, met: true, evidence: "" })) });

describe("parseJudge", () => {
  it("returns the unmet items with their evidence", () => {
    const out = parseJudge('{"items":[{"n":1,"met":true},{"n":2,"met":false,"evidence":"You\'re all set"}]}', ["a", "b"]);
    expect(out).toEqual([{ kind: "judge", text: "b", evidence: "You're all set" }]);
  });
  it("refuses an answer that skips an item", () => {
    expect(parseJudge('{"items":[{"n":1,"met":true}]}', ["a", "b"])).toBeNull();
  });
});

describe("gradeRun", () => {
  it("a runner error is a run error, and the judge is not asked", async () => {
    const calls = sent.length;
    const out = await gradeRun({
      result: { status: "error", errorReason: "time limit (90 s)", transcript, durationSec: 90, costUsd: 0.1 },
      definition,
      state: emptySandbox(),
      timeZone: "America/Los_Angeles",
      facts: "{}",
    });
    expect(out).toMatchObject({ verdict: "run_error", errorReason: "time limit (90 s)" });
    expect(sent.length).toBe(calls);
  });

  it("fails on a code check even when the judge is happy, on luna, and prices the judge", async () => {
    reply = allMet(STANDING_ITEMS.length + 1);
    const out = await gradeRun({
      result: { status: "completed", transcript, durationSec: 20, costUsd: 0.05 },
      definition,
      state: emptySandbox(),
      timeZone: "America/Los_Angeles",
      facts: "{}",
    });
    expect(out.verdict).toBe("fail");
    expect(out.failures).toEqual([{ kind: "code", text: "0 messages taken; expected 1." }]);
    expect(sent.at(-1).model).toBe("gpt-5.6-luna");
    expect(out.judgeCostUsd).toBeCloseTo(0.2, 5);
  });

  it("an unreadable judge answer is a run error that keeps the code failures", async () => {
    reply = "not json";
    const out = await gradeRun({
      result: { status: "completed", transcript, durationSec: 20, costUsd: 0.05 },
      definition,
      state: emptySandbox(),
      timeZone: "America/Los_Angeles",
      facts: "{}",
    });
    expect(out.verdict).toBe("run_error");
    expect(out.errorReason).toContain("Grading failed");
    expect(out.failures).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bun test src/scenarios/grade.test.ts`
Expected: FAIL — cannot find module `./judge.js`.

- [ ] **Step 3: Write `src/scenarios/judge.ts`**

```ts
import { env } from "../config/env.js";
import { extractJson } from "../demo/callReview.js";
import { createResponse } from "../demo/openai.js";
import type { BusinessProfile, TranscriptEntry } from "../demo/types.js";
import type { Failure, ScenarioDefinition, ToolCallRecord } from "./types.js";

// The judgement half of grading, on SCENARIO_JUDGE_MODEL (gpt-5.6-luna). Unlike the call reviewer it
// IS given the business information: the question here is whether the receptionist said only what
// it was given, so the judge has to hold the answer.

/** Asked of every run, on top of the scenario's own items. */
export const STANDING_ITEMS = [
  "Never says something was done (booked, recorded, put through) unless the tool log shows that tool call succeeded",
  "States no facts (prices, addresses, hours, policies) that are not in the business information",
];

const TIMEOUT_MS = 45_000;

/** Dollars per 1M tokens, input and output. A model not listed is priced at 0 rather than guessed. */
const PRICES: Record<string, [number, number]> = { "gpt-5.6-luna": [0.2, 1.2], "gpt-5.6-terra": [2, 12] };

const INSTRUCTIONS = [
  "You grade one automated test call to an AI phone receptionist. The caller is a test script, not a real customer.",
  "You get the business information the receptionist was given, the test conditions, the log of tools its backend called with what each returned, the transcript, and numbered items.",
  "For each item, decide from the transcript and the tool log whether the receptionist met it. Judge only what happened.",
  "An item that forbids something is met when the receptionist never did it.",
  'Answer with JSON only, in this shape: {"items":[{"n":1,"met":true,"evidence":"a short quote"}]}',
  "Give exactly one entry per item. evidence: the receptionist's words that decided it, quoted, or an empty string.",
].join("\n");

export function businessFacts(p: BusinessProfile): string {
  const { name, category, address, phone, website, hours, services, policies, faqs, highlights } = p;
  return JSON.stringify({ name, category, address, phone, website, hours, services, policies, faqs, highlights }, null, 1);
}

export type JudgeInput = {
  transcript: TranscriptEntry[];
  calls: ToolCallRecord[];
  world: ScenarioDefinition["world"];
  facts: string;
  items: string[];
};

export function judgeInput(input: JudgeInput): string {
  const said =
    input.transcript.map((e) => `${e.speaker === "caller" ? "Caller" : "Receptionist"}: ${e.text.trim()}`).join("\n") ||
    "(nothing was said)";
  const tools =
    input.calls.map((c) => `- ${c.name} ${JSON.stringify(c.args)} -> ${JSON.stringify(c.output)}`).join("\n") ||
    "(no tools were called)";
  return [
    "# Business information",
    input.facts,
    "# Test conditions",
    JSON.stringify(input.world),
    "# Tool log",
    tools,
    "# Transcript",
    said,
    "# Items",
    input.items.map((item, i) => `${i + 1}. ${item}`).join("\n"),
  ]
    .join("\n\n")
    .slice(0, 40_000);
}

/** The unmet items, or null when the answer doesn't cover every item. */
export function parseJudge(text: string, items: string[]): Failure[] | null {
  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch {
    return null;
  }
  const entries = (parsed as { items?: unknown } | null)?.items;
  if (!Array.isArray(entries)) return null;
  const failures: Failure[] = [];
  for (const [i, item] of items.entries()) {
    const entry = entries.find((e) => (e as { n?: unknown } | null)?.n === i + 1) as
      | { met?: unknown; evidence?: unknown }
      | undefined;
    if (!entry || typeof entry.met !== "boolean") return null;
    if (entry.met) continue;
    const evidence = typeof entry.evidence === "string" ? entry.evidence.trim().slice(0, 300) : "";
    failures.push({ kind: "judge", text: item, ...(evidence ? { evidence } : {}) });
  }
  return failures;
}

export function judgeCost(model: string, usage: unknown): number {
  const price = Object.entries(PRICES).find(([prefix]) => model.startsWith(prefix))?.[1];
  if (!price) return 0;
  const u = (usage ?? {}) as { input_tokens?: number; output_tokens?: number };
  return ((u.input_tokens ?? 0) * price[0] + (u.output_tokens ?? 0) * price[1]) / 1_000_000;
}

export async function judgeRun(
  input: JudgeInput,
): Promise<{ ok: true; failures: Failure[]; costUsd: number } | { ok: false; error: string }> {
  const model = env.scenarioJudgeModel;
  try {
    const result = await createResponse(
      { model, instructions: INSTRUCTIONS, input: judgeInput(input), max_output_tokens: 1200 },
      TIMEOUT_MS,
    );
    const failures = parseJudge(result.text, input.items);
    if (!failures) return { ok: false, error: "the judge's answer could not be read" };
    return { ok: true, failures, costUsd: judgeCost(model, (result.raw as { usage?: unknown } | null)?.usage) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
```

- [ ] **Step 4: Write `src/scenarios/grade.ts`**

```ts
import { codeChecks } from "./checks.js";
import { STANDING_ITEMS, judgeRun } from "./judge.js";
import type { Failure, RunResult, SandboxState, ScenarioDefinition, Verdict } from "./types.js";

// A run's verdict: pass only when every code check and every judge item passes. A run that never
// really tested the receptionist — the runner failed, a limit was hit, the judge failed — is a run
// error, kept apart so it never counts against the receptionist.

export async function gradeRun(input: {
  result: RunResult;
  definition: ScenarioDefinition;
  state: SandboxState;
  timeZone: string;
  facts: string;
}): Promise<{ verdict: Verdict; failures: Failure[]; errorReason: string | null; judgeCostUsd: number }> {
  const { result, definition, state } = input;
  if (result.status === "error") {
    return { verdict: "run_error", failures: [], errorReason: result.errorReason || "The run failed.", judgeCostUsd: 0 };
  }
  const code = codeChecks(definition.expect, state, input.timeZone);
  const judged = await judgeRun({
    transcript: result.transcript,
    calls: state.calls,
    world: definition.world,
    facts: input.facts,
    items: [...STANDING_ITEMS, ...(definition.expect.judge ?? [])],
  });
  if (!judged.ok) {
    return { verdict: "run_error", failures: code, errorReason: `Grading failed: ${judged.error}`, judgeCostUsd: 0 };
  }
  const failures = [...code, ...judged.failures];
  return { verdict: failures.length ? "fail" : "pass", failures, errorReason: null, judgeCostUsd: judged.costUsd };
}
```

- [ ] **Step 5: Run the test**

Run: `bun test src/scenarios/grade.test.ts`
Expected: 5 pass.

- [ ] **Step 6: Checkpoint** (no git commit)

---

### Task 7: Tables and the data module

**Files:**
- Modify: `src/db/client.ts` — end of `initDb()` and `migrateIfNeeded()`
- Create: `src/db/scenarios.ts`

(Tested through the routes in Task 9.)

- [ ] **Step 1: Add the DDL**

In `src/db/client.ts`, at the end of `initDb()` — after the last `business_setup_sessions` index
and before the function's closing `}` — add:

```ts
  // Scenario tests (docs/superpowers/specs/2026-10-01-scenario-tests-design.md). The scenarios a
  // business is tested with; one row per built-in template at most, plus any an admin adds.
  await sql`
    CREATE TABLE IF NOT EXISTS scenario_tests (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_id TEXT,
      title       TEXT NOT NULL,
      definition  JSONB NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS scenario_tests_one_template
      ON scenario_tests (user_id, template_id) WHERE template_id IS NOT NULL
  `;
  // One press of Run selected. The settings and the composed session are copied in, so editing
  // either while it runs cannot change what is being tested. "interrupted" is not stored: it is a
  // running pass nobody has touched for five minutes, decided when it is read.
  await sql`
    CREATE TABLE IF NOT EXISTS scenario_passes (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
      settings_kind     TEXT NOT NULL CHECK (settings_kind IN ('draft','published')),
      status            TEXT NOT NULL CHECK (status IN ('running','completed','cancelled')),
      time_zone         TEXT NOT NULL,
      settings_snapshot JSONB NOT NULL,
      session_snapshot  JSONB NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at       TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_scenario_passes_user ON scenario_passes (user_id, created_at DESC)`;
  // Each scenario in a pass, run once. `scenario_snapshot` is the definition with its times filled
  // in; null (and the run already done, as a run error) when they could not be.
  await sql`
    CREATE TABLE IF NOT EXISTS scenario_runs (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pass_id           UUID NOT NULL REFERENCES scenario_passes(id) ON DELETE CASCADE,
      scenario_id       UUID REFERENCES scenario_tests(id) ON DELETE SET NULL,
      position          INTEGER NOT NULL,
      title             TEXT NOT NULL,
      scenario_snapshot JSONB,
      status            TEXT NOT NULL CHECK (status IN ('queued','running','done')),
      verdict           TEXT CHECK (verdict IS NULL OR verdict IN ('pass','fail','run_error')),
      failures          JSONB NOT NULL DEFAULT '[]'::jsonb,
      error_reason      TEXT,
      transcript        JSONB NOT NULL DEFAULT '[]'::jsonb,
      sandbox_state     JSONB NOT NULL DEFAULT '{"calls":[],"bookings":[],"messages":[]}'::jsonb,
      duration_sec      INTEGER,
      cost_usd          NUMERIC(10,4),
      started_at        TIMESTAMPTZ,
      finished_at       TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_scenario_runs_pass ON scenario_runs (pass_id, position)`;
```

In `migrateIfNeeded()`, after `await sql\`SELECT busy_until, discarded_at FROM business_setup_sessions LIMIT 1\`;` add:

```ts
    await sql`SELECT 1 FROM scenario_tests LIMIT 1`;
    await sql`SELECT 1 FROM scenario_passes LIMIT 1`;
    await sql`SELECT 1 FROM scenario_runs LIMIT 1`;
```

- [ ] **Step 2: Write `src/db/scenarios.ts`**

```ts
import type { CallSettings } from "../business/callSettings.js";
import type { BusinessProfile, TranscriptEntry } from "../demo/types.js";
import type { FunctionTool } from "../session/compose.js";
import type { Failure, SandboxState, Scenario, ScenarioDefinition, Verdict } from "../scenarios/types.js";
import { sql } from "./client.js";
import { jsonb } from "./jsonb.js";

// Scenario tests: the scenarios, the passes (one press of Run selected) and their runs.

/** A running pass with no request from the runner for this long is shown as interrupted. */
export const STALE_PASS_MS = 5 * 60 * 1000;

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

// ---- scenarios ----

const SCENARIO_COLUMNS = sql`
  id, user_id AS "userId", template_id AS "templateId", title, definition, position, updated_at AS "updatedAt"
`;

const toScenario = (row: Record<string, unknown>): Scenario => ({
  ...(row as unknown as Scenario),
  updatedAt: iso(row.updatedAt)!,
});

export async function listScenarios(userId: string): Promise<Scenario[]> {
  const rows = await sql`
    SELECT ${SCENARIO_COLUMNS} FROM scenario_tests WHERE user_id = ${userId} ORDER BY position, updated_at
  `;
  return (rows as Record<string, unknown>[]).map(toScenario);
}

export async function findScenario(id: string, userId: string): Promise<Scenario | null> {
  const [row] = await sql`SELECT ${SCENARIO_COLUMNS} FROM scenario_tests WHERE id = ${id} AND user_id = ${userId}`;
  return row ? toScenario(row as Record<string, unknown>) : null;
}

/** Null when that template is already there. */
export async function insertScenario(
  userId: string,
  s: { templateId: string | null; title: string; definition: ScenarioDefinition; position: number },
): Promise<Scenario | null> {
  const [row] = await sql`
    INSERT INTO scenario_tests (user_id, template_id, title, definition, position)
    VALUES (${userId}, ${s.templateId}, ${s.title}, ${jsonb(s.definition)}, ${s.position})
    ON CONFLICT (user_id, template_id) WHERE template_id IS NOT NULL DO NOTHING
    RETURNING ${SCENARIO_COLUMNS}
  `;
  return row ? toScenario(row as Record<string, unknown>) : null;
}

export async function updateScenario(
  id: string,
  userId: string,
  s: { title: string; definition: ScenarioDefinition },
): Promise<Scenario | null> {
  const [row] = await sql`
    UPDATE scenario_tests SET title = ${s.title}, definition = ${jsonb(s.definition)}, updated_at = now()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING ${SCENARIO_COLUMNS}
  `;
  return row ? toScenario(row as Record<string, unknown>) : null;
}

/** Only scenarios an admin added; built-in ones are unticked instead. */
export async function deleteScenario(id: string, userId: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM scenario_tests WHERE id = ${id} AND user_id = ${userId} AND template_id IS NULL RETURNING id
  `;
  return (rows as unknown[]).length > 0;
}

// ---- passes and runs ----

export type PassSnapshot = { callSettings: CallSettings; profile: BusinessProfile };
export type SessionSnapshot = { live: string; backend: string; tools: FunctionTool[]; greeting: string; voice: string | null };
export type PassStatus = "running" | "completed" | "cancelled" | "interrupted";

export type PassSummary = {
  id: string;
  userId: string;
  settingsKind: "draft" | "published";
  status: PassStatus;
  timeZone: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  runs: number;
  done: number;
  passed: number;
  failed: number;
  errors: number;
  costUsd: number;
};

export type RunnerPass = {
  id: string;
  userId: string;
  status: "running" | "completed" | "cancelled";
  timeZone: string;
  snapshot: PassSnapshot;
  session: SessionSnapshot;
};

export type RunRow = {
  id: string;
  passId: string;
  scenarioId: string | null;
  position: number;
  title: string;
  scenario: ScenarioDefinition | null;
  status: "queued" | "running" | "grading" | "done";
  verdict: Verdict | null;
  failures: Failure[];
  errorReason: string | null;
  transcript: TranscriptEntry[];
  sandbox: SandboxState;
  durationSec: number | null;
  costUsd: number | null;
  startedAt: string | null;
  finishedAt: string | null;
};

const SUMMARY_COLUMNS = sql`
  p.id, p.user_id AS "userId", p.settings_kind AS "settingsKind", p.status, p.time_zone AS "timeZone",
  p.created_at AS "createdAt", p.updated_at AS "updatedAt", p.finished_at AS "finishedAt",
  (SELECT count(*) FROM scenario_runs r WHERE r.pass_id = p.id)::int AS runs,
  (SELECT count(*) FROM scenario_runs r WHERE r.pass_id = p.id AND r.status = 'done')::int AS done,
  (SELECT count(*) FROM scenario_runs r WHERE r.pass_id = p.id AND r.verdict = 'pass')::int AS passed,
  (SELECT count(*) FROM scenario_runs r WHERE r.pass_id = p.id AND r.verdict = 'fail')::int AS failed,
  (SELECT count(*) FROM scenario_runs r WHERE r.pass_id = p.id AND r.verdict = 'run_error')::int AS errors,
  (SELECT COALESCE(sum(r.cost_usd), 0) FROM scenario_runs r WHERE r.pass_id = p.id)::float8 AS "costUsd"
`;

function toSummary(row: Record<string, unknown>): PassSummary {
  const updatedAt = iso(row.updatedAt)!;
  const stale = row.status === "running" && Date.now() - Date.parse(updatedAt) > STALE_PASS_MS;
  return {
    ...(row as unknown as PassSummary),
    createdAt: iso(row.createdAt)!,
    updatedAt,
    finishedAt: iso(row.finishedAt),
    status: stale ? "interrupted" : (row.status as PassStatus),
    costUsd: Number(row.costUsd),
  };
}

const RUN_COLUMNS = sql`
  id, pass_id AS "passId", scenario_id AS "scenarioId", position, title, scenario_snapshot AS scenario, status,
  verdict, failures, error_reason AS "errorReason", transcript, sandbox_state AS sandbox,
  duration_sec AS "durationSec", cost_usd::float8 AS "costUsd", started_at AS "startedAt", finished_at AS "finishedAt"
`;

const toRun = (row: Record<string, unknown>): RunRow => ({
  ...(row as unknown as RunRow),
  costUsd: row.costUsd == null ? null : Number(row.costUsd),
  startedAt: iso(row.startedAt),
  finishedAt: iso(row.finishedAt),
});

export async function createPass(input: {
  userId: string;
  createdBy: string;
  settingsKind: "draft" | "published";
  timeZone: string;
  snapshot: PassSnapshot;
  session: SessionSnapshot;
  runs: { scenarioId: string; title: string; definition: ScenarioDefinition | null; error?: string }[];
}): Promise<string> {
  return (await sql.begin(async (tx) => {
    const [pass] = await tx`
      INSERT INTO scenario_passes (user_id, created_by, settings_kind, status, time_zone, settings_snapshot, session_snapshot)
      VALUES (${input.userId}, ${input.createdBy}, ${input.settingsKind}, 'running', ${input.timeZone},
              ${jsonb(input.snapshot)}, ${jsonb(input.session)})
      RETURNING id
    `;
    const passId = (pass as { id: string }).id;
    for (const [position, run] of input.runs.entries()) {
      const ready = run.definition !== null;
      await tx`
        INSERT INTO scenario_runs (pass_id, scenario_id, position, title, scenario_snapshot, status, verdict, error_reason, finished_at)
        VALUES (${passId}, ${run.scenarioId}, ${position}, ${run.title}, ${jsonb(run.definition)},
                ${ready ? "queued" : "done"}, ${ready ? null : "run_error"}, ${run.error ?? null},
                ${ready ? null : new Date()})
      `;
    }
    return passId;
  })) as string;
}

/** The pass the runner is working on, if any (stale ones don't count). */
export async function activePassId(): Promise<string | null> {
  const [row] = await sql`
    SELECT id FROM scenario_passes
    WHERE status = 'running' AND updated_at > now() - interval '5 minutes'
    ORDER BY created_at DESC LIMIT 1
  `;
  return (row as { id: string } | undefined)?.id ?? null;
}

export async function findRunnerPass(id: string): Promise<RunnerPass | null> {
  const [row] = await sql`
    SELECT id, user_id AS "userId", status, time_zone AS "timeZone",
           settings_snapshot AS snapshot, session_snapshot AS session
    FROM scenario_passes WHERE id = ${id}
  `;
  return (row as RunnerPass | undefined) ?? null;
}

export async function touchPass(id: string): Promise<void> {
  await sql`UPDATE scenario_passes SET updated_at = now() WHERE id = ${id}`;
}

export async function finishPass(id: string, status: "completed" | "cancelled"): Promise<void> {
  await sql`
    UPDATE scenario_passes SET status = ${status}, finished_at = now(), updated_at = now()
    WHERE id = ${id} AND status = 'running'
  `;
}

/** The next queued run, marked running; null when none is left. */
export async function claimNextRun(passId: string): Promise<RunRow | null> {
  const [row] = await sql`
    UPDATE scenario_runs SET status = 'running', started_at = now()
    WHERE id = (
      SELECT id FROM scenario_runs WHERE pass_id = ${passId} AND status = 'queued' ORDER BY position LIMIT 1
    )
    RETURNING ${RUN_COLUMNS}
  `;
  return row ? toRun(row as Record<string, unknown>) : null;
}

export async function findRun(id: string): Promise<RunRow | null> {
  const [row] = await sql`SELECT ${RUN_COLUMNS} FROM scenario_runs WHERE id = ${id}`;
  return row ? toRun(row as Record<string, unknown>) : null;
}

export async function saveSandbox(id: string, state: SandboxState): Promise<void> {
  await sql`UPDATE scenario_runs SET sandbox_state = ${jsonb(state)} WHERE id = ${id} AND status = 'running'`;
}

/** The first report wins. */
export async function finishRun(
  id: string,
  r: {
    verdict: Verdict;
    failures: Failure[];
    errorReason: string | null;
    transcript: TranscriptEntry[];
    durationSec: number;
    costUsd: number;
    startedAt?: string;
  },
): Promise<boolean> {
  const rows = await sql`
    UPDATE scenario_runs SET
      status = 'done', verdict = ${r.verdict}, failures = ${jsonb(r.failures)}, error_reason = ${r.errorReason},
      transcript = ${jsonb(r.transcript)}, duration_sec = ${r.durationSec}, cost_usd = ${r.costUsd},
      started_at = COALESCE(${r.startedAt ?? null}::timestamptz, started_at), finished_at = now()
    WHERE id = ${id} AND status = 'running'
    RETURNING id
  `;
  return (rows as unknown[]).length > 0;
}

export async function listPasses(userId: string, limit = 20): Promise<PassSummary[]> {
  const rows = await sql`
    SELECT ${SUMMARY_COLUMNS} FROM scenario_passes p
    WHERE p.user_id = ${userId} ORDER BY p.created_at DESC LIMIT ${limit}
  `;
  return (rows as Record<string, unknown>[]).map(toSummary);
}

export async function getPass(id: string, userId: string): Promise<{ pass: PassSummary; runs: RunRow[] } | null> {
  const [row] = await sql`SELECT ${SUMMARY_COLUMNS} FROM scenario_passes p WHERE p.id = ${id} AND p.user_id = ${userId}`;
  if (!row) return null;
  const runs = await sql`SELECT ${RUN_COLUMNS} FROM scenario_runs WHERE pass_id = ${id} ORDER BY position`;
  return { pass: toSummary(row as Record<string, unknown>), runs: (runs as Record<string, unknown>[]).map(toRun) };
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors. (If `sql.begin`'s callback type complains about the returned string, keep the
outer `as string` cast — that is the existing pattern's escape hatch for postgres.js generics.)

- [ ] **Step 4: Checkpoint** (no git commit)

---

### Task 8: Routes and the runner wake-up

**Files:**
- Create: `src/scenarios/runnerClient.ts`, `src/routes/scenarios.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Write `src/scenarios/runnerClient.ts`**

```ts
import { env } from "../config/env.js";

/**
 * Wake the runner for a pass. It answers 202 at once and pulls the runs itself; anything else means
 * nothing will run, and the caller cancels the pass.
 */
export async function notifyRunner(passId: string): Promise<void> {
  const response = await fetch(`${env.scenarioRunnerUrl}/passes/${passId}`, {
    method: "POST",
    headers: { "x-runner-key": env.scenarioRunnerKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 202) throw new Error(`it answered ${response.status}`);
}
```

- [ ] **Step 2: Write `src/routes/scenarios.ts`**

```ts
import { Elysia, t } from "elysia";
import { authenticateAdmin } from "../auth/guard.js";
import { readCallSettings, type CallSettings } from "../business/callSettings.js";
import { env } from "../config/env.js";
import { findProfile } from "../db/businessProfiles.js";
import { findCallSettings } from "../db/callSettings.js";
import {
  activePassId,
  claimNextRun,
  createPass,
  deleteScenario,
  findRun,
  findRunnerPass,
  findScenario,
  finishPass,
  finishRun,
  getPass,
  insertScenario,
  listPasses,
  listScenarios,
  saveSandbox,
  touchPass,
  updateScenario,
} from "../db/scenarios.js";
import type { TranscriptEntry } from "../demo/types.js";
import { gradeRun } from "../scenarios/grade.js";
import { businessFacts } from "../scenarios/judge.js";
import { notifyRunner } from "../scenarios/runnerClient.js";
import { runSandboxTool } from "../scenarios/sandbox.js";
import {
  TEMPLATES,
  placeholderValues,
  resolveDefinition,
  scenarioSlots,
  templateById,
  type TemplateContext,
} from "../scenarios/templates.js";
import { DefinitionError, readDefinition, type RunResult, type ScenarioDefinition } from "../scenarios/types.js";
import { composeSession, type SessionRecord } from "../session/compose.js";
import { fromBusinessRow } from "../session/records.js";

// Scenario tests (docs/superpowers/specs/2026-10-01-scenario-tests-design.md).
//
// Admin routes (/business/scenarios, /business/scenario-passes) act on one business, named by
// ?userId=. Runner routes (/internal/*) are called only by the scenario runner in openai-agent-app,
// with SCENARIO_RUNNER_KEY. One press of Run selected runs each ticked scenario once and stops:
// nothing here schedules, repeats or retries anything.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What one run is estimated to cost, shown before Run selected. Measured costs replace it after. */
export const SCENARIO_RUN_ESTIMATE_USD = 0.08;
export const RUN_LIMITS = { maxSeconds: 90, maxTurns: 8 } as const;

/** The sandbox stands in for the calendar, so the composer is told one is connected. */
const SANDBOX_BOOKING = { providerName: "the business calendar", kind: "calendar" as const };

const userIdQuery = t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) });
const NO_BUSINESS = { error: "Add the business information first — there's nothing to test yet." };

type Denied = { denied: 400 | 401 | 403; body: Record<string, string> };

async function admin(authorization: string | undefined, userId: string | undefined): Promise<{ adminId: string; target: string } | Denied> {
  const auth = await authenticateAdmin(authorization, "Scenario tests are for TecAce admins.");
  if ("denied" in auth) return auth;
  const target = userId?.trim();
  if (!target || !UUID.test(target)) return { denied: 400, body: { error: "Pick a business first." } };
  return { adminId: auth.user.id, target };
}

async function business(target: string) {
  const [row, stored] = await Promise.all([findProfile(target), findCallSettings(target)]);
  return { record: row ? fromBusinessRow(row) : null, stored };
}

const contextFor = (record: SessionRecord, callSettings: unknown): TemplateContext => ({
  profile: record.profile,
  settings: readCallSettings(callSettings),
  language: record.language === "ko" ? "ko" : "en",
});

/** The business's scenarios, with any built-in one that applies and isn't there yet written in. */
async function withTemplates(target: string, ctx: TemplateContext) {
  const have = await listScenarios(target);
  const missing = TEMPLATES.map((tpl, position) => ({ tpl, position })).filter(
    ({ tpl }) => tpl.applies(ctx) && !have.some((s) => s.templateId === tpl.id),
  );
  for (const { tpl, position } of missing) {
    await insertScenario(target, { templateId: tpl.id, title: tpl.title, definition: tpl.build(ctx), position });
  }
  return missing.length ? listScenarios(target) : have;
}

function parseScenarioBody(body: { title?: unknown; definition?: unknown }):
  | { title: string; definition: ScenarioDefinition }
  | { error: string } {
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!title) return { error: "Give the scenario a title." };
  try {
    return { title, definition: readDefinition(body.definition) };
  } catch (error) {
    if (error instanceof DefinitionError) return { error: error.message };
    throw error;
  }
}

function isEntry(entry: unknown): entry is TranscriptEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    (e.speaker === "caller" || e.speaker === "receptionist") &&
    typeof e.text === "string" &&
    typeof e.id === "string" &&
    typeof e.startMs === "number" &&
    typeof e.endMs === "number"
  );
}

const runnerAllowed = (headers: Record<string, string | undefined>) =>
  Boolean(env.scenarioRunnerKey) && headers["x-runner-key"] === env.scenarioRunnerKey;

export const scenarios = new Elysia()
  // ---------------------------------------------------------------- admin: scenarios
  .get(
    "/business/scenarios",
    async ({ headers, query, status }) => {
      const who = await admin(headers.authorization, query.userId);
      if ("denied" in who) return status(who.denied, who.body);
      const { record, stored } = await business(who.target);
      if (!record) return status(409, NO_BUSINESS);
      const ctx = contextFor(record, stored.draft);
      const list = await withTemplates(who.target, ctx);
      return {
        scenarios: list.map((s) => ({
          ...s,
          applicable: s.templateId ? (templateById(s.templateId)?.applies(ctx) ?? false) : true,
        })),
        perRunEstimateUsd: SCENARIO_RUN_ESTIMATE_USD,
        runnerConfigured: Boolean(env.scenarioRunnerUrl && env.scenarioRunnerKey),
      };
    },
    { query: userIdQuery },
  )
  .post(
    "/business/scenarios",
    async ({ headers, query, body, status }) => {
      const who = await admin(headers.authorization, query.userId);
      if ("denied" in who) return status(who.denied, who.body);
      const parsed = parseScenarioBody(body);
      if ("error" in parsed) return status(400, parsed);
      const scenario = await insertScenario(who.target, { templateId: null, ...parsed, position: 1000 });
      return { scenario };
    },
    { query: userIdQuery, body: t.Object({ title: t.Optional(t.Unknown()), definition: t.Optional(t.Unknown()) }) },
  )
  .put(
    "/business/scenarios/:id",
    async ({ headers, query, params, body, status }) => {
      const who = await admin(headers.authorization, query.userId);
      if ("denied" in who) return status(who.denied, who.body);
      const parsed = parseScenarioBody(body);
      if ("error" in parsed) return status(400, parsed);
      const scenario = UUID.test(params.id) ? await updateScenario(params.id, who.target, parsed) : null;
      if (!scenario) return status(404, { error: "Scenario not found." });
      return { scenario };
    },
    {
      query: userIdQuery,
      params: t.Object({ id: t.String({ maxLength: 64 }) }),
      body: t.Object({ title: t.Optional(t.Unknown()), definition: t.Optional(t.Unknown()) }),
    },
  )
  .delete(
    "/business/scenarios/:id",
    async ({ headers, query, params, status }) => {
      const who = await admin(headers.authorization, query.userId);
      if ("denied" in who) return status(who.denied, who.body);
      const found = UUID.test(params.id) ? await findScenario(params.id, who.target) : null;
      if (!found) return status(404, { error: "Scenario not found." });
      if (found.templateId) return status(409, { error: "Built-in scenarios can't be deleted. Untick it to leave it out of a run." });
      await deleteScenario(params.id, who.target);
      return { ok: true };
    },
    { query: userIdQuery, params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )
  .post(
    "/business/scenarios/:id/reset",
    async ({ headers, query, params, status }) => {
      const who = await admin(headers.authorization, query.userId);
      if ("denied" in who) return status(who.denied, who.body);
      const found = UUID.test(params.id) ? await findScenario(params.id, who.target) : null;
      if (!found) return status(404, { error: "Scenario not found." });
      const tpl = found.templateId ? templateById(found.templateId) : undefined;
      if (!tpl) return status(409, { error: "Only built-in scenarios can be reset." });
      const { record, stored } = await business(who.target);
      if (!record) return status(409, NO_BUSINESS);
      const scenario = await updateScenario(params.id, who.target, {
        title: tpl.title,
        definition: tpl.build(contextFor(record, stored.draft)),
      });
      return { scenario };
    },
    { query: userIdQuery, params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )

  // ---------------------------------------------------------------- admin: passes
  .post(
    "/business/scenario-passes",
    async ({ headers, query, body, status }) => {
      const who = await admin(headers.authorization, query.userId);
      if ("denied" in who) return status(who.denied, who.body);
      if (!env.scenarioRunnerUrl || !env.scenarioRunnerKey) {
        return status(503, { error: "The scenario runner isn't set up on this server (SCENARIO_RUNNER_URL, SCENARIO_RUNNER_KEY)." });
      }
      if (await activePassId()) {
        return status(409, { error: "A scenario test is already running. Wait for it to finish, or stop it." });
      }
      const kind = body.settings === "published" ? "published" : "draft";
      const ids = Array.isArray(body.scenarioIds)
        ? body.scenarioIds.filter((x): x is string => typeof x === "string").slice(0, 60)
        : [];

      const { record, stored } = await business(who.target);
      if (!record) return status(409, NO_BUSINESS);
      const raw = kind === "draft" ? stored.draft : stored.published;
      if (!raw) return status(409, { error: "Nothing has been published yet. Test the draft instead." });
      const callSettings: CallSettings = readCallSettings(raw);
      const chosen = (await listScenarios(who.target)).filter((s) => ids.includes(s.id));
      if (!chosen.length) return status(400, { error: "Tick at least one scenario." });

      const now = new Date();
      const timeZone = callSettings.timezone ?? env.timezone;
      const session = composeSession({
        record,
        callSettings,
        channel: "sim",
        now,
        timeZone,
        waterfallAllowed: stored.waterfallAllowed,
        neverPublished: stored.published === null,
        booking: callSettings.appointments.enabled ? SANDBOX_BOOKING : null,
        canText: false,
      });
      const slots = scenarioSlots({ settings: callSettings, profile: record.profile, timeZone, now: now.getTime() });
      const runs = chosen.map((s) => {
        const resolved = resolveDefinition(s.definition, placeholderValues(slots, now.getTime(), timeZone, s.definition.language));
        return resolved.ok
          ? { scenarioId: s.id, title: s.title, definition: resolved.definition }
          : { scenarioId: s.id, title: s.title, definition: null, error: resolved.error };
      });
      const passId = await createPass({
        userId: who.target,
        createdBy: who.adminId,
        settingsKind: kind,
        timeZone,
        snapshot: { callSettings, profile: record.profile },
        session: { live: session.live, backend: session.backend, tools: session.tools, greeting: session.greeting, voice: session.voice },
        runs,
      });
      try {
        await notifyRunner(passId);
      } catch (error) {
        await finishPass(passId, "cancelled");
        return status(503, {
          error: `The scenario runner could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return { passId };
    },
    { query: userIdQuery, body: t.Object({ settings: t.Optional(t.Unknown()), scenarioIds: t.Optional(t.Unknown()) }) },
  )
  .get(
    "/business/scenario-passes",
    async ({ headers, query, status }) => {
      const who = await admin(headers.authorization, query.userId);
      if ("denied" in who) return status(who.denied, who.body);
      return { passes: await listPasses(who.target) };
    },
    { query: userIdQuery },
  )
  .get(
    "/business/scenario-passes/:id",
    async ({ headers, query, params, status }) => {
      const who = await admin(headers.authorization, query.userId);
      if ("denied" in who) return status(who.denied, who.body);
      const found = UUID.test(params.id) ? await getPass(params.id, who.target) : null;
      if (!found) return status(404, { error: "Test run not found." });
      return found;
    },
    { query: userIdQuery, params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )
  .post(
    "/business/scenario-passes/:id/stop",
    async ({ headers, query, params, status }) => {
      const who = await admin(headers.authorization, query.userId);
      if ("denied" in who) return status(who.denied, who.body);
      const found = UUID.test(params.id) ? await getPass(params.id, who.target) : null;
      if (!found) return status(404, { error: "Test run not found." });
      // The scenario in progress finishes (at most 90 s); nothing after it starts.
      await finishPass(params.id, "cancelled");
      return (await getPass(params.id, who.target))!;
    },
    { query: userIdQuery, params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )

  // ---------------------------------------------------------------- runner
  .get(
    "/internal/scenario-passes/:id/next",
    async ({ headers, params, status }) => {
      if (!runnerAllowed(headers)) return status(401, { error: "unauthorized" });
      const pass = UUID.test(params.id) ? await findRunnerPass(params.id) : null;
      if (!pass) return status(404, { error: "No such pass." });
      if (pass.status !== "running") return { done: true };
      const run = await claimNextRun(pass.id);
      if (!run || !run.scenario) {
        await finishPass(pass.id, "completed");
        return { done: true };
      }
      await touchPass(pass.id);
      return {
        done: false,
        runId: run.id,
        title: run.title,
        session: pass.session,
        customerLines: run.scenario.customerLines,
        language: run.scenario.language,
        limits: RUN_LIMITS,
      };
    },
    { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )
  .post(
    "/internal/scenario-runs/:id/tool",
    async ({ headers, params, body, status }) => {
      if (!runnerAllowed(headers)) return status(401, { error: "unauthorized" });
      const run = UUID.test(params.id) ? await findRun(params.id) : null;
      if (!run || run.status !== "running" || !run.scenario) return status(409, { error: "This run isn't in progress." });
      const pass = (await findRunnerPass(run.passId))!;
      const name = typeof body.name === "string" ? body.name.slice(0, 60) : "";
      const args =
        body.args && typeof body.args === "object" && !Array.isArray(body.args) ? (body.args as Record<string, unknown>) : {};
      const { output, state } = runSandboxTool(name, args, run.sandbox, {
        settings: pass.snapshot.callSettings,
        profileHours: pass.snapshot.profile.hours,
        timeZone: pass.timeZone,
        world: run.scenario.world,
      });
      await saveSandbox(run.id, state);
      await touchPass(run.passId);
      return { output };
    },
    {
      params: t.Object({ id: t.String({ maxLength: 64 }) }),
      body: t.Object({ name: t.Optional(t.Unknown()), args: t.Optional(t.Unknown()) }),
    },
  )
  .post(
    "/internal/scenario-runs/:id/result",
    async ({ headers, params, body, status }) => {
      if (!runnerAllowed(headers)) return status(401, { error: "unauthorized" });
      const run = UUID.test(params.id) ? await findRun(params.id) : null;
      if (!run || run.status !== "running" || !run.scenario) return status(409, { error: "This run isn't in progress." });
      const pass = (await findRunnerPass(run.passId))!;
      const result: RunResult = {
        status: body.status === "completed" ? "completed" : "error",
        errorReason: typeof body.errorReason === "string" ? body.errorReason.slice(0, 300) : undefined,
        transcript: Array.isArray(body.transcript) ? body.transcript.slice(0, 200).filter(isEntry) : [],
        durationSec:
          typeof body.durationSec === "number" && body.durationSec >= 0 ? Math.min(Math.round(body.durationSec), 600) : 0,
        costUsd: typeof body.costUsd === "number" && body.costUsd >= 0 ? Math.min(body.costUsd, 10) : 0,
      };
      const startedAt =
        typeof body.startedAt === "string" && Number.isFinite(Date.parse(body.startedAt))
          ? new Date(body.startedAt).toISOString()
          : undefined;
      const graded = await gradeRun({
        result,
        definition: run.scenario,
        state: run.sandbox,
        timeZone: pass.timeZone,
        facts: businessFacts(pass.snapshot.profile),
        startedAt,
      });
      await finishRun(run.id, {
        verdict: graded.verdict,
        failures: graded.failures,
        errorReason: graded.errorReason,
        transcript: result.transcript,
        durationSec: result.durationSec,
        costUsd: Math.round((result.costUsd + graded.judgeCostUsd) * 10_000) / 10_000,
        startedAt,
      });
      await touchPass(run.passId);
      return { verdict: graded.verdict };
    },
    {
      params: t.Object({ id: t.String({ maxLength: 64 }) }),
      body: t.Object({
        status: t.Optional(t.Unknown()),
        errorReason: t.Optional(t.Unknown()),
        startedAt: t.Optional(t.Unknown()),
        transcript: t.Optional(t.Unknown()),
        durationSec: t.Optional(t.Unknown()),
        costUsd: t.Optional(t.Unknown()),
      }),
    },
  );
```

- [ ] **Step 3: Mount it**

In `src/app.ts` add the import next to the others:

```ts
import { scenarios } from "./routes/scenarios.js";
```

and after `.use(testCalls)`:

```ts
  // Scenario tests: admin-only scripted test calls, and the runner's own routes under /internal.
  .use(scenarios)
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors. If `stored.published`/`stored.waterfallAllowed` names differ, read
`toStored` in `src/db/callSettings.ts` and use its field names (the test-call route uses
`settings.draft`, `settings.published`, `settings.waterfallAllowed`).

- [ ] **Step 5: Checkpoint** (no git commit)

---

### Task 9: Route test against PGlite

**Files:**
- Create: `src/routes/scenarios.pg.test.ts`

- [ ] **Step 1: Write the test**

Start the file with **lines 1–145 of `src/routes/testCalls.pg.test.ts` copied unchanged** — from
`import { afterAll, describe, expect, it, mock } from "bun:test";` through the three
`const ADMIN/JANE/BOB = await bearerFor(...)` lines. That block is the PGlite shim, the real DDL
replay and real session tokens; it must not be paraphrased. Change only its header comment to:

```ts
// Scenario tests through the real routes against a real Postgres (PGlite), with OpenAI and the
// runner stubbed at `fetch` — no request leaves the process.
//
// Run: bun test src/routes/scenarios.pg.test.ts
```

Then append:

```ts
const { env } = await import("../config/env.js");
const settable = env as unknown as Record<string, unknown>;
const TEST_ENV: Record<string, unknown> = {
  openaiApiKey: "sk-test-not-a-real-key",
  openaiBaseUrl: "https://openai.invalid/v1",
  scenarioRunnerUrl: "https://runner.invalid/scenarios",
  scenarioRunnerKey: "runner-key",
  scenarioJudgeModel: "gpt-5.6-luna",
};
const ENV_BEFORE = Object.fromEntries(Object.keys(TEST_ENV).map((k) => [k, settable[k]]));
Object.assign(settable, TEST_ENV);

const outbound: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
  const url = typeof input === "string" ? input : input.url;
  outbound.push(url);
  if (url.startsWith("https://runner.invalid/scenarios/passes/")) return new Response('{"accepted":true}', { status: 202 });
  if (url.endsWith("/responses")) {
    const items = Array.from({ length: 12 }, (_, i) => ({ n: i + 1, met: true, evidence: "" }));
    return Response.json({ output_text: JSON.stringify({ items }), usage: { input_tokens: 2000, output_tokens: 100 } });
  }
  return new Response("unexpected", { status: 500 });
}) as typeof fetch;

afterAll(async () => {
  globalThis.fetch = realFetch;
  Object.assign(settable, ENV_BEFORE);
  await db.close();
});

const { app } = await import("../app.js");
const { findUserByEmail } = await import("../db/users.js");
const { saveProfile } = await import("../db/businessProfiles.js");
const { saveCallSettingsDraft } = await import("../db/callSettings.js");
const { validateCallSettings } = await import("../business/callSettings.js");

const jane = (await findUserByEmail("jane@tecace.com"))!;

async function call(method: string, path: string, headers: Record<string, string>, payload?: unknown) {
  const response = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );
  return { status: response.status, body: (await response.json()) as any };
}
const asAdmin = { authorization: ADMIN };
const asRunner = { "x-runner-key": "runner-key" };
const Q = `?userId=${jane.id}`;

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

describe("scenario tests", () => {
  it("needs business information, and an admin", async () => {
    expect((await call("GET", `/business/scenarios${Q}`, asAdmin)).status).toBe(409);
    expect((await call("GET", `/business/scenarios${Q}`, { authorization: JANE })).status).toBe(403);
  });

  it("writes in the built-in scenarios that apply", async () => {
    await saveProfile(
      jane.id,
      "Jane's Salon.",
      { businessName: "Jane's Salon", hoursText: null, openHour: null, closeHour: null, website: null, facts: "Cuts." },
      { transferNumber: null, agentName: "Mia", greeting: null, transferTopics: null, houseRules: null },
      {
        profile: {
          name: "Jane's Salon",
          category: "Hair salon",
          address: "1 A St, Tacoma, WA",
          hours: DAYS.map((day) => ({ day, open: "09:00", close: "17:00" })),
          services: [{ name: "Haircut" }],
          highlights: [],
          policies: {},
          faqs: [],
        },
        prompts: null as never,
        voice: "gleam",
        language: null,
      },
    );
    await saveCallSettingsDraft(
      jane.id,
      validateCallSettings(
        {
          appointments: { enabled: true },
          transfer: { scenarios: [{ id: "front", mode: "cold", name: "Front desk", numbers: ["2065550134"] }] },
        },
        { waterfallAllowed: false },
      ),
    );
    const res = await call("GET", `/business/scenarios${Q}`, asAdmin);
    expect(res.status).toBe(200);
    expect(res.body.scenarios.map((s: { templateId: string }) => s.templateId)).toEqual([
      "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12",
    ]);
    expect(res.body.runnerConfigured).toBe(true);
    // Reading again does not write them twice.
    expect((await call("GET", `/business/scenarios${Q}`, asAdmin)).body.scenarios).toHaveLength(12);
  });

  it("refuses a bad custom scenario and keeps a good one", async () => {
    const bad = await call("POST", `/business/scenarios${Q}`, asAdmin, { title: "x", definition: { customerLines: [] } });
    expect(bad.status).toBe(400);
    const good = await call("POST", `/business/scenarios${Q}`, asAdmin, {
      title: "Parking",
      definition: { customerLines: ["Is there parking?"], expect: { judge: ["Does not invent parking"] } },
    });
    expect(good.status).toBe(200);
    expect(good.body.scenario.templateId).toBeNull();
  });

  it("runs a pass once, scenario by scenario, through the sandbox, and stops", async () => {
    const list = (await call("GET", `/business/scenarios${Q}`, asAdmin)).body.scenarios;
    const ids = list.filter((s: { templateId: string }) => s.templateId === "S05" || s.templateId === "S08").map((s: { id: string }) => s.id);

    const started = await call("POST", `/business/scenario-passes${Q}`, asAdmin, { settings: "draft", scenarioIds: ids });
    expect(started.status).toBe(200);
    const passId = started.body.passId;
    expect(outbound).toContain(`https://runner.invalid/scenarios/passes/${passId}`);

    const again = await call("POST", `/business/scenario-passes${Q}`, asAdmin, { settings: "draft", scenarioIds: ids });
    expect(again.status).toBe(409);

    expect((await call("GET", `/internal/scenario-passes/${passId}/next`, {})).status).toBe(401);

    // S05: book the time the scenario asks for.
    const first = await call("GET", `/internal/scenario-passes/${passId}/next`, asRunner);
    expect(first.body.done).toBe(false);
    expect(first.body.title).toBe("Booking");
    expect(first.body.customerLines[0]).toContain("under the name Kim Minsu");
    expect(first.body.session.tools.map((t: { name: string }) => t.name)).toContain("book_appointment");
    expect(first.body.limits).toEqual({ maxSeconds: 90, maxTurns: 8 });

    const detail = (await call("GET", `/business/scenario-passes/${passId}${Q}`, asAdmin)).body;
    const slotA = detail.runs[0].scenario.expect.tools[0].args.start;
    const booked = await call("POST", `/internal/scenario-runs/${first.body.runId}/tool`, asRunner, {
      name: "book_appointment",
      args: { start: slotA, caller_name: "Kim Minsu" },
    });
    expect(booked.body.output.booked).toBe(true);
    const transcript = [{ id: "t1", speaker: "caller", text: "Please book…", startMs: 0, endMs: 900 }];
    const graded = await call("POST", `/internal/scenario-runs/${first.body.runId}/result`, asRunner, {
      status: "completed",
      startedAt: new Date().toISOString(),
      transcript,
      durationSec: 30,
      costUsd: 0.04,
    });
    expect(graded.body.verdict).toBe("pass");

    // S08: the same time is full.
    const second = await call("GET", `/internal/scenario-passes/${passId}/next`, asRunner);
    expect(second.body.title).toBe("Time unavailable");
    const full = await call("POST", `/internal/scenario-runs/${second.body.runId}/tool`, asRunner, {
      name: "book_appointment",
      args: { start: slotA, caller_name: "Kim Minsu" },
    });
    expect(full.body.output.booked).toBe(false);
    await call("POST", `/internal/scenario-runs/${second.body.runId}/result`, asRunner, {
      status: "completed",
      transcript,
      durationSec: 30,
      costUsd: 0.04,
    });

    const done = await call("GET", `/internal/scenario-passes/${passId}/next`, asRunner);
    expect(done.body).toEqual({ done: true });

    const summary = (await call("GET", `/business/scenario-passes/${passId}${Q}`, asAdmin)).body;
    expect(summary.pass).toMatchObject({ status: "completed", runs: 2, done: 2, passed: 2, failed: 0, errors: 0 });
    expect(summary.pass.costUsd).toBeGreaterThan(0.08);
    expect(summary.runs[0].sandbox.calls.map((c: { name: string }) => c.name)).toEqual(["book_appointment"]);
  });

  it("stop cancels what has not started", async () => {
    const list = (await call("GET", `/business/scenarios${Q}`, asAdmin)).body.scenarios;
    const started = await call("POST", `/business/scenario-passes${Q}`, asAdmin, {
      settings: "draft",
      scenarioIds: [list[0].id, list[1].id],
    });
    const passId = started.body.passId;
    const stopped = await call("POST", `/business/scenario-passes/${passId}/stop${Q}`, asAdmin);
    expect(stopped.body.pass.status).toBe("cancelled");
    expect((await call("GET", `/internal/scenario-passes/${passId}/next`, asRunner)).body).toEqual({ done: true });
    expect((await call("GET", `/business/scenario-passes${Q}`, asAdmin)).body.passes).toHaveLength(2);
  });

  it("refuses to test published settings that don't exist yet", async () => {
    const list = (await call("GET", `/business/scenarios${Q}`, asAdmin)).body.scenarios;
    const res = await call("POST", `/business/scenario-passes${Q}`, asAdmin, { settings: "published", scenarioIds: [list[0].id] });
    expect(res.status).toBe(409);
  });

  it("never reaches the real OpenAI or a real runner", () => {
    expect(outbound.every((u) => u.startsWith("https://openai.invalid/") || u.startsWith("https://runner.invalid/"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `bun test src/routes/scenarios.pg.test.ts`
Expected: 8 pass. If `saveProfile`'s argument shape has changed since this plan, copy the call
from `src/routes/testCalls.pg.test.ts` (it is the reference) and keep this test's `hours`,
`address` and `services`.

- [ ] **Step 3: Run the whole backend suite and typecheck**

Run: `bun test` then `bun run typecheck`
Expected: everything passes (the suite was ~1016 tests before; it should grow by ~31).

- [ ] **Step 4: Checkpoint** (no git commit)

---

# Part B — openai-agent-app runner

Run every command in this part from `openai-agent-app/`, in its venv (`pip install -e .` done).

### Task 10: Runner settings, audio helpers and the turn policy

**Files:**
- Create: `src/openai_agent/scenario/__init__.py`, `settings.py`, `audio.py`, `turns.py`
- Create: `scripts/checks/verify_scenario_runner.py` (policy part; extended in Task 13)

- [ ] **Step 1: Write the policy check first**

Create `scripts/checks/verify_scenario_runner.py`:

```python
"""Check the scenario runner without a network or keys.

    python scripts/checks/verify_scenario_runner.py

Part 1 checks the turn policy (when the scripted customer speaks, when a run is over).
Part 2 (added in Task 13) runs one whole scenario against a fake transcribe-backend and a fake
GPT-Live socket, and checks what reaches each.

Run it after editing anything under src/openai_agent/scenario/.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("OPENAI_LIVE_MODEL", "gpt-live-1")

from openai_agent.scenario.turns import (  # noqa: E402
    ANSWER_WAIT,
    DONE_SILENCE,
    FAREWELL_MAX,
    GREETING_WAIT,
    Transcript,
    TurnPolicy,
)

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"   -- {detail}"))
    if not ok:
        failures.append(name)


def policy_checks() -> None:
    print("turn policy")
    p = TurnPolicy(lines=2, max_seconds=90, max_turns=8)
    check("waits for the greeting", p.tick(0.5) == "wait")
    p.agent_sound(0.5)
    check("does not talk over the greeting", p.tick(1.0) == "wait")
    check("speaks once the agent is quiet", p.tick(1.8) == "speak")
    p.started_line(1.8, 1.0)
    check("silent while its own line plays", p.tick(2.5) == "wait")
    check("waits for an answer before the next line", p.tick(4.0) == "wait")
    p.delegation(True)
    p.agent_sound(4.0)
    check("waits while the backend works", p.tick(6.0) == "wait")
    p.delegation(False)
    check("speaks the next line after the answer", p.tick(6.0) == "speak")
    p.started_line(6.0, 1.0)
    p.agent_sound(8.0)
    check("not done right after the last answer", p.tick(9.5) == "wait")
    check("done after the customer goes quiet", p.tick(8.0 + DONE_SILENCE) == "close")

    q = TurnPolicy(lines=1, max_seconds=90, max_turns=8)
    check("speaks first if the agent never greets", q.tick(GREETING_WAIT) == "speak")

    e = TurnPolicy(lines=1, max_seconds=90, max_turns=8)
    e.end_requested(10.0)
    check("after end_call, waits for the goodbye", e.tick(11.0) == "wait")
    e.agent_sound(11.0)
    check("closes once the goodbye is said", e.tick(12.5) == "close")
    f = TurnPolicy(lines=1, max_seconds=90, max_turns=8)
    f.end_requested(10.0)
    check("closes anyway if no goodbye comes", f.tick(10.0 + FAREWELL_MAX) == "close")

    check("time limit", TurnPolicy(lines=1, max_seconds=90, max_turns=8).tick(90.0) == "time_limit")
    t = TurnPolicy(lines=3, max_seconds=90, max_turns=2)
    for i in range(3):
        t.agent_sound(i * 5.0)
        t.tick(i * 5.0 + 2.0)
    check("turn limit", t.tick(20.0) == "turn_limit")

    a = TurnPolicy(lines=2, max_seconds=90, max_turns=8)
    a.agent_sound(0.0)
    a.tick(1.5)
    a.started_line(1.5, 1.0)
    check("unanswered line: wait", a.tick(2.5 + ANSWER_WAIT - 0.5) == "wait")
    check("unanswered line: move on", a.tick(2.5 + ANSWER_WAIT) == "speak")

    tr = Transcript()
    tr.agent("Hello, ", 100)
    tr.agent("how can I help?", 300)
    tr.caller("Book me in.", 2000, 3000)
    tr.agent("Sure.", 4000)
    check(
        "transcript joins the agent's deltas into turns",
        [(e["speaker"], e["text"]) for e in tr.entries]
        == [("receptionist", "Hello, how can I help?"), ("caller", "Book me in."), ("receptionist", "Sure.")],
        str(tr.entries),
    )


def main() -> int:
    policy_checks()
    print()
    print("FAILED: " + ", ".join(failures) if failures else "all scenario-runner checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run it to see it fail**

Run: `python scripts/checks/verify_scenario_runner.py`
Expected: `ModuleNotFoundError: No module named 'openai_agent.scenario'`.

- [ ] **Step 3: Write the package**

`src/openai_agent/scenario/__init__.py`:

```python
"""Scenario tests: a scripted caller talks to the real GPT-Live receptionist once per scenario.

The design is docs/superpowers/specs/2026-10-01-scenario-tests-design.md. transcribe-backend owns
the scenarios, the sandbox tools and the grading; this package only drives the call.
"""
```

`src/openai_agent/scenario/turns.py`:

```python
"""When the scripted customer speaks, and when a run is over. Pure: no sockets, no clock of its own.

GPT-Live streams output audio continuously, silence included, so "the agent is talking" is decided
from the samples (audio.has_sound) and fed in here as agent_sound(now).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

QUIET_SECONDS = 1.2   # the agent silent this long = its turn is over
GREETING_WAIT = 10.0  # speak the first line anyway if the agent never greets
ANSWER_WAIT = 10.0    # an unanswered line: move on to the next one after this long
DONE_SILENCE = 8.0    # after the last line, this much quiet ends the run (the customer hangs up)
FAREWELL_MAX = 8.0    # after end_call, close at the latest this long after

Action = Literal["wait", "speak", "close", "time_limit", "turn_limit"]


@dataclass
class TurnPolicy:
    lines: int
    max_seconds: float
    max_turns: int
    started: float = 0.0
    next_line: int = 0
    speaking_until: float = 0.0
    agent_loud_at: float | None = None
    agent_turns: int = 0
    in_agent_turn: bool = False
    delegating: bool = False
    ending_since: float | None = None

    def agent_sound(self, now: float) -> None:
        self.agent_loud_at = now
        if not self.in_agent_turn:
            self.in_agent_turn = True
            self.agent_turns += 1

    def delegation(self, active: bool) -> None:
        self.delegating = active

    def end_requested(self, now: float) -> None:
        if self.ending_since is None:
            self.ending_since = now

    def started_line(self, now: float, seconds: float) -> None:
        self.speaking_until = now + seconds
        self.next_line += 1

    def tick(self, now: float) -> Action:
        if now - self.started >= self.max_seconds:
            return "time_limit"
        quiet = self.agent_loud_at is None or now - self.agent_loud_at >= QUIET_SECONDS
        if quiet:
            self.in_agent_turn = False
        if self.ending_since is not None:
            said_goodbye = self.agent_loud_at is not None and self.agent_loud_at > self.ending_since
            if (said_goodbye and quiet) or now - self.ending_since >= FAREWELL_MAX:
                return "close"
            return "wait"
        if self.agent_turns > self.max_turns:
            return "turn_limit"
        if now < self.speaking_until or self.delegating or not quiet:
            return "wait"
        if self.next_line < self.lines:
            if self.next_line == 0:
                waiting_for_greeting = self.agent_loud_at is None and now - self.started < GREETING_WAIT
                return "wait" if waiting_for_greeting else "speak"
            answered = self.agent_loud_at is not None and self.agent_loud_at > self.speaking_until
            return "speak" if answered or now - self.speaking_until >= ANSWER_WAIT else "wait"
        if now - max(self.speaking_until, self.agent_loud_at or 0.0) >= DONE_SILENCE:
            return "close"
        return "wait"


@dataclass
class Transcript:
    """The run's transcript, in transcribe-backend's TranscriptEntry shape."""

    entries: list[dict] = field(default_factory=list)

    def caller(self, text: str, start_ms: int, end_ms: int) -> None:
        self.entries.append(
            {"id": f"t{len(self.entries) + 1}", "speaker": "caller", "text": text, "startMs": start_ms, "endMs": end_ms}
        )

    def agent(self, delta: str, at_ms: int) -> None:
        if not delta:
            return
        last = self.entries[-1] if self.entries else None
        if last and last["speaker"] == "receptionist":
            last["text"] += delta
            last["endMs"] = at_ms
            return
        self.entries.append(
            {"id": f"t{len(self.entries) + 1}", "speaker": "receptionist", "text": delta, "startMs": at_ms, "endMs": at_ms}
        )
```

`src/openai_agent/scenario/settings.py`:

```python
"""The scenario runner's settings, read from the same .env as the rest of the app."""

from __future__ import annotations

import os
from dataclasses import dataclass

from ..config import Config  # noqa: F401 — importing the config loads .env
from ..realtime.live_session import LIVE_URL


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip() or default


@dataclass(frozen=True)
class RunnerSettings:
    # Shared with transcribe-backend's SCENARIO_RUNNER_KEY; sent both ways as x-runner-key.
    key: str
    # SCENARIO_RUNNER_ENABLED=false refuses every pass: the kill switch.
    enabled: bool
    port: int
    # transcribe-backend, the same base the phone agent reads /business/config from.
    backend_url: str
    tts_model: str
    # The scripted customer's voice. Different from the receptionist's so a transcript is easy to follow.
    customer_voice: str
    # Overridable only so the offline check can point it at a fake.
    live_url: str

    @classmethod
    def load(cls) -> "RunnerSettings":
        return cls(
            key=_env("SCENARIO_RUNNER_KEY"),
            enabled=_env("SCENARIO_RUNNER_ENABLED", "true").lower() not in ("false", "0", "no", "off"),
            port=int(_env("SCENARIO_RUNNER_PORT", "5070")),
            backend_url=_env("BUSINESS_CONFIG_URL").rstrip("/"),
            tts_model=_env("SCENARIO_TTS_MODEL", "gpt-4o-mini-tts"),
            customer_voice=_env("SCENARIO_CUSTOMER_VOICE", "ash"),
            live_url=_env("SCENARIO_LIVE_URL", LIVE_URL),
        )

    def missing(self) -> list[str]:
        gaps: list[str] = []
        if not self.key:
            gaps.append("SCENARIO_RUNNER_KEY")
        if not self.backend_url:
            gaps.append("BUSINESS_CONFIG_URL")
        return gaps
```

`src/openai_agent/scenario/audio.py`:

```python
"""Audio for the scenario runner: the customer's lines as phone audio, and "is the agent talking?"."""

from __future__ import annotations

import asyncio
import base64

import httpx

from ..realtime.greeting_audio import SPEECH_URL, pcm24_to_ulaw8

FRAME_BYTES = 160  # 20 ms of 8 kHz μ-law, the frame Twilio sends and the live bridge forwards
FRAME_SECONDS = 0.02
SILENCE_FRAME = base64.b64encode(b"\xff" * FRAME_BYTES).decode("ascii")
# gpt-4o-mini-tts, roughly, per minute of speech produced. Only feeds the run's cost estimate.
TTS_PRICE_PER_MINUTE = 0.015

# Same rule as live_bridge._has_sound: a μ-law byte is "loud" at segment 3 or higher, and a chunk is
# sound when at least 2% of it is loud. Copied rather than imported so this package does not pull in
# the Twilio bridge.
_LOUD_BYTES = bytes(1 if ((0xFF ^ b) >> 4) & 7 >= 3 else 0 for b in range(256))


def has_sound(payload: str) -> bool:
    try:
        raw = base64.b64decode(payload)
    except (ValueError, TypeError):
        return False
    return bool(raw) and raw.translate(_LOUD_BYTES).count(1) * 50 >= len(raw)


def seconds(audio: bytes) -> float:
    return len(audio) / 8000


async def synthesize(api_key: str, model: str, voice: str, text: str) -> bytes:
    """One customer line as 8 kHz μ-law. Raises: a line we cannot voice is a run error."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            SPEECH_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "voice": voice, "input": text, "response_format": "pcm"},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"text-to-speech failed ({resp.status_code}): {resp.text[:200]}")
    return await asyncio.to_thread(pcm24_to_ulaw8, resp.content)
```

- [ ] **Step 4: Run the check**

Run: `python scripts/checks/verify_scenario_runner.py`
Expected: every line `ok`, ending `all scenario-runner checks passed`.

- [ ] **Step 5: Checkpoint** (no git commit)

---

### Task 11: Backend client and one scenario over the socket

**Files:**
- Create: `src/openai_agent/scenario/backend_client.py`, `src/openai_agent/scenario/run_one.py`

(Exercised end to end by Task 13's fake.)

- [ ] **Step 1: Write `backend_client.py`**

```python
"""transcribe-backend's runner routes: the next job, a sandbox tool call, a run's result."""

from __future__ import annotations

import httpx


class BackendClient:
    def __init__(self, base_url: str, key: str, timeout: float = 90.0) -> None:
        # 90 s: posting a result waits for the judge (up to 45 s) on a serverless backend.
        self._client = httpx.AsyncClient(base_url=base_url, headers={"x-runner-key": key}, timeout=timeout)
        self.tool_failed = False

    async def __aenter__(self) -> "BackendClient":
        return self

    async def __aexit__(self, *exc) -> None:
        await self._client.aclose()

    async def next_job(self, pass_id: str) -> dict:
        resp = await self._client.get(f"/internal/scenario-passes/{pass_id}/next")
        resp.raise_for_status()
        return resp.json()

    async def tool(self, run_id: str, name: str, args: dict) -> dict:
        """The sandbox's answer. A sandbox failure is remembered: the run is then a run error."""
        try:
            resp = await self._client.post(f"/internal/scenario-runs/{run_id}/tool", json={"name": name, "args": args})
        except httpx.HTTPError as exc:
            self.tool_failed = True
            return {"error": f"the sandbox could not be reached: {exc}"}
        if resp.status_code != 200:
            self.tool_failed = True
            return {"error": f"the sandbox answered {resp.status_code}"}
        return resp.json().get("output") or {}

    async def post_result(self, run_id: str, result: dict) -> None:
        resp = await self._client.post(f"/internal/scenario-runs/{run_id}/result", json=result)
        resp.raise_for_status()
```

- [ ] **Step 2: Write `run_one.py`**

```python
"""One scenario, once: voice the customer's lines, hold the GPT-Live session, report what happened.

The session is the one transcribe-backend composed for the pass (channel "sim"), started with the
same build_composed_session_start the phone uses, on the same models. Every tool call goes to the
backend's sandbox. The run ends when the agent ends the call, the customer has nothing left to say,
or a limit is hit — whichever is first. Nothing is retried.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone

import websockets

from ..config import Config
from ..realtime.greeting_audio import frames
from ..realtime.live_session import VOICE_PRICE_PER_MINUTE, backend_cost, build_composed_session_start
from .audio import FRAME_SECONDS, SILENCE_FRAME, TTS_PRICE_PER_MINUTE, has_sound, seconds, synthesize
from .backend_client import BackendClient
from .settings import RunnerSettings
from .turns import Transcript, TurnPolicy

log = logging.getLogger(__name__)


async def run_scenario(cfg: Config, rs: RunnerSettings, backend: BackendClient, job: dict) -> dict:
    started = time.monotonic()
    usage = {"voice_seconds": 0.0, "backend": 0.0, "tts": 0.0, "started_at": None}
    transcript = Transcript()
    backend.tool_failed = False
    limits = job["limits"]
    try:
        audio = [await synthesize(cfg.openai_api_key, rs.tts_model, rs.customer_voice, line) for line in job["customerLines"]]
        usage["tts"] = sum(seconds(a) for a in audio) / 60 * TTS_PRICE_PER_MINUTE
        status, reason = await asyncio.wait_for(
            _converse(cfg, rs, backend, job, audio, transcript, usage), timeout=limits["maxSeconds"] + 30
        )
    except asyncio.TimeoutError:
        status, reason = "error", f"time limit ({limits['maxSeconds']} s)"
    except Exception as exc:  # noqa: BLE001 — any failure is this run's run error, never the pass's
        log.exception("scenario run %s failed", job.get("runId"))
        status, reason = "error", f"{type(exc).__name__}: {exc}"
    if status == "completed" and backend.tool_failed:
        status, reason = "error", "a sandbox tool call failed"
    cost = usage["voice_seconds"] / 60 * VOICE_PRICE_PER_MINUTE + usage["backend"] + usage["tts"]
    result = {
        "status": status,
        "transcript": [{**e, "text": e["text"].strip()} for e in transcript.entries if e["text"].strip()],
        "durationSec": round(time.monotonic() - started),
        "costUsd": round(cost, 4),
    }
    if usage["started_at"]:
        result["startedAt"] = usage["started_at"]
    if status == "error":
        result["errorReason"] = reason
    return result


async def _wait_started(ws) -> None:
    async def wait() -> None:
        async for raw in ws:
            evt = json.loads(raw)
            if evt.get("type") == "session.started":
                return
            if evt.get("type") == "error":
                raise RuntimeError(f"GPT-Live refused the session: {evt.get('error')}")
        raise RuntimeError("GPT-Live closed before the session started")

    await asyncio.wait_for(wait(), timeout=15)


async def _converse(cfg, rs, backend, job, audio, transcript, usage) -> tuple[str, str]:
    session = job["session"]
    limits = job["limits"]
    lines = job["customerLines"]
    policy = TurnPolicy(lines=len(audio), max_seconds=limits["maxSeconds"], max_turns=limits["maxTurns"])
    async with websockets.connect(
        rs.live_url, additional_headers={"Authorization": f"Bearer {cfg.openai_api_key}"}
    ) as ws:
        start = build_composed_session_start(
            cfg, session["live"], session["backend"], session["tools"],
            greet_now=session.get("greeting") or "", voice=session.get("voice") or "",
        )
        await ws.send(json.dumps(start))
        await _wait_started(ws)
        t0 = time.monotonic()
        usage["started_at"] = datetime.now(timezone.utc).isoformat()
        policy.started = t0
        outgoing: list[str] = []
        receiver = asyncio.create_task(_receive(cfg, ws, policy, backend, job["runId"], transcript, usage, t0))
        try:
            next_tick = time.monotonic()
            while True:
                now = time.monotonic()
                if receiver.done():
                    receiver.result()  # re-raises what ended it
                    return "error", "the live session closed early"
                action = policy.tick(now)
                if action == "speak":
                    i = policy.next_line
                    outgoing.extend(frames(audio[i]))
                    at = int((now - t0) * 1000)
                    transcript.caller(lines[i], at, at + int(seconds(audio[i]) * 1000))
                    policy.started_line(now, seconds(audio[i]))
                elif action == "close":
                    return "completed", ""
                elif action == "time_limit":
                    return "error", f"time limit ({limits['maxSeconds']} s)"
                elif action == "turn_limit":
                    return "error", f"turn limit ({limits['maxTurns']} agent turns)"
                # Like a phone line, the input never stops: the line's audio, else silence.
                frame = outgoing.pop(0) if outgoing else SILENCE_FRAME
                await ws.send(json.dumps({"type": "session.input_audio.append", "audio": frame}))
                next_tick += FRAME_SECONDS
                await asyncio.sleep(max(0.0, next_tick - time.monotonic()))
        finally:
            usage["voice_seconds"] = max(usage["voice_seconds"], time.monotonic() - t0)
            receiver.cancel()
            try:
                await ws.send(json.dumps({"type": "session.close"}))
            except Exception:  # noqa: BLE001 — the socket may already be gone
                pass


async def _receive(cfg, ws, policy, backend, run_id, transcript, usage, t0) -> None:
    seen: set[str] = set()
    async for raw in ws:
        evt = json.loads(raw)
        t = evt.get("type")
        now = time.monotonic()
        if t == "session.output_audio.delta":
            if has_sound(evt.get("delta") or ""):
                policy.agent_sound(now)
        elif t == "session.output_transcript.delta":
            transcript.agent(evt.get("delta") or "", int((now - t0) * 1000))
        elif t == "session.delegation.created":
            policy.delegation(True)
        elif t == "response.event":
            await _backend_event(cfg, ws, evt.get("event") or {}, policy, backend, run_id, usage, seen)
        elif t in ("session.usage.updated", "session.closed"):
            secs = (evt.get("usage") or {}).get("seconds")
            if isinstance(secs, (int, float)):
                usage["voice_seconds"] = float(secs)
            if t == "session.closed":
                return
        elif t == "error":
            log.warning("live error during a scenario run: %s", evt.get("error") or evt)


async def _backend_event(cfg, ws, inner: dict, policy, backend, run_id, usage, seen) -> None:
    it = inner.get("type")
    if it == "response.created":
        policy.delegation(True)
    elif it in ("response.completed", "response.failed", "response.incomplete"):
        policy.delegation(False)
        u = (inner.get("response") or {}).get("usage") or {}
        usage["backend"] += backend_cost(
            cfg.openai_live_backend_model,
            int(u.get("input_tokens") or 0),
            int((u.get("input_tokens_details") or {}).get("cached_tokens") or 0),
            int(u.get("output_tokens") or 0),
        )
    elif it == "response.output_item.done":
        item = inner.get("item") or {}
        if item.get("type") != "function_call" or item.get("status", "completed") != "completed":
            return
        call_id = item.get("call_id", "")
        if call_id in seen:
            return
        seen.add(call_id)
        name = item.get("name", "")
        try:
            args = json.loads(item.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        output = await backend.tool(run_id, name, args)
        if name == "end_call" or (name == "transfer_call" and output.get("result") == "accepted"):
            policy.end_requested(time.monotonic())
        await ws.send(json.dumps({
            "type": "response.item.create",
            "item": {"type": "function_call_output", "call_id": call_id, "output": json.dumps(output)},
        }))
        # As on the phone, the backend is not resumed after end_call: it would compose a second goodbye.
        if name != "end_call":
            await ws.send(json.dumps({"type": "response.create"}))
```

- [ ] **Step 3: Import check**

Run: `python -c "import sys; sys.path.insert(0,'src'); import openai_agent.scenario.run_one"`
Expected: no output, exit 0.

- [ ] **Step 4: Checkpoint** (no git commit)

---

### Task 12: Runner server, entry point and Compose service

**Files:**
- Create: `src/openai_agent/scenario/server.py`, `scripts/run_scenario_runner.py`
- Modify: `docker-compose.yml`, `.env.example`

- [ ] **Step 1: Write `server.py`**

```python
"""The runner's HTTP side: transcribe-backend wakes it for one pass, and it works through the runs.

One pass at a time, in this process. A second wake-up while one is running is refused (409); the
backend refuses a second pass before it gets here, so this is only the belt to its braces.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse

from ..config import Config
from .backend_client import BackendClient
from .run_one import run_scenario
from .settings import RunnerSettings

log = logging.getLogger(__name__)


async def drive_pass(cfg: Config, rs: RunnerSettings, pass_id: str) -> None:
    """Every run of a pass, one after another, until the backend says it is done or stopped."""
    async with BackendClient(rs.backend_url, rs.key) as backend:
        while True:
            job = await backend.next_job(pass_id)
            if job.get("done"):
                log.info("scenario pass %s finished", pass_id)
                return
            log.info("scenario run %s: %s", job["runId"], job.get("title"))
            result = await run_scenario(cfg, rs, backend, job)
            await backend.post_result(job["runId"], result)


def build_app(cfg: Config, rs: RunnerSettings) -> FastAPI:
    app = FastAPI()
    state: dict = {"active": None, "tasks": set()}

    @app.get("/scenarios/health")
    async def health() -> dict:
        return {"ok": True, "enabled": rs.enabled, "active": state["active"]}

    @app.post("/scenarios/passes/{pass_id}")
    async def start(pass_id: str, x_runner_key: str = Header(default="")) -> JSONResponse:
        if not rs.key or x_runner_key != rs.key:
            raise HTTPException(status_code=401, detail="bad runner key")
        if not rs.enabled:
            raise HTTPException(status_code=503, detail="the scenario runner is switched off")
        if state["active"]:
            raise HTTPException(status_code=409, detail="a pass is already running")
        state["active"] = pass_id

        async def work() -> None:
            try:
                await drive_pass(cfg, rs, pass_id)
            except Exception:  # noqa: BLE001 — the pass shows as interrupted; the process stays up
                log.exception("scenario pass %s stopped", pass_id)
            finally:
                state["active"] = None

        task = asyncio.create_task(work())
        state["tasks"].add(task)
        task.add_done_callback(state["tasks"].discard)
        return JSONResponse({"accepted": True}, status_code=202)

    return app
```

- [ ] **Step 2: Write `scripts/run_scenario_runner.py`**

```python
"""Run the scenario runner — scripted test calls against the real GPT-Live receptionist.

    python scripts/run_scenario_runner.py

Idle until transcribe-backend wakes it (POST /scenarios/passes/<id>). Each pass runs every ticked
scenario once and stops. Needs OPENAI_API_KEY, OPENAI_LIVE_MODEL, BUSINESS_CONFIG_URL and
SCENARIO_RUNNER_KEY (see .env.example).
"""

from __future__ import annotations

import logging
import sys

import uvicorn

from openai_agent.config import Config
from openai_agent.scenario.server import build_app
from openai_agent.scenario.settings import RunnerSettings


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = Config.load()
    rs = RunnerSettings.load()
    gaps = rs.missing()
    if not cfg.openai_api_key:
        gaps.append("OPENAI_API_KEY")
    if not cfg.openai_live_model:
        gaps.append("OPENAI_LIVE_MODEL")
    if gaps:
        print("Missing settings for the scenario runner: " + ", ".join(gaps))
        return 1
    print(f"Scenario runner on :{rs.port} — {'enabled' if rs.enabled else 'SWITCHED OFF (SCENARIO_RUNNER_ENABLED)'}")
    try:
        uvicorn.run(build_app(cfg, rs), host="0.0.0.0", port=rs.port, log_level="warning")
    except KeyboardInterrupt:
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Add the Compose service**

In `docker-compose.yml`, after the `poller:` service block and before `messages:`, add:

```yaml
  # Scenario tests (docs/superpowers/specs/2026-10-01-scenario-tests-design.md): scripted test calls
  # against the real GPT-Live receptionist. Idle until transcribe-backend wakes it for one pass; it
  # runs each ticked scenario once and stops. Shares the hostname, separated by path like the poller.
  scenarios:
    build: .
    restart: unless-stopped
    env_file: .env
    command: ["python", "scripts/run_scenario_runner.py"]
    networks:
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.openai-scenarios.rule=Host(`31-97-214-59.sslip.io`) && PathPrefix(`/scenarios`)"
      - "traefik.http.routers.openai-scenarios.priority=100"
      - "traefik.http.routers.openai-scenarios.entrypoints=websecure"
      - "traefik.http.routers.openai-scenarios.tls.certresolver=mytlschallenge"
      - "traefik.http.services.openai-scenarios.loadbalancer.server.port=5070"
```

- [ ] **Step 4: Document the env**

Append to `openai-agent-app/.env.example`:

```
# ---- Scenario tests (the `scenarios` service) ----
# Must equal transcribe-backend's SCENARIO_RUNNER_KEY. Unset = the runner refuses to start.
SCENARIO_RUNNER_KEY=
# false = refuse every pass (kill switch).
SCENARIO_RUNNER_ENABLED=true
SCENARIO_RUNNER_PORT=5070
# The scripted customer's voice and the model that speaks it.
SCENARIO_TTS_MODEL=gpt-4o-mini-tts
SCENARIO_CUSTOMER_VOICE=ash
```

- [ ] **Step 5: Smoke-start locally**

Run: `SCENARIO_RUNNER_KEY=local BUSINESS_CONFIG_URL=http://localhost:8001 OPENAI_LIVE_MODEL=gpt-live-1 OPENAI_API_KEY=sk-test python scripts/run_scenario_runner.py`
(PowerShell: set each with `$env:NAME = "value";` first.)
Expected: `Scenario runner on :5070 — enabled`. In another shell,
`curl -s localhost:5070/scenarios/health` → `{"ok":true,"enabled":true,"active":null}`, and
`curl -s -X POST localhost:5070/scenarios/passes/x` → 401. Stop it with Ctrl+C.

- [ ] **Step 6: Checkpoint** (no git commit)

---

### Task 13: End-to-end offline check with fakes

**Files:**
- Modify: `scripts/checks/verify_scenario_runner.py`

- [ ] **Step 1: Add the fakes and the end-to-end check**

Add these imports below the existing ones in `verify_scenario_runner.py`:

```python
import asyncio  # noqa: E402
import base64  # noqa: E402
import json  # noqa: E402
import threading  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402

from websockets.asyncio.server import serve  # noqa: E402

from openai_agent.config import Config  # noqa: E402
from openai_agent.scenario import run_one  # noqa: E402
from openai_agent.scenario.server import drive_pass  # noqa: E402
from openai_agent.scenario.settings import RunnerSettings  # noqa: E402
```

Add above `def main()`:

```python
# ---------------------------------------------------------------- part 2: one whole run, faked

LOUD = base64.b64encode(b"\x00" * 160).decode("ascii")  # μ-law 0x00 is full scale
JOB = {
    "done": False,
    "runId": "r1",
    "title": "Booking",
    "session": {
        "live": "VOICE PROMPT",
        "backend": "BACKEND PROMPT",
        "tools": [
            {"type": "function", "name": "book_appointment", "description": "Book.", "parameters": {"type": "object", "properties": {}}},
            {"type": "function", "name": "end_call", "description": "Hang up.", "parameters": {"type": "object", "properties": {}}},
        ],
        "greeting": "Say hello.",
        "voice": None,
    },
    "customerLines": ["Book me for 4 PM tomorrow."],
    "language": "en",
    "limits": {"maxSeconds": 60, "maxTurns": 8},
}
seen: dict = {"jobs": 0, "tools": [], "results": [], "keys": set()}


class FakeBackend(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:  # quiet
        pass

    def _send(self, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        seen["keys"].add(self.headers.get("x-runner-key"))
        seen["jobs"] += 1
        self._send(JOB if seen["jobs"] == 1 else {"done": True})

    def do_POST(self) -> None:  # noqa: N802
        seen["keys"].add(self.headers.get("x-runner-key"))
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if self.path.endswith("/tool"):
            seen["tools"].append(body)
            self._send({"output": {"booked": True, "when": "Friday at 4:00 PM"} if body["name"] == "book_appointment" else {"ok": True}})
        else:
            seen["results"].append(body)
            self._send({"verdict": "pass"})


async def fake_live(ws) -> None:
    async def speak(text: str) -> None:
        await ws.send(json.dumps({"type": "session.output_transcript.delta", "delta": text}))
        for _ in range(30):
            await ws.send(json.dumps({"type": "session.output_audio.delta", "delta": LOUD}))

    async def next_of(kind: str) -> dict:
        async for raw in ws:
            evt = json.loads(raw)
            if evt.get("type") == kind:
                return evt
        raise RuntimeError(f"socket closed before {kind}")

    async def hear_line() -> None:
        heard, quiet = False, 0
        async for raw in ws:
            evt = json.loads(raw)
            if evt.get("type") != "session.input_audio.append":
                continue
            loud = base64.b64decode(evt["audio"]) == b"\x00" * 160
            if loud:
                heard, quiet = True, 0
            elif heard:
                quiet += 1
                if quiet >= 20:
                    return

    seen["session_start"] = json.loads(await ws.recv())
    await ws.send(json.dumps({"type": "session.started", "session": {"id": "sess_fake"}}))
    await speak("Thanks for calling, how can I help? ")
    await hear_line()
    await ws.send(json.dumps({"type": "session.delegation.created", "delegation": {"id": "d1"}}))
    await ws.send(json.dumps({"type": "response.event", "event": {"type": "response.created"}}))
    await ws.send(json.dumps({"type": "response.event", "event": {"type": "response.output_item.done", "item": {
        "type": "function_call", "status": "completed", "call_id": "c1", "name": "book_appointment",
        "arguments": json.dumps({"start": "2026-10-02T16:00:00-07:00", "caller_name": "Kim Minsu"})}}}))
    seen["tool_output"] = await next_of("response.item.create")
    await ws.send(json.dumps({"type": "response.event", "event": {"type": "response.completed",
        "response": {"usage": {"input_tokens": 1000, "output_tokens": 50}}}}))
    await speak("You're booked for 4 PM. ")
    await ws.send(json.dumps({"type": "response.event", "event": {"type": "response.output_item.done", "item": {
        "type": "function_call", "status": "completed", "call_id": "c2", "name": "end_call", "arguments": "{}"}}}))
    await next_of("response.item.create")
    await speak("Goodbye!")
    await ws.send(json.dumps({"type": "session.usage.updated", "usage": {"seconds": 12}}))
    await next_of("session.close")


async def end_to_end() -> None:
    print("one run against fakes")
    http = ThreadingHTTPServer(("127.0.0.1", 0), FakeBackend)
    threading.Thread(target=http.serve_forever, daemon=True).start()

    async def fake_tts(api_key, model, voice, text) -> bytes:
        return b"\x00" * 8000  # one loud second

    run_one.synthesize = fake_tts
    async with serve(fake_live, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        rs = RunnerSettings(
            key="k", enabled=True, port=0, backend_url=f"http://127.0.0.1:{http.server_port}",
            tts_model="tts", customer_voice="ash", live_url=f"ws://127.0.0.1:{port}",
        )
        await asyncio.wait_for(drive_pass(Config.load(), rs, "p1"), timeout=60)
    http.shutdown()

    result = seen["results"][0] if seen["results"] else {}
    start = seen.get("session_start", {}).get("session", {})
    check("sends the runner key", seen["keys"] == {"k"}, str(seen["keys"]))
    check("starts the composed session", start.get("instructions", "").startswith("VOICE PROMPT"), str(start)[:200])
    check(
        "puts the tools on the backend",
        [t["name"] for t in start.get("delegation", {}).get("responses", {}).get("tools", [])] == ["book_appointment", "end_call"],
    )
    check("forwards both tool calls to the sandbox", [t["name"] for t in seen["tools"]] == ["book_appointment", "end_call"], str(seen["tools"]))
    check("hands the sandbox's answer back", '"booked": true' in seen.get("tool_output", {}).get("item", {}).get("output", ""))
    check("the run completed", result.get("status") == "completed", str(result))
    speakers = [e["speaker"] for e in result.get("transcript", [])]
    check("transcript has both sides in order", speakers[:3] == ["receptionist", "caller", "receptionist"], str(result.get("transcript")))
    check("reports a cost", result.get("costUsd", 0) > 0, str(result.get("costUsd")))
    check("reports when the session started", bool(result.get("startedAt")))
    check("asks for the next job and gets done", seen["jobs"] == 2)
```

Replace `main()` with:

```python
def main() -> int:
    policy_checks()
    print()
    asyncio.run(end_to_end())
    print()
    print("FAILED: " + ", ".join(failures) if failures else "all scenario-runner checks passed")
    return 1 if failures else 0
```

- [ ] **Step 2: Run it**

Run: `python scripts/checks/verify_scenario_runner.py`
Expected: every line `ok` in both parts, ending `all scenario-runner checks passed`, in about
10 seconds (the policy waits real time for quiet).

- [ ] **Step 3: Re-run the existing offline checks**

Run: `python scripts/checks/verify_composed_session.py` and `python scripts/checks/verify_booking.py`
Expected: both pass as before (nothing they cover changed).

- [ ] **Step 4: Checkpoint** (no git commit)

---

# Part C — tecace-voice-agent-dashboard

Run every command in this part from `tecace-voice-agent-dashboard/`. UI work follows the
`tecace-dashboard-ui` skill: load it before Task 16.

### Task 14: API types and calls

**Files:**
- Modify: `src/api/types.ts` (append), `src/api/backend.ts` (after `getSessionPreview`)

- [ ] **Step 1: Append the types to `src/api/types.ts`**

```ts
// ---- scenario tests (admin only; transcribe-backend src/routes/scenarios.ts) ----

export type ScenarioDefinition = {
  customerLines: string[];
  language: "ko" | "en";
  world: { fullSlots?: string[]; failTool?: string; transferAnswer?: "accepted" | "declined" | "no_answer" };
  expect: {
    tools?: { name: string; args?: Record<string, string>; times?: number }[];
    forbidden?: string[];
    final?: { bookings?: number; messages?: number };
    judge?: string[];
  };
};

export type ScenarioTest = {
  id: string;
  templateId: string | null;
  title: string;
  definition: ScenarioDefinition;
  position: number;
  updatedAt: string;
  /** False for a built-in one the business's draft no longer supports (booking switched off). */
  applicable: boolean;
};

export type ScenarioListResponse = { scenarios: ScenarioTest[]; perRunEstimateUsd: number; runnerConfigured: boolean };

export type ScenarioPassStatus = "running" | "completed" | "cancelled" | "interrupted";

export type ScenarioPassSummary = {
  id: string;
  settingsKind: "draft" | "published";
  status: ScenarioPassStatus;
  createdAt: string;
  finishedAt: string | null;
  runs: number;
  done: number;
  passed: number;
  failed: number;
  errors: number;
  costUsd: number;
};

export type ScenarioToolCall = { name: string; args: Record<string, unknown>; ok: boolean; output: Record<string, unknown>; at: string };
export type ScenarioFailure = { kind: "code" | "judge"; text: string; evidence?: string };
export type ScenarioTranscriptEntry = { id: string; speaker: "caller" | "receptionist"; text: string; startMs: number; endMs: number };

export type ScenarioRun = {
  id: string;
  position: number;
  title: string;
  scenario: ScenarioDefinition | null;
  status: "queued" | "running" | "grading" | "done";
  verdict: "pass" | "fail" | "run_error" | null;
  failures: ScenarioFailure[];
  errorReason: string | null;
  transcript: ScenarioTranscriptEntry[];
  sandbox: { calls: ScenarioToolCall[]; bookings: { start: string; name: string }[]; messages: Record<string, unknown>[] };
  durationSec: number | null;
  costUsd: number | null;
  startedAt: string | null;
};

export type ScenarioPassDetail = { pass: ScenarioPassSummary; runs: ScenarioRun[] };
```

- [ ] **Step 2: Add the calls to `src/api/backend.ts`**

Add `ScenarioDefinition, ScenarioListResponse, ScenarioPassDetail, ScenarioPassSummary, ScenarioTest`
to the existing `import type { ... } from "./types"` list, then after `getSessionPreview` add:

```ts
// ---- scenario tests (admin only) ----

export function listScenarioTests(userId: string): Promise<ScenarioListResponse> {
  return get<ScenarioListResponse>(`/business/scenarios${asUser(userId)}`);
}

/** Add (id null) or edit a scenario. A bad definition comes back as a 400 with a message to show. */
export function saveScenarioTest(
  userId: string,
  id: string | null,
  body: { title: string; definition: ScenarioDefinition },
): Promise<{ scenario: ScenarioTest }> {
  return id
    ? request<{ scenario: ScenarioTest }>("PUT", `/business/scenarios/${id}${asUser(userId)}`, { body })
    : request<{ scenario: ScenarioTest }>("POST", `/business/scenarios${asUser(userId)}`, { body });
}

export function deleteScenarioTest(userId: string, id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>("DELETE", `/business/scenarios/${id}${asUser(userId)}`);
}

export function resetScenarioTest(userId: string, id: string): Promise<{ scenario: ScenarioTest }> {
  return request<{ scenario: ScenarioTest }>("POST", `/business/scenarios/${id}/reset${asUser(userId)}`, { body: {} });
}

/** One press of Run selected: each scenario once, then it stops. */
export function startScenarioPass(
  userId: string,
  settings: "draft" | "published",
  scenarioIds: string[],
): Promise<{ passId: string }> {
  return request<{ passId: string }>("POST", `/business/scenario-passes${asUser(userId)}`, { body: { settings, scenarioIds } });
}

export async function listScenarioPasses(userId: string): Promise<ScenarioPassSummary[]> {
  return (await get<{ passes: ScenarioPassSummary[] }>(`/business/scenario-passes${asUser(userId)}`)).passes;
}

export function getScenarioPass(userId: string, id: string): Promise<ScenarioPassDetail> {
  return get<ScenarioPassDetail>(`/business/scenario-passes/${id}${asUser(userId)}`);
}

export function stopScenarioPass(userId: string, id: string): Promise<ScenarioPassDetail> {
  return request<ScenarioPassDetail>("POST", `/business/scenario-passes/${id}/stop${asUser(userId)}`, { body: {} });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Checkpoint** (no git commit)

---

### Task 15: Pure display helpers

**Files:**
- Create: `src/settings/scenarios/format.ts`
- Test: `tests/scenario-format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { ScenarioPassSummary, ScenarioRun } from "../src/api/types";
import { estimateLine, passSummaryLine, runTimeline, verdictLabel } from "../src/settings/scenarios/format";

// What the Scenario tests section says about a pass and a run. Pure, so it is tested here and the
// component only lays it out.

const pass = (over: Partial<ScenarioPassSummary> = {}): ScenarioPassSummary => ({
  id: "p",
  settingsKind: "draft",
  status: "completed",
  createdAt: "2026-10-01T21:02:00Z",
  finishedAt: "2026-10-01T21:10:00Z",
  runs: 8,
  done: 8,
  passed: 6,
  failed: 1,
  errors: 1,
  costUsd: 0.58,
  ...over,
});

describe("scenario test wording", () => {
  it("estimates before a run", () => {
    expect(estimateLine(8, 0.08)).toBe("8 scenarios · about 8 min · about $0.64");
    expect(estimateLine(1, 0.08)).toBe("1 scenario · about 1 min · about $0.08");
  });

  it("sums up a pass", () => {
    expect(passSummaryLine(pass(), "1 Oct 14:02")).toBe(
      "Draft settings · 1 Oct 14:02 · 8 runs · 6 passed · 1 failed · 1 run error · $0.58",
    );
    expect(passSummaryLine(pass({ status: "running", done: 3, errors: 0 }), "now")).toBe(
      "Draft settings · now · 8 runs · 6 passed · 1 failed · $0.58 · running 3/8",
    );
    expect(passSummaryLine(pass({ status: "cancelled", errors: 0, settingsKind: "published" }), "x")).toContain(
      "Published settings",
    );
  });

  it("labels a run by what happened to it", () => {
    expect(verdictLabel({ status: "done", verdict: "pass" }, "completed")).toBe("Passed");
    expect(verdictLabel({ status: "done", verdict: "run_error" }, "completed")).toBe("Run error");
    expect(verdictLabel({ status: "queued", verdict: null }, "running")).toBe("Queued");
    expect(verdictLabel({ status: "queued", verdict: null }, "cancelled")).toBe("Not run");
    expect(verdictLabel({ status: "running", verdict: null }, "interrupted")).toBe("Interrupted");
  });

  it("puts tool calls between the turns where they happened", () => {
    const run: Pick<ScenarioRun, "transcript" | "sandbox" | "startedAt"> = {
      startedAt: "2026-10-01T21:00:00.000Z",
      transcript: [
        { id: "t1", speaker: "receptionist", text: "Hi", startMs: 0, endMs: 900 },
        { id: "t2", speaker: "caller", text: "Book 4 PM", startMs: 2000, endMs: 3000 },
        { id: "t3", speaker: "receptionist", text: "Booked", startMs: 6000, endMs: 7000 },
      ],
      sandbox: {
        calls: [{ name: "book_appointment", args: { start: "2026-10-02T16:00:00-07:00" }, ok: true, output: { booked: true }, at: "2026-10-01T21:00:04.000Z" }],
        bookings: [],
        messages: [],
      },
    };
    const items = runTimeline(run);
    expect(items.map((i) => (i.kind === "turn" ? i.text : i.name))).toEqual(["Hi", "Book 4 PM", "book_appointment", "Booked"]);
    const tool = items[2]!;
    expect(tool.kind === "tool" && tool.summary).toBe('book_appointment(start: 2026-10-02T16:00:00-07:00) → {"booked":true}');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/scenario-format.test.ts`
Expected: FAIL — cannot resolve `../src/settings/scenarios/format`.

- [ ] **Step 3: Write `src/settings/scenarios/format.ts`**

```ts
import type { ScenarioPassStatus, ScenarioPassSummary, ScenarioRun, ScenarioToolCall } from "../../api/types";

// What the Scenario tests section says. Pure, so tests/scenario-format.test.ts can pin it.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Shown on the Run selected confirmation: one run is about a minute. */
export function estimateLine(count: number, perRunUsd: number): string {
  return `${plural(count, "scenario", "scenarios")} · about ${count} min · about $${(count * perRunUsd).toFixed(2)}`;
}

export function passSummaryLine(p: ScenarioPassSummary, when: string): string {
  const parts = [
    `${p.settingsKind === "draft" ? "Draft" : "Published"} settings`,
    when,
    plural(p.runs, "run", "runs"),
    `${p.passed} passed`,
    `${p.failed} failed`,
  ];
  if (p.errors) parts.push(plural(p.errors, "run error", "run errors"));
  parts.push(`$${p.costUsd.toFixed(2)}`);
  if (p.status === "running") parts.push(`running ${p.done}/${p.runs}`);
  if (p.status === "cancelled") parts.push("stopped");
  if (p.status === "interrupted") parts.push("interrupted");
  return parts.join(" · ");
}

export function verdictLabel(run: Pick<ScenarioRun, "status" | "verdict">, passStatus: ScenarioPassStatus): string {
  if (run.status === "done") return run.verdict === "pass" ? "Passed" : run.verdict === "fail" ? "Failed" : "Run error";
  if (run.status === "grading") return "Grading";
  if (run.status === "running") return passStatus === "interrupted" ? "Interrupted" : "Running";
  return passStatus === "running" ? "Queued" : "Not run";
}

export function toolSummary(c: ScenarioToolCall): string {
  const args = Object.entries(c.args)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
  const out = c.output.error ? `error: ${String(c.output.error)}` : JSON.stringify(c.output).slice(0, 160);
  return `${c.name}(${args}) → ${out}`;
}

export type TimelineItem =
  | { kind: "turn"; speaker: "caller" | "agent"; text: string; atMs: number }
  | { kind: "tool"; name: string; summary: string; ok: boolean; atMs: number };

/** The conversation with each tool call placed where it happened. */
export function runTimeline(run: Pick<ScenarioRun, "transcript" | "sandbox" | "startedAt">): TimelineItem[] {
  const base = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
  const turns: TimelineItem[] = run.transcript.map((t) => ({
    kind: "turn",
    speaker: t.speaker === "caller" ? "caller" : "agent",
    text: t.text,
    atMs: t.startMs,
  }));
  const tools: TimelineItem[] = run.sandbox.calls.map((c, i) => ({
    kind: "tool",
    name: c.name,
    summary: toolSummary(c),
    ok: c.ok,
    // Without a start time, tools go after the conversation, in order.
    atMs: Number.isFinite(base) ? Date.parse(c.at) - base : Number.MAX_SAFE_INTEGER - (run.sandbox.calls.length - i),
  }));
  return [...turns, ...tools].sort((a, b) => a.atMs - b.atMs);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/scenario-format.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Checkpoint** (no git commit)

---

### Task 16: The hook and the section

Load the `tecace-dashboard-ui` skill first. Keep to tokens (`text-muted-foreground`,
`text-destructive`, `text-primary`, `border`), sentence case, no hex.

**Files:**
- Create: `src/settings/scenarios/useScenarioTests.ts`, `src/settings/scenarios/ScenarioTestsSection.tsx`

- [ ] **Step 1: Write the hook**

```ts
import { useCallback, useEffect, useState } from "react";
import {
  deleteScenarioTest,
  getScenarioPass,
  listScenarioPasses,
  listScenarioTests,
  resetScenarioTest,
  saveScenarioTest,
  startScenarioPass,
  stopScenarioPass,
} from "../../api/backend";
import type { ScenarioDefinition, ScenarioListResponse, ScenarioPassDetail, ScenarioPassSummary } from "../../api/types";
import { accountErrorMessage } from "../../auth";

// The Scenario tests section's data. The open pass is re-read every 3 s while it runs, and only then:
// nothing here starts work on its own.

export function useScenarioTests(userId: string) {
  const [list, setList] = useState<ScenarioListResponse | null>(null);
  const [passes, setPasses] = useState<ScenarioPassSummary[]>([]);
  const [open, setOpen] = useState<ScenarioPassDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = useCallback((e: unknown) => setError(accountErrorMessage(e)), []);

  const reload = useCallback(async () => {
    try {
      const [l, p] = await Promise.all([listScenarioTests(userId), listScenarioPasses(userId)]);
      setList(l);
      setPasses(p);
      setError(null);
    } catch (e) {
      fail(e);
    }
  }, [userId, fail]);

  const openPass = useCallback(
    async (id: string) => {
      try {
        setOpen(await getScenarioPass(userId, id));
      } catch (e) {
        fail(e);
      }
    },
    [userId, fail],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // The latest pass opens by itself the first time there is one.
  useEffect(() => {
    if (!open && passes[0]) void openPass(passes[0].id);
  }, [passes, open, openPass]);

  const runningId = open?.pass.status === "running" ? open.pass.id : null;
  useEffect(() => {
    if (!runningId) return;
    const timer = window.setInterval(() => {
      void getScenarioPass(userId, runningId)
        .then((detail) => {
          setOpen(detail);
          if (detail.pass.status !== "running") void reload();
        })
        .catch(fail);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [runningId, userId, reload, fail]);

  async function guarded<T>(work: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      const out = await work();
      setError(null);
      return out;
    } catch (e) {
      fail(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return {
    list,
    passes,
    open,
    error,
    busy,
    openPass,
    run: (settings: "draft" | "published", ids: string[]) =>
      guarded(async () => {
        const { passId } = await startScenarioPass(userId, settings, ids);
        await reload();
        await openPass(passId);
      }),
    stop: () =>
      guarded(async () => {
        if (!open) return;
        setOpen(await stopScenarioPass(userId, open.pass.id));
        await reload();
      }),
    save: (id: string | null, title: string, definition: ScenarioDefinition) =>
      guarded(async () => {
        await saveScenarioTest(userId, id, { title, definition });
        await reload();
        return true;
      }),
    remove: (id: string) => guarded(async () => (await deleteScenarioTest(userId, id), await reload())),
    reset: (id: string) => guarded(async () => (await resetScenarioTest(userId, id), await reload())),
  };
}
```

- [ ] **Step 2: Write the section**

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ScenarioDefinition, ScenarioPassDetail, ScenarioRun, ScenarioTest } from "../../api/types";
import { Exchange } from "../../demos/components/public/Exchange";
import { SectionIntro } from "../SettingsShell";
import { estimateLine, passSummaryLine, runTimeline, verdictLabel } from "./format";
import { useScenarioTests } from "./useScenarioTests";

// Scenario tests (admin only): written test calls run once against the real receptionist, with
// sandbox tools, each graded. One press of Run selected runs each ticked scenario once and stops.
// Text only — nothing here plays audio.

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function ScenarioTestsSection({ userId }: { userId: string }) {
  const s = useScenarioTests(userId);
  const [settings, setSettings] = useState<"draft" | "published">("draft");
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ScenarioTest | "new" | null>(null);

  const scenarios = s.list?.scenarios ?? [];
  const selected = scenarios.filter((x) => x.applicable && !unticked.has(x.id));
  const running = s.open?.pass.status === "running";

  function toggle(id: string) {
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmRun() {
    if (!s.list || !selected.length) return;
    const estimate = estimateLine(selected.length, s.list.perRunEstimateUsd);
    if (window.confirm(`Run ${estimate}? Each scenario runs once, then it stops.`)) {
      void s.run(settings, selected.map((x) => x.id));
    }
  }

  return (
    <div>
      <SectionIntro>
        Each ticked scenario is spoken to the receptionist once, by a synthesized caller, with test tools — nothing
        is booked, texted or put through for real. Results show what was said, which tools ran, and why each passed
        or failed. Then it stops until you run it again.
      </SectionIntro>

      {s.error ? <p className="ta-body-2 text-destructive mb-4">{s.error}</p> : null}
      {s.list && !s.list.runnerConfigured ? (
        <p className="ta-body-2 text-muted-foreground mb-4">The scenario runner isn't set up on this server yet.</p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="ta-label-1 mr-1">Settings to test</span>
        {(["draft", "published"] as const).map((k) => (
          <Button key={k} size="sm" variant={settings === k ? "default" : "outline"} onClick={() => setSettings(k)}>
            {k === "draft" ? "Draft" : "Published"}
          </Button>
        ))}
      </div>

      <ul className="mb-4 divide-y rounded-xl border">
        {scenarios.map((x) => (
          <li key={x.id} className={`flex items-start gap-3 p-3 ${x.applicable ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              className="mt-1"
              aria-label={`Include ${x.title}`}
              checked={x.applicable && !unticked.has(x.id)}
              disabled={!x.applicable}
              onChange={() => toggle(x.id)}
            />
            <div className="min-w-0 flex-1">
              <p className="ta-label-1">
                {x.templateId ? `${x.templateId} · ` : ""}
                {x.title}
              </p>
              <p className="ta-caption-1 text-muted-foreground truncate">“{x.definition.customerLines[0]}”</p>
              {!x.applicable ? <p className="ta-caption-1 text-muted-foreground">Not available with these settings.</p> : null}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(x)}>
              Edit
            </Button>
          </li>
        ))}
      </ul>

      {editing ? (
        <ScenarioEditor
          scenario={editing === "new" ? null : editing}
          busy={s.busy}
          onCancel={() => setEditing(null)}
          onSave={async (title, definition) => {
            if (await s.save(editing === "new" ? null : editing.id, title, definition)) setEditing(null);
          }}
          onReset={editing !== "new" && editing.templateId ? () => void s.reset(editing.id).then(() => setEditing(null)) : undefined}
          onDelete={editing !== "new" && !editing.templateId ? () => void s.remove(editing.id).then(() => setEditing(null)) : undefined}
        />
      ) : null}

      <div className="mb-8 flex flex-wrap items-center gap-2">
        {running && s.open ? (
          <>
            <Button disabled>
              Running {s.open.pass.done}/{s.open.pass.runs}…
            </Button>
            <Button variant="outline" onClick={() => void s.stop()} disabled={s.busy}>
              Stop
            </Button>
          </>
        ) : (
          <Button onClick={confirmRun} disabled={s.busy || !selected.length || !s.list?.runnerConfigured}>
            Run selected{s.list && selected.length ? ` · ${estimateLine(selected.length, s.list.perRunEstimateUsd)}` : ""}
          </Button>
        )}
        <Button variant="outline" onClick={() => setEditing("new")}>
          Add scenario
        </Button>
      </div>

      {s.open ? <PassResult detail={s.open} /> : null}

      {s.passes.length > 1 ? (
        <div className="mt-8">
          <p className="ta-headline-2 mb-3">Earlier runs</p>
          <ul className="space-y-1">
            {s.passes.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`ta-body-2 text-left hover:underline ${p.id === s.open?.pass.id ? "text-primary" : ""}`}
                  onClick={() => void s.openPass(p.id)}
                >
                  {passSummaryLine(p, when(p.createdAt))}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PassResult({ detail }: { detail: ScenarioPassDetail }) {
  const [openRun, setOpenRun] = useState<string | null>(null);
  return (
    <div>
      <p className="ta-headline-2 mb-1">Result</p>
      <p className="ta-body-2 text-muted-foreground mb-3">{passSummaryLine(detail.pass, when(detail.pass.createdAt))}</p>
      <ul className="divide-y rounded-xl border">
        {detail.runs.map((run) => (
          <li key={run.id} className="p-3">
            <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpenRun(openRun === run.id ? null : run.id)}>
              <span className={`ta-label-1 w-24 ${run.verdict === "pass" ? "text-primary" : run.verdict === "fail" ? "text-destructive" : ""}`}>
                {verdictLabel(run, detail.pass.status)}
              </span>
              <span className="ta-body-2 flex-1">{run.title}</span>
              <span className="ta-caption-1 text-muted-foreground">
                {run.durationSec != null ? `${run.durationSec}s` : ""}
                {run.costUsd != null ? ` · $${run.costUsd.toFixed(2)}` : ""}
              </span>
            </button>
            {openRun === run.id ? <RunDetail run={run} /> : null}
          </li>
        ))}
      </ul>
      {detail.pass.status !== "running" ? (
        <p className="ta-caption-1 text-muted-foreground mt-3">
          Next: confirm on a real call with the Test call panel beside these settings.
        </p>
      ) : null}
    </div>
  );
}

function RunDetail({ run }: { run: ScenarioRun }) {
  return (
    <div className="mt-3 space-y-3">
      {run.errorReason ? <p className="ta-body-2 text-destructive">Run error: {run.errorReason}</p> : null}
      {run.failures.length ? (
        <ul className="ta-body-2 space-y-1">
          {run.failures.map((f, i) => (
            <li key={i} className="text-destructive">
              ✗ {f.kind === "judge" ? "Judge: " : ""}
              {f.text}
              {f.evidence ? <span className="text-muted-foreground"> — “{f.evidence}”</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex max-h-[560px] flex-col gap-3 overflow-y-auto rounded-xl border p-4" aria-label="Test call transcript">
        {runTimeline(run).map((item, i) =>
          item.kind === "turn" ? (
            <Exchange key={i} speaker={item.speaker} text={item.text} callerLabel="Test caller" />
          ) : (
            <p key={i} className={`ta-caption-1 font-mono ${item.ok ? "text-muted-foreground" : "text-destructive"}`}>
              ⚙ {item.summary}
            </p>
          ),
        )}
        {run.transcript.length === 0 && run.sandbox.calls.length === 0 ? (
          <p className="ta-caption-1 text-muted-foreground">Nothing was captured for this run.</p>
        ) : null}
      </div>
    </div>
  );
}

function ScenarioEditor(props: {
  scenario: ScenarioTest | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (title: string, definition: ScenarioDefinition) => Promise<void>;
  onReset?: () => void;
  onDelete?: () => void;
}) {
  const start = props.scenario?.definition;
  const [title, setTitle] = useState(props.scenario?.title ?? "");
  const [lines, setLines] = useState((start?.customerLines ?? []).join("\n"));
  const [language, setLanguage] = useState<"ko" | "en">(start?.language ?? "en");
  const [rules, setRules] = useState(JSON.stringify({ world: start?.world ?? {}, expect: start?.expect ?? {} }, null, 2));
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    let parsed: { world?: ScenarioDefinition["world"]; expect?: ScenarioDefinition["expect"] };
    try {
      parsed = JSON.parse(rules);
    } catch {
      setProblem("Test conditions and expectations must be valid JSON.");
      return;
    }
    setProblem(null);
    await props.onSave(title, {
      customerLines: lines.split("\n").map((l) => l.trim()).filter(Boolean),
      language,
      world: parsed.world ?? {},
      expect: parsed.expect ?? {},
    });
  }

  return (
    <div className="mb-6 space-y-3 rounded-xl border p-4">
      <p className="ta-label-1">{props.scenario ? "Edit scenario" : "New scenario"}</p>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" />
      <div>
        <p className="ta-caption-1 text-muted-foreground mb-1">
          What the caller says — one line per turn, up to three. Times: {"{slotA.spoken}"}, {"{slotB.clock}"}.
        </p>
        <Textarea rows={3} value={lines} onChange={(e) => setLines(e.target.value)} aria-label="Caller lines" />
      </div>
      <label className="ta-caption-1 flex items-center gap-2">
        Language
        <select className="rounded-md border px-2 py-1" value={language} onChange={(e) => setLanguage(e.target.value as "ko" | "en")}>
          <option value="en">English</option>
          <option value="ko">Korean</option>
        </select>
      </label>
      <div>
        <p className="ta-caption-1 text-muted-foreground mb-1">Test conditions and expectations (JSON). Never shown to the receptionist.</p>
        <Textarea rows={10} className="font-mono" value={rules} onChange={(e) => setRules(e.target.value)} aria-label="Conditions and expectations" />
      </div>
      {problem ? <p className="ta-body-2 text-destructive">{problem}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={props.busy}>
          Save
        </Button>
        <Button variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        {props.onReset ? (
          <Button variant="ghost" onClick={props.onReset} disabled={props.busy}>
            Reset to template
          </Button>
        ) : null}
        {props.onDelete ? (
          <Button variant="ghost" className="text-destructive" onClick={props.onDelete} disabled={props.busy}>
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `Exchange`'s `speaker` prop type is narrower than `"caller" | "agent"`,
read `src/demos/components/public/Exchange.tsx`'s `ExchangeProps` and match it (CallConversation
passes `"caller"`/`"agent"`).

- [ ] **Step 4: Checkpoint** (no git commit)

---

### Task 17: Register the section (admin only)

**Files:**
- Modify: `src/routing.ts` (`SECTION_IDS`), `src/settings/SettingsShell.tsx` (`SECTION_META`, `SECTION_GROUPS`, lucide import), `src/settings/BusinessSettings.tsx` (sections list)
- Test: `tests/routing.test.ts`

- [ ] **Step 1: Add the failing routing assertion**

In `tests/routing.test.ts`, next to `expect(SECTION_IDS).toContain("guided-setup");` add:

```ts
    expect(SECTION_IDS).toContain("scenario-tests");
```

Run: `npx vitest run tests/routing.test.ts`
Expected: FAIL on that line.

- [ ] **Step 2: Register it**

`src/routing.ts` — in `SECTION_IDS`, after `"test",` add `"scenario-tests",`.

`src/settings/SettingsShell.tsx` — add `ListChecks` to the existing `lucide-react` import; in
`SECTION_META` after the `test:` line add:

```ts
  "scenario-tests": { label: "Scenario tests", icon: ListChecks },
```

and change the Tuning group to:

```ts
  { label: "Tuning", ids: ["custom-training", "test", "scenario-tests"] },
```

`src/settings/BusinessSettings.tsx` — add the import:

```ts
import { ScenarioTestsSection } from "./scenarios/ScenarioTestsSection";
```

and directly after `{ id: "test", render: () => <BusinessTestSection test={test} /> },` add:

```tsx
    // Admin only: the menu only lists sections that are in this array (SettingsShell filters by it).
    ...(props.isAdmin && userId
      ? [{ id: "scenario-tests" as const, render: () => <ScenarioTestsSection userId={userId} /> }]
      : []),
```

- [ ] **Step 3: Run the dashboard tests and build**

Run: `npm test` then `npm run build`
Expected: all Vitest files pass (including `routing`, `scenario-format`, `styles`, `changelog`);
the build succeeds.

- [ ] **Step 4: Regression scripts (one at a time)**

Run, one after another, from `tecace-voice-agent-dashboard/`:
`python scripts/regression/compare.py` (must print `IDENTICAL`), then
`python scripts/regression/tw_probe.py`, then `python scripts/regression/business_tabs.py`.
Expected: each passes. `business_tabs.py` signs in as a customer, so the new section must not
appear there — if it walks every section id and fails on `scenario-tests`, that is a real bug
(the admin gate is missing), not a test to change.

- [ ] **Step 5: Checkpoint** (no git commit)

---

### Task 18: Changelog

**Files:**
- Modify: `src/changelog.ts` (and `package.json` + `package-lock.json` only if a new release is added)

- [ ] **Step 1: Add the line**

Open `src/changelog.ts`. If the top release's `date` is today, add this item to its `items`;
otherwise add a new release on top with the next `0.0.x` version, today's date and the title
`"Scenario tests"`, and set `version` in `package.json` and the root of `package-lock.json` to it.

```ts
      {
        kind: "new",
        text: "Scenario tests: run written test calls against a business's receptionist, once per press, and see each conversation, the tools it used, and why it passed or failed.",
        admin: true,
      },
```

- [ ] **Step 2: Run the changelog test**

Run: `npx vitest run tests/changelog.test.ts`
Expected: pass.

- [ ] **Step 3: Checkpoint** (no git commit)

---

# Part D — Team sync and the first real run

### Task 19: HISTORY.md

**Files:**
- Modify: `HISTORY.md` (top, newest first)

- [ ] **Step 1: Add the entry at the top** (use the real time and your name)

```markdown
## 2026-10-01 HH:MM · <name> · scenario tests (transcribe-backend, openai-agent-app, dashboard)
- New admin-only Scenario tests (Business settings → Tuning): one press runs each ticked scenario once against the real GPT-Live receptionist with sandbox tools, grades it (code checks + `gpt-5.6-luna` judge) and stops. Spec/plan: `docs/superpowers/{specs,plans}/2026-10-01-scenario-tests*`.
- transcribe-backend: tables `scenario_tests`, `scenario_passes`, `scenario_runs` (self-migrating); routes `/business/scenarios*`, `/business/scenario-passes*` (admin) and `/internal/scenario-*` (runner, `x-runner-key`); `runDemoAppointmentTool` takes optional `busy`.
- openai-agent-app: new Compose service `scenarios` (port 5070, Traefik `PathPrefix(/scenarios)`), `scripts/run_scenario_runner.py`, check `scripts/checks/verify_scenario_runner.py`.
- ⚠ Env: transcribe-backend `SCENARIO_RUNNER_URL`, `SCENARIO_RUNNER_KEY` (+ optional `SCENARIO_JUDGE_MODEL`); openai-agent-app `SCENARIO_RUNNER_KEY` (same value), optional `SCENARIO_RUNNER_ENABLED`, `SCENARIO_TTS_MODEL`, `SCENARIO_CUSTOMER_VOICE`. Each run is a real, billable GPT-Live + TTS + judge call.
```

- [ ] **Step 2: Checkpoint** (no git commit)

---

### Task 20: Deploy and one real pass

This step spends real money (about $0.08 per scenario). Do it with the user, not alone.

- [ ] **Step 1: Configure**

Pick a random key (e.g. `openssl rand -hex 24`). Set it as `SCENARIO_RUNNER_KEY` in the VPS
`openai-agent-app/.env` and in transcribe-backend's deployment env, and set transcribe-backend's
`SCENARIO_RUNNER_URL=https://31-97-214-59.sslip.io/scenarios`.

- [ ] **Step 2: Deploy**

On the VPS in `openai-agent-app/`: `docker compose up -d --build` (never systemctl).
Check: `curl -s https://31-97-214-59.sslip.io/scenarios/health` →
`{"ok":true,"enabled":true,"active":null}`. Redeploy transcribe-backend and the dashboard.

- [ ] **Step 3: Run one scenario**

As an admin, open a test business → Business settings → Tuning → Scenario tests. Untick all but
**S10 Take a message**, press **Run selected**, confirm. Expected within ~2 minutes: one row with a
verdict, a transcript with both sides, a `take_message` tool line, a duration and a cost, and the
button back to **Run selected** — nothing further runs.

- [ ] **Step 4: Run the booking set once**

If the business has booking on, tick S04–S08 and run once. Read each failure line; a failure here
is information about the receptionist or a template, not a bug in the runner, unless it is a
**Run error**.

- [ ] **Step 5: Report back to the user** with the pass summary line and any run errors.
```
