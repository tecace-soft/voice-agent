import { Elysia, t } from "elysia";
import {
  countIntakes,
  getIntake,
  insertIntake,
  listIntakes,
  updateIntakeStatus,
} from "../db/intakes";

// The lifecycle states, as a reusable validation schema (query filter + PATCH body).
const statusSchema = t.Union([
  t.Literal("new"),
  t.Literal("contacted"),
  t.Literal("booked"),
  t.Literal("unreachable"),
]);

// Intake controller: create + read + advance the callback intakes the form, dashboard,
// and voice agent share, backed by Postgres.
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
        status: query.status,
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
        status: t.Optional(statusSchema),
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
  )
  // Advance a client's lifecycle status — the agent writes back what happened.
  .patch(
    "/intake/:id/status",
    async ({ params, body, status }) => {
      const record = await updateIntakeStatus(params.id, body.status);
      if (!record) return status(404, { status: "not_found" });
      return { status: "updated", intake: record };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({ status: statusSchema }),
    },
  );
