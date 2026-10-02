import { describe, expect, it } from "bun:test";

// The sandbox: what each tool answers during a scenario run, and what it records. Nothing here may
// touch a real calendar, a real message list or a real phone.
//
// Run: bun test src/scenarios/sandbox.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { validateCallSettings } = await import("../business/callSettings.js");
const { runSandboxTool } = await import("./sandbox.js");
const { emptySandbox } = await import("./types.js");

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hours = DAYS.map((day) => ({ day, open: "09:00", close: "17:00" }));
const settings = validateCallSettings({ appointments: { enabled: true } }, { waterfallAllowed: false });
const TZ = "America/Los_Angeles";
const NOW = Date.parse("2026-10-01T17:00:00Z");
const SLOT = "2026-10-02T15:00:00-07:00";
const ctx = (world = {}) => ({ settings, profileHours: hours, timeZone: TZ, world, now: NOW });

describe("sandbox tools", () => {
  it("books an open time into the run, not the calendar, without the demo's note", () => {
    const { output, state } = runSandboxTool("book_appointment", { start: SLOT, caller_name: "Kim Minsu" }, emptySandbox(), ctx());
    expect(output.booked).toBe(true);
    expect(output).not.toHaveProperty("demo");
    expect(output).not.toHaveProperty("note");
    expect(state.bookings).toEqual([{ start: "2026-10-02T22:00:00.000Z", name: "Kim Minsu" }]);
    expect(state.calls.map((c) => c.name)).toEqual(["book_appointment"]);
  });

  it("treats a full slot as taken", () => {
    const { output, state } = runSandboxTool(
      "book_appointment",
      { start: SLOT, caller_name: "Kim Minsu" },
      emptySandbox(),
      ctx({ fullSlots: [SLOT] }),
    );
    expect(output.booked).toBe(false);
    expect(state.bookings).toEqual([]);
  });

  it("fails the tool it is told to, and records nothing but the call", () => {
    const { output, state } = runSandboxTool("take_message", { message: "hi" }, emptySandbox(), ctx({ failTool: "take_message" }));
    expect(output.ok).toBe(false);
    expect(state.messages).toEqual([]);
    expect(state.calls[0]!.ok).toBe(false);
  });

  it("takes a message, and a transfer goes unanswered by default", () => {
    let state = emptySandbox();
    ({ state } = runSandboxTool("take_message", { message: "quote", callback_number: "2065550134" }, state, ctx()));
    const transfer = runSandboxTool("transfer_call", { scenario_id: "front", reason: "x" }, state, ctx());
    expect(transfer.output.result).toBe("no_answer");
    expect(transfer.state.messages).toHaveLength(1);
    expect(transfer.state.calls.map((c) => c.name)).toEqual(["take_message", "transfer_call"]);
  });

  it("treats a slot already booked in the run as taken", () => {
    const first = runSandboxTool("book_appointment", { start: SLOT, caller_name: "Kim Minsu" }, emptySandbox(), ctx());
    const second = runSandboxTool("book_appointment", { start: SLOT, caller_name: "Lee" }, first.state, ctx());
    expect(second.output.booked).toBe(false);
    expect(second.state.bookings).toHaveLength(1);
  });

  it("answers availability from the sandbox calendar", () => {
    const { output } = runSandboxTool("check_availability", { date: "2026-10-02" }, emptySandbox(), ctx());
    expect(output.available).toBe(true);
  });
});
