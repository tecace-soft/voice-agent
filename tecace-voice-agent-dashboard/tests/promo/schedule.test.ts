import { describe, expect, it } from "vitest";
import { demoWeek, hoursUnknown, minutesOf, slotTimes } from "../../src/demos/lib/schedule";
import type { BusinessHour } from "../../src/demos/lib/types";

const weekday = (day: string, open: string, close: string): BusinessHour => ({
  day,
  open,
  close,
});

describe("minutesOf", () => {
  it("reads a time off the clock", () => {
    expect(minutesOf("09:00")).toBe(540);
    expect(minutesOf("9:30")).toBe(570);
    expect(minutesOf(" 17:45 ")).toBe(1065);
  });

  it("refuses anything that is not one", () => {
    for (const bad of [undefined, "", "closed", "9", "09:60", "25:00", "9am"]) {
      expect(minutesOf(bad)).toBeNull();
    }
  });
});

describe("slotTimes", () => {
  it("spreads three times across the day, clear of open and close", () => {
    expect(slotTimes("09:00", "17:00")).toEqual(["11:00", "13:00", "15:00"]);
  });

  it("handles a business that closes after midnight", () => {
    expect(slotTimes("18:00", "02:00")).toEqual(["20:00", "22:00", "00:00"]);
  });

  it("says nothing for a window too short to book inside", () => {
    expect(slotTimes("09:00", "10:00")).toEqual([]);
  });

  it("says nothing when the hours are not hours", () => {
    expect(slotTimes("", "")).toEqual([]);
    expect(slotTimes("morning", "evening")).toEqual([]);
  });
});

describe("demoWeek", () => {
  const hours = [
    weekday("Monday", "09:00", "17:00"),
    weekday("Tuesday", "09:00", "17:00"),
    weekday("Wednesday", "09:00", "17:00"),
    weekday("Thursday", "09:00", "17:00"),
    weekday("Friday", "09:00", "17:00"),
    { day: "Saturday", open: "", close: "", closed: true },
    { day: "Sunday", open: "", close: "", closed: true },
  ];

  it("always draws the seven days, in order", () => {
    const week = demoWeek(hours);
    expect(week.map((day) => day.short)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
  });

  it("takes the opening hours from the knowledge, which is the source of truth", () => {
    const week = demoWeek([
      weekday("Monday", "07:30", "15:30"),
      weekday("Tuesday", "10:00", "22:00"),
    ]);
    expect(week[0]!.hours).toBe("07:30 to 15:30");
    expect(week[1]!.hours).toBe("10:00 to 22:00");
    // Slots sit inside the window the business actually keeps.
    expect(week[0]!.slots.map((slot) => slot.time)).toEqual([
      "09:30",
      "11:30",
      "13:30",
    ]);
  });

  it("leaves a closed day closed and empty", () => {
    const week = demoWeek(hours);
    expect(week[5]).toMatchObject({ day: "Saturday", closed: true, slots: [] });
    expect(week[6]!.closed).toBe(true);
  });

  it("matches the day whatever case or padding research returned", () => {
    const week = demoWeek([{ day: "  monday ", open: "09:00", close: "17:00" }]);
    expect(week[0]!.hours).toBe("09:00 to 17:00");
  });

  it("books some slots and leaves the rest free", () => {
    const week = demoWeek(hours);
    const monday = week[0]!;
    expect(monday.slots.filter((slot) => slot.who)).toHaveLength(1);
    expect(monday.slots.filter((slot) => !slot.who).length).toBeGreaterThan(0);
  });

  it("draws the same week every time, because a diary that reshuffles is obviously fake", () => {
    expect(demoWeek(hours)).toEqual(demoWeek(hours));
  });

  it("gives no two bookings in one week the same name", () => {
    const booked = demoWeek(hours)
      .flatMap((day) => day.slots)
      .filter((slot) => slot.who)
      .map((slot) => slot.who);
    expect(new Set(booked).size).toBe(booked.length);
  });

  it("survives research that found no hours at all", () => {
    const week = demoWeek(undefined);
    expect(week).toHaveLength(7);
    expect(hoursUnknown(week)).toBe(true);
    expect(week.every((day) => day.slots.length === 0)).toBe(true);
  });

  it("does not call the week blank when one day is known", () => {
    expect(hoursUnknown(demoWeek([weekday("Monday", "09:00", "17:00")]))).toBe(
      false,
    );
  });
});
