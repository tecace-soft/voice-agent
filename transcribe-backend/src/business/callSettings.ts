import { toE164 } from "./phone.js";
import { DAYS, clean, clockTime, dayName } from "./profileShape.js";

// What the assistant may DO on a call: put someone through, text a link, take a message a
// particular way. One shape for every place it is stored (a demo record's `call_settings`, a
// business's draft and published copies) and every place it is read (the settings screens, the
// session composer, the phone agent).
//
// Everything a customer types reaches here as untrusted JSON from the browser, so this is where the
// rules live — not in the form. The form repeats the easy ones so a mistake shows before Save, but a
// rule that only exists in a form is a rule the next client skips. A bad value is refused with a
// message naming the field, never silently dropped: a transfer scenario that quietly lost its phone
// number is a caller put through to nobody.
//
// Pure, and importing no config or database, so it is testable on its own (like profileShape.ts).

export const MAX_SCENARIOS = 20;
/** Waterfall rings numbers one after another; five at ~20s each is already nearly two minutes on hold. */
export const MAX_WATERFALL_NUMBERS = 5;
export const MAX_LINK_TEXT = 150;
export const MAX_BRIEF = 500;
export const MAX_NAME = 80;
export const MAX_DESCRIPTION = 500;
export const MAX_TRIGGERS = 10;
export const MAX_TRIGGER = 60;

export const TRANSFER_MODES = ["cold", "warm", "waterfall"] as const;
export type TransferMode = (typeof TRANSFER_MODES)[number];

/** Twilio's own royalty-free hold playlists (twimlets holdmusic buckets). */
export const HOLD_MUSIC = ["classical", "ambient", "electronica", "guitars", "rock", "soft-rock"] as const;
export type HoldMusic = (typeof HOLD_MUSIC)[number];

export const DEFAULT_COLLECT_BEFORE = "The caller's name and the reason for the call";
export const DEFAULT_LINK_TEXT = "[business_name]: Here's the link you asked for";
export const DEFAULT_HOLD_MUSIC: HoldMusic = "classical";

export type Day = (typeof DAYS)[number];

/** One stretch of a day. Several per day are allowed — a lunch break is two windows. */
export type Window = { day: Day; open: string; close: string };

export type TransferScenario = {
  id: string;
  enabled: boolean;
  mode: TransferMode;
  /** A person or a department, as the caller would ask for it: "Sam", "Billing". */
  name: string;
  /** When to use it, and when not to. Read by the model, word for word. */
  description: string;
  /** Cold and warm: exactly one. Waterfall: two or more, tried in order. */
  numbers: string[];
  /** Warm and waterfall: what to ask the caller before ringing anyone. */
  collectBefore: string;
  holdMusic: HoldMusic;
  /** When this scenario may be used. Empty means always. */
  hours: Window[];
};

export type MessageScenario = { id: string; enabled: boolean; name: string; brief: string };

export type LinkScenario = {
  id: string;
  enabled: boolean;
  /** Words that make a link worth offering: "directions", "menu". */
  triggers: string[];
  /** The text message, `[business_name]` filled in when sent. */
  text: string;
  url: string;
};

/**
 * Booking new appointments into the business's connected calendar or booking tool.
 *
 * The connection itself (which calendar, the credentials) is not in here: it is a secret, and it is
 * the same for the draft and the published copy — there is one calendar. What is here is how the
 * assistant may book into it, which is draft-then-publish like everything else a caller hears.
 * Switched on with nothing connected, it does nothing: the composer only offers booking when both
 * are true.
 */
export type AppointmentSettings = {
  enabled: boolean;
  /** What the booking is called, to the caller and on the calendar: "Consultation". */
  title: string;
  /** Calendars only; a booking tool's event type decides its own length. */
  durationMinutes: number;
  /** Kept free before and after every existing event. Calendars only. */
  bufferMinutes: number;
  /** How soon the earliest bookable start may be. */
  minNoticeMinutes: number;
  /** How far ahead a caller may book. */
  horizonDays: number;
  /** When a booking may start. Empty means the business hours. Calendars only. */
  hours: Window[];
  /** Read by the model, word for word: who it is for, what to ask first. */
  instructions: string;
};

export const APPOINTMENT_LIMITS = {
  duration: [5, 480],
  buffer: [0, 240],
  notice: [0, 20_160],
  horizon: [1, 180],
} as const;
export const DEFAULT_APPOINTMENT_TITLE = "Appointment";

export function defaultAppointments(): AppointmentSettings {
  return {
    enabled: false,
    title: DEFAULT_APPOINTMENT_TITLE,
    durationMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 120,
    horizonDays: 30,
    hours: [],
    instructions: "",
  };
}

export type CallSettings = {
  /** IANA zone the scenario hours are in. Absent means the service default. */
  timezone?: string;
  transfer: { waterfallEnabled: boolean; scenarios: TransferScenario[] };
  messages: { scenarios: MessageScenario[] };
  links: { scenarios: LinkScenario[] };
  sms: { doubleOptIn: boolean };
  appointments: AppointmentSettings;
};

export function emptyCallSettings(): CallSettings {
  return {
    transfer: { waterfallEnabled: false, scenarios: [] },
    messages: { scenarios: [] },
    links: { scenarios: [] },
    // On by default: turning it off is the business accepting the legal risk, and the screen says so.
    sms: { doubleOptIn: true },
    appointments: defaultAppointments(),
  };
}

/** A refusal the settings screen can put under the field that caused it. */
export class CallSettingsError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "CallSettingsError";
    this.field = field;
  }
}

export type ValidationContext = {
  /** The number the assistant answers on. It cannot be a transfer target: that rings the assistant. */
  agentNumber?: string | null;
  /** Waterfall is a plan feature an admin turns on; a customer cannot save one without it. */
  waterfallAllowed: boolean;
};

const US_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;
// "x", "ext", "#", or the pause characters dialers use. Checked on the raw text, before
// normalising strips them and turns an extension into extra digits of a different number.
const EXTENSION = /(ext|x|#|,|;|\bp\b|\bw\b)/i;

/**
 * A US phone number in E.164, or a refusal that says what was wrong with it.
 *
 * Only US numbers, and no extensions: a transfer dials the number as it stands, and there is no one
 * to press the extension once it connects.
 */
export function usPhone(raw: unknown, field: string): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) throw new CallSettingsError(field, "Add a phone number.");
  if (EXTENSION.test(text.replace(/^\+/, ""))) {
    throw new CallSettingsError(field, "Extensions aren't supported. Use a direct number.");
  }
  const e164 = toE164(text);
  if (!US_E164.test(e164)) {
    throw new CallSettingsError(field, "Use a 10-digit US phone number, like (206) 555-0134.");
  }
  return e164;
}

function object(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function list(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function bool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

/** Short free text, tidied, with a hard limit that refuses rather than trims. */
function text(raw: unknown, field: string, max: number, label: string): string {
  // `clean` would truncate with an ellipsis; here a customer should see that it was too long.
  const value = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (value.length > max) {
    throw new CallSettingsError(field, `${label} can be at most ${max} characters.`);
  }
  return clean(value, max);
}

/** A fresh scenario id — the same shape the settings screens mint, and what `id()` falls back to. */
export const newScenarioId = (): string => crypto.randomUUID().slice(0, 12);

function id(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  return /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : newScenarioId();
}

/**
 * A range's end, where midnight means the END of the day: "12am", "00:00" and "24:00" all close at
 * 24:00, so "6pm to midnight" is a range rather than one that ends before it starts.
 */
function closingTime(raw: unknown): string {
  const text = typeof raw === "string" ? raw.replace(/[\s.]/g, "").toLowerCase() : "";
  if (/^(24(:00)?|12am|0?0:00|midnight)$/.test(text)) return "24:00";
  return clockTime(raw);
}

function windows(raw: unknown, field: string): Window[] {
  const out: Window[] = [];
  list(raw).forEach((entry, index) => {
    const row = object(entry);
    const at = `${field}[${index}]`;
    const day = dayName(row.day) as Day | "";
    if (!day) throw new CallSettingsError(at, "Pick a day for each time range.");
    const open = clockTime(row.open);
    const close = closingTime(row.close);
    if (!open || !close) throw new CallSettingsError(at, `Use times like 9:00 AM for ${day}.`);
    if (open >= close) {
      throw new CallSettingsError(
        at,
        `On ${day}, the end time has to be after the start time. For hours past midnight, add the early hours to the next day.`,
      );
    }
    out.push({ day, open, close });
  });
  if (out.length > 21) throw new CallSettingsError(field, "That's too many time ranges.");
  return out.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.open.localeCompare(b.open));
}

function transferScenario(raw: unknown, index: number, ctx: ValidationContext): TransferScenario {
  const row = object(raw);
  const at = `transfer.scenarios[${index}]`;
  const mode = TRANSFER_MODES.includes(row.mode as TransferMode) ? (row.mode as TransferMode) : null;
  if (!mode) throw new CallSettingsError(`${at}.mode`, "Choose cold, warm or waterfall.");
  const name = text(row.name, `${at}.name`, MAX_NAME, "The name");
  if (!name) throw new CallSettingsError(`${at}.name`, "Give this transfer a name, like Billing or Sam.");

  const numbers = list(row.numbers).map((n, i) => usPhone(n, `${at}.numbers[${i}]`));
  if (mode === "waterfall") {
    if (numbers.length < 2) {
      throw new CallSettingsError(`${at}.numbers`, "A waterfall needs at least two numbers to try in order.");
    }
    if (numbers.length > MAX_WATERFALL_NUMBERS) {
      throw new CallSettingsError(`${at}.numbers`, `A waterfall can try at most ${MAX_WATERFALL_NUMBERS} numbers.`);
    }
  } else if (numbers.length !== 1) {
    throw new CallSettingsError(`${at}.numbers`, "Add the one number to put callers through to.");
  }

  const collectBefore =
    mode === "cold" ? "" : text(row.collectBefore, `${at}.collectBefore`, 200, "What to ask first") ||
      DEFAULT_COLLECT_BEFORE;
  const holdMusic = HOLD_MUSIC.includes(row.holdMusic as HoldMusic)
    ? (row.holdMusic as HoldMusic)
    : DEFAULT_HOLD_MUSIC;

  return {
    id: id(row.id),
    // Waterfall is a plan feature. On an account without it a waterfall scenario may be KEPT (one
    // copied from a demo, or from before an admin switched it off) but never switched on — so it is
    // saved switched off rather than refused, which would block every unrelated save of the object.
    enabled: bool(row.enabled, true) && (mode !== "waterfall" || ctx.waterfallAllowed),
    mode,
    name,
    description: text(row.description, `${at}.description`, MAX_DESCRIPTION, "The description"),
    numbers,
    collectBefore,
    holdMusic,
    hours: windows(row.hours, `${at}.hours`),
  };
}

function messageScenario(raw: unknown, index: number): MessageScenario {
  const row = object(raw);
  const at = `messages.scenarios[${index}]`;
  const name = text(row.name, `${at}.name`, MAX_NAME, "The name");
  if (!name) throw new CallSettingsError(`${at}.name`, "Give this scenario a name.");
  const brief = text(row.brief, `${at}.brief`, MAX_BRIEF, "The brief");
  if (!brief) throw new CallSettingsError(`${at}.brief`, "Say what to ask callers in this situation.");
  return { id: id(row.id), enabled: bool(row.enabled, true), name, brief };
}

function httpsUrl(raw: unknown, field: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CallSettingsError(field, "Use a full link starting with https://");
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".")) {
    throw new CallSettingsError(field, "Links have to start with https://");
  }
  return url.toString();
}

function linkScenario(raw: unknown, index: number): LinkScenario {
  const row = object(raw);
  const at = `links.scenarios[${index}]`;
  const triggers = list(row.triggers)
    .map((t, i) => text(t, `${at}.triggers[${i}]`, MAX_TRIGGER, "A keyword"))
    .filter(Boolean);
  if (!triggers.length) {
    throw new CallSettingsError(`${at}.triggers`, "Add at least one keyword, like directions or menu.");
  }
  if (triggers.length > MAX_TRIGGERS) {
    throw new CallSettingsError(`${at}.triggers`, `Use at most ${MAX_TRIGGERS} keywords.`);
  }
  // Counted before [business_name] is filled in: that is the number the screen shows while typing.
  const message = typeof row.text === "string" ? row.text.trim() : "";
  if (message.length > MAX_LINK_TEXT) {
    throw new CallSettingsError(`${at}.text`, `The text can be at most ${MAX_LINK_TEXT} characters.`);
  }
  return {
    id: id(row.id),
    enabled: bool(row.enabled, true),
    triggers,
    text: message || DEFAULT_LINK_TEXT,
    url: httpsUrl(row.url, `${at}.url`),
  };
}

function minutes(raw: unknown, field: string, [min, max]: readonly [number, number], label: string): number {
  const value = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CallSettingsError(field, `${label} has to be a whole number.`);
  }
  if (value < min || value > max) {
    throw new CallSettingsError(field, `${label} has to be between ${min} and ${max}.`);
  }
  return value;
}

function appointmentSettings(raw: unknown): AppointmentSettings {
  const base = defaultAppointments();
  const row = object(raw);
  if (!Object.keys(row).length) return base;
  const at = "appointments";
  return {
    enabled: bool(row.enabled, false),
    title: text(row.title, `${at}.title`, MAX_NAME, "The name") || DEFAULT_APPOINTMENT_TITLE,
    durationMinutes:
      row.durationMinutes === undefined
        ? base.durationMinutes
        : minutes(row.durationMinutes, `${at}.durationMinutes`, APPOINTMENT_LIMITS.duration, "The length"),
    bufferMinutes:
      row.bufferMinutes === undefined
        ? base.bufferMinutes
        : minutes(row.bufferMinutes, `${at}.bufferMinutes`, APPOINTMENT_LIMITS.buffer, "The gap"),
    minNoticeMinutes:
      row.minNoticeMinutes === undefined
        ? base.minNoticeMinutes
        : minutes(row.minNoticeMinutes, `${at}.minNoticeMinutes`, APPOINTMENT_LIMITS.notice, "The notice"),
    horizonDays:
      row.horizonDays === undefined
        ? base.horizonDays
        : minutes(row.horizonDays, `${at}.horizonDays`, APPOINTMENT_LIMITS.horizon, "How far ahead"),
    hours: windows(row.hours, `${at}.hours`),
    instructions: text(row.instructions, `${at}.instructions`, MAX_DESCRIPTION, "The instructions"),
  };
}

/** Stored appointment settings, read without refusing: out-of-range numbers fall back to defaults. */
export function readAppointments(raw: unknown): AppointmentSettings {
  const base = defaultAppointments();
  const row = object(raw);
  const num = (v: unknown, [min, max]: readonly [number, number], fallback: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
  return {
    enabled: bool(row.enabled, false),
    title: typeof row.title === "string" && row.title.trim() ? row.title : base.title,
    durationMinutes: num(row.durationMinutes, APPOINTMENT_LIMITS.duration, base.durationMinutes),
    bufferMinutes: num(row.bufferMinutes, APPOINTMENT_LIMITS.buffer, base.bufferMinutes),
    minNoticeMinutes: num(row.minNoticeMinutes, APPOINTMENT_LIMITS.notice, base.minNoticeMinutes),
    horizonDays: num(row.horizonDays, APPOINTMENT_LIMITS.horizon, base.horizonDays),
    hours: list(row.hours) as Window[],
    instructions: typeof row.instructions === "string" ? row.instructions : "",
  };
}

function zone(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw.trim() });
    return raw.trim();
  } catch {
    throw new CallSettingsError("timezone", "That isn't a time zone we recognise.");
  }
}

/**
 * Check and tidy a whole settings object. Throws CallSettingsError on the first problem.
 *
 * Missing sections come back empty rather than failing, so an older client that only knows about
 * transfers can still save — but anything present has to be right.
 */
export function validateCallSettings(raw: unknown, ctx: ValidationContext): CallSettings {
  const root = object(raw);
  const transfer = object(root.transfer);
  const messages = object(root.messages);
  const links = object(root.links);
  const sms = object(root.sms);

  const counts: [string, unknown[]][] = [
    ["transfer.scenarios", list(transfer.scenarios)],
    ["messages.scenarios", list(messages.scenarios)],
    ["links.scenarios", list(links.scenarios)],
  ];
  for (const [field, rows] of counts) {
    if (rows.length > MAX_SCENARIOS) {
      throw new CallSettingsError(field, `You can have at most ${MAX_SCENARIOS} scenarios here.`);
    }
  }

  const transferScenarios = uniqueIds(list(transfer.scenarios).map((row, i) => transferScenario(row, i, ctx)));
  noDuplicateNames(transferScenarios, "transfer.scenarios", "transfer");

  // One number, one scenario. Two scenarios ringing the same phone means the model's choice between
  // them decides nothing, and the business cannot tell from a missed call which one it was.
  const seen = new Map<string, string>();
  const agent = ctx.agentNumber ? toE164(ctx.agentNumber) : "";
  transferScenarios.forEach((scenario, i) => {
    scenario.numbers.forEach((number, j) => {
      const field = `transfer.scenarios[${i}].numbers[${j}]`;
      if (agent && number === agent) {
        throw new CallSettingsError(field, "That's the number the assistant answers on — it would ring itself.");
      }
      const owner = seen.get(number);
      if (owner !== undefined) {
        throw new CallSettingsError(
          field,
          owner === scenario.name
            ? "This number is listed twice."
            : `This number is already used by "${owner}". Each number can be in one transfer only.`,
        );
      }
      seen.set(number, scenario.name);
    });
  });

  const messageScenarios = uniqueIds(list(messages.scenarios).map(messageScenario));
  noDuplicateNames(messageScenarios, "messages.scenarios", "message scenario");

  return {
    ...(zone(root.timezone) ? { timezone: zone(root.timezone) } : {}),
    transfer: {
      waterfallEnabled: ctx.waterfallAllowed,
      scenarios: transferScenarios,
    },
    messages: { scenarios: messageScenarios },
    links: { scenarios: uniqueIds(list(links.scenarios).map(linkScenario)) },
    sms: { doubleOptIn: bool(sms.doubleOptIn, true) },
    appointments: appointmentSettings(root.appointments),
  };
}

/** Ids are the tool's enum values: two the same and the model's choice between them decides nothing. */
function uniqueIds<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const next = seen.has(row.id) ? { ...row, id: newScenarioId() } : row;
    seen.add(next.id);
    return next;
  });
}

function noDuplicateNames(rows: { name: string }[], field: string, noun: string): void {
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const key = row.name.trim().toLowerCase();
    if (seen.has(key)) {
      throw new CallSettingsError(`${field}[${i}].name`, `There's already a ${noun} called "${row.name}".`);
    }
    seen.add(key);
  });
}

/**
 * Read stored settings without refusing anything. For values that were validated on the way in but
 * may predate a rule added since — the composer must still build a call from them.
 */
export function readCallSettings(raw: unknown): CallSettings {
  const base = emptyCallSettings();
  const root = object(raw);
  if (!Object.keys(root).length) return base;
  const transfer = object(root.transfer);
  return {
    ...(typeof root.timezone === "string" && root.timezone ? { timezone: root.timezone } : {}),
    transfer: {
      waterfallEnabled: bool(transfer.waterfallEnabled, false),
      scenarios: list(transfer.scenarios) as TransferScenario[],
    },
    messages: { scenarios: list(object(root.messages).scenarios) as MessageScenario[] },
    links: { scenarios: list(object(root.links).scenarios) as LinkScenario[] },
    sms: { doubleOptIn: bool(object(root.sms).doubleOptIn, true) },
    appointments: readAppointments(root.appointments),
  };
}

/** Stable JSON, so "has the draft changed since it was published?" is a string comparison. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Whether two settings say the same thing. `transfer.waterfallEnabled` is left out: it mirrors the
 * account's plan flag rather than anything the business edited, so flipping that flag must not make
 * an untouched draft look like it has changes to publish.
 */
export function sameSettings(a: unknown, b: unknown): boolean {
  const strip = (value: unknown) => {
    const settings = readCallSettings(value);
    return { ...settings, transfer: { scenarios: settings.transfer.scenarios } };
  };
  return canonical(strip(a)) === canonical(strip(b));
}

/** The weekday and HH:MM it is now in a zone, the way scenario hours are written. */
export function zonedNow(now: Date, timeZone: string): { day: Day; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: get("weekday") as Day, time: `${get("hour")}:${get("minute")}` };
}

/** Whether a scenario may be used at this moment: switched on, and inside its hours if it has any. */
export function inHours(hours: Window[], now: Date, timeZone: string): boolean {
  if (!hours.length) return true;
  const { day, time } = zonedNow(now, timeZone);
  return hours.some((w) => w.day === day && w.open <= time && time < w.close);
}

/**
 * The transfer scenarios the assistant is told about on a call starting now.
 *
 * Decided once, when the call starts: the model never learns about a scenario outside its hours, so
 * it cannot offer one. A call that runs past a closing time keeps what it started with — cutting a
 * transfer off mid-sentence is worse than one that connects a few minutes late.
 */
export function activeTransfers(
  settings: CallSettings,
  now: Date,
  timeZone: string,
  /** The account's plan flag. The stored copy's own flag is only a mirror of it and may be stale. */
  waterfallAllowed: boolean = settings.transfer.waterfallEnabled,
): TransferScenario[] {
  return settings.transfer.scenarios.filter(
    (s) =>
      s.enabled &&
      s.numbers.length > 0 &&
      (s.mode !== "waterfall" || waterfallAllowed) &&
      inHours(s.hours ?? [], now, timeZone),
  );
}

export function activeLinks(settings: CallSettings): LinkScenario[] {
  return settings.links.scenarios.filter((s) => s.enabled && s.url);
}

export function activeMessages(settings: CallSettings): MessageScenario[] {
  return settings.messages.scenarios.filter((s) => s.enabled && s.brief);
}

/** The text a link goes out in, with the business named so the recipient knows who sent it. */
export function linkMessage(scenario: LinkScenario, businessName: string): string {
  const body = (scenario.text || DEFAULT_LINK_TEXT).replace(/\[business_name\]/gi, businessName || "We");
  return `${body} ${scenario.url}`;
}

/**
 * The first text a number gets from a business when double opt-in is on. Carries what the carrier
 * rules ask of a first message: who is sending, how to stop, how to get help, and that rates apply.
 */
export function consentRequestMessage(businessName: string, businessPhone?: string | null): string {
  const name = businessName || "This business";
  const help = businessPhone ? ` Questions: ${businessPhone}.` : "";
  return (
    `${name}: Reply YES to get the info you asked for on your call. Messages may include promotions. ` +
    `Msg & data rates may apply. Reply STOP to opt out, HELP for help.${help}`
  );
}

export function helpMessage(businessName: string, businessPhone?: string | null): string {
  const name = businessName || "This business";
  const reach = businessPhone ? ` Call ${businessPhone}.` : "";
  return `${name}: texts about your call.${reach} Reply STOP to opt out. Msg & data rates may apply.`;
}
