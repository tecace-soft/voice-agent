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
  if (response.status === 409) throw new Error("it is still finishing the previous test — try again in a minute");
  if (response.status === 503) throw new Error("it is switched off (SCENARIO_RUNNER_ENABLED)");
  if (response.status !== 202) throw new Error(`it answered ${response.status}`);
}
