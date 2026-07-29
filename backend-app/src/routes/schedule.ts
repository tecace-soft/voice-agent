import { Elysia, t } from "elysia";
import { env } from "../config/env.js";
import { listBookedTimes } from "../db/intakes.js";
import {
  checkAvailability,
  dateRange,
  localDateOf,
  slotsForDate,
  suggestSlots,
} from "../schedule/slots.js";

// How many days a single /schedule range query may span (guards response size).
const MAX_RANGE_DAYS = 62;

const DATE = t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }); // YYYY-MM-DD

// Schedule controller: exposes the bookable slot grid (what's taken vs. available),
// derived from booked intakes. Business-hours config lives in `env.schedule`.
export const schedule = new Elysia()
  // Slot grid over a date range. `from` required; `to` defaults to `from` (single day).
  .get(
    "/schedule",
    async ({ query, status }) => {
      const to = query.to ?? query.from;
      if (to < query.from) {
        return status(422, { status: "invalid_range", message: "`to` is before `from`." });
      }
      const dates = dateRange(query.from, to);
      if (dates.length > MAX_RANGE_DAYS) {
        return status(422, {
          status: "range_too_large",
          message: `Range spans ${dates.length} days; max is ${MAX_RANGE_DAYS}.`,
        });
      }

      // One bounded query for the taken times across the range, widened a day on each
      // side: a local slot's UTC instant can fall on the adjacent UTC date, and a booking
      // window near a boundary can reach into the range. Extra rows simply match no slot.
      const booked = await listBookedTimes(
        `${addDays(query.from, -1)}T00:00:00Z`,
        `${addDays(to, 2)}T00:00:00Z`,
      );

      const days = dates.map((d) => slotsForDate(env.schedule, d, booked));
      return {
        timezone: env.schedule.timezone,
        slotMinutes: env.schedule.slotMinutes,
        days,
      };
    },
    {
      query: t.Object({
        from: DATE,
        to: t.Optional(DATE),
      }),
    },
  )
  // Is one specific instant a free, valid slot? Used by the agent/form before booking.
  .get(
    "/schedule/availability",
    async ({ query }) => {
      const booked = await listBookedTimes();
      const result = checkAvailability(env.schedule, query.dateTime, booked, Date.now());
      return { dateTime: query.dateTime, ...result };
    },
    {
      query: t.Object({ dateTime: t.String({ format: "date-time" }) }),
    },
  )
  // Nearest available slots to a wanted time — the agent's fallback when the requested
  // slot is taken. Returns the requested slot's status plus alternatives, closest first.
  .get(
    "/schedule/suggestions",
    async ({ query }) => {
      const now = Date.now();
      const wantedDate = localDateOf(env.schedule.timezone, new Date(query.dateTime).getTime());
      const today = localDateOf(env.schedule.timezone, now);
      // The search anchors at today (for past wanted times), so cover both the wanted
      // window and today→today+withinDays. Widen a day each side for tz/boundary safety.
      const lo = wantedDate < today ? wantedDate : today;
      const hi = wantedDate > today ? wantedDate : today;
      const booked = await listBookedTimes(
        `${addDays(lo, -query.withinDays - 1)}T00:00:00Z`,
        `${addDays(hi, query.withinDays + 2)}T00:00:00Z`,
      );
      const requested = checkAvailability(env.schedule, query.dateTime, booked, now);
      const suggestions = suggestSlots(env.schedule, query.dateTime, booked, {
        limit: query.limit,
        withinDays: query.withinDays,
        now,
      });
      return {
        requested: { dateTime: query.dateTime, ...requested },
        suggestions,
      };
    },
    {
      query: t.Object({
        dateTime: t.String({ format: "date-time" }),
        limit: t.Integer({ minimum: 1, maximum: 20, default: 3 }),
        withinDays: t.Integer({ minimum: 1, maximum: 62, default: 14 }),
      }),
    },
  );

// Shift a "YYYY-MM-DD" date by N calendar days, returning "YYYY-MM-DD".
function addDays(date: string, days: number): string {
  const parts = date.split("-");
  const shifted = new Date(
    Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + days),
  );
  return shifted.toISOString().slice(0, 10);
}
