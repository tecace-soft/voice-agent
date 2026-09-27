import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCallSettings } from "../src/settings/callSettings";
import { eventLine } from "../src/settings/simulator/eventLabels";

// The simulated line of an in-app test call, for the two appointment tools: check_availability and
// book_appointment go to the business's real calendar through the injected `bookingTool` runner
// (POST /business/calendar/tool), and what it answers is what the receptionist is told. A demo has
// no runner, and the tools must say so instead of throwing mid-call.
//
// The suite runs in node with no DOM (vitest.config.ts), so `useCallSimulator` is driven through a
// tiny stand-in for React's three hooks it uses: each render walks the same slots in the same order,
// a setter writes its slot, and "rendering again" is calling the hook again. That runs the hook's
// real code — refs read at call time, state appended by the tool handler — without a renderer.

const harness = vi.hoisted(() => ({ slots: [] as unknown[], i: 0 }));

vi.mock("react", () => ({
  useState: (init: unknown) => {
    const i = harness.i++;
    if (!(i in harness.slots)) harness.slots[i] = typeof init === "function" ? (init as () => unknown)() : init;
    const set = (next: unknown) => {
      harness.slots[i] = typeof next === "function" ? (next as (v: unknown) => unknown)(harness.slots[i]) : next;
    };
    return [harness.slots[i], set];
  },
  useRef: (init: unknown) => {
    const i = harness.i++;
    if (!(i in harness.slots)) harness.slots[i] = { current: init };
    return harness.slots[i];
  },
  useCallback: (fn: unknown) => {
    harness.i++;
    return fn;
  },
}));

const { useCallSimulator } = await import("../src/settings/simulator/useCallSimulator");
type Runner = NonNullable<Parameters<typeof useCallSimulator>[3]>;

const settings = emptyCallSettings();
const render = (bookingTool?: Runner) => {
  harness.i = 0;
  return useCallSimulator(settings, "Glow Clinic", "(206) 555-0100", bookingTool);
};
const tool = (name: string, args: Record<string, unknown> = {}) => ({ callId: `call-${name}`, name, args });
const lines = (events: { type: string; data: Record<string, unknown> }[]) => events.map(eventLine).filter(Boolean);

const OPENINGS = {
  available: true,
  openings: [
    { start: "2026-09-28T09:00:00-07:00", spoken: "Monday, September 28 at 9:00 AM" },
    { start: "2026-09-28T11:30:00-07:00", spoken: "Monday, September 28 at 11:30 AM" },
  ],
  note: "Offer two or three of these, as spoken. Book only a start from this list.",
};
const BOOKED = { booked: true, when: "Monday, September 28 at 9:00 AM", what: "Consultation" };
const REFUSED = {
  booked: false,
  message: "That time is no longer open.",
  other_openings: [{ start: "2026-09-28T11:30:00-07:00", spoken: "Monday, September 28 at 11:30 AM" }],
};

beforeEach(() => {
  harness.slots = [];
  harness.i = 0;
});

describe("appointment tools on a business test call", () => {
  it("routes check_availability to the calendar runner and hands its answer to the model", async () => {
    const runner = vi.fn<Runner>(async () => OPENINGS);
    const sim = render(runner);
    const result = await sim.onToolCall(tool("check_availability", { date: "2026-09-28", part_of_day: "morning" }));

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith("check_availability", { date: "2026-09-28", part_of_day: "morning" });
    expect(JSON.parse(result.output)).toEqual(OPENINGS);
    expect(result.resume).toBe(true);
    expect(result.hangup).toBeUndefined();

    const after = render(runner);
    expect(after.events.map((e) => e.type)).toEqual(["availability_checked"]);
    expect(after.events[0]!.data).toEqual({ args: { date: "2026-09-28", part_of_day: "morning" } });
    expect(lines(after.events)).toEqual(["Checked the calendar"]);
    expect(after.bookings).toEqual([]);
  });

  it("shows a successful booking on the line and as a 'Booked' event", async () => {
    const runner = vi.fn<Runner>(async () => BOOKED);
    const sim = render(runner);
    const args = { start: OPENINGS.openings[0]!.start, caller_name: "Jo Kim", reason: "First visit" };
    const result = await sim.onToolCall(tool("book_appointment", args));

    expect(runner).toHaveBeenCalledWith("book_appointment", args);
    expect(JSON.parse(result.output)).toEqual(BOOKED);
    expect(result.resume).toBe(true);

    const after = render(runner);
    expect(after.bookings).toEqual([{ when: BOOKED.when, callerName: "Jo Kim", reason: "First visit" }]);
    expect(after.events.map((e) => e.type)).toEqual(["booking_requested", "booking_made"]);
    expect(after.events[1]!.data).toEqual(BOOKED);
    expect(lines(after.events)).toEqual(["Booking asked for", `Booked: ${BOOKED.when}`]);
    // The call's report carries the same events.
    expect(after.reportExtras().events.map((e) => e.type)).toEqual(["booking_requested", "booking_made"]);
  });

  it("turns a refusal into 'booking_refused', books nothing, and passes the other openings on", async () => {
    const runner = vi.fn<Runner>(async () => REFUSED);
    const sim = render(runner);
    const result = await sim.onToolCall(tool("book_appointment", { start: OPENINGS.openings[0]!.start, caller_name: "Jo" }));

    expect(JSON.parse(result.output)).toEqual(REFUSED);
    expect(result.resume).toBe(true);
    const after = render(runner);
    expect(after.bookings).toEqual([]);
    expect(after.events.map((e) => e.type)).toEqual(["booking_requested", "booking_refused"]);
    expect(lines(after.events)).toEqual(["Booking asked for", "Booking refused (time no longer open)"]);
  });

  it("keeps a whole check-then-book exchange in order, and a second booking alongside the first", async () => {
    const runner = vi.fn<Runner>(async (name, args) =>
      name === "check_availability" ? OPENINGS : { booked: true, when: `when ${String(args.start)}`, what: "Consultation" },
    );
    const sim = render(runner);
    await sim.onToolCall(tool("check_availability"));
    await sim.onToolCall(tool("book_appointment", { start: "A", caller_name: "Jo" }));
    await sim.onToolCall(tool("book_appointment", { start: "B", caller_name: "Sam", reason: "Follow-up" }));

    const after = render(runner);
    expect(after.events.map((e) => e.type)).toEqual([
      "availability_checked",
      "booking_requested",
      "booking_made",
      "booking_requested",
      "booking_made",
    ]);
    expect(after.bookings).toEqual([
      { when: "when A", callerName: "Jo", reason: "" },
      { when: "when B", callerName: "Sam", reason: "Follow-up" },
    ]);
  });

  it("tells the model the calendar couldn't be reached when the runner throws, instead of failing the call", async () => {
    const runner = vi.fn<Runner>(async () => {
      throw new Error("502");
    });
    const sim = render(runner);
    for (const name of ["check_availability", "book_appointment"]) {
      const result = await sim.onToolCall(tool(name, { start: "x", caller_name: "Jo" }));
      expect(result.resume).toBe(true);
      expect(JSON.parse(result.output)).toEqual({
        ok: false,
        error: "The calendar couldn't be reached. Take a message with the time they want.",
      });
    }
    const after = render(runner);
    expect(after.bookings).toEqual([]);
    // A thrown runner logs that the booking failed, so the Events tab doesn't just stop at the ask.
    expect(after.events.map((e) => e.type)).toEqual(["availability_checked", "booking_requested", "booking_failed"]);
  });

  it("logs a backend error answer (e.g. no calendar connected) as a refusal and passes it through", async () => {
    const answer = { ok: false, error: "No calendar is connected.", instruction: "Tell the caller you can't book it right now." };
    const runner = vi.fn<Runner>(async () => answer);
    const sim = render(runner);
    const result = await sim.onToolCall(tool("book_appointment", { start: "x", caller_name: "Jo" }));
    expect(JSON.parse(result.output)).toEqual(answer);
    const after = render(runner);
    expect(after.bookings).toEqual([]);
    expect(after.events.map((e) => e.type)).toEqual(["booking_requested", "booking_refused"]);
    // The line carries the backend's reason, not a guess that the time was taken.
    expect(eventLine(after.events[1]!)).toBe("Booking refused: No calendar is connected.");
  });

  it("uses the runner of the latest render, even from a handler made before it", async () => {
    const stale = render();
    const runner = vi.fn<Runner>(async () => OPENINGS);
    render(runner);
    const result = await stale.onToolCall(tool("check_availability"));
    expect(runner).toHaveBeenCalledTimes(1);
    expect(JSON.parse(result.output)).toEqual(OPENINGS);
  });

  it("clears bookings and events on reset", async () => {
    const runner = vi.fn<Runner>(async () => BOOKED);
    const sim = render(runner);
    await sim.onToolCall(tool("book_appointment", { start: "A", caller_name: "Jo" }));
    expect(render(runner).bookings).toHaveLength(1);
    render(runner).reset();
    const after = render(runner);
    expect(after.bookings).toEqual([]);
    expect(after.events).toEqual([]);
    expect(after.reportExtras().events).toEqual([]);
  });
});

describe("appointment tools on a demo (no calendar runner)", () => {
  it("answers that booking isn't available on this call rather than throwing", async () => {
    const sim = render();
    for (const name of ["check_availability", "book_appointment"]) {
      const result = await sim.onToolCall(tool(name, { start: "2026-09-28T09:00:00-07:00", caller_name: "Jo" }));
      expect(JSON.parse(result.output)).toEqual({ error: "No calendar on this call." });
      expect(result.resume).toBe(true);
      expect(result.hangup).toBeUndefined();
    }
    const after = render();
    expect(after.bookings).toEqual([]);
    expect(after.events.map((e) => e.type)).toEqual(["availability_checked", "booking_requested"]);
    expect(after.events.some((e) => e.type === "booking_made" || e.type === "booking_refused")).toBe(false);
  });

  it("leaves the other tools as they were", async () => {
    const sim = render();
    const message = await sim.onToolCall(tool("take_message", { caller_name: "Jo", message: "Wants Tuesday at 9." }));
    expect(JSON.parse(message.output)).toEqual({ ok: true });
    const end = await sim.onToolCall(tool("end_call"));
    expect(end).toMatchObject({ resume: false, hangup: true });
    const unknown = await sim.onToolCall(tool("cancel_appointment"));
    expect(JSON.parse(unknown.output)).toEqual({ error: "unknown tool cancel_appointment" });
    expect(render().messages).toHaveLength(1);
  });
});

describe("event lines for bookings", () => {
  it("reads each booking event the way the Events tab shows it", () => {
    expect(eventLine({ type: "availability_checked", data: {} })).toBe("Checked the calendar");
    expect(eventLine({ type: "booking_requested", data: {} })).toBe("Booking asked for");
    expect(eventLine({ type: "booking_made", data: { when: "Monday at 9:00 AM" } })).toBe("Booked: Monday at 9:00 AM");
    expect(eventLine({ type: "booking_made", data: {} })).toBe("Booked");
    expect(eventLine({ type: "booking_refused", data: {} })).toBe("Booking refused (time no longer open)");
    expect(eventLine({ type: "booking_failed", data: {} })).toBe("Booking failed (calendar unreachable)");
  });
});
