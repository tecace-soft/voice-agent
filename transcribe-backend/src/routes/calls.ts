import { Elysia, t } from "elysia";
import { authenticate, UNAUTHORIZED } from "../auth/guard.js";
import { env } from "../config/env.js";
import {
  deleteInboundCall,
  insertInboundCall,
  listAllInboundCalls,
  listCallsAwaitingSheet,
  listInboundCalls,
  listUnassignedInboundCalls,
  markSheetWritten,
  type InboundCall,
} from "../db/inboundCalls.js";
import { findUserById } from "../db/users.js";
import { callSummaryMail, sendMail } from "../email/mailer.js";

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
      // The call is stored first and the 201 doesn't depend on the email. We still wait for it,
      // because a serverless function can be stopped once it has answered; the agent posts after the
      // call has ended, so nobody is waiting on the phone.
      await emailCallSummary(call);
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
        requestedTime: t.Optional(t.String({ maxLength: 200 })),
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
      // "unassigned" = calls on numbers nobody owns, the same bucket name the talk-time totals use.
      if (wanted === "unassigned") return { calls: await listUnassignedInboundCalls() };
      return { calls: wanted ? await listInboundCalls(wanted) : await listAllInboundCalls() };
    },
    { query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }) },
  )

  // Remove a call for good. A customer may delete their own; an admin may delete any, including
  // the unattributed ones no customer can see. There is no undo and no soft-delete tombstone —
  // "delete" on a record of what someone said should mean it is gone.
  .delete(
    "/:id",
    async ({ headers, params, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);

      const removed = await deleteInboundCall(params.id, user.role === "admin" ? null : user.id);
      if (!removed) return status(404, { error: "not_found", message: "No such call." });
      return { status: "deleted" };
    },
    { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )

  // ---- the spreadsheet hand-off -------------------------------------------------------------
  //
  // Messages the assistant took are written to a Google Sheet by transcribe-app, which already
  // owns all the sheet logic — tab matching, name-based column mapping, filling gaps rather than
  // appending past stray data. Reimplementing that here would be a second place to get it wrong,
  // so this service only holds the queue and the claim.
  //
  // Same shared key as the agent's own calls: this is server-to-server, with no session.
  .get(
    "/awaiting-sheet",
    async ({ headers, status }) => {
      if (!env.agentConfigKey || headers["x-agent-key"] !== env.agentConfigKey) {
        return status(401, { error: "unauthorized" });
      }
      return { calls: await listCallsAwaitingSheet() };
    },
  )

  .post(
    "/:id/sheet-written",
    async ({ headers, params, status }) => {
      if (!env.agentConfigKey || headers["x-agent-key"] !== env.agentConfigKey) {
        return status(401, { error: "unauthorized" });
      }
      // `false` means it was already stamped. That is a success from the caller's point of view —
      // the row exists — so it is not an error, just nothing left to do.
      const claimed = await markSheetWritten(params.id);
      return { status: claimed ? "marked" : "already_written" };
    },
    { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  );

// Bounds the wait so the insert plus the send stays under the agent's 10s HTTP timeout.
const SUMMARY_SEND_TIMEOUT_MS = 5_000;

/**
 * Email the call's owner its summary, if they switched that on (Business settings › Call emails).
 * Best effort and never throws: a call to a number nobody owns, an account that didn't ask, or a
 * mail server that is down all just mean no email.
 */
export async function emailCallSummary(call: InboundCall): Promise<boolean> {
  try {
    if (!call.userId) return false;
    const owner = await findUserById(call.userId);
    if (!owner?.emailCallSummaries) return false;
    return await sendMail(callSummaryMail(owner.email, call), { timeoutMs: SUMMARY_SEND_TIMEOUT_MS });
  } catch (err) {
    console.warn(`[calls] summary email for call ${call.id} failed: ${(err as Error).message}`);
    return false;
  }
}
