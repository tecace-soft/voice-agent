import {
  CallSettingsError,
  DEFAULT_COLLECT_BEFORE,
  DEFAULT_HOLD_MUSIC,
  newScenarioId,
  validateCallSettings,
  type CallSettings,
  type Day,
  type MessageScenario,
  type TransferScenario,
  type Window,
} from "../business/callSettings.js";
import { DAYS, clockTime, dayName } from "../business/profileShape.js";
import type { StoredCallSettings } from "../db/callSettings.js";
import type { BusinessHour } from "../demo/types.js";
import type { BookingTarget } from "../session/appointments.js";
import type { SetupFunctionTool } from "./llm.js";
import { SETUP_TOPICS, type SetupChange, type SetupTopic, type TopicStatus } from "./types.js";

// The setup consultant's hands: the function tools it calls to write a business's call-settings
// DRAFT, and their executors.
//
// Every write is the loaded draft with one thing changed, run through validateCallSettings — the
// same gate as PUT /business/call-settings — and saved only if it passes. The consultant cannot
// write anything the settings screen would refuse, and a refusal comes back to the model as a
// result naming the field, so it can fix its input or ask the owner. Executors never throw: a turn
// that dies mid-tool leaves the customer with no reply and no idea what was saved.
//
// The store is injected so the executors run in a unit test against memory; the route hands in the
// real findCallSettings / saveCallSettingsDraft.

/** The two draft operations, injected so the executors run in a unit test with an in-memory store. */
export type DraftStore = {
  load(): Promise<StoredCallSettings>;
  save(draft: CallSettings): Promise<StoredCallSettings>;
};

export type ToolContext = {
  store: DraftStore;
  /** The business's own line, E.164 — never a transfer target. */
  agentNumber: string | null;
  /** Null = no calendar connected. */
  calendar: BookingTarget | null;
  /** For use_business_hours. */
  profileHours: BusinessHour[];
  /** draft.timezone ?? the service default. */
  timeZone: string;
  /** Mutated by mark_topic / finish_interview. */
  topics: Record<SetupTopic, TopicStatus>;
  /** Set by finish_interview. */
  finished: boolean;
};

export type ToolOutcome = {
  /** What the model is told, serialised to JSON as the function_call_output. */
  output: Record<string, unknown>;
  change?: SetupChange;
};

// ---- schemas ----

const HOURS_SCHEMA = {
  type: "array",
  description:
    "When it may be used, in the business's time zone, 24h HH:MM. Empty = always. Split overnight ranges at midnight.",
  items: {
    type: "object",
    properties: {
      day: { type: "string", enum: [...DAYS] },
      open: { type: "string" },
      close: { type: "string" },
    },
    required: ["day", "open", "close"],
  },
};

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): SetupFunctionTool => ({
  type: "function",
  name,
  description,
  parameters: { type: "object", properties, ...(required.length ? { required } : {}) },
  strict: false,
});

export const SETUP_TOOLS: SetupFunctionTool[] = [
  tool(
    "get_current_setup",
    "Read the current draft, topics, agent number and calendar status. Use after several writes, or when unsure of an id.",
    {},
  ),
  tool(
    "upsert_transfer_scenario",
    "Add a transfer, or change one by id. Fields omitted on an update keep their value. Saved only when the result says ok:true.",
    {
      id: { type: "string", description: "Only to change an existing transfer: its id from the current setup. Omit to add one." },
      name: { type: "string", description: 'Who the caller is put through to, as they\'d ask: "Sam", "Billing", "Front desk". Max 80.' },
      description: {
        type: "string",
        description: "When to use it and when not to — plain sentences the receptionist reads word for word. Max 500.",
      },
      number: {
        type: "string",
        description: "The one US number to dial, e.g. (206) 555-0134. No extensions. Never the receptionist's own number.",
      },
      ask_first: {
        type: "boolean",
        description: "true: collect a few things before dialling (default: name and reason). false: straight through.",
      },
      collect_before: {
        type: "string",
        description: 'With ask_first: what to collect, e.g. "The caller\'s name, account number and reason". Max 200.',
      },
      hours: HOURS_SCHEMA,
      use_business_hours: {
        type: "boolean",
        description: "true: hours = the business's opening hours from its profile (overrides `hours`).",
      },
      enabled: { type: "boolean" },
    },
  ),
  tool("remove_transfer_scenario", "Remove a transfer by id.", { id: { type: "string" } }, ["id"]),
  tool(
    "upsert_message_scenario",
    "Add a message situation with a brief of what to ask, or change one by id.",
    {
      id: { type: "string", description: "Only to change an existing situation: its id from the current setup. Omit to add one." },
      name: { type: "string", description: 'The situation: "Quote request", "After hours". Max 80.' },
      brief: { type: "string", description: "What to ask in that situation, one thing at a time, and any tone to keep. Max 500." },
      enabled: { type: "boolean" },
    },
  ),
  tool("remove_message_scenario", "Remove a message situation by id.", { id: { type: "string" } }, ["id"]),
  tool(
    "set_appointments",
    "Switch booking rules on or off and set them. Fields omitted keep their value. Does NOT connect a calendar.",
    {
      enabled: { type: "boolean" },
      title: { type: "string", description: 'What a booking is called: "Consultation". Max 80.' },
      duration_minutes: { type: "integer", minimum: 5, maximum: 480 },
      buffer_minutes: { type: "integer", minimum: 0, maximum: 240 },
      min_notice_minutes: { type: "integer", minimum: 0, maximum: 20160 },
      horizon_days: { type: "integer", minimum: 1, maximum: 180 },
      hours: HOURS_SCHEMA,
      use_business_hours: { type: "boolean" },
      instructions: {
        type: "string",
        description: "What the receptionist should know when booking: who it's for, what to ask first. Max 500.",
      },
    },
    ["enabled"],
  ),
  tool(
    "set_timezone",
    "The IANA zone every hours window is in, e.g. America/New_York. Set it before any hours when the business is not in the default zone.",
    { timezone: { type: "string" } },
    ["timezone"],
  ),
  tool(
    "mark_topic",
    "Record that a topic is done or skipped, once the customer has confirmed or declined it.",
    {
      topic: { type: "string", enum: [...SETUP_TOPICS] },
      status: { type: "string", enum: ["done", "skipped"] },
    },
    ["topic", "status"],
  ),
  tool(
    "finish_interview",
    "End the setup once every topic is done or skipped, or the owner says they're done. Call it in the same reply as your two-line summary and the Publish reminder. Pending topics are marked skipped.",
    {},
  ),
];

// ---- helpers ----

type Args = Record<string, unknown>;

const has = (args: Args, key: string) => args[key] !== undefined && args[key] !== null;
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** (206) 555-0134 for a US number in E.164; anything else as it stands. */
export function displayNumber(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : e164;
}

/**
 * A profile's opening hours as scenario windows. Closed and blank days are left out; an overnight
 * range is split at midnight, the way the hours rule asks. A time this can't read is passed through
 * as written, so validateCallSettings refuses it by name rather than the day vanishing.
 */
export function profileHoursToWindows(hours: BusinessHour[]): Window[] {
  const out: Window[] = [];
  for (const hour of hours) {
    const day = dayName(hour.day) as Day | "";
    if (!day || hour.closed || !str(hour.open) || !str(hour.close)) continue;
    const open = clockTime(hour.open) || str(hour.open);
    const close = clockTime(hour.close) || str(hour.close);
    if (/^\d{2}:\d{2}$/.test(open) && /^\d{2}:\d{2}$/.test(close) && close !== "00:00" && close < open) {
      const next = DAYS[(DAYS.indexOf(day) + 1) % DAYS.length]!;
      out.push({ day, open, close: "24:00" }, { day: next, open: "00:00", close });
    } else {
      out.push({ day, open, close });
    }
  }
  return out;
}

/** The draft as the model reads it (also used by prompt.ts). Numbers shown as (206) 555-0134. */
export function summarizeDraft(
  draft: CallSettings,
  ctx: Pick<ToolContext, "agentNumber" | "calendar" | "timeZone" | "topics">,
): Record<string, unknown> {
  const a = draft.appointments;
  return {
    timeZone: draft.timezone ?? ctx.timeZone,
    agentNumber: ctx.agentNumber ? displayNumber(ctx.agentNumber) : null,
    calendar: ctx.calendar ? ctx.calendar.providerName : null,
    topics: ctx.topics,
    transfers: draft.transfer.scenarios.map((s) => ({
      id: s.id,
      name: s.name,
      enabled: s.enabled,
      number: s.numbers.map(displayNumber).join(", "),
      asksFirst: s.mode !== "cold",
      collectBefore: s.collectBefore,
      description: s.description,
      hours: s.hours ?? [],
    })),
    messages: draft.messages.scenarios.map((s) => ({ id: s.id, name: s.name, enabled: s.enabled, brief: s.brief })),
    appointments: {
      enabled: a.enabled,
      title: a.title,
      durationMinutes: a.durationMinutes,
      bufferMinutes: a.bufferMinutes,
      minNoticeMinutes: a.minNoticeMinutes,
      horizonDays: a.horizonDays,
      hours: a.hours,
      instructions: a.instructions,
    },
  };
}

const EXISTING_INVALID =
  "An existing setting is invalid, not the one you changed. Fix it with the matching tool or tell the customer to fix it in Settings.";

function refuse(field: string | undefined, message: string, extra: Record<string, unknown> = {}): ToolOutcome {
  return { output: { ok: false, ...(field ? { field } : {}), message, ...extra } };
}

/**
 * Validate the patched draft and save it, or say what was wrong.
 *
 * `touched` is the path of what this call changed (null for a removal). A refusal elsewhere gets a
 * hint only when the draft as loaded fails too: then the fault really was there before this call —
 * a draft copied from a demo whose number is now this business's own line. A clash this call caused
 * can land on another scenario's field (the later of two equal numbers), and blaming "an existing
 * setting" for that would send the model off to fix the wrong one.
 */
async function commit(
  ctx: ToolContext,
  current: StoredCallSettings,
  patched: CallSettings,
  touched: string | null,
  describe: (saved: CallSettings) => SetupChange,
): Promise<ToolOutcome> {
  const rules = { agentNumber: ctx.agentNumber, waterfallAllowed: current.waterfallAllowed };
  let checked: CallSettings;
  try {
    checked = validateCallSettings(patched, rules);
  } catch (err) {
    if (!(err instanceof CallSettingsError)) throw err;
    const ours = touched !== null && (err.field === touched || err.field.startsWith(`${touched}.`));
    let before = true;
    try {
      validateCallSettings(current.draft, rules);
    } catch {
      before = false;
    }
    return refuse(err.field, err.message, !ours && !before ? { hint: EXISTING_INVALID } : {});
  }
  await ctx.store.save(checked);
  const change = describe(checked);
  return { output: { ok: true, change }, change };
}

function hoursFrom(args: Args, ctx: ToolContext): Window[] | undefined {
  if (args.use_business_hours === true) return profileHoursToWindows(ctx.profileHours);
  return has(args, "hours") ? (args.hours as Window[]) : undefined;
}

// ---- executors ----

async function upsertTransfer(args: Args, ctx: ToolContext): Promise<ToolOutcome> {
  const current = await ctx.store.load();
  const patched = structuredClone(current.draft);
  const scenarios = patched.transfer.scenarios;
  const id = str(args.id);
  let index: number;
  let op: "add" | "update";

  if (id) {
    index = scenarios.findIndex((s) => s.id === id);
    if (index < 0) {
      return refuse(undefined, `No transfer with id ${id}. Omit id to add a new one.`, { ids: scenarios.map((s) => s.id) });
    }
    op = "update";
  } else {
    if (!str(args.name)) return refuse("name", "Give the transfer a name: who the caller is put through to.");
    if (!str(args.number)) return refuse("number", "Give the one number to put callers through to.");
    index = scenarios.length;
    scenarios.push({
      id: newScenarioId(),
      enabled: true,
      mode: "cold",
      name: "",
      description: "",
      numbers: [],
      collectBefore: "",
      holdMusic: DEFAULT_HOLD_MUSIC,
      hours: [],
    });
    op = "add";
  }

  const scenario: TransferScenario = scenarios[index]!;
  if (has(args, "name")) scenario.name = args.name as string;
  if (has(args, "description")) scenario.description = args.description as string;
  if (has(args, "number")) scenario.numbers = [args.number as string];
  if (has(args, "enabled")) scenario.enabled = args.enabled as boolean;
  // Warm or cold only: waterfall is a plan feature the consultant never switches on.
  if (args.ask_first === true) {
    scenario.mode = "warm";
    scenario.collectBefore = str(args.collect_before) || scenario.collectBefore || DEFAULT_COLLECT_BEFORE;
  } else if (args.ask_first === false) {
    scenario.mode = "cold";
    scenario.collectBefore = "";
  } else if (has(args, "collect_before")) {
    scenario.collectBefore = args.collect_before as string;
  }
  const hours = hoursFrom(args, ctx);
  if (hours) scenario.hours = hours;

  return commit(ctx, current, patched, `transfer.scenarios[${index}]`, (saved) => {
    const s = saved.transfer.scenarios[index]!;
    return { kind: "transfer", op, id: s.id, label: `Transfer "${s.name}" → ${s.numbers.map(displayNumber).join(", ")}` };
  });
}

async function removeTransfer(args: Args, ctx: ToolContext): Promise<ToolOutcome> {
  const current = await ctx.store.load();
  const patched = structuredClone(current.draft);
  const id = str(args.id);
  const found = patched.transfer.scenarios.find((s) => s.id === id);
  if (!found) {
    return refuse(undefined, `No transfer with id ${id}.`, { ids: patched.transfer.scenarios.map((s) => s.id) });
  }
  patched.transfer.scenarios = patched.transfer.scenarios.filter((s) => s.id !== id);
  return commit(ctx, current, patched, null, () => ({
    kind: "transfer",
    op: "remove",
    id,
    label: `Removed transfer "${found.name}"`,
  }));
}

async function upsertMessage(args: Args, ctx: ToolContext): Promise<ToolOutcome> {
  const current = await ctx.store.load();
  const patched = structuredClone(current.draft);
  const scenarios = patched.messages.scenarios;
  const id = str(args.id);
  let index: number;
  let op: "add" | "update";

  if (id) {
    index = scenarios.findIndex((s) => s.id === id);
    if (index < 0) {
      return refuse(undefined, `No message situation with id ${id}. Omit id to add a new one.`, {
        ids: scenarios.map((s) => s.id),
      });
    }
    op = "update";
  } else {
    if (!str(args.name)) return refuse("name", "Give the situation a name, like Quote request.");
    if (!str(args.brief)) return refuse("brief", "Say what to ask callers in this situation.");
    index = scenarios.length;
    scenarios.push({ id: newScenarioId(), enabled: true, name: "", brief: "" });
    op = "add";
  }

  const scenario: MessageScenario = scenarios[index]!;
  if (has(args, "name")) scenario.name = args.name as string;
  if (has(args, "brief")) scenario.brief = args.brief as string;
  if (has(args, "enabled")) scenario.enabled = args.enabled as boolean;

  return commit(ctx, current, patched, `messages.scenarios[${index}]`, (saved) => {
    const s = saved.messages.scenarios[index]!;
    return { kind: "message", op, id: s.id, label: `Message situation "${s.name}"` };
  });
}

async function removeMessage(args: Args, ctx: ToolContext): Promise<ToolOutcome> {
  const current = await ctx.store.load();
  const patched = structuredClone(current.draft);
  const id = str(args.id);
  const found = patched.messages.scenarios.find((s) => s.id === id);
  if (!found) {
    return refuse(undefined, `No message situation with id ${id}.`, { ids: patched.messages.scenarios.map((s) => s.id) });
  }
  patched.messages.scenarios = patched.messages.scenarios.filter((s) => s.id !== id);
  return commit(ctx, current, patched, null, () => ({
    kind: "message",
    op: "remove",
    id,
    label: `Removed message situation "${found.name}"`,
  }));
}

const APPOINTMENT_FIELDS: [string, keyof CallSettings["appointments"]][] = [
  ["enabled", "enabled"],
  ["title", "title"],
  ["duration_minutes", "durationMinutes"],
  ["buffer_minutes", "bufferMinutes"],
  ["min_notice_minutes", "minNoticeMinutes"],
  ["horizon_days", "horizonDays"],
  ["instructions", "instructions"],
];

async function setAppointments(args: Args, ctx: ToolContext): Promise<ToolOutcome> {
  const current = await ctx.store.load();
  const patched = structuredClone(current.draft);
  const rules = patched.appointments as Record<string, unknown>;
  for (const [arg, field] of APPOINTMENT_FIELDS) {
    if (has(args, arg)) rules[field] = args[arg];
  }
  const hours = hoursFrom(args, ctx);
  if (hours) patched.appointments.hours = hours;

  let switchedOn = false;
  const outcome = await commit(ctx, current, patched, "appointments", (saved) => {
    const a = saved.appointments;
    switchedOn = a.enabled;
    return {
      kind: "appointments",
      op: "update",
      label: a.enabled ? `Appointments: on, ${a.durationMinutes} min, up to ${a.horizonDays} days ahead` : "Appointments: off",
    };
  });
  // Saved rules are not booking: the owner should hear that before believing callers can book.
  if (switchedOn && ctx.calendar === null) {
    outcome.output.note =
      "Rules saved. Booking only starts once a calendar is connected in the Appointments section and the settings are published.";
  }
  return outcome;
}

async function setTimezone(args: Args, ctx: ToolContext): Promise<ToolOutcome> {
  const timezone = str(args.timezone);
  if (!timezone) return refuse("timezone", "Give an IANA time zone, like America/New_York.");
  const current = await ctx.store.load();
  const patched = structuredClone(current.draft);
  patched.timezone = timezone;
  return commit(ctx, current, patched, "timezone", (saved) => ({
    kind: "timezone",
    op: "update",
    label: `Time zone: ${saved.timezone}`,
  }));
}

function markTopic(args: Args, ctx: ToolContext): ToolOutcome {
  const topic = args.topic as SetupTopic;
  const status = args.status as TopicStatus;
  if (!SETUP_TOPICS.includes(topic)) return refuse("topic", `Topic must be one of ${SETUP_TOPICS.join(", ")}.`);
  if (status !== "done" && status !== "skipped") return refuse("status", "Status must be done or skipped.");
  ctx.topics[topic] = status;
  return { output: { ok: true, topics: { ...ctx.topics } } };
}

function finishInterview(ctx: ToolContext): ToolOutcome {
  for (const topic of SETUP_TOPICS) {
    if (ctx.topics[topic] === "pending") ctx.topics[topic] = "skipped";
  }
  ctx.finished = true;
  return {
    output: {
      ok: true,
      // One order with the prompt: the summary, the Publish reminder and this call go out in the same
      // reply. If the summary was already written alongside the call, the turn ends on it.
      next: "The setup is closed. If you have not already, reply now with a two-line summary of what was set up and a reminder that nothing is live until they press Publish. No question at the end — the chat closes after this reply.",
    },
  };
}

export async function executeSetupTool(name: string, rawArguments: string, ctx: ToolContext): Promise<ToolOutcome> {
  let args: Args;
  try {
    const parsed = rawArguments.trim() ? JSON.parse(rawArguments) : {};
    args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return refuse(undefined, "Arguments were not valid JSON.");
  }

  try {
    switch (name) {
      case "get_current_setup": {
        const current = await ctx.store.load();
        return { output: { ok: true, ...summarizeDraft(current.draft, ctx) } };
      }
      case "upsert_transfer_scenario":
        return await upsertTransfer(args, ctx);
      case "remove_transfer_scenario":
        return await removeTransfer(args, ctx);
      case "upsert_message_scenario":
        return await upsertMessage(args, ctx);
      case "remove_message_scenario":
        return await removeMessage(args, ctx);
      case "set_appointments":
        return await setAppointments(args, ctx);
      case "set_timezone":
        return await setTimezone(args, ctx);
      case "mark_topic":
        return markTopic(args, ctx);
      case "finish_interview":
        return finishInterview(ctx);
      default:
        return refuse(undefined, "Unknown tool.");
    }
  } catch (err) {
    console.error(`[setup] ${name} failed:`, err);
    return refuse(undefined, "The draft could not be saved just now. Try again.");
  }
}
