// What a scenario run is expected to cost and take, shown before Run selected.
//
// Taken from what recent runs really cost (each run records its measured voice minutes, backend
// tokens, TTS and judge), not from a fixed guess: a scenario's own last few runs when it has any,
// otherwise the average of recent runs across all scenarios, otherwise a default.

export type MeasuredRun = { scenarioId: string | null; costUsd: number; durationSec: number | null };
export type RunEstimate = { costUsd: number; durationSec: number; basedOnRuns: number };

/** Before any run has been measured. */
export const DEFAULT_RUN_ESTIMATE: RunEstimate = { costUsd: 0.08, durationSec: 60, basedOnRuns: 0 };

const PER_SCENARIO = 5;
const OVERALL = 50;

function average(runs: MeasuredRun[]): RunEstimate {
  const timed = runs.filter((r) => r.durationSec !== null);
  return {
    costUsd: Math.round((runs.reduce((sum, r) => sum + r.costUsd, 0) / runs.length) * 10_000) / 10_000,
    durationSec: timed.length
      ? Math.round(timed.reduce((sum, r) => sum + (r.durationSec ?? 0), 0) / timed.length)
      : DEFAULT_RUN_ESTIMATE.durationSec,
    basedOnRuns: runs.length,
  };
}

/** `recent` is newest first. */
export function runEstimates(
  recent: MeasuredRun[],
  scenarioIds: string[],
): { overall: RunEstimate; byScenario: Record<string, RunEstimate> } {
  const latest = recent.slice(0, OVERALL);
  const overall = latest.length ? average(latest) : DEFAULT_RUN_ESTIMATE;
  const byScenario: Record<string, RunEstimate> = {};
  for (const id of scenarioIds) {
    const own = recent.filter((r) => r.scenarioId === id).slice(0, PER_SCENARIO);
    // Never run: the overall average, marked as not its own (basedOnRuns 0).
    byScenario[id] = own.length ? average(own) : { ...overall, basedOnRuns: 0 };
  }
  return { overall, byScenario };
}
