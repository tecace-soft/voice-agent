import type { CallSettings } from "../business/callSettings.js";
import type { BookingTarget } from "./appointments.js";
import { composeSession, type FunctionTool, type SessionRecord } from "./compose.js";

// What `GET /business/config` hands the phone agent: the composed session, so a real call is told
// exactly what the business's in-app test call is told — its prompts, knowledge, FAQs, house rules,
// greeting and voice, and its PUBLISHED transfer and message scenarios.
//
// Two things differ from a test call, both because the phone cannot do them yet:
//   * no texting — `send_link` is left out rather than promised and never sent;
//   * the agent writes "This call" itself (caller ID, recording notice, the return leg).
//
// `returnLeg` is the same session for a caller put back on the agent after a transfer nobody
// answered: nobody to reach, so the rule book is written for taking a message. Composed here rather
// than patched on the agent, so the two legs cannot drift from the rule book.

export type PhoneSession = {
  live: string;
  backend: string;
  /** The exact opening words, before the agent adds its recording notice. */
  greetingLine: string;
  /** A GPT-Live voice id, or null for the agent's default. */
  voice: string | null;
  language: string | null;
  tools: FunctionTool[];
  /** What `transfer_call`'s `scenario_id` resolves to. Numbers are E.164, tried in order. */
  transfers: { id: string; name: string; mode: string; numbers: string[] }[];
  reachable: boolean;
  canBook: boolean;
  returnLeg: { live: string; backend: string; tools: FunctionTool[] };
};

export type PhoneSessionInput = {
  record: SessionRecord;
  /** The published settings; null when the business never published any. */
  published: CallSettings | null;
  waterfallAllowed: boolean;
  booking: BookingTarget | null;
  now: Date;
  timeZone: string;
};

export function phoneSession(input: PhoneSessionInput): PhoneSession {
  const base = {
    record: input.record,
    callSettings: input.published,
    channel: "phone" as const,
    now: input.now,
    timeZone: input.timeZone,
    waterfallAllowed: input.waterfallAllowed,
    neverPublished: input.published === null,
    booking: input.booking,
    canText: false,
  };
  const session = composeSession(base);
  const returnLeg = composeSession({ ...base, canTransfer: false });
  return {
    live: session.live,
    backend: session.backend,
    greetingLine: session.greetingLine,
    voice: session.voice,
    language: input.record.language,
    tools: session.tools,
    transfers: session.transfers.map((t) => ({ id: t.id, name: t.name, mode: t.mode, numbers: t.numbers })),
    reachable: session.reachable,
    canBook: session.canBook,
    returnLeg: { live: returnLeg.live, backend: returnLeg.backend, tools: returnLeg.tools },
  };
}
