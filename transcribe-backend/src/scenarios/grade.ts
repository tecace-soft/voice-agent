import { codeChecks } from "./checks.js";
import { STANDING_ITEMS, judgeRun } from "./judge.js";
import type { Failure, RunResult, SandboxState, ScenarioDefinition, Verdict } from "./types.js";

// A run's verdict: pass only when every code check and every judge item passes. A run that never
// really tested the receptionist — the runner failed, a limit was hit, the judge failed — is a run
// error, kept apart so it never counts against the receptionist.

/** e.g. "Thursday, October 1, 2026, 2:05 PM (America/Los_Angeles)". */
function callTime(startedAt: string | undefined, timeZone: string): string {
  const date = startedAt ? new Date(startedAt) : new Date();
  const when = Number.isNaN(date.getTime()) ? new Date() : date;
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(when);
  return `${text} (${timeZone})`;
}

export async function gradeRun(input: {
  result: RunResult;
  definition: ScenarioDefinition;
  state: SandboxState;
  timeZone: string;
  facts: string;
  startedAt?: string;
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
    callTime: callTime(input.startedAt, input.timeZone),
    facts: input.facts,
    items: [...STANDING_ITEMS, ...(definition.expect.judge ?? [])],
  });
  if (!judged.ok) {
    return {
      verdict: "run_error",
      failures: code,
      errorReason: `Grading failed: ${judged.error}`,
      judgeCostUsd: judged.costUsd ?? 0,
    };
  }
  const failures = [...code, ...judged.failures];
  return { verdict: failures.length ? "fail" : "pass", failures, errorReason: null, judgeCostUsd: judged.costUsd };
}
