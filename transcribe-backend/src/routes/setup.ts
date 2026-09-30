import { Elysia, t } from "elysia";
import { authenticate, UNAUTHORIZED } from "../auth/guard.js";
import { env } from "../config/env.js";
import { findProfile } from "../db/businessProfiles.js";
import { findCallSettings } from "../db/callSettings.js";
import {
  countSetupTurnsSince,
  discardSetupSessions,
  findLatestSetupSession,
  toPublicSession,
} from "../db/setupSessions.js";
import { findUserById } from "../db/users.js";
import { OpenAIError } from "../demo/openai.js";
import { SetupTurnError, runTurn } from "../setup/orchestrator.js";
import { rateLimited } from "./demoCommon.js";

// The guided setup interview (src/setup): a consultant chat that writes a business's call-settings
// DRAFT for the owner. One blocking POST per message; the server runs every tool call before it
// answers. Nothing here publishes — the owner does that from the settings screens.
//
// Every turn is a real, billed model call, so a demo-stage account may look but not talk, a burst is
// throttled per account, and a customer has a daily allowance (admins are exempt from that one).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function targetFor(user: { id: string; role: string }, requested?: string): string {
  if (user.role !== "admin") return user.id;
  const wanted = requested?.trim();
  return wanted && UUID.test(wanted) ? wanted : user.id;
}

/** Midnight today on the wall clock of `zone`, as an instant. */
function startOfTodayIn(zone: string, now = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  const offset = wall - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(parts.year!, parts.month! - 1, parts.day!) - offset);
}

const NOT_FOUND = { error: "not_found", message: "No such account." };

const DEMO_READ_ONLY = {
  error: "demo_read_only",
  message: "The setup assistant opens once your receptionist is being set up.",
};

export const setup = new Elysia({ prefix: "/business/setup" })
  // The chat as it stands, the draft beside it, and whether a turn can be taken at all.
  .get(
    "/",
    async ({ headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const target = targetFor(user, query.userId);
      const owner = target === user.id ? user : await findUserById(target);
      if (!owner) return status(404, NOT_FOUND);
      const [profile, settings, session] = await Promise.all([
        findProfile(target),
        findCallSettings(target),
        findLatestSetupSession(target),
      ]);
      const reason = !env.openaiApiKey
        ? "no_openai_key"
        : user.role !== "admin" && owner.status === "demo"
          ? "demo_stage"
          : !profile?.profile
            ? "no_profile"
            : null;
      return {
        session: session ? toPublicSession(session, env.setupMaxTurns) : null,
        draft: settings.draft,
        dirty: settings.dirty,
        available: !reason,
        ...(reason ? { unavailableReason: reason } : {}),
      };
    },
    { query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }) },
  )

  // One message from the owner ("" opens the conversation) and the consultant's reply.
  .post(
    "/turn",
    async ({ body, headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      if (user.role !== "admin" && user.status === "demo") return status(403, DEMO_READ_ONLY);
      const target = targetFor(user, query.userId);
      if (target !== user.id && !(await findUserById(target))) return status(404, NOT_FOUND);
      if (rateLimited(`setup:${target}`, 12)) {
        return status(429, { error: "rate_limited", message: "Too many messages in a row. Wait a minute and try again." });
      }
      if (!env.openaiApiKey) {
        return status(503, { error: "no_openai_key", message: "OPENAI_API_KEY is not set on the server." });
      }
      if (user.role !== "admin" && env.setupDailyTurnCap > 0) {
        const used = await countSetupTurnsSince(target, startOfTodayIn(env.timezone));
        if (used >= env.setupDailyTurnCap) {
          return status(429, {
            error: "daily_cap",
            message: "You've used today's setup messages. Try again tomorrow, or finish in the settings screens.",
          });
        }
      }
      try {
        return await runTurn(target, body.message);
      } catch (err) {
        if (err instanceof SetupTurnError) return status(err.status, { error: err.code, message: err.message });
        // OpenAI refusing OUR key is not the owner's sign-in failing: a 401 here would sign them out.
        if (err instanceof OpenAIError) {
          const code = err.status === 401 || err.status === 403 ? 502 : err.status;
          return status(code, { error: "openai", message: err.message });
        }
        throw err;
      }
    },
    {
      query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }),
      body: t.Object({ message: t.String({ maxLength: 4000 }) }),
    },
  )

  // Forget the conversation. The draft keeps everything written to it. The rows are discarded, not
  // deleted, so Start over does not hand back a fresh daily allowance.
  .post(
    "/reset",
    async ({ headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      if (user.role !== "admin" && user.status === "demo") return status(403, DEMO_READ_ONLY);
      const target = targetFor(user, query.userId);
      if (target !== user.id && !(await findUserById(target))) return status(404, NOT_FOUND);
      await discardSetupSessions(target);
      return { session: null };
    },
    { query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }) },
  );
