import { Elysia, t } from "elysia";
import { authenticateAdmin } from "../auth/guard.js";
import { env } from "../config/env.js";
import {
  assignAgentNumber,
  createAgentNumber,
  deleteAgentNumber,
  findByPhone,
  listAgentNumbers,
  toE164,
} from "../db/agentNumbers.js";

// Which phone number the voice agent answers for which customer.
//
// Under /business, deliberately NOT /agent: backend-app already owns /agent/* for the agent's
// booking tools, and the same prefix meaning two different things across two services is the kind
// of thing that reads fine today and misroutes somebody in a year.
//
// Managing numbers is admin-only. The single read the agent makes is authenticated with its own
// shared key, since it has no session — see AGENT_CONFIG_KEY.

const NUMBERS_ARE_ADMIN = "Only an admin can manage the agent's phone numbers.";

export const business = new Elysia({ prefix: "/business" })
  // The agent's lookup: whose business is this dialled number?
  //
  // Guarded by its own key rather than a session. When AGENT_CONFIG_KEY is unset the route is shut
  // entirely rather than left open — an unauthenticated caller could otherwise enumerate which
  // numbers we serve and who owns them, and failing closed here just means the agent falls back to
  // its neutral prompt, which is the safe outcome by design.
  .get(
    "/config",
    async ({ headers, query, status }) => {
      if (!env.agentConfigKey || headers["x-agent-key"] !== env.agentConfigKey) {
        return status(401, { error: "unauthorized" });
      }
      const number = await findByPhone(query.to);
      if (!number) {
        // Not an error. An unknown or unassigned number is a normal state — a line that rings
        // before an admin has assigned it — and the agent's correct response is the neutral
        // prompt, not a retry. `assigned:false` says so without making the agent read a status code.
        return { assigned: false, to: toE164(query.to) };
      }
      return {
        assigned: true,
        to: number.phoneE164,
        user: { id: number.userId, email: number.userEmail, name: number.userName },
      };
    },
    { query: t.Object({ to: t.String({ minLength: 1, maxLength: 40 }) }) },
  )

  // Every number we've registered, with its assignee.
  .get("/numbers", async ({ headers, status }) => {
    const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
    if ("denied" in caller) return status(caller.denied, caller.body);
    return { numbers: await listAgentNumbers() };
  })

  // Register a number we own. Unassigned until an admin says whose it is.
  .post(
    "/numbers",
    async ({ body, headers, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const phone = toE164(body.phone);
      // A number that isn't E.164 would be stored but could never match a lookup, so it is
      // rejected here rather than sitting in the table looking correct and never working.
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        return status(400, {
          error: "bad_number",
          message: `"${body.phone}" isn't a phone number we can match. Use the full number, e.g. +12065551234.`,
        });
      }
      try {
        return status(201, { number: await createAgentNumber({ phone, label: body.label ?? null }) });
      } catch (err) {
        // 23505 = unique_violation. Surfacing it as a plain conflict is the point of the
        // constraint: the second person to claim a number is told, not silently allowed.
        if ((err as { code?: string }).code === "23505") {
          return status(409, {
            error: "already_registered",
            message: `${phone} is already registered.`,
          });
        }
        throw err;
      }
    },
    {
      body: t.Object({
        phone: t.String({ minLength: 1, maxLength: 40 }),
        label: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  )

  // Assign the number to a user, or pass userId: null to un-assign it.
  .post(
    "/numbers/:id/assign",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);
      const number = await assignAgentNumber(params.id, body.userId ?? null);
      if (!number) return status(404, { error: "not_found", message: "No such number." });
      return { number };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ userId: t.Union([t.String(), t.Null()]) }),
    },
  )

  .delete(
    "/numbers/:id",
    async ({ headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);
      const removed = await deleteAgentNumber(params.id);
      if (!removed) return status(404, { error: "not_found", message: "No such number." });
      return { status: "deleted" };
    },
    { params: t.Object({ id: t.String() }) },
  );
