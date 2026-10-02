import { describe, expect, it } from "bun:test";

// The estimate shown before Run selected, from what recent runs really cost.
//
// Run: bun test src/scenarios/estimate.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { DEFAULT_RUN_ESTIMATE, runEstimates } = await import("./estimate.js");

describe("runEstimates", () => {
  it("falls back to the default with no history", () => {
    const out = runEstimates([], ["a"]);
    expect(out.overall).toEqual(DEFAULT_RUN_ESTIMATE);
    expect(out.byScenario.a).toEqual(DEFAULT_RUN_ESTIMATE);
  });

  it("uses a scenario's own recent runs, and the overall average for one never run", () => {
    const recent = [
      { scenarioId: "a", costUsd: 0.12, durationSec: 50 },
      { scenarioId: "a", costUsd: 0.1, durationSec: 40 },
      { scenarioId: "b", costUsd: 0.06, durationSec: null },
    ];
    const out = runEstimates(recent, ["a", "c"]);
    expect(out.byScenario.a).toEqual({ costUsd: 0.11, durationSec: 45, basedOnRuns: 2 });
    expect(out.overall.basedOnRuns).toBe(3);
    expect(out.overall.costUsd).toBeCloseTo(0.0933, 4);
    expect(out.overall.durationSec).toBe(45);
    expect(out.byScenario.c).toEqual({ ...out.overall, basedOnRuns: 0 });
  });

  it("only looks at a scenario's five most recent runs", () => {
    const recent = [
      ...Array.from({ length: 5 }, () => ({ scenarioId: "a", costUsd: 0.2, durationSec: 60 })),
      { scenarioId: "a", costUsd: 5, durationSec: 600 },
    ];
    expect(runEstimates(recent, ["a"]).byScenario.a!.costUsd).toBeCloseTo(0.2, 6);
  });
});
