import { readCallSettings, type Window } from "../business/callSettings.js";
import type { BusinessHour } from "./types.js";
import { calendarSlots, pickSlots, type Interval, type PartOfDay } from "../calendar/availability.js";
import { spokenTime } from "../calendar/time.js";
import type { BookingTarget } from "../session/appointments.js";

// What the public demo page (`/c/<id>`) shows of the receptionist's call settings, and the demo
// calendar its call books into.
//
// The page is public, so it gets a summary rather than the settings: which transfers, links,
// message scenarios and bookings the operator set up, in the words a caller would use — never a
// staff member's phone number. A transfer says how many phones it rings, because the page plays
// the waterfall one phone at a time.
//
// The demo has no calendar. Its call books into this one: the openings are the booking rules laid
// over the business hours with nothing busy, and a booking is answered as made and saved nowhere.

export type PublicCapabilities = {
  transfers: {
    id: string;
    name: string;
    mode: "cold" | "warm" | "waterfall";
    description: string;
    collectBefore: string;
    rings: number;
    hours: Window[];
  }[];
  links: { id: string; triggers: string[]; text: string; url: string }[];
  messages: { id: string; name: string; brief: string }[];
  /** The booking rules as set, so the page can show them; null when booking is off. */
  appointments: {
    title: string;
    durationMinutes: number;
    bufferMinutes: number;
    minNoticeMinutes: number;
    horizonDays: number;
    hours: Window[];
    instructions: string;
  } | null;
  sms: { doubleOptIn: boolean };
  timezone: string | null;
};

/** The switched-on part of a demo's call settings, safe for a public page. */
export function publicCapabilities(raw: unknown): PublicCapabilities {
  const settings = readCallSettings(raw);
  return {
    transfers: settings.transfer.scenarios
      .filter((s) => s.enabled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        mode: s.mode,
        description: s.description,
        collectBefore: s.collectBefore,
        rings: s.numbers.length,
        hours: s.hours,
      })),
    links: settings.links.scenarios
      .filter((l) => l.enabled)
      .map((l) => ({ id: l.id, triggers: l.triggers, text: l.text, url: l.url })),
    messages: settings.messages.scenarios
      .filter((m) => m.enabled)
      .map((m) => ({ id: m.id, name: m.name, brief: m.brief })),
    appointments: settings.appointments.enabled
      ? {
          title: settings.appointments.title,
          durationMinutes: settings.appointments.durationMinutes,
          bufferMinutes: settings.appointments.bufferMinutes,
          minNoticeMinutes: settings.appointments.minNoticeMinutes,
          horizonDays: settings.appointments.horizonDays,
          hours: settings.appointments.hours,
          instructions: settings.appointments.instructions,
        }
      : null,
    sms: { doubleOptIn: settings.sms.doubleOptIn },
    timezone: settings.timezone ?? null,
  };
}

/** What the composer is told about the demo's calendar, when booking is switched on. */
export function demoBookingTarget(raw: unknown): BookingTarget | null {
  return readCallSettings(raw).appointments.enabled ? { providerName: "demo calendar", kind: "calendar" } : null;
}

const PARTS: PartOfDay[] = ["morning", "afternoon", "evening", "any"];

/**
 * check_availability / book_appointment for a demo call, answered in the shapes the real tools use
 * (`calendar/service.ts runAppointmentTool`) so the receptionist behaves as it would on a live line.
 * A booking is checked against the openings and then answered as made; nothing is stored.
 * `busy` marks times as taken — the scenario sandbox uses it to make a slot "full".
 */
export function runDemoAppointmentTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { settings: unknown; profileHours: BusinessHour[] | undefined; timeZone: string; now?: number; busy?: Interval[] },
): Record<string, unknown> {
  const rules = readCallSettings(ctx.settings).appointments;
  if (!rules.enabled) return { ok: false, error: "Booking is switched off for this business." };
  const now = ctx.now ?? Date.now();
  const starts = calendarSlots({ rules, profileHours: ctx.profileHours, busy: ctx.busy ?? [], now, timeZone: ctx.timeZone });
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  if (name === "check_availability") {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(args.date)) ? str(args.date) : undefined;
    const part = PARTS.includes(str(args.part_of_day) as PartOfDay) ? (str(args.part_of_day) as PartOfDay) : "any";
    const found = pickSlots(starts, ctx.timeZone, { date, partOfDay: part });
    if (found.length) {
      return { available: true, openings: found, note: "Offer two or three of these, as spoken. Book only a start from this list." };
    }
    const nearest = date ? pickSlots(starts, ctx.timeZone, { partOfDay: part, after: Date.parse(`${date}T00:00:00Z`) - 14 * 3_600_000 }, 4) : [];
    return nearest.length
      ? { available: false, message: "Nothing open then.", nearest_openings: nearest, note: "Offer two or three of these, as spoken. Book only a start from this list." }
      : { available: false, message: "There are no openings in the booking window. Offer to take a message instead." };
  }

  if (name === "book_appointment") {
    const start = Date.parse(str(args.start));
    if (!Number.isFinite(start)) {
      return { ok: false, error: "That isn't a time from check_availability.", instruction: "Check availability first, then book one of the times it returns." };
    }
    if (!starts.some((s) => Math.abs(s - start) < 60_000)) {
      return { booked: false, message: "That time is no longer open.", other_openings: pickSlots(starts, ctx.timeZone, { after: start - 3 * 3_600_000 }, 4) };
    }
    return {
      booked: true,
      when: spokenTime(start, ctx.timeZone),
      what: rules.title,
      demo: true,
      note: "This is the demo calendar: nothing was saved. Confirm the time as you would, and say once that on this demo it's only shown on screen.",
    };
  }

  return { error: `unknown tool ${name}` };
}
