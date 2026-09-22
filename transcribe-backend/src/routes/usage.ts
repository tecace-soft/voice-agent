import { Elysia, t } from "elysia";
import { INVALID_API_KEY, authenticateApiKey, looksLikeApiKey } from "../auth/apiKey.js";
import { authenticate, UNAUTHORIZED } from "../auth/guard.js";
import { env } from "../config/env.js";
import {
  UNASSIGNED,
  addCallSeconds,
  emptyMinutesFor,
  listCallMinutes,
  type OwnerCallMinutes,
} from "../db/callMinutes.js";
import { earliestSessionAt, periodTotalsByOwner } from "../db/callSessions.js";
import { findUserById } from "../db/users.js";
import {
  MAX_CALL_SECONDS,
  MAX_RANGE_DAYS,
  isSettled,
  parseRange,
  startedAtFor,
  type ParsedRange,
} from "../usage/range.js";

const BUSINESS_NOT_FOUND = {
  error: "business_not_found",
  message: "No business has that userId.",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string) => UUID.test(id);

// The read has four kinds of caller (an API key for all businesses or one, a customer, an admin) and
// one answer shape. Without a range this is exactly what it has always returned; with one, each
// business gains its period totals and the response says how far the data goes back and whether it
// can still change.
//
// `ownerKey` is whichever business these rows were read for, threaded through so the range sum is
// scoped the same way the rows were: unscoped, a caller asking about one business would have every
// business's sessions summed behind it, and the (owner_key, started_at) index would go unused.
async function respond(minutes: OwnerCallMinutes[], range: ParsedRange, ownerKey?: string) {
  if (range.kind !== "range") return { timezone: env.timezone, minutes };
  const [totals, coverageFrom] = await Promise.all([
    periodTotalsByOwner(range.from, range.to, ownerKey),
    earliestSessionAt(),
  ]);
  // A business with no calls in the window is absent from the totals, not zero in them.
  const zero = { periodSeconds: 0, periodMinutes: 0, periodCalls: 0 };
  return {
    timezone: env.timezone,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    settled: isSettled(range.to, new Date(), env.settleSeconds),
    settleSeconds: env.settleSeconds,
    coverageFrom,
    minutes: minutes.map((m) => ({
      ...m,
      ...(totals.get(m.userId ?? UNASSIGNED) ?? zero),
    })),
  };
}

// Minutes the voice agent has spent talking, per business, this month and last.
//
// The write comes from the agent after every session, inbound and outbound — same shared key as its
// other endpoints, and keyed by the agent's own number on the call rather than an account id, exactly
// like the call record and the config lookup.
//
// The read has three kinds of caller: a customer signed in to the dashboard (their own business), an
// admin (any or all), and another system holding an API key — which reads like an admin: every
// business, or the one it names. See docs/usage-api.md — that file is what other teams are given.

export const usage = new Elysia({ prefix: "/usage" })
  .post(
    "/minutes",
    async ({ body, headers, status }) => {
      if (!env.agentConfigKey || headers["x-agent-key"] !== env.agentConfigKey) {
        return status(401, { error: "unauthorized" });
      }
      // One instant for both halves of the write: the month the counter rolls onto, and the start the
      // session row is filed under — taken once so a call near midnight cannot land in two periods.
      const now = new Date();
      const startedAt = startedAtFor(body.startedAt, body.durationSeconds, now);
      return {
        timezone: env.timezone,
        minutes: await addCallSeconds(body.durationSeconds, body.agentNumber, now, startedAt),
      };
    },
    {
      body: t.Object({
        // Capped at a day, like the call record's own duration: a larger number is a bug, not a call.
        durationSeconds: t.Integer({ minimum: 0, maximum: MAX_CALL_SECONDS }),
        // The number the agent answered (inbound) or rang out from (outbound). Missing or unowned =
        // the unassigned bucket: the minutes were still used.
        agentNumber: t.Optional(t.String({ maxLength: 40 })),
        // When the call started, if the agent knows. Absent, the backend derives it from arrival —
        // the report is sent as the call ends, so that is right to within the round-trip.
        startedAt: t.Optional(t.String({ maxLength: 40 })),
      }),
    },
  )

  // `userId` is a filter — an account id, or "unassigned" — for an admin or an API key, and never a
  // way in for anyone else. Always a list, so a customer's single business and an admin's view share
  // a shape.
  .get(
    "/minutes",
    async ({ headers, query, status }) => {
      // Before authentication on purpose: a malformed range is the caller's own mistake in every
      // role, and answering "sign in" would send them looking for the wrong problem.
      const range = parseRange(query.from, query.to);
      if (range.kind === "error") {
        return status(400, {
          error: range.error,
          message:
            range.error === "range_too_long"
              ? `A range may cover at most ${MAX_RANGE_DAYS} days.`
              : "Send from and to as ISO 8601 instants with an offset or Z, with from before to.",
        });
      }

      // Another system, holding a key. Checked first and answered on its own terms: a wrong key must
      // say so plainly rather than "sign in", which is advice an integration cannot act on.
      if (looksLikeApiKey(headers.authorization)) {
        const key = await authenticateApiKey(headers.authorization);
        if (!key) return status(401, INVALID_API_KEY);

        // Every business, or the one it names — the same view an admin has in the dashboard.
        // Ids are stored lower-case; an upper-cased copy must find the same business, not its zeroes.
        const wanted = query.userId?.trim().toLowerCase() || undefined;
        if (!wanted) return respond(await listCallMinutes(), range);
        if (wanted === UNASSIGNED) return respond(await listCallMinutes(UNASSIGNED), range, UNASSIGNED);
        const [found] = await listCallMinutes(wanted);
        if (found) return respond([found], range, wanted);
        // Not in the totals yet: a real customer with no number and no calls is a row of zeroes (an
        // integration asking for a total wants a number); anything else is a mistyped id, said plainly.
        const account = isUuid(wanted) ? await findUserById(wanted) : null;
        if (!account || account.role === "admin") return status(404, BUSINESS_NOT_FOUND);
        return respond([emptyMinutesFor(account)], range, wanted);
      }

      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);

      if (user.role !== "admin") {
        const [own] = await listCallMinutes(user.id);
        return respond([own ?? emptyMinutesFor(user)], range, user.id);
      }
      const wanted = query.userId?.trim();
      return respond(await listCallMinutes(wanted || undefined), range, wanted || undefined);
    },
    {
      query: t.Object({
        userId: t.Optional(t.String({ maxLength: 64 })),
        // Validated in the handler rather than by the schema — including the length, which the
        // instant regex bounds far more tightly than a maxLength could — so that every bad value is
        // answered with this API's own 400 shape instead of the framework's 422.
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
      }),
    },
  );
