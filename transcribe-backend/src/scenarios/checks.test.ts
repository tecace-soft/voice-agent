import { describe, expect, it } from "bun:test";

// The exact half of grading: tool calls, their details, and what the run left behind.
//
// Run: bun test src/scenarios/checks.test.ts
process.env.DATABASE_URL ??= "postgres://unused/unused";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123";

const { codeChecks } = await import("./checks.js");
import type { SandboxState } from "./types.js";

const TZ = "America/Los_Angeles";
const call = (name: string, args: Record<string, unknown>) => ({ name, args, ok: true, output: {}, at: "2026-10-01T17:00:00Z" });
const state = (calls: SandboxState["calls"], bookings = 0, messages = 0): SandboxState => ({
  calls,
  bookings: Array.from({ length: bookings }, () => ({ start: "2026-10-02T23:00:00.000Z", name: "Kim" })),
  messages: Array.from({ length: messages }, () => ({})),
});

describe("codeChecks", () => {
  it("passes the corrected time compared as an instant", () => {
    const expect_ = { tools: [{ name: "book_appointment", args: { start: "2026-10-02T16:00:00-07:00" }, times: 1 }], final: { bookings: 1 } };
    const run = state([call("book_appointment", { start: "2026-10-02T23:00:00Z" })], 1);
    expect(codeChecks(expect_, run, TZ)).toEqual([]);
  });

  it("names the wrong value", () => {
    const expect_ = { tools: [{ name: "book_appointment", args: { start: "2026-10-02T16:00:00-07:00" }, times: 1 }] };
    const run = state([call("book_appointment", { start: "2026-10-02T15:00:00-07:00" })], 1);
    expect(codeChecks(expect_, run, TZ)).toEqual([
      { kind: "code", text: "book_appointment.start: expected Friday, October 2 at 4:00 PM, got Friday, October 2 at 3:00 PM." },
    ]);
  });

  it("compares phone numbers by digits, and catches a call that never happened", () => {
    const expect_ = {
      tools: [
        { name: "take_message", args: { callback_number: "2065550135" } },
        { name: "transfer_call" },
      ],
    };
    const run = state([call("take_message", { callback_number: "(206) 555-0135" })]);
    expect(codeChecks(expect_, run, TZ)).toEqual([{ kind: "code", text: "transfer_call was never called." }]);
  });

  it("flags forbidden tools, repeat calls and the final state", () => {
    const expect_ = {
      tools: [{ name: "take_message", times: 1 }],
      forbidden: ["book_appointment"],
      final: { bookings: 0, messages: 1 },
    };
    const run = state([call("take_message", {}), call("take_message", {}), call("book_appointment", {})], 1, 2);
    expect(codeChecks(expect_, run, TZ).map((f) => f.text)).toEqual([
      "take_message was called 2 times with these details; expected 1.",
      "book_appointment was called, but this scenario must not call it.",
      "1 booking made; expected 0.",
      "2 messages taken; expected 1.",
    ]);
  });
});

describe("codeChecks refinements", () => {
  const never = { tools: [{ name: "book_appointment", args: { start: "2026-10-02T16:00:00-07:00" }, times: 0 }] };
  it("times 0: never called is fine", () => {
    expect(codeChecks(never, state([]), TZ)).toEqual([]);
  });
  it("times 0: called with other details is fine", () => {
    expect(codeChecks(never, state([call("book_appointment", { start: "2026-10-03T16:00:00-07:00" })]), TZ)).toEqual([]);
  });
  it("times 0: called with matching details fails", () => {
    expect(codeChecks(never, state([call("book_appointment", { start: "2026-10-02T23:00:00Z" })]), TZ).map((f) => f.text)).toEqual([
      "book_appointment was called 1 time with these details; expected never.",
    ]);
  });
  it("ignores spaces and punctuation in names", () => {
    const run = state([call("take_message", { caller_name: "Kim Minsu." }), call("take_message", { caller_name: "김민수" })]);
    expect(codeChecks({ tools: [{ name: "take_message", args: { caller_name: "Kim Minsu" }, times: 1 }] }, run, TZ)).toEqual([]);
    expect(codeChecks({ tools: [{ name: "take_message", args: { caller_name: "김 민수" }, times: 1 }] }, run, TZ)).toEqual([]);
  });
  it("singular count message", () => {
    const run = state([call("take_message", {})]);
    expect(codeChecks({ tools: [{ name: "take_message", times: 2 }] }, run, TZ).map((f) => f.text)).toEqual([
      "take_message was called 1 time with these details; expected 2.",
    ]);
  });
});
