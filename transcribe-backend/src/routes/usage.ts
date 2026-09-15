import { Elysia, t } from "elysia";
import { authenticate, UNAUTHORIZED } from "../auth/guard.js";
import { env } from "../config/env.js";
import { addCallSeconds, emptyMinutesFor, listCallMinutes } from "../db/callMinutes.js";

// Minutes the voice agent has spent talking, per business, this month and last.
//
// The write comes from the agent after every session, inbound and outbound — same shared key as its
// other endpoints, and keyed by the agent's own number on the call rather than an account id, exactly
// like the call record and the config lookup. The read is scoped like every other read here: a
// customer sees their own business, an admin may name one or see them all.

export const usage = new Elysia({ prefix: "/usage" })
  .post(
    "/minutes",
    async ({ body, headers, status }) => {
      if (!env.agentConfigKey || headers["x-agent-key"] !== env.agentConfigKey) {
        return status(401, { error: "unauthorized" });
      }
      return {
        timezone: env.timezone,
        minutes: await addCallSeconds(body.durationSeconds, body.agentNumber),
      };
    },
    {
      body: t.Object({
        // Capped at a day, like the call record's own duration: a larger number is a bug, not a call.
        durationSeconds: t.Integer({ minimum: 0, maximum: 86400 }),
        // The number the agent answered (inbound) or rang out from (outbound). Missing or unowned =
        // the unassigned bucket: the minutes were still used.
        agentNumber: t.Optional(t.String({ maxLength: 40 })),
      }),
    },
  )

  // `userId` is a filter for an admin — an account id, or "unassigned" — and never a way in for
  // anyone else. Always a list, so a customer's single business and an admin's view share a shape.
  .get(
    "/minutes",
    async ({ headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);

      if (user.role !== "admin") {
        const [own] = await listCallMinutes(user.id);
        return { timezone: env.timezone, minutes: [own ?? emptyMinutesFor(user)] };
      }
      const wanted = query.userId?.trim();
      return { timezone: env.timezone, minutes: await listCallMinutes(wanted || undefined) };
    },
    { query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }) },
  );
