import type { CallSettings } from "../business/callSettings.js";
import type { BusinessProfile, TranscriptEntry } from "../demo/types.js";
import type { FunctionTool } from "../session/compose.js";
import type { Failure, SandboxState, Scenario, ScenarioDefinition, Verdict } from "../scenarios/types.js";
import { sql } from "./client.js";
import { jsonb } from "./jsonb.js";

// Scenario tests: the scenarios, the passes (one press of Run selected) and their runs.

/** A running pass with no request from the runner for this long is shown as interrupted. */
export const STALE_PASS_MS = 5 * 60 * 1000;

/**
 * A started run unreported for this long is closed as an error: TTS up to 3 x 30 s, the call limit,
 * the runner slack, posting the result (judge), and a margin.
 */
export const STUCK_RUN_SECONDS = 3 * 30 + 90 + 30 + 90 + 30;

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
  createdAt: string;
  updatedAt: string;
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
}): Promise<string | null> {
  return (await sql.begin(async (tx) => {
    // Serialise concurrent starts, then re-check: two quick presses must not make two passes.
    await tx`SELECT pg_advisory_xact_lock(hashtext('scenario_passes.active'))`;
    const [active] = await tx`
      SELECT id FROM scenario_passes
      WHERE status = 'running' AND updated_at > now() - ${STALE_PASS_MS} * interval '1 millisecond'
      LIMIT 1
    `;
    if (active) return null;
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
  })) as string | null;
}

/** The pass the runner is working on, if any (stale ones don't count). */
export async function activePassId(): Promise<string | null> {
  const [row] = await sql`
    SELECT id FROM scenario_passes
    WHERE status = 'running' AND updated_at > now() - ${STALE_PASS_MS} * interval '1 millisecond'
    ORDER BY created_at DESC LIMIT 1
  `;
  return (row as { id: string } | undefined)?.id ?? null;
}

export async function findRunnerPass(id: string): Promise<RunnerPass | null> {
  const [row] = await sql`
    SELECT id, user_id AS "userId", status, created_at AS "createdAt", updated_at AS "updatedAt", time_zone AS "timeZone",
           settings_snapshot AS snapshot, session_snapshot AS session
    FROM scenario_passes WHERE id = ${id}
  `;
  return row ? {
        ...(row as unknown as RunnerPass),
        createdAt: iso((row as { createdAt: unknown }).createdAt)!,
        updatedAt: iso((row as { updatedAt: unknown }).updatedAt)!,
      } : null;
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
      SELECT id FROM scenario_runs
      WHERE pass_id = ${passId} AND status = 'queued'
        AND EXISTS (SELECT 1 FROM scenario_passes WHERE id = ${passId} AND status = 'running')
      ORDER BY position LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING ${RUN_COLUMNS}
  `;
  return row ? toRun(row as Record<string, unknown>) : null;
}

/** Runs the runner started but never reported (a crash mid-run) are closed as errors. */
export async function failStuckRuns(passId: string): Promise<void> {
  await sql`
    UPDATE scenario_runs SET
      status = 'done', verdict = 'run_error', error_reason = 'The runner never reported this run.', finished_at = now()
    WHERE pass_id = ${passId} AND status IN ('running','grading') AND started_at < now() - ${STUCK_RUN_SECONDS} * interval '1 second'
  `;
}

/** Take the right to report a run's result, so a repeated report can't be graded (and judged) twice. */
export async function claimReport(id: string): Promise<boolean> {
  const rows = await sql`UPDATE scenario_runs SET status = 'grading' WHERE id = ${id} AND status = 'running' RETURNING id`;
  return (rows as unknown[]).length > 0;
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
    WHERE id = ${id} AND status = 'grading'
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
