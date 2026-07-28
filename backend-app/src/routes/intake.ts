import { Elysia, t } from "elysia";
import {
  countIntakes,
  getIntake,
  insertIntake,
  listIntakes,
} from "../db/intakes";

// Intake controller: create + read the callback intakes the voice agent / dashboard
// collect, backed by Postgres.
// Elysia best practice: one `Elysia` instance per controller, method-chained so the
// `body`/`query`/`params` schemas stay type-inferred end to end.
export const intake = new Elysia()
  // Create an intake.
  .post(
    "/intake",
    async ({ body, status }) => {
      const record = await insertIntake(body);
      return status(201, { status: "created", intake: record });
    },
    {
      body: t.Object({
        language: t.String({ minLength: 1 }),
        name: t.String({ minLength: 1 }),
        email: t.String({ format: "email" }),
        phoneNumber: t.String({ minLength: 1 }),
        purpose: t.String({ minLength: 1 }),
        // ISO 8601 date-time string, e.g. "2026-08-01T15:30:00Z".
        dateTime: t.String({ format: "date-time" }),
      }),
    },
  )
  // List intakes (newest first) for the dashboard, with filtering, paging + total count.
  .get(
    "/intake",
    async ({ query }) => {
      const filters = {
        language: query.language,
        q: query.q,
        scheduledFrom: query.scheduledFrom,
        scheduledTo: query.scheduledTo,
      };
      const [intakes, total] = await Promise.all([
        listIntakes(query.limit, query.offset, filters),
        countIntakes(filters),
      ]);
      return { total, limit: query.limit, offset: query.offset, intakes };
    },
    {
      query: t.Object({
        limit: t.Integer({ minimum: 1, maximum: 200, default: 50 }),
        offset: t.Integer({ minimum: 0, default: 0 }),
        // Filters (all optional, combined with AND).
        language: t.Optional(t.String({ minLength: 1 })),
        q: t.Optional(t.String({ minLength: 1 })),
        scheduledFrom: t.Optional(t.String({ format: "date-time" })),
        scheduledTo: t.Optional(t.String({ format: "date-time" })),
      }),
    },
  )
  // Fetch a single intake by id.
  .get(
    "/intake/:id",
    async ({ params, status }) => {
      const record = await getIntake(params.id);
      if (!record) return status(404, { status: "not_found" });
      return { intake: record };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    },
  );
