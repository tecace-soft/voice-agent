import { Elysia, t } from "elysia";
import { authenticate, UNAUTHORIZED } from "../auth/guard.js";
import { env } from "../config/env.js";
import { getTranscribeAnalytics } from "../db/analytics.js";
import { getVoicemailStats, insertVoicemailRun } from "../db/voicemailRuns.js";

// Transcribe controller: the transcribe-app reports each run here (write, secret-guarded), and a
// signed-in dashboard user reads the aggregate.
export const transcribe = new Elysia({ prefix: "/transcribe" })
  // Two different callers, two different credentials:
  //   POST /transcribe/runs  — the transcribe-app, with the shared `x-transcribe-key` secret.
  //   GET  /transcribe/stats — a person on the dashboard, with their session token.
  .onBeforeHandle(async ({ request, headers, status }) => {
    if (request.method === "OPTIONS") return; // never 401 a CORS preflight

    if (request.method === "POST") {
      // Unset TRANSCRIBE_INGEST_KEY = open (dev only).
      if (env.transcribeIngestKey && headers["x-transcribe-key"] !== env.transcribeIngestKey) {
        return status(401, { error: "unauthorized" });
      }
      return;
    }

    if (!(await authenticate(headers.authorization))) return status(401, UNAUTHORIZED);
  })

  // Report one finished transcribe-app pass (the RunSummary counts).
  .post(
    "/runs",
    async ({ body, status }) => {
      const record = await insertVoicemailRun(body);
      return status(201, { status: "recorded", run: record });
    },
    {
      body: t.Object({
        voicemails: t.Integer({ minimum: 0 }),
        processed: t.Integer({ minimum: 0 }),
        skipped: t.Integer({ minimum: 0 }),
        failed: t.Integer({ minimum: 0 }),
      }),
    },
  )

  // Aggregate stats for the dashboard.
  .get("/stats", async () => getVoicemailStats())

  // Deeper analysis for the dashboard's Analytics view — aggregated over the whole history rather
  // than the 60-run window /stats ships. Same guard as /stats: any signed-in user.
  .get("/analytics", async () => getTranscribeAnalytics());
