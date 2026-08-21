import { Elysia, t } from "elysia";
import { env } from "../config/env.js";
import { getVoicemailStats, insertVoicemailRun } from "../db/voicemailRuns.js";

// Transcribe controller: the transcribe-app reports each run here (write, secret-guarded), and the
// transcribe dashboard reads the aggregate (open, like the other dashboard reads).
export const transcribe = new Elysia({ prefix: "/transcribe" })
  // Shared-secret guard for the WRITE only. When TRANSCRIBE_INGEST_KEY is set, POSTs require a
  // matching header; GET /stats stays open for the dashboard. Unset = open (dev).
  .onBeforeHandle(({ request, headers, status }) => {
    if (request.method !== "POST") return;
    if (env.transcribeIngestKey && headers["x-transcribe-key"] !== env.transcribeIngestKey) {
      return status(401, { error: "unauthorized" });
    }
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
  .get("/stats", async () => getVoicemailStats());
