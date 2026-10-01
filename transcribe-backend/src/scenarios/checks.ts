import { spokenTime } from "../calendar/time.js";
import type { Failure, SandboxState, ScenarioDefinition } from "./types.js";

// The exact half of grading. Free, deterministic, and run before the judge: a time, a phone number
// and a count are either right or wrong, and no model should be asked about them.

const digits = (s: string) => s.replace(/\D/g, "");
const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
const squash = (s: string) => s.toLowerCase().replace(/[\s\p{P}]/gu, "");
const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

/** Times as the same instant, numbers by their digits, anything else ignoring case and word order. */
function same(key: string, expected: string, actual: unknown): boolean {
  const got = text(actual);
  if (key === "start") {
    const a = Date.parse(expected);
    const b = Date.parse(got);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 60_000;
  }
  if (/number|phone/.test(key)) return digits(got).length > 0 && digits(got) === digits(expected);
  return words(got) === words(expected) || squash(got) === squash(expected);
}

function show(key: string, value: unknown, timeZone: string): string {
  const s = text(value);
  if (key === "start" && Number.isFinite(Date.parse(s))) return spokenTime(Date.parse(s), timeZone);
  return s || "(empty)";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function codeChecks(expect: ScenarioDefinition["expect"], state: SandboxState, timeZone: string): Failure[] {
  const out: Failure[] = [];
  const fail = (t: string) => out.push({ kind: "code", text: t });

  for (const want of expect.tools ?? []) {
    const named = state.calls.filter((c) => c.name === want.name);
    const wanted = Object.entries(want.args ?? {});
    if (want.times === 0) {
      const hits = named.filter((c) => wanted.every(([k, v]) => same(k, v, c.args[k])));
      if (hits.length) fail(`${want.name} was called ${plural(hits.length, "time", "times")} with these details; expected never.`);
      continue;
    }
    if (!named.length) {
      fail(`${want.name} was never called.`);
      continue;
    }
    // A call matches whatever the tool answered (S12 relies on a failed call counting); the final state proves what was saved.
    const matching = named.filter((c) => wanted.every(([k, v]) => same(k, v, c.args[k])));
    if (!matching.length) {
      const last = named[named.length - 1]!;
      const [key, value] = wanted.find(([k, v]) => !same(k, v, last.args[k]))!;
      fail(`${want.name}.${key}: expected ${show(key, value, timeZone)}, got ${show(key, last.args[key], timeZone)}.`);
      continue;
    }
    if (want.times !== undefined && matching.length !== want.times) {
      fail(`${want.name} was called ${plural(matching.length, "time", "times")} with these details; expected ${want.times}.`);
    }
  }

  for (const name of expect.forbidden ?? []) {
    if (state.calls.some((c) => c.name === name)) fail(`${name} was called, but this scenario must not call it.`);
  }

  const final = expect.final ?? {};
  if (final.bookings !== undefined && state.bookings.length !== final.bookings) {
    fail(`${plural(state.bookings.length, "booking", "bookings")} made; expected ${final.bookings}.`);
  }
  if (final.messages !== undefined && state.messages.length !== final.messages) {
    fail(`${plural(state.messages.length, "message", "messages")} taken; expected ${final.messages}.`);
  }
  return out;
}
