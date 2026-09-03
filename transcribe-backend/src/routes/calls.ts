import { Elysia, t } from "elysia";
import { authenticate, UNAUTHORIZED } from "../auth/guard.js";
import { env } from "../config/env.js";
import {
  insertInboundCall,
  listAllInboundCalls,
  listInboundCalls,
} from "../db/inboundCalls.js";

// Calls the voice agent answered, and the conversations it had.
//
// The write comes from the agent, which has no session — same shared key as its config lookup.
// The reads are ordinary dashboard reads, scoped the way everything else is: a customer sees their
// own, an admin may name someone else or see everything.

const turnSchema = t.Object({
  speaker: t.Union([t.Literal("agent"), t.Literal("caller")]),
  text: t.String({ maxLength: 4000 }),
});

export const calls = new Elysia({ prefix: "/calls" })
  // The agent posting a finished call. Keyed by the number that was DIALLED — the agent doesn't
  // know our account ids and shouldn't have to; the backend resolves the owner.
  .post(
    "/",
    async ({ body, headers, status }) => {
      if (!env.agentConfigKey || headers["x-agent-key"] !== env.agentConfigKey) {
        return status(401, { error: "unauthorized" });
      }
      const call = await insertInboundCall(body);
      return status(201, { call });
    },
    {
      body: t.Object({
        dialled: t.String({ minLength: 1, maxLength: 40 }),
        caller: t.Optional(t.String({ maxLength: 40 })),
        forwardedFrom: t.Optional(t.String({ maxLength: 40 })),
        callerName: t.Optional(t.String({ maxLength: 200 })),
        callbackNumber: t.Optional(t.String({ maxLength: 40 })),
        request: t.Optional(t.String({ maxLength: 2000 })),
        summary: t.Optional(t.String({ maxLength: 2000 })),
        outcome: t.Optional(t.String({ maxLength: 100 })),
        callbackRequested: t.Optional(t.Boolean()),
        durationSeconds: t.Optional(t.Integer({ minimum: 0, maximum: 86400 })),
        startedAt: t.Optional(t.String({ maxLength: 40 })),
        // Capped generously: a long call is a good call, but a runaway transcript shouldn't be
        // able to fill a column unbounded.
        turns: t.Array(turnSchema, { maxItems: 500 }),
      }),
    },
  )

  // What the dashboard lists. `userId` is a filter for an admin and never a way in for anyone
  // else — the same rule as every other scoped read in this service.
  .get(
    "/",
    async ({ headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);

      if (user.role !== "admin") {
        return { calls: await listInboundCalls(user.id) };
      }
      const wanted = query.userId?.trim();
      return { calls: wanted ? await listInboundCalls(wanted) : await listAllInboundCalls() };
    },
    { query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }) },
  );
