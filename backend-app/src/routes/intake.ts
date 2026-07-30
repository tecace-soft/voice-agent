import { Elysia, t } from "elysia";
import { env } from "../config/env.js";
import {
  bookIntake,
  cancelBooking,
  countIntakes,
  deleteIntake,
  getIntake,
  incrementIntakeAttempts,
  insertIntake,
  listIntakes,
  setIntakeNotes,
  updateIntakeStatus,
} from "../db/intakes.js";

// Statuses the agent may set directly via PATCH. `canceled` is intentionally NOT here —
// canceling goes through DELETE /intake/:id/booking, which enforces "must be booked".
const settableStatusSchema = t.Union([
  t.Literal("new"),
  t.Literal("contacted"),
  t.Literal("booked"),
  t.Literal("unreachable"),
]);

// All lifecycle states — used for the list `?status` filter (dashboard can filter canceled).
const filterStatusSchema = t.Union([
  t.Literal("new"),
  t.Literal("contacted"),
  t.Literal("booked"),
  t.Literal("unreachable"),
  t.Literal("canceled"),
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
        status: t.Optional(filterStatusSchema),
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
  // Booking is special: it must not collide with an existing booked slot, so it goes
  // through the conflict-checked path (409 if taken). When booking, an optional `dateTime`
  // books the client at the slot they chose on the call, rather than their form time.
  .patch(
    "/intake/:id/status",
    async ({ params, body, status }) => {
      if (body.status === "booked") {
        const result = await bookIntake(params.id, env.schedule.slotMinutes, body.dateTime);
        if (!result.ok) {
          if (result.reason === "not_found") return status(404, { status: "not_found" });
          if (result.reason === "in_past") {
            return status(422, {
              status: "in_past",
              message: "That time is in the past and can't be booked.",
            });
          }
          return status(409, {
            status: "slot_taken",
            message: "That time overlaps an existing booking.",
          });
        }
        return { status: "updated", intake: result.intake };
      }

      const record = await updateIntakeStatus(params.id, body.status);
      if (!record) return status(404, { status: "not_found" });
      return { status: "updated", intake: record };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        status: settableStatusSchema,
        // Only used when status is "booked": the caller-chosen slot to book at.
        dateTime: t.Optional(t.String({ format: "date-time" })),
      }),
    },
  )
  // Record a call attempt against a client (atomic increment). The agent calls this each
  // time it places a call and reads back `attempts` to decide when to give up (past a
  // configured max it PATCHes the status to `unreachable`, so the poller stops calling).
  .post(
    "/intake/:id/attempt",
    async ({ params, status }) => {
      const record = await incrementIntakeAttempts(params.id);
      if (!record) return status(404, { status: "not_found" });
      return { status: "updated", intake: record };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    },
  )
  // Attach the agent's post-call summary to a client (free text).
  .patch(
    "/intake/:id/notes",
    async ({ params, body, status }) => {
      const record = await setIntakeNotes(params.id, body.notes);
      if (!record) return status(404, { status: "not_found" });
      return { status: "updated", intake: record };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({ notes: t.String() }),
    },
  )
  // Cancel a client's booking — booked -> canceled, which frees the slot. The client
  // record is kept (visible in the dashboard as canceled).
  .delete(
    "/intake/:id/booking",
    async ({ params, status }) => {
      const result = await cancelBooking(params.id);
      if (!result.ok) {
        if (result.reason === "not_found") return status(404, { status: "not_found" });
        return status(409, {
          status: "not_booked",
          message: "That client has no active booking to cancel.",
        });
      }
      return { status: "canceled", intake: result.intake };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    },
  )
  // Permanently delete a client (hard delete). Frees their slot if they were booked.
  .delete(
    "/intake/:id",
    async ({ params, status }) => {
      const deleted = await deleteIntake(params.id);
      if (!deleted) return status(404, { status: "not_found" });
      return { status: "deleted", id: params.id };
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    },
  );
