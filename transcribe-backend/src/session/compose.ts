import type { BusinessProfile, CustomerPrompts } from "../demo/types.js";
import { quotedGreeting } from "../demo/prompt.js";
import {
  activeLinks,
  activeMessages,
  activeTransfers,
  readCallSettings,
  type CallSettings,
  type LinkScenario,
  type MessageScenario,
  type TransferScenario,
} from "../business/callSettings.js";
import { BACKEND_PREAMBLE, callRules, voicePreamble, type RuleTool } from "./callRules.js";
import {
  clockBlock,
  houseRulesBlock,
  linksBlock,
  messagesBlock,
  publicDemoBlock,
  thisCallBlock,
  transfersBlock,
} from "./blocks.js";
import { appointmentsBlock, BOOK_APPOINTMENT, CHECK_AVAILABILITY, type BookingTarget } from "./appointments.js";
import {
  agentNameOf,
  buildSessionGreetingPrompt,
  resolveGreetingLine,
  resolveSessionPrompts,
} from "./prompts.js";

// One place that decides what a call is told.
//
// Every way the receptionist can be reached goes through here: an operator's test call on a demo,
// a business's in-app test call, the phone agent's real calls, the public demo page, and the text
// simulator the regression suite runs. The point is that there is exactly one answer to "what will
// the receptionist do?", and the thing a business tests in the app is the thing its callers get.
//
// Order matters, for prompt caching as much as for reading: what never changes between calls (the
// rule book) comes first, then what changes when the business edits something (its prompts and
// instructions), then what is decided per call (who can be reached right now, the clock, the caller).

export type Channel = "app-test" | "phone" | "public-demo" | "sim";

/** Everything about a business, or a demo standing in for one, that a call is built from. */
export type SessionRecord = {
  profile: BusinessProfile;
  prompts: CustomerPrompts | null;
  agentName: string | null;
  voice: string | null;
  language: string | null;
  houseRules?: string | null;
  greeting?: string | null;
  /**
   * The single "put callers through to" number from before transfer scenarios existed. Used only
   * while the business has never published call settings (see `ComposeInput.neverPublished`), so a
   * business that set one up long ago keeps exactly the transfer it had — and one that published
   * "no transfers" on purpose does not get the old number back.
   */
  legacyTransferNumber?: string | null;
  legacyTransferTopics?: string | null;
};

export type FunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ComposeInput = {
  record: SessionRecord;
  /** Draft for a test call, published for a phone call, the demo's own for a demo. */
  callSettings: CallSettings | unknown;
  channel: Channel;
  now: Date;
  timeZone: string;
  /** The account's plan flag for waterfall transfers. A demo passes true. */
  waterfallAllowed: boolean;
  /** No call settings have ever been published: the legacy transfer number still applies. */
  neverPublished: boolean;
  /** Per-call facts for the channels this module writes them for (app-test, sim). */
  callerNumber?: string;
  recordingDisclosed?: boolean;
  /**
   * The business's connected calendar, when it has one with a place to book into. Booking is only
   * offered when this is set AND the settings switch it on. A demo passes nothing.
   */
  booking?: BookingTarget | null;
};

export type ComposedSession = {
  /** The voice model's instructions. */
  live: string;
  /** The delegate model's instructions. */
  backend: string;
  /** The exact opening words. */
  greetingLine: string;
  /** The instruction that makes the receptionist say them first. */
  greeting: string;
  voice: string | null;
  /** On the delegate model; the voice model cannot run tools. */
  tools: FunctionTool[];
  transfers: TransferScenario[];
  links: LinkScenario[];
  messages: MessageScenario[];
  /** Whether this call can put anyone through. */
  reachable: boolean;
  /** Whether this call can book appointments. */
  canBook: boolean;
};

export const LEGACY_SCENARIO_ID = "team";

/**
 * The old single transfer number, as a scenario. The phone prompt has always put a caller through
 * for anything to do with an appointment and whenever they ask for a person; that is carried over
 * as the "Use when", plus whatever extra topics the business listed.
 */
export function legacyScenario(number: string, topics?: string | null): TransferScenario {
  const extra = topics?.trim() ? ` Also: ${topics.trim()}` : "";
  return {
    id: LEGACY_SCENARIO_ID,
    enabled: true,
    mode: "cold",
    name: "Someone on the team",
    description: `The caller asks for a person, or wants to book, change or cancel an appointment.${extra}`,
    numbers: [number],
    collectBefore: "",
    holdMusic: "classical",
    hours: [],
  };
}

const END_CALL: FunctionTool = {
  type: "function",
  name: "end_call",
  description:
    "Hang up. Call it once the conversation is genuinely over — the caller is done, it was a wrong number, or a sales call you declined — right after your one short goodbye.",
  parameters: { type: "object", properties: {} },
};

function takeMessageTool(messages: MessageScenario[]): FunctionTool {
  const properties: Record<string, unknown> = {
    caller_name: { type: "string", description: "The caller's name, as given." },
    callback_number: {
      type: "string",
      description:
        "Digits only. Default to the number the call came from, given under 'This call' — do NOT ask a caller for the number they are calling you on. Only when it is withheld, or they give a different one, ask and read it back.",
    },
    message: { type: "string", description: "What the call is regarding, in one or two sentences." },
    requested_time: {
      type: "string",
      description: "When they want an appointment, in THEIR words. Leave empty if they did not say. Never convert it to a date.",
    },
  };
  if (messages.length) {
    properties.scenario = {
      type: "string",
      enum: messages.map((m) => m.name),
      description: "The situation from 'Taking messages for this business' this message fits, if any.",
    };
  }
  return {
    type: "function",
    name: "take_message",
    description:
      "Record a message for the team: when the caller wants a callback, turned down being put through, or there is nobody to put them through to.",
    parameters: { type: "object", properties, required: ["message"] },
  };
}

function transferTool(transfers: TransferScenario[]): FunctionTool {
  return {
    type: "function",
    name: "transfer_call",
    description:
      "Put the caller through to one of the people or teams listed under Transfers. Only after they asked for it or agreed to it.",
    parameters: {
      type: "object",
      properties: {
        scenario_id: {
          type: "string",
          enum: transfers.map((t) => t.id),
          description: "The scenario_id of the best match from the Transfers section.",
        },
        reason: {
          type: "string",
          description:
            "One sentence, in ENGLISH, of what the caller wants. It is read to the person before they accept, so make it specific.",
        },
        caller_name: {
          type: "string",
          description: "The caller's name if they said it at any point. Never guess.",
        },
      },
      required: ["scenario_id", "reason"],
    },
  };
}

function sendLinkTool(links: LinkScenario[]): FunctionTool {
  return {
    type: "function",
    name: "send_link",
    description: "Text the caller a link from 'Texting a link'. Only after they said yes to it.",
    parameters: {
      type: "object",
      properties: {
        scenario_id: {
          type: "string",
          enum: links.map((l) => l.id),
          description: "Which link to send.",
        },
        phone: {
          type: "string",
          description:
            "Only when the caller's own number is withheld or not a US number: the US mobile number they gave and confirmed, digits only. Otherwise leave empty.",
        },
      },
      required: ["scenario_id"],
    },
  };
}

function join(...parts: string[]): string {
  return parts.filter((p) => p.trim()).join("\n\n");
}

export function composeSession(input: ComposeInput): ComposedSession {
  const { record, channel, now, timeZone } = input;
  const settings = readCallSettings(input.callSettings);
  const businessName = record.profile.name;
  const agentName = agentNameOf(record.agentName);
  const language = record.language ?? undefined;

  // The public demo page gets the same tools as a test call: the page plays out the transfer, the
  // text and the booking on the prospect's screen (nothing really happens — see publicDemoBlock).
  const demo = channel === "public-demo";
  let transfers: TransferScenario[] = activeTransfers(settings, now, timeZone, input.waterfallAllowed);
  if (!demo && input.neverPublished && !settings.transfer.scenarios.length && record.legacyTransferNumber) {
    transfers = [legacyScenario(record.legacyTransferNumber, record.legacyTransferTopics)];
  }
  const links = activeLinks(settings);
  const messages = activeMessages(settings);
  const reachable = transfers.length > 0;
  const appointments = input.booking && settings.appointments.enabled ? settings.appointments : null;
  const canBook = appointments !== null;

  const tools: FunctionTool[] = [
    ...(reachable ? [transferTool(transfers)] : []),
    ...(links.length ? [sendLinkTool(links)] : []),
    ...(canBook ? [CHECK_AVAILABILITY, BOOK_APPOINTMENT] : []),
    takeMessageTool(messages),
    END_CALL,
  ];
  const ruleTools: RuleTool[] = tools.map((t) => ({ name: t.name, description: t.description }));

  // Stored prompts are rebuilt here too when nobody has edited them and they are out of date, so a
  // record last saved under an older builder still gets today's wording on its next call.
  const prompts = resolveSessionPrompts({
    current: record.prompts,
    profile: record.profile,
    agentName: record.agentName ?? "",
    language,
    greeting: record.greeting,
  });
  // A greeting instruction edited by hand in Custom training wins, as the stored live and backend
  // prompts do. Its quoted line is what gets said (and rendered ahead of time on a phone call).
  const handGreeting = prompts.edited && prompts.greeting.trim() ? prompts.greeting.trim() : null;
  const greetingLine =
    (handGreeting && quotedGreeting(handGreeting)) ||
    resolveGreetingLine(record.greeting, businessName, record.agentName ?? "", language);

  const rules = callRules({ businessName, agentName, reachable, canBook });
  const perCall = join(
    transfersBlock(transfers),
    linksBlock(links),
    messagesBlock(messages),
    appointments && input.booking ? appointmentsBlock(appointments, input.booking) : "",
    demo ? publicDemoBlock() : "",
    clockBlock(now, timeZone, record.profile),
    // The phone agent writes "This call" itself: it knows the caller, and whether this leg is the
    // caller coming back from a transfer nobody answered.
    channel === "phone"
      ? ""
      : thisCallBlock({
          callerNumber: input.callerNumber ?? "",
          greetingLine,
          recordingDisclosed: input.recordingDisclosed ?? false,
          test: channel === "app-test" || channel === "sim",
        }),
  );
  const house = houseRulesBlock(record.houseRules);

  return {
    live: join(voicePreamble(ruleTools), rules, prompts.live, house, perCall),
    backend: join(BACKEND_PREAMBLE, rules, prompts.backend, house, perCall),
    greetingLine,
    greeting: handGreeting ?? buildSessionGreetingPrompt(greetingLine),
    voice: record.voice,
    tools,
    transfers,
    links,
    messages,
    reachable,
    canBook,
  };
}
