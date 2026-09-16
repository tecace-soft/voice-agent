import { Elysia, t } from "elysia";
import { INVALID_API_KEY, authenticateApiKey, looksLikeApiKey } from "../auth/apiKey.js";
import { authenticate, UNAUTHORIZED } from "../auth/guard.js";
import { env } from "../config/env.js";
import { addCallSeconds, emptyMinutesFor, listCallMinutes } from "../db/callMinutes.js";

// Minutes the voice agent has spent talking, per business, this month and last.
//
// The write comes from the agent after every session, inbound and outbound — same shared key as its
// other endpoints, and keyed by the agent's own number on the call rather than an account id, exactly
// like the call record and the config lookup.
//
// The read has three kinds of caller, all scoped the same way: a customer signed in to the dashboard
// (their own business), an admin (any or all), and another system holding an API key (whatever that
// key was issued for). See docs/usage-api.md — that file is what other teams are given.

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
      // Another system, holding a key. Checked first and answered on its own terms: a wrong key must
      // say so plainly rather than "sign in", which is advice an integration cannot act on.
      if (looksLikeApiKey(headers.authorization)) {
        const key = await authenticateApiKey(headers.authorization);
        if (!key) return status(401, INVALID_API_KEY);
        if (!key.userId) return { timezone: env.timezone, minutes: await listCallMinutes() };
        const scoped = await listCallMinutes(key.userId);
        // A business with no calls yet still gets its row of zeroes — an integration asking for a
        // total wants a number, and an empty list reads as an error at the other end.
        return {
          timezone: env.timezone,
          minutes: scoped.length
            ? scoped
            : [emptyMinutesFor({ id: key.userId, email: key.userEmail ?? "", name: key.userName ?? "" })],
        };
      }

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
