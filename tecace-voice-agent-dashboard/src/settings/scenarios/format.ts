import type {
  ScenarioDefinition,
  ScenarioPassStatus,
  ScenarioPassSummary,
  ScenarioRun,
  ScenarioRunEstimate,
  ScenarioToolCall,
} from "../../api/types";

// What the Scenario tests section says. Pure, so tests/scenario-format.test.ts can pin it.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Shown on Run selected and its confirmation: the ticked scenarios' estimates added up. Each comes
 * from what that scenario's recent runs really cost (the backend's `estimate`), so it tracks the
 * real bill rather than a fixed guess.
 */
export function estimateLine(estimates: ScenarioRunEstimate[]): string {
  const usd = estimates.reduce((sum, e) => sum + e.costUsd, 0);
  const minutes = Math.max(1, Math.round(estimates.reduce((sum, e) => sum + e.durationSec, 0) / 60));
  return `${plural(estimates.length, "scenario", "scenarios")} · about ${minutes} min · about $${usd.toFixed(2)}`;
}

/** Under a scenario: what one run of it costs, and what that's based on. */
export function runEstimateLine(e: ScenarioRunEstimate): string {
  if (!e.basedOnRuns) return `About $${e.costUsd.toFixed(2)} per run (not run yet)`;
  const from = e.basedOnRuns === 1 ? "its last run" : `its last ${e.basedOnRuns} runs`;
  return `About $${e.costUsd.toFixed(2)} and ${e.durationSec} s per run, from ${from}`;
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

/**
 * What the runner is doing right now, for the panel shown while a pass runs. `runs` is null when
 * the running pass isn't the one open on screen: then only the count is known.
 */
export function runnerActivity(
  pass: Pick<ScenarioPassSummary, "done" | "runs">,
  runs: Pick<ScenarioRun, "status" | "title">[] | null,
): { line: string; percent: number } {
  const percent = pass.runs ? Math.round((pass.done / pass.runs) * 100) : 0;
  if (!runs) return { line: `${pass.done} of ${plural(pass.runs, "scenario", "scenarios")} done`, percent };
  const index = runs.findIndex((r) => r.status === "running" || r.status === "grading");
  if (index < 0) return { line: "Starting the next scenario…", percent };
  const current = runs[index]!;
  const doing = current.status === "grading" ? "grading the call" : "on the call";
  return { line: `Scenario ${index + 1} of ${runs.length} · ${current.title} · ${doing}`, percent };
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

/** One line on a scenario row saying what it checks: tools, forbidden tools, final counts, judge checks. */
export function expectationLine(def: ScenarioDefinition): string {
  const e = def.expect ?? {};
  const parts: string[] = [];
  for (const t of e.tools ?? []) parts.push(t.times && t.times > 1 ? `${t.name} ×${t.times}` : t.name);
  if (e.forbidden?.length) parts.push(`never: ${e.forbidden.join(", ")}`);
  if (e.final?.bookings != null) parts.push(plural(e.final.bookings, "booking", "bookings"));
  if (e.final?.messages != null) parts.push(plural(e.final.messages, "message", "messages"));
  if (e.judge?.length) parts.push(plural(e.judge.length, "judge check", "judge checks"));
  return parts.length ? parts.join(" · ") : "Judge checks only";
}
