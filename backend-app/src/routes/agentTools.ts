import { Elysia } from "elysia";
import { env } from "../config/env.js";
import { listBookedTimes } from "../db/intakes.js";
import { formatSpoken, joinSpoken } from "../lib/spoken.js";
import {
  checkAvailability,
  normalizeDateTime,
  slotsForDate,
  suggestSlots,
} from "../schedule/slots.js";
import { bookExisting, createAndBook } from "../services/booking.js";

// Agent tools — the "custom functions" the voice agent (Retell) calls DURING a call to
// check availability, list openings, and book. Retell POSTs a JSON body; in "standard"
// mode it's `{ name, call, args }`, in "args only" mode the arguments are at the top
// level. `readArgs` handles both. Every response is a JSON object with a speakable
// `message` plus structured fields, and always returns 200 so the agent can recover
// conversationally (auth failures are the only non-2xx). See docs/agent-tools.md.

interface RetellCall {
  from_number?: string;
  retell_llm_dynamic_variables?: Record<string, unknown>;
}

// Pull the function arguments whether Retell nested them under `args` or flattened them.
function readArgs(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b.args && typeof b.args === "object") return b.args as Record<string, unknown>;
    return b;
  }
  return {};
}

function readCall(body: unknown): RetellCall {
  if (body && typeof body === "object") {
    const c = (body as Record<string, unknown>).call;
    if (c && typeof c === "object") return c as RetellCall;
  }
  return {};
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const TZ = env.schedule.timezone;

export const agentTools = new Elysia({ prefix: "/agent" })
  // Shared-secret guard. When AGENT_TOOLS_SECRET is set, require a matching header
  // (configure it as a custom header on the Retell function). Unset = open (dev).
  .onBeforeHandle(({ headers, status }) => {
    if (env.agentToolsSecret && headers["x-agent-secret"] !== env.agentToolsSecret) {
      return status(401, { error: "unauthorized" });
    }
  })

  // Is a specific time open? If not, offer the nearest alternatives. arg: dateTime (ISO).
  .post("/check-availability", async ({ body }) => {
    const args = readArgs(body);
    const raw = str(args.dateTime);
    if (!raw || Number.isNaN(new Date(raw).getTime())) {
      return { available: false, message: "I couldn't read that date and time." };
    }
    // The agent sends a zone-less local time (Pacific); read it as Pacific, not UTC.
    const dateTime = normalizeDateTime(raw, TZ);
    const now = Date.now();
    const booked = await listBookedTimes();
    const { available, reason } = checkAvailability(env.schedule, dateTime, booked, now);
    const when = formatSpoken(dateTime, TZ);
    if (available) {
      return { available: true, when, message: `Good news — ${when} is available.` };
    }
    const suggestions = suggestSlots(env.schedule, dateTime, booked, {
      limit: 3,
      withinDays: 14,
      now,
    });
    const alternatives = suggestions.map((s) => formatSpoken(s.start, TZ));
    const lead = reason === "in_past" ? `${when} is in the past.` : `${when} isn't available.`;
    return {
      available: false,
      when,
      reason,
      alternatives,
      message: alternatives.length
        ? `${lead} The closest openings I have are ${joinSpoken(alternatives)}.`
        : `${lead} I don't have anything open nearby — would another day work?`,
    };
  })

  // A few open slots on a given day. arg: date (YYYY-MM-DD).
  .post("/openings", async ({ body }) => {
    const args = readArgs(body);
    const date = str(args.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { openings: [], message: "Which day would you like me to check?" };
    }
    const now = Date.now();
    const booked = await listBookedTimes(`${date}T00:00:00Z`, `${date}T23:59:59Z`);
    const day = slotsForDate(env.schedule, date, booked);
    const open = day.slots
      .filter((s) => s.available && new Date(s.start).getTime() > now)
      .slice(0, 5)
      .map((s) => formatSpoken(s.start, TZ));
    return {
      date,
      openings: open,
      message: open.length
        ? `I have ${joinSpoken(open)}.`
        : "I don't have any openings that day. Would another day work?",
    };
  })

  // Book a slot. For an inbound caller (no intakeId) we create the lead first. Booking
  // also creates the Cal.com meeting (invite + link). args: dateTime (ISO) + either
  // intakeId (existing lead) OR name/email[/phone/language/purpose] (new inbound lead).
  .post("/book", async ({ body }) => {
    const args = readArgs(body);
    const call = readCall(body);
    const raw = str(args.dateTime);
    if (!raw || Number.isNaN(new Date(raw).getTime())) {
      return { booked: false, message: "I couldn't read that date and time." };
    }
    // The agent sends a zone-less local time (Pacific); read it as Pacific, not UTC.
    const dateTime = normalizeDateTime(raw, TZ);
    const when = formatSpoken(dateTime, TZ);
    const intakeId = str(args.intakeId);

    const result = intakeId
      ? await bookExisting(intakeId, dateTime)
      : await bookNewLead(args, call, dateTime);

    if (!result.ok) {
      if (result.reason === "not_found") {
        return { booked: false, reason: result.reason, message: "I couldn't find that booking." };
      }
      if (result.reason === "in_past") {
        return { booked: false, reason: result.reason, message: `${when} is in the past.` };
      }
      if (result.reason === "missing_details") {
        return { booked: false, reason: result.reason, message: "I still need your name and email to book this." };
      }
      return {
        booked: false,
        reason: result.reason,
        message: `${when} was just taken. Would another time work?`,
      };
    }
    const email = result.intake.email;
    return {
      booked: true,
      when,
      intakeId: result.intake.id,
      message: `You're all set for ${when}. A confirmation with the meeting link will be sent to ${email}.`,
    };
  });

// Create a new inbound lead from the call details, then book it.
async function bookNewLead(
  args: Record<string, unknown>,
  call: RetellCall,
  dateTime: string,
) {
  const name = str(args.name);
  const email = str(args.email);
  const phone = str(args.phone) || str(call.from_number);
  if (!name || !email) return { ok: false as const, reason: "missing_details" };
  return createAndBook({
    language: str(args.language) || "English",
    name,
    email,
    phoneNumber: phone,
    purpose: str(args.purpose) || "Consultation (inbound call)",
    dateTime,
  });
}
