import { Elysia, t } from "elysia";
import { authenticate, UNAUTHORIZED } from "../auth/guard.js";
import { env } from "../config/env.js";
import { findUserById } from "../db/users.js";
import { findProfile } from "../db/businessProfiles.js";
import { findCallSettings } from "../db/callSettings.js";
import { findByPhone } from "../db/agentNumbers.js";
import { deleteConnection, findConnection, recentBookings, setTarget } from "../db/calendarConnections.js";
import { catalog, isProvider } from "../calendar/catalog.js";
import { authorizeUrl, exchangeCode, oauthConfigured, redirectUri, type OAuthProvider } from "../calendar/oauth.js";
import { readState, signState } from "../calendar/secrets.js";
import {
  checkAvailability,
  clientFor,
  connectWithCredentials,
  connectWithTokens,
  runAppointmentTool,
  summarize,
  type BookingContext,
} from "../calendar/service.js";
import { CalendarError } from "../calendar/types.js";
import type { PartOfDay } from "../calendar/availability.js";

// A business's calendar: connect one, choose where bookings land, see the next openings, and the
// two tools a call uses to book.
//
// Under /business/calendar with the same rule as the rest of /business: a customer acts on their own
// account, an admin may name someone else's (?userId=), which is how onboarding is done for them.
// The OAuth callback is the one route with no session — the browser arrives from Google or
// Microsoft — and it trusts nothing but the signed `state` it sent out ten minutes earlier.

function targetFor(user: { id: string; role: string }, requested?: string): string {
  if (user.role !== "admin") return user.id;
  return requested?.trim() || user.id;
}

const userQuery = t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) });

function refusal(error: unknown): { status: 400 | 401 | 502; body: { error: string; message: string } } {
  if (error instanceof CalendarError) {
    const status = error.kind === "input" ? 400 : error.kind === "auth" ? 401 : 502;
    return { status, body: { error: `calendar_${error.kind}`, message: error.message } };
  }
  console.error("calendar:", error);
  return { status: 502, body: { error: "calendar_provider", message: "The calendar couldn't be reached. Try again in a moment." } };
}

/** The booking rules, the hours and the zone a business's calls use. Draft for the app, published for the phone. */
async function bookingContext(userId: string, which: "draft" | "published"): Promise<BookingContext & { businessEmail?: string }> {
  const [settings, row, user] = await Promise.all([findCallSettings(userId), findProfile(userId), findUserById(userId)]);
  // The phone uses only what was published. Nothing published yet means no booking on the phone,
  // even when the draft has it switched on — callers get settings once somebody presses Publish.
  const chosen = which === "published" ? settings.published : settings.draft;
  return {
    userId,
    rules: chosen ? chosen.appointments : { ...settings.draft.appointments, enabled: false },
    profileHours: row?.profile?.hours,
    timeZone: (chosen ?? settings.draft).timezone ?? env.timezone,
    businessEmail: user?.email,
  };
}

/** Where the browser may be sent back to after an OAuth sign-in: only the dashboard's own origins. */
function allowedReturn(raw: string | undefined): string | null {
  try {
    const url = new URL(raw ?? "");
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (env.corsOrigins.length && !env.corsOrigins.includes(url.origin)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function withResult(back: string, result: "connected" | "error", message?: string): string {
  const url = new URL(back);
  url.searchParams.set("calendar", result);
  if (message) url.searchParams.set("calendarMessage", message.slice(0, 200));
  return url.toString();
}

const PROVIDER_SLUG: Record<string, OAuthProvider> = { google: "google-calendar", microsoft: "outlook" };

export const calendar = new Elysia()
  .group("/business/calendar", (app) =>
    app
      // Everything the Appointments screen draws: what can be connected, what is, recent bookings.
      .get(
        "",
        async ({ headers, query, status }) => {
          const user = await authenticate(headers.authorization);
          if (!user) return status(401, UNAUTHORIZED);
          const target = targetFor(user, query.userId);
          const [row, bookings] = await Promise.all([findConnection(target), recentBookings(target, 10)]);
          return { providers: catalog(), connection: summarize(row), bookings };
        },
        { query: userQuery },
      )

      // Connect with credentials the business types in: iCloud, CalDAV, Cal.com, Calendly, Acuity.
      .post(
        "/connect",
        async ({ body, headers, query, status }) => {
          const user = await authenticate(headers.authorization);
          if (!user) return status(401, UNAUTHORIZED);
          if (!isProvider(body.provider)) return status(400, { error: "unknown_provider", message: "That one can't be connected yet." });
          const target = targetFor(user, query.userId);
          const { timeZone } = await bookingContext(target, "draft");
          try {
            return await connectWithCredentials(target, body.provider, body.credentials ?? {}, timeZone);
          } catch (error) {
            const r = refusal(error);
            return status(r.status === 401 ? 400 : r.status, r.body);
          }
        },
        {
          query: userQuery,
          body: t.Object({
            provider: t.String({ maxLength: 40 }),
            credentials: t.Optional(t.Record(t.String({ maxLength: 40 }), t.String({ maxLength: 600 }))),
          }),
        },
      )

      // Start a Google or Microsoft sign-in. The browser goes to the returned URL.
      .post(
        "/oauth/start",
        async ({ body, headers, query, request, status }) => {
          const user = await authenticate(headers.authorization);
          if (!user) return status(401, UNAUTHORIZED);
          const provider = body.provider as OAuthProvider;
          if (provider !== "google-calendar" && provider !== "outlook") {
            return status(400, { error: "unknown_provider", message: "That one doesn't sign in with OAuth." });
          }
          if (!oauthConfigured(provider)) {
            return status(409, {
              error: "needs_setup",
              message: "This server isn't set up to connect that calendar yet. Ask your TecAce admin.",
            });
          }
          const back = allowedReturn(body.returnTo);
          if (!back) return status(400, { error: "bad_return", message: "That page can't receive the sign-in." });
          const state = signState({ uid: targetFor(user, query.userId), provider, back });
          return { url: authorizeUrl(provider, state, redirectUri(provider, new URL(request.url).origin)) };
        },
        { query: userQuery, body: t.Object({ provider: t.String({ maxLength: 40 }), returnTo: t.String({ maxLength: 2000 }) }) },
      )

      // The calendars (or event types) the connected account can book into.
      .get(
        "/targets",
        async ({ headers, query, status }) => {
          const user = await authenticate(headers.authorization);
          if (!user) return status(401, UNAUTHORIZED);
          const target = targetFor(user, query.userId);
          const row = await findConnection(target);
          if (!row) return status(404, { error: "not_connected", message: "No calendar is connected." });
          const { timeZone } = await bookingContext(target, "draft");
          try {
            return { targets: await clientFor(row, timeZone).targets() };
          } catch (error) {
            const r = refusal(error);
            return status(r.status, r.body);
          }
        },
        { query: userQuery },
      )

      .put(
        "/target",
        async ({ body, headers, query, status }) => {
          const user = await authenticate(headers.authorization);
          if (!user) return status(401, UNAUTHORIZED);
          const target = targetFor(user, query.userId);
          const row = await findConnection(target);
          if (!row) return status(404, { error: "not_connected", message: "No calendar is connected." });
          const { timeZone } = await bookingContext(target, "draft");
          try {
            // Only a calendar the provider itself lists: the id is not ours to invent.
            const chosen = (await clientFor(row, timeZone).targets()).find((t) => t.id === body.targetId);
            if (!chosen) return status(400, { error: "unknown_target", message: "That calendar isn't on this account." });
            return { connection: summarize(await setTarget(target, chosen.id, chosen.name)) };
          } catch (error) {
            const r = refusal(error);
            return status(r.status, r.body);
          }
        },
        { query: userQuery, body: t.Object({ targetId: t.String({ maxLength: 1000 }) }) },
      )

      .delete(
        "",
        async ({ headers, query, status }) => {
          const user = await authenticate(headers.authorization);
          if (!user) return status(401, UNAUTHORIZED);
          await deleteConnection(targetFor(user, query.userId));
          return { connection: null };
        },
        { query: userQuery },
      )

      // The next openings under the DRAFT rules, for the screen's "Check openings".
      .post(
        "/availability",
        async ({ body, headers, query, status }) => {
          const user = await authenticate(headers.authorization);
          if (!user) return status(401, UNAUTHORIZED);
          const ctx = await bookingContext(targetFor(user, query.userId), "draft");
          try {
            return await checkAvailability(ctx, {
              date: body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : undefined,
              partOfDay: (body.partOfDay as PartOfDay) || "any",
            });
          } catch (error) {
            const r = refusal(error);
            return status(r.status, r.body);
          }
        },
        {
          query: userQuery,
          body: t.Object({ date: t.Optional(t.String({ maxLength: 10 })), partOfDay: t.Optional(t.String({ maxLength: 10 })) }),
        },
      )

      // An in-app test call's check_availability / book_appointment, under the draft rules. Real: a
      // test booking lands in the calendar, titled "[Test]", so the business sees it work.
      .post(
        "/tool",
        async ({ body, headers, query, status }) => {
          const user = await authenticate(headers.authorization);
          if (!user) return status(401, UNAUTHORIZED);
          if (body.name !== "check_availability" && body.name !== "book_appointment") {
            return status(400, { error: "unknown_tool", message: "Not an appointment tool." });
          }
          const ctx = await bookingContext(targetFor(user, query.userId), "draft");
          return runAppointmentTool(body.name, (body.args as Record<string, unknown>) ?? {}, {
            ...ctx,
            callerNumber: body.callerNumber ?? "",
            test: true,
          });
        },
        {
          query: userQuery,
          body: t.Object({
            name: t.String({ maxLength: 40 }),
            args: t.Optional(t.Unknown()),
            callerNumber: t.Optional(t.String({ maxLength: 32 })),
          }),
        },
      )

      // The phone agent's tools, under the PUBLISHED rules. Keyed like /business/config: the agent has
      // no session, so its shared AGENT_CONFIG_KEY and the number that was dialled say whose calendar.
      .post(
        "/agent-tool",
        async ({ body, headers, status }) => {
          if (!env.agentConfigKey || headers["x-agent-key"] !== env.agentConfigKey) {
            return status(401, { error: "unauthorized" });
          }
          if (body.name !== "check_availability" && body.name !== "book_appointment") {
            return status(400, { error: "unknown_tool" });
          }
          const number = await findByPhone(body.to);
          if (!number?.userId) return status(404, { error: "no_number" });
          const ctx = await bookingContext(number.userId, "published");
          if (!ctx.rules.enabled) return { ok: false, error: "Booking is switched off for this business." };
          return runAppointmentTool(body.name, (body.args as Record<string, unknown>) ?? {}, {
            ...ctx,
            callerNumber: body.callerNumber ?? "",
            test: false,
          });
        },
        {
          body: t.Object({
            to: t.String({ maxLength: 32 }),
            name: t.String({ maxLength: 40 }),
            args: t.Optional(t.Unknown()),
            callerNumber: t.Optional(t.String({ maxLength: 32 })),
          }),
        },
      ),
  )

  // Google / Microsoft send the browser back here. No session: the signed state names the account.
  .get(
    "/calendar/oauth/:slug/callback",
    async ({ params, query, request, redirect, status }) => {
      const provider = PROVIDER_SLUG[params.slug];
      const state = readState(query.state);
      if (!provider || !state || state.provider !== provider) {
        return status(400, "This sign-in link has expired. Go back to the dashboard and connect again.");
      }
      if (query.error || !query.code) {
        return redirect(withResult(state.back, "error", query.error === "access_denied" ? "Sign-in was cancelled." : "Sign-in didn't finish."));
      }
      try {
        const tokens = await exchangeCode(provider, query.code, redirectUri(provider, new URL(request.url).origin));
        const settings = await findCallSettings(state.uid);
        await connectWithTokens(state.uid, provider, tokens, settings.draft.timezone ?? env.timezone);
        return redirect(withResult(state.back, "connected"));
      } catch (error) {
        const message = error instanceof CalendarError ? error.message : "Couldn't finish connecting the calendar.";
        if (!(error instanceof CalendarError)) console.error("calendar oauth:", error);
        return redirect(withResult(state.back, "error", message));
      }
    },
    {
      params: t.Object({ slug: t.String({ maxLength: 20 }) }),
      query: t.Object({
        code: t.Optional(t.String({ maxLength: 4000 })),
        state: t.Optional(t.String({ maxLength: 4000 })),
        error: t.Optional(t.String({ maxLength: 200 })),
        scope: t.Optional(t.String({ maxLength: 2000 })),
        session_state: t.Optional(t.String({ maxLength: 200 })),
        authuser: t.Optional(t.String({ maxLength: 20 })),
        prompt: t.Optional(t.String({ maxLength: 40 })),
        hd: t.Optional(t.String({ maxLength: 200 })),
        error_description: t.Optional(t.String({ maxLength: 2000 })),
      }),
    },
  );
