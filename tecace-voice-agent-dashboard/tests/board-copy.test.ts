import { describe, expect, it } from "vitest";
import {
  DAYS,
  defaultAppointments,
  type AppointmentSettings,
  type TransferScenario,
  type Window,
} from "../src/settings/callSettings";
import {
  appointmentsCard,
  compactHours,
  displayPhone,
  hourLabel,
  messageCard,
  noticeLabel,
  timezoneCard,
  transferCard,
} from "../src/settings/setup/boardCopy";

// The wording on the guided setup's board cards — what a non-technical owner reads.

const weekdays = (open: string, close: string): Window[] =>
  DAYS.slice(0, 5).map((day) => ({ day, open, close }));

describe("hourLabel", () => {
  it("reads a 24-hour time the way people say it", () => {
    expect(hourLabel("09:00")).toBe("9am");
    expect(hourLabel("17:30")).toBe("5:30pm");
    expect(hourLabel("12:00")).toBe("12pm");
    expect(hourLabel("00:00")).toBe("12am");
  });
});

describe("compactHours", () => {
  it("says any time for no hours", () => {
    expect(compactHours([])).toBe("Any time");
  });

  it("names weekdays and every day", () => {
    expect(compactHours(weekdays("09:00", "17:00"))).toBe("Weekdays 9am–5pm");
    expect(compactHours(DAYS.map((day) => ({ day, open: "09:00", close: "17:00" })))).toBe("Every day 9am–5pm");
  });

  it("joins runs of days that share hours", () => {
    const hours: Window[] = [
      { day: "Saturday", open: "09:00", close: "13:00" },
      { day: "Monday", open: "09:00", close: "17:00" },
      { day: "Tuesday", open: "09:00", close: "17:00" },
      { day: "Wednesday", open: "09:00", close: "17:00" },
    ];
    expect(compactHours(hours)).toBe("Mon–Wed 9am–5pm · Sat 9am–1pm");
  });

  it("lists two windows on one day", () => {
    const hours: Window[] = [
      { day: "Monday", open: "13:00", close: "17:00" },
      { day: "Monday", open: "09:00", close: "12:00" },
    ];
    expect(compactHours(hours)).toBe("Mon 9am–12pm, 1pm–5pm");
  });
});

describe("displayPhone", () => {
  it("formats a US number and leaves anything else alone", () => {
    expect(displayPhone("+12065550100")).toBe("(206) 555-0100");
    expect(displayPhone("2065550100")).toBe("(206) 555-0100");
    expect(displayPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });
});

describe("noticeLabel", () => {
  it("reads minutes as minutes, hours or days", () => {
    expect(noticeLabel(0)).toBe("no");
    expect(noticeLabel(30)).toBe("30 minutes");
    expect(noticeLabel(60)).toBe("1 hour");
    expect(noticeLabel(120)).toBe("2 hours");
    expect(noticeLabel(1440)).toBe("1 day");
    expect(noticeLabel(2880)).toBe("2 days");
  });
});

describe("transferCard", () => {
  const sam: TransferScenario = {
    id: "t1",
    enabled: true,
    mode: "warm",
    name: "Sam",
    description: "Billing questions",
    numbers: ["+12065550100"],
    collectBefore: "The caller's name and the reason for the call",
    holdMusic: "classical",
    hours: weekdays("09:00", "17:00"),
  };

  it("describes a warm transfer", () => {
    expect(transferCard(sam)).toEqual({
      key: "transfer:t1",
      title: "Sam",
      tag: "Asks first",
      off: false,
      detail: [
        "Billing questions",
        "(206) 555-0100",
        "Weekdays 9am–5pm",
        "Asks for the caller's name and the reason for the call first",
      ],
    });
  });

  it("describes a cold transfer that's switched off, and a waterfall", () => {
    const cold = transferCard({
      ...sam,
      mode: "cold",
      enabled: false,
      description: "",
      hours: [],
      numbers: ["+12065550100", "+12065550101"],
    });
    expect(cold.tag).toBe("Straight through");
    expect(cold.off).toBe(true);
    expect(cold.detail).toEqual([
      "When callers ask for Sam",
      "(206) 555-0100 → (206) 555-0101",
      "Any time",
      "Puts the caller straight through",
    ]);
    expect(transferCard({ ...sam, mode: "waterfall" }).tag).toBe("One after another");
    expect(transferCard({ ...sam, collectBefore: "" }).detail[3]).toBe("Puts the caller straight through");
  });
});

describe("messageCard", () => {
  it("shows the brief, shortened", () => {
    const card = messageCard({ id: "m1", enabled: true, name: "Quote request", brief: "Ask for the address. ".repeat(10) });
    expect(card.key).toBe("message:m1");
    expect(card.title).toBe("Quote request");
    expect(card.off).toBe(false);
    expect(card.detail).toHaveLength(1);
    expect(card.detail[0]).toHaveLength(110);
    expect(card.detail[0]?.endsWith("…")).toBe(true);
  });

  it("says what it takes when there is no brief", () => {
    expect(messageCard({ id: "m2", enabled: false, name: "Other", brief: "" })).toEqual({
      key: "message:m2",
      title: "Other",
      detail: ["Takes the caller's name, number and what it's about"],
      off: true,
    });
  });
});

describe("appointmentsCard", () => {
  it("describes booking when it's on", () => {
    const a: AppointmentSettings = {
      ...defaultAppointments(),
      enabled: true,
      title: "Consultation",
      durationMinutes: 45,
      minNoticeMinutes: 1440,
      horizonDays: 14,
      instructions: "Ask what the appointment is for.",
    };
    const card = appointmentsCard(a);
    expect(card.key).toBe("appointments");
    expect(card.title).toBe("Books appointments");
    expect(card.off).toBeFalsy();
    expect(card.detail).toEqual([
      "Consultation · 45 min",
      "At least 1 day notice · up to 14 days ahead",
      "During business hours",
      "Ask what the appointment is for.",
    ]);
    expect(appointmentsCard({ ...a, title: "", instructions: "", hours: weekdays("09:00", "17:00") }).detail).toEqual([
      "Appointment · 45 min",
      "At least 1 day notice · up to 14 days ahead",
      "Weekdays 9am–5pm",
    ]);
  });

  it("says it isn't booking when it's off", () => {
    expect(appointmentsCard(defaultAppointments())).toEqual({
      key: "appointments",
      title: "Not booking appointments",
      detail: ["Takes the caller's preferred time as a message"],
      off: true,
    });
  });
});

describe("timezoneCard", () => {
  it("names the city of a set time zone", () => {
    expect(timezoneCard("America/Los_Angeles")).toEqual({
      key: "timezone",
      title: "Los Angeles",
      detail: ["America/Los_Angeles", "Used for transfer hours and booking times"],
    });
  });

  it("says who sets it when it's unset", () => {
    expect(timezoneCard(undefined)).toEqual({
      key: "timezone",
      title: "Not set",
      detail: ["The consultant sets it, or it's taken from your address"],
    });
  });
});
