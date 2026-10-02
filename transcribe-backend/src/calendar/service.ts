import type { AppointmentSettings } from "../business/callSettings.js";
import { toE164 } from "../business/phone.js";
import type { BusinessHour } from "../demo/types.js";
import {
  findConnection,
  markStatus,
  recordBooking,
  saveConnection,
  updateSecret,
  type ConnectionRow,
} from "../db/calendarConnections.js";
import { calendarSlots, pickSlots, withinRules, type PartOfDay, type SlotChoice } from "./availability.js";
import {
  acuityAccount,
  acuityClient,
  calcomAccount,
  calcomClient,
  calendlyAccount,
  calendlyClient,
  type AcuityCredentials,
  type CalendlyCredentials,
} from "./bookingTools.js";
import { caldavClient, ICLOUD_CALDAV, type CalDavCredentials } from "./caldav.js";
import { isProvider, providerKind, PROVIDER_NAMES } from "./catalog.js";
import type { BookingTarget } from "../session/appointments.js";
import { googleAccount, googleClient } from "./google.js";
import { microsoftAccount, microsoftClient } from "./microsoft.js";
import type { OAuthProvider, OAuthTokens } from "./oauth.js";
import { openStored, seal } from "./secrets.js";
import { spokenTime, zonedIso } from "./time.js";
import { CalendarError, type CalendarClient, type ProviderId, type Target } from "./types.js";

// Everything a route or a call needs from a calendar connection: connect one, pick where bookings
// land, find openings, book. The one place that opens the sealed credentials.

type Credentials = OAuthTokens | CalDavCredentials | { apiKey: string } | CalendlyCredentials | AcuityCredentials;

/** What the browser may see of a connection. Never the credentials. */
export type ConnectionSummary = {
  provider: ProviderId;
  providerName: string;
  account: string;
  targetId: string | null;
  targetName: string | null;
  status: "ok" | "error";
  lastError: string | null;
  connectedAt: string;
};

export function summarize(row: ConnectionRow | null): ConnectionSummary | null {
  if (!row || !isProvider(row.provider)) return null;
  return {
    provider: row.provider,
    providerName: PROVIDER_NAMES[row.provider],
    account: row.account,
    targetId: row.targetId,
    targetName: row.targetName,
    status: row.status,
    lastError: row.lastError,
    connectedAt: row.createdAt,
  };
}

function build(provider: ProviderId, creds: Credentials, timeZone: string, save: (next: Credentials) => Promise<void>): CalendarClient {
  switch (provider) {
    case "google-calendar":
      return googleClient(creds as OAuthTokens, save);
    case "outlook":
      return microsoftClient(creds as OAuthTokens, save);
    case "apple-calendar":
      return caldavClient(creds as CalDavCredentials, timeZone, "iCloud");
    case "caldav":
      return caldavClient(creds as CalDavCredentials, timeZone);
    case "cal-com":
      return calcomClient((creds as { apiKey: string }).apiKey);
    case "calendly":
      return calendlyClient(creds as CalendlyCredentials);
    case "squarespace":
      return acuityClient(creds as AcuityCredentials);
  }
}

/** The live client for a stored connection. Refreshed tokens are written back as they arrive. */
export function clientFor(row: ConnectionRow, timeZone: string): CalendarClient {
  if (!isProvider(row.provider)) throw new CalendarError("input", "This calendar isn't supported any more.");
  const stored = openStored<Credentials>(row.secret);
  if (!stored) throw new CalendarError("auth", "This connection can't be read any more. Reconnect the calendar.");
  // Saved under an earlier key (before CALENDAR_SECRET was set): move it to the current one now, so
  // the fallback is only ever needed once per connection.
  if (stored.stale) {
    void updateSecret(row.userId, seal(stored.value)).catch((error) =>
      console.warn(`calendar: couldn't re-seal a connection under the current key: ${(error as Error).message}`),
    );
  }
  return build(row.provider, stored.value, timeZone, (next) => updateSecret(row.userId, seal(next)));
}

function required(value: unknown, message: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new CalendarError("input", message);
  if (text.length > 500) throw new CalendarError("input", "That's longer than any real key or password.");
  return text;
}

function serverUrl(raw: unknown): string {
  const text = required(raw, "Add the server address.");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new CalendarError("input", "That server address isn't a web address.");
  }
  if (url.protocol !== "https:") throw new CalendarError("input", "The server has to use https://");
  // Not a way to make this backend call inside its own network.
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|0\.)/i.test(url.hostname)) {
    throw new CalendarError("input", "That server address isn't reachable from the internet.");
  }
  return url.toString();
}

function pickTarget(targets: Target[]): Target | null {
  return targets.find((t) => t.primary) ?? targets[0] ?? null;
}

export type ConnectResult = { connection: ConnectionSummary; targets: Target[] };

/**
 * Check a set of credentials against the provider, and keep them only if they work. The first
 * calendar (the primary one, where the provider says which) is chosen; the screen can change it.
 */
export async function connectWithCredentials(
  userId: string,
  provider: ProviderId,
  input: Record<string, unknown>,
  timeZone: string,
): Promise<ConnectResult> {
  let creds: Credentials;
  let account: string;
  switch (provider) {
    case "apple-calendar":
    case "caldav": {
      const apple = provider === "apple-calendar";
      const password = required(input.password, "Add the password.");
      const c: CalDavCredentials = {
        server: apple ? ICLOUD_CALDAV : serverUrl(input.server),
        username: required(input.username, apple ? "Add your Apple ID email." : "Add the user name."),
        // iCloud shows app-specific passwords as xxxx-xxxx-xxxx-xxxx; people paste them with spaces.
        password: apple ? password.replace(/\s+/g, "") : password,
      };
      creds = c;
      account = c.username;
      break;
    }
    case "cal-com": {
      const apiKey = required(input.apiKey, "Paste your Cal.com API key.");
      account = await calcomAccount(apiKey);
      creds = { apiKey };
      break;
    }
    case "calendly": {
      const token = required(input.token, "Paste your Calendly personal access token.");
      const me = await calendlyAccount(token);
      creds = { token, userUri: me.userUri };
      account = me.email;
      break;
    }
    case "squarespace": {
      const c: AcuityCredentials = {
        userId: required(input.userId, "Add your User ID."),
        apiKey: required(input.apiKey, "Add your API key."),
      };
      account = await acuityAccount(c);
      creds = c;
      break;
    }
    default:
      throw new CalendarError("input", "That one connects by signing in, not with a key.");
  }
  // Nothing is saved until the provider has shown us at least one place to book into.
  const client = build(provider, creds, timeZone, async () => undefined);
  const targets = await client.targets();
  const target = pickTarget(targets);
  if (!target) {
    throw new CalendarError(
      "input",
      client.kind === "booking"
        ? "Connected, but there's no active event type to book into. Add one there first."
        : "Connected, but this account has no calendar we can write to.",
    );
  }
  const row = await saveConnection({ userId, provider, account, secret: seal(creds), targetId: target.id, targetName: target.name });
  return { connection: summarize(row)!, targets };
}

/** Finish an OAuth sign-in: the tokens are good, so name the account and pick a calendar. */
export async function connectWithTokens(userId: string, provider: OAuthProvider, tokens: OAuthTokens, timeZone: string): Promise<ConnectResult> {
  const noop = async () => undefined;
  const account = provider === "google-calendar" ? await googleAccount(tokens, noop) : await microsoftAccount(tokens, noop);
  const client = build(provider, tokens, timeZone, noop);
  const targets = await client.targets();
  const target = pickTarget(targets);
  const row = await saveConnection({
    userId,
    provider,
    account,
    secret: seal(tokens),
    targetId: target?.id ?? null,
    targetName: target?.name ?? null,
  });
  return { connection: summarize(row)!, targets };
}

// ---- Openings and bookings ----------------------------------------------------------------------

export type BookingContext = {
  userId: string;
  rules: AppointmentSettings;
  profileHours: BusinessHour[] | undefined;
  timeZone: string;
  now?: number;
};

async function withConnection<T>(userId: string, run: (row: ConnectionRow) => Promise<T>): Promise<T> {
  const row = await findConnection(userId);
  if (!row) throw new CalendarError("input", "No calendar is connected.");
  if (!row.targetId) throw new CalendarError("input", "Choose which calendar bookings go into.");
  try {
    const result = await run(row);
    if (row.status === "error") await markStatus(userId, null);
    return result;
  } catch (error) {
    if (error instanceof CalendarError && error.kind === "auth") await markStatus(userId, error.message);
    throw error;
  }
}

/** Every bookable start from now to the horizon (or `until`). */
export async function openings(ctx: BookingContext, until?: number): Promise<number[]> {
  const now = ctx.now ?? Date.now();
  const end = Math.min(until ?? Infinity, now + ctx.rules.horizonDays * 86_400_000);
  return withConnection(ctx.userId, async (row) => {
    const client = clientFor(row, ctx.timeZone);
    if (client.kind === "booking") {
      const starts = await client.openings!(row.targetId!, now, end, ctx.timeZone);
      return withinRules(starts, ctx.rules, now);
    }
    const busy = await client.busy!(row.targetId!, now - 86_400_000, end + 86_400_000);
    return calendarSlots({ rules: ctx.rules, profileHours: ctx.profileHours, busy, now, timeZone: ctx.timeZone, until: end });
  });
}

export type AvailabilityAsk = { date?: string; partOfDay?: PartOfDay };

export type AvailabilityAnswer = {
  timeZone: string;
  openings: SlotChoice[];
  /** Set when the day asked for had nothing: the nearest days that do. */
  nearest?: SlotChoice[];
};

export async function checkAvailability(ctx: BookingContext, ask: AvailabilityAsk): Promise<AvailabilityAnswer> {
  const starts = await openings(ctx);
  const found = pickSlots(starts, ctx.timeZone, ask);
  if (found.length || !ask.date) return { timeZone: ctx.timeZone, openings: found };
  const after = Date.parse(`${ask.date}T00:00:00Z`) - 14 * 3_600_000;
  return {
    timeZone: ctx.timeZone,
    openings: [],
    nearest: pickSlots(starts, ctx.timeZone, { partOfDay: ask.partOfDay, after }, 4),
  };
}

export type BookInput = {
  start: string;
  callerName: string;
  callerPhone: string;
  reason: string;
  email?: string;
  test: boolean;
  /** Fallback for booking tools that insist on an email: the business's own. */
  businessEmail?: string;
};

export type BookAnswer =
  | { booked: true; start: string; spoken: string; title: string }
  | { booked: false; reason: string; openings: SlotChoice[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Book one opening. Checked against the calendar again first: minutes may have passed since the
 * caller heard it, and a double booking is worse than asking them to pick another time.
 */
export async function book(ctx: BookingContext, input: BookInput): Promise<BookAnswer> {
  const start = Date.parse(input.start);
  if (!Number.isFinite(start)) throw new CalendarError("input", "That isn't a time from check_availability.");
  const starts = await openings(ctx, start + 86_400_000);
  if (!starts.some((s) => Math.abs(s - start) < 60_000)) {
    return {
      booked: false,
      reason: "That time is no longer open.",
      openings: pickSlots(starts, ctx.timeZone, { after: start - 3 * 3_600_000 }, 4),
    };
  }
  return withConnection(ctx.userId, async (row) => {
    const client = clientFor(row, ctx.timeZone);
    const phone = input.callerPhone ? toE164(input.callerPhone) : "";
    const name = input.callerName.trim() || "Caller";
    const email =
      (input.email && EMAIL.test(input.email.trim()) && input.email.trim()) ||
      (EMAIL.test(row.account) ? row.account : "") ||
      (input.businessEmail && EMAIL.test(input.businessEmail) ? input.businessEmail : "");
    if (client.kind === "booking" && !email) {
      throw new CalendarError("input", "This booking tool needs an email for every booking. Ask the caller for one.");
    }
    const title = `${input.test ? "[Test] " : ""}${ctx.rules.title}: ${name}`;
    const notes = [
      `Booked by the AI receptionist${input.test ? " during an in-app test call" : " on a phone call"}.`,
      `Caller: ${name}`,
      phone ? `Phone: ${phone}` : "Phone: withheld",
      input.reason ? `Regarding: ${input.reason}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const booked = await client.book(row.targetId!, {
      start,
      end: start + ctx.rules.durationMinutes * 60_000,
      timeZone: ctx.timeZone,
      title,
      notes,
      callerName: name,
      callerPhone: phone,
      email,
    });
    await recordBooking({
      userId: ctx.userId,
      provider: row.provider,
      externalId: booked.id,
      start: booked.start,
      end: booked.end,
      callerName: name,
      callerPhone: phone,
      reason: input.reason,
      test: input.test,
    });
    return { booked: true, start: zonedIso(booked.start, ctx.timeZone), spoken: spokenTime(booked.start, ctx.timeZone), title: ctx.rules.title };
  });
}

// ---- The call's two tools -----------------------------------------------------------------------

const PARTS: PartOfDay[] = ["morning", "afternoon", "evening", "any"];

/**
 * Run check_availability or book_appointment for a call and return what the model is told, as JSON.
 * A calendar that fails is reported as such rather than thrown: the receptionist has to be able to
 * say "I can't reach the calendar right now" and take a message instead.
 */
export async function runAppointmentTool(
  name: string,
  args: Record<string, unknown>,
  ctx: BookingContext & { callerNumber: string; test: boolean; businessEmail?: string },
): Promise<Record<string, unknown>> {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  try {
    if (name === "check_availability") {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str(args.date)) ? str(args.date) : undefined;
      const part = PARTS.includes(str(args.part_of_day) as PartOfDay) ? (str(args.part_of_day) as PartOfDay) : "any";
      const answer = await checkAvailability(ctx, { date, partOfDay: part });
      if (!answer.openings.length && !answer.nearest?.length) {
        return { available: false, message: "There are no openings in the booking window. Offer to take a message instead." };
      }
      return {
        available: answer.openings.length > 0,
        ...(answer.openings.length ? { openings: answer.openings } : { message: "Nothing open then.", nearest_openings: answer.nearest }),
        note: "Offer two or three of these, as spoken. Book only a start from this list.",
      };
    }
    if (name === "book_appointment") {
      const answer = await book(ctx, {
        start: str(args.start),
        callerName: str(args.caller_name),
        callerPhone: str(args.callback_number) || ctx.callerNumber,
        reason: str(args.reason),
        email: str(args.email) || undefined,
        test: ctx.test,
        businessEmail: ctx.businessEmail,
      });
      return answer.booked
        ? { booked: true, when: answer.spoken, what: answer.title }
        : { booked: false, message: answer.reason, other_openings: answer.openings };
    }
    return { error: `unknown tool ${name}` };
  } catch (error) {
    const message = error instanceof CalendarError ? error.message : "The calendar couldn't be reached.";
    return { ok: false, error: message, instruction: "Tell the caller you can't book it right now, and take a message with the time they want." };
  }
}

/**
 * What a call's composer is told about this business's calendar: set only when there is somewhere
 * to book into and the last attempt did not find the sign-in revoked. A broken connection is not
 * offered — the receptionist would only discover it mid-call.
 */
export async function bookingTargetFor(userId: string): Promise<BookingTarget | null> {
  const row = await findConnection(userId);
  if (!row || !row.targetId || row.status === "error" || !isProvider(row.provider)) return null;
  return { providerName: PROVIDER_NAMES[row.provider], kind: providerKind(row.provider) };
}
