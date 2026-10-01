import { timingSafeEqual } from "node:crypto";
import { Elysia, t } from "elysia";
import { authenticateAdmin } from "../auth/guard.js";
import { readCallSettings, type CallSettings } from "../business/callSettings.js";
import { env } from "../config/env.js";
import { findProfile } from "../db/businessProfiles.js";
import { findCallSettings } from "../db/callSettings.js";
import {
  activePassId,
  claimNextRun,
  claimReport,
  createPass,
  deleteScenario,
  failStuckRuns,
  findRun,
  findRunnerPass,
  findScenario,
  finishPass,
  finishRun,
  getPass,
  insertScenario,
  listPasses,
  listScenarios,
  recentRunCosts,
  saveSandbox,
  STALE_PASS_MS,
  touchPass,
  updateScenario,
} from "../db/scenarios.js";
import type { TranscriptEntry } from "../demo/types.js";
import { runEstimates } from "../scenarios/estimate.js";
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

export const RUN_LIMITS = { maxSeconds: 90, maxTurns: 8 } as const;

/** The sandbox stands in for the calendar, so the composer is told one is connected. */
const SANDBOX_BOOKING = { providerName: "the business calendar", kind: "calendar" as const };

const userIdQuery = t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) });
const err = (error: string, message: string) => ({ error, message });
const NO_BUSINESS = err("no_business", "Add the business information first — there's nothing to test yet.");

type Denied = { denied: 400 | 401 | 403; body: Record<string, string> };

async function admin(authorization: string | undefined, userId: string | undefined): Promise<{ adminId: string; target: string } | Denied> {
  const auth = await authenticateAdmin(authorization, "Scenario tests are for TecAce admins.");
  if ("denied" in auth) return auth;
  const target = userId?.trim();
  if (!target || !UUID.test(target)) return { denied: 400, body: err("pick_business", "Pick a business first.")  };
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
  | { message: string } {
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!title) return { message: "Give the scenario a title." };
  try {
    return { title, definition: readDefinition(body.definition) };
  } catch (error) {
    if (error instanceof DefinitionError) return { message: error.message };
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

const runnerAllowed = (headers: Record<string, string | undefined>) => {
  const key = Buffer.from(env.scenarioRunnerKey);
  const given = Buffer.from(headers["x-runner-key"] ?? "");
  return key.length > 0 && key.length === given.length && timingSafeEqual(key, given);
};

const ALREADY_RUNNING = err("pass_running", "A scenario test is already running. Wait for it to finish, or stop it.");

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
      // Shown before Run selected: what these scenarios really cost on their recent runs.
      const estimates = runEstimates(await recentRunCosts(), list.map((s) => s.id));
      return {
        scenarios: list.map((s) => ({
          ...s,
          applicable: s.templateId ? (templateById(s.templateId)?.applies(ctx) ?? false) : true,
          estimate: estimates.byScenario[s.id]!,
        })),
        perRunEstimateUsd: estimates.overall.costUsd,
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
      if ("message" in parsed) return status(400, err("invalid_scenario", parsed.message));
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
      if ("message" in parsed) return status(400, err("invalid_scenario", parsed.message));
      const scenario = UUID.test(params.id) ? await updateScenario(params.id, who.target, parsed) : null;
      if (!scenario) return status(404, err("not_found", "Scenario not found."));
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
      if (!found) return status(404, err("not_found", "Scenario not found."));
      if (found.templateId) return status(409, err("built_in", "Built-in scenarios can't be deleted. Untick it to leave it out of a run."));
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
      if (!found) return status(404, err("not_found", "Scenario not found."));
      const tpl = found.templateId ? templateById(found.templateId) : undefined;
      if (!tpl) return status(409, err("not_built_in", "Only built-in scenarios can be reset."));
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
        return status(503, err("runner_not_configured", "The scenario runner isn't set up on this server (SCENARIO_RUNNER_URL, SCENARIO_RUNNER_KEY)."));
      }
      if (await activePassId()) {
        return status(409, ALREADY_RUNNING);
      }
      const kind = body.settings === "published" ? "published" : "draft";
      const ids = Array.isArray(body.scenarioIds)
        ? body.scenarioIds.filter((x): x is string => typeof x === "string").slice(0, 60)
        : [];

      const { record, stored } = await business(who.target);
      if (!record) return status(409, NO_BUSINESS);
      const raw = kind === "draft" ? stored.draft : stored.published;
      if (!raw) return status(409, err("nothing_published", "Nothing has been published yet. Test the draft instead."));
      const callSettings: CallSettings = readCallSettings(raw);
      const chosen = (await listScenarios(who.target)).filter((s) => ids.includes(s.id));
      if (!chosen.length) return status(400, err("nothing_selected", "Tick at least one scenario."));

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
      // Applicability follows the settings being tested, not the draft.
      const ctx = contextFor(record, raw);
      const runs = chosen.map((s) => {
        const tpl = s.templateId ? templateById(s.templateId) : undefined;
        if (tpl && !tpl.applies(ctx)) {
          return { scenarioId: s.id, title: s.title, definition: null, error: `Not available with the ${kind} settings.` };
        }
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
      if (!passId) return status(409, ALREADY_RUNNING);
      try {
        await notifyRunner(passId);
      } catch (error) {
        await finishPass(passId, "cancelled");
        return status(
          503,
          err("runner_unreachable", `The scenario runner could not be reached: ${error instanceof Error ? error.message : String(error)}`),
        );
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
      if (!found) return status(404, err("not_found", "Test run not found."));
      await failStuckRuns(params.id);
      return (await getPass(params.id, who.target)) ?? found;
    },
    { query: userIdQuery, params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )
  .post(
    "/business/scenario-passes/:id/stop",
    async ({ headers, query, params, status }) => {
      const who = await admin(headers.authorization, query.userId);
      if ("denied" in who) return status(who.denied, who.body);
      const found = UUID.test(params.id) ? await getPass(params.id, who.target) : null;
      if (!found) return status(404, err("not_found", "Test run not found."));
      // The scenario in progress finishes (at most 90 s); nothing after it starts.
      await finishPass(params.id, "cancelled");
      await failStuckRuns(params.id);
      return (await getPass(params.id, who.target))!;
    },
    { query: userIdQuery, params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )

  // ---------------------------------------------------------------- runner
  .get(
    "/internal/scenario-passes/:id/next",
    async ({ headers, params, status }) => {
      if (!runnerAllowed(headers)) return status(401, err("unauthorized", "Missing or invalid runner key."));
      const pass = UUID.test(params.id) ? await findRunnerPass(params.id) : null;
      if (!pass) return status(404, err("not_found", "No such pass."));
      if (pass.status !== "running") return { done: true };
      // Nobody has touched it for too long: it shows as interrupted, so nothing more starts.
      if (Date.now() - Date.parse(pass.updatedAt) > STALE_PASS_MS) return { done: true };
      await failStuckRuns(pass.id);
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
    // The runner forwards tool calls one at a time (sessions use parallel_tool_calls: false and the
    // runner awaits each call), so the read-modify-write of the sandbox state below is safe.
    "/internal/scenario-runs/:id/tool",
    async ({ headers, params, body, status }) => {
      if (!runnerAllowed(headers)) return status(401, err("unauthorized", "Missing or invalid runner key."));
      const run = UUID.test(params.id) ? await findRun(params.id) : null;
      if (!run || run.status !== "running" || !run.scenario) return status(409, err("run_not_in_progress", "This run isn't in progress."));
      const pass = (await findRunnerPass(run.passId))!;
      const name = typeof body.name === "string" ? body.name.slice(0, 60) : "";
      const args =
        body.args && typeof body.args === "object" && !Array.isArray(body.args) ? (body.args as Record<string, unknown>) : {};
      const { output, state } = runSandboxTool(name, args, run.sandbox, {
        settings: pass.snapshot.callSettings,
        profileHours: pass.snapshot.profile.hours,
        timeZone: pass.timeZone,
        world: run.scenario.world,
        // One clock per pass: the sandbox's "now" starts at the moment the placeholders were resolved.
        now: Date.parse(pass.createdAt) + (Date.now() - Date.parse(run.startedAt ?? pass.createdAt)),
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
      if (!runnerAllowed(headers)) return status(401, err("unauthorized", "Missing or invalid runner key."));
      const run = UUID.test(params.id) ? await findRun(params.id) : null;
      if (!run || run.status !== "running" || !run.scenario) return status(409, err("run_not_in_progress", "This run isn't in progress."));
      if (!(await claimReport(run.id))) return status(409, err("already_reported", "This run was already reported."));
      const pass = (await findRunnerPass(run.passId))!;
      const result: RunResult = {
        status: body.status === "completed" ? "completed" : "error",
        errorReason: typeof body.errorReason === "string" ? body.errorReason.slice(0, 300) : undefined,
        transcript: Array.isArray(body.transcript) ? body.transcript.slice(0, 200).filter(isEntry).map((e) => ({ ...e, text: e.text.slice(0, 2000) })) : [],
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
      const saved = await finishRun(run.id, {
        verdict: graded.verdict,
        failures: graded.failures,
        errorReason: graded.errorReason,
        transcript: result.transcript,
        durationSec: result.durationSec,
        costUsd: Math.round((result.costUsd + graded.judgeCostUsd) * 10_000) / 10_000,
        startedAt,
      });
      if (!saved) return status(409, err("run_closed", "This run was closed before its result arrived."));
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
