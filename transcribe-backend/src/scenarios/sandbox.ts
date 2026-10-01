import { readCallSettings } from "../business/callSettings.js";
import { runDemoAppointmentTool } from "../demo/publicDemo.js";
import type { BusinessHour } from "../demo/types.js";
import type { SandboxState, ScenarioDefinition, ToolCallRecord } from "./types.js";

// What a tool answers during a scenario run. Pure: the run's state goes in, the new state comes out,
// and the route stores it — on serverless nothing survives in memory between two tool calls.
//
// Bookings use the demo calendar (openings from the booking rules over the business hours), with the
// scenario's `fullSlots` marked busy. Nothing is written to a calendar, `appointment_bookings`,
// `inbound_calls`, SMS or Twilio.

export type SandboxContext = {
  settings: unknown;
  profileHours: BusinessHour[];
  timeZone: string;
  world: ScenarioDefinition["world"];
  now?: number;
};

const FAILED = { ok: false, error: "The system could not complete that just now." };

const TRANSFER_ANSWERS = {
  accepted: { result: "accepted", instruction: "They accepted. Tell the caller you're putting them through now." },
  declined: { result: "declined", instruction: "They can't take the call right now. Tell the caller, and offer to take a message." },
  no_answer: { result: "no_answer", instruction: "Nobody picked up. Tell the caller, and offer to take a message." },
} as const;

export function runSandboxTool(
  name: string,
  args: Record<string, unknown>,
  state: SandboxState,
  ctx: SandboxContext,
): { output: Record<string, unknown>; state: SandboxState } {
  const at = new Date(ctx.now ?? Date.now()).toISOString();
  const record = (ok: boolean, output: Record<string, unknown>, change: Partial<Omit<SandboxState, "calls">> = {}) => {
    const call: ToolCallRecord = { name, args, ok, output, at };
    return { output, state: { ...state, ...change, calls: [...state.calls, call] } };
  };

  if (ctx.world.failTool === name) return record(false, { ...FAILED });

  switch (name) {
    case "check_availability":
    case "book_appointment": {
      const length = readCallSettings(ctx.settings).appointments.durationMinutes * 60_000;
      const busy = [...(ctx.world.fullSlots ?? []), ...state.bookings.map((b) => b.start)]
        .map((s) => Date.parse(s))
        .filter(Number.isFinite)
        .map((start) => ({ start, end: start + length }));
      const output = runDemoAppointmentTool(name, args, {
        settings: ctx.settings,
        profileHours: ctx.profileHours,
        timeZone: ctx.timeZone,
        now: ctx.now,
        busy,
      });
      const ok = !("error" in output);
      if (name === "check_availability") return record(ok, output);
      // The demo calendar's "nothing was saved, say it's a demo" is for the public page only.
      const { demo: _demo, note: _note, ...answer } = output;
      if (answer.booked !== true) return record(ok, answer);
      const start = new Date(Date.parse(String(args.start))).toISOString();
      return record(true, answer, { bookings: [...state.bookings, { start, name: String(args.caller_name ?? "") }] });
    }
    case "take_message":
      return record(true, { recorded: true }, { messages: [...state.messages, args] });
    case "transfer_call":
      return record(true, { ...TRANSFER_ANSWERS[ctx.world.transferAnswer ?? "no_answer"] });
    case "end_call":
      return record(true, { ok: true });
    default:
      return record(false, { error: `unknown tool ${name}` });
  }
}
