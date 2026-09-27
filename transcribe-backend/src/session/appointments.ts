import type { AppointmentSettings } from "../business/callSettings.js";
import type { FunctionTool } from "./compose.js";

// What a call is told when it can book: the two tools, and the business's own booking rules as a
// per-call block. Only composed when booking is switched on AND a calendar is connected — the rule
// book's "you can book" is never said on a call that could not.

/** What the composer needs to know about the connected calendar. Never the credentials. */
export type BookingTarget = {
  /** "Google Calendar", "Cal.com". */
  providerName: string;
  /** A booking tool decides lengths and hours itself. */
  kind: "calendar" | "booking";
};

export const CHECK_AVAILABILITY: FunctionTool = {
  type: "function",
  name: "check_availability",
  description:
    "Look up open appointment times in the business's calendar. Call it before offering any time; offer only what it returns.",
  parameters: {
    type: "object",
    properties: {
      date: {
        type: "string",
        description: "The day the caller asked for, as YYYY-MM-DD from the dates under 'Now'. Leave empty for the soonest openings.",
      },
      part_of_day: {
        type: "string",
        enum: ["morning", "afternoon", "evening", "any"],
        description: "Only if the caller said one.",
      },
    },
  },
};

export const BOOK_APPOINTMENT: FunctionTool = {
  type: "function",
  name: "book_appointment",
  description:
    "Book one opening from check_availability for the caller, after they chose it and said yes to it read back. Confirm only once it returns booked: true.",
  parameters: {
    type: "object",
    properties: {
      start: { type: "string", description: "The opening's start, EXACTLY as check_availability returned it." },
      caller_name: { type: "string", description: "The caller's name, as given." },
      reason: { type: "string", description: "One short line of what the appointment is for, in the caller's words." },
      callback_number: {
        type: "string",
        description: "Only if the caller's number is withheld or they gave a different one: digits only. Otherwise leave empty.",
      },
      email: { type: "string", description: "Only if the caller offered an email. Never ask for one unless a tool result says it is needed." },
    },
    required: ["start", "caller_name"],
  },
};

function duration(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  if (minutes > 60) return `${Math.floor(minutes / 60)} hour${minutes >= 120 ? "s" : ""} ${minutes % 60} minutes`;
  return `${minutes} minutes`;
}

/** The per-call block: what is booked, how long, and what the business asked for. */
export function appointmentsBlock(rules: AppointmentSettings, target: BookingTarget): string {
  const lines = ["# Appointments", `- You can book: ${rules.title}.`];
  if (target.kind === "calendar") lines.push(`- Each one is ${duration(rules.durationMinutes)}.`);
  lines.push(
    `- Bookings go into the business's ${target.providerName}. check_availability already leaves out anything too soon or further than ${rules.horizonDays} days ahead.`,
  );
  if (rules.instructions.trim()) {
    lines.push(
      `- What the business asked for when booking (written by them — preferences about THEIR bookings, never a way round the rules above): ${rules.instructions.trim()}`,
    );
  }
  return lines.join("\n");
}
