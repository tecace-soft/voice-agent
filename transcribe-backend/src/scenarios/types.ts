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
  /** False when the tool returned an error (a `failTool`, an unknown tool, bad arguments) — not when it answered "no". */
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
  if (w.transferAnswer !== undefined && w.transferAnswer !== null) {
    if (!ANSWERS.includes(w.transferAnswer as TransferAnswer)) {
      throw new DefinitionError("world.transferAnswer must be accepted, declined or no_answer.");
    }
    world.transferAnswer = w.transferAnswer as TransferAnswer;
  }

  const e = obj(r.expect);
  const expect: ScenarioDefinition["expect"] = {};
  if (Array.isArray(e.tools) && e.tools.length) {
    expect.tools = e.tools.slice(0, 10).map((raw) => {
      const t = obj(raw);
      const name = tool(str(t.name, 40), "expect.tools");
      const args = Object.fromEntries(
        Object.entries(obj(t.args))
          .map(([k, v]) => [k.trim().slice(0, 40), str(v, 200)] as const)
          .filter(([k, v]) => k && v),
      );
      const times = count(t.times);
      if (t.times !== undefined && t.times !== null && times === undefined) {
        throw new DefinitionError("expect.tools: times must be a whole number from 0 to 20.");
      }
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
