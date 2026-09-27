import {
  DEFAULT_COLLECT_BEFORE,
  DEFAULT_LINK_TEXT,
  defaultAppointments,
  emptyCallSettings,
  type CallSettings,
  type TransferMode,
  type Window,
} from "../settings/callSettings";
import type { SimEvent } from "../settings/simulator/simulate";

// What the demo page knows about the receptionist's call settings, and what it makes of them: the
// settings the in-browser simulator plays the call out with, the "Try saying" cards, and the
// after-call summary. Pure, so it is tested without a browser (tests/public-capabilities.test.ts).

/** `capabilities` on `GET /demo/public/customers/:id` (transcribe-backend demo/publicDemo.ts). */
export type PublicCapabilities = {
  transfers: {
    id: string;
    name: string;
    mode: TransferMode;
    description: string;
    collectBefore: string;
    /** How many phones it rings; the numbers themselves are never sent to the page. */
    rings: number;
    hours: Window[];
  }[];
  links: { id: string; triggers: string[]; text: string; url: string }[];
  messages: { id: string; name: string; brief: string }[];
  appointments: { title: string; durationMinutes: number; hours: Window[] } | null;
  sms: { doubleOptIn: boolean };
  timezone: string | null;
};

export function emptyCapabilities(): PublicCapabilities {
  return { transfers: [], links: [], messages: [], appointments: null, sms: { doubleOptIn: true }, timezone: null };
}

/**
 * The settings the simulator runs the page's call on. Staff numbers are stood in for by labels
 * ("Front desk's phone"), which the cards show where the operator's console shows a number; a
 * waterfall keeps its count, because the page rings its phones one at a time.
 */
export function settingsFromCapabilities(caps: PublicCapabilities): CallSettings {
  const base = emptyCallSettings();
  return {
    ...base,
    timezone: caps.timezone ?? undefined,
    transfer: {
      waterfallEnabled: true,
      scenarios: caps.transfers.map((t) => ({
        id: t.id,
        enabled: true,
        mode: t.mode,
        name: t.name,
        description: t.description,
        numbers: Array.from({ length: Math.max(1, t.rings) }, (_, i) =>
          t.rings > 1 ? `${t.name}'s phone ${i + 1}` : `${t.name}'s phone`,
        ),
        collectBefore: t.collectBefore || DEFAULT_COLLECT_BEFORE,
        holdMusic: "classical",
        hours: t.hours,
      })),
    },
    links: { scenarios: caps.links.map((l) => ({ id: l.id, enabled: true, triggers: l.triggers, text: l.text || DEFAULT_LINK_TEXT, url: l.url })) },
    messages: { scenarios: caps.messages.map((m) => ({ id: m.id, enabled: true, name: m.name, brief: m.brief })) },
    sms: { doubleOptIn: caps.sms.doubleOptIn },
    appointments: caps.appointments
      ? { ...defaultAppointments(), enabled: true, title: caps.appointments.title, durationMinutes: caps.appointments.durationMinutes, hours: caps.appointments.hours }
      : defaultAppointments(),
  };
}

export type TryKind = "transfer" | "link" | "message" | "booking" | "question";

export type TryCard = {
  kind: TryKind;
  /** The small label on the card: "Transfer · Warm". */
  tag: string;
  /** What to say, as a caller would. */
  say: string;
  /** What happens when you do. */
  detail: string;
};

const ROLE = /\b(manager|owner|doctor|dentist|pharmacist|chef|nurse|technician|director|supervisor|accountant|lawyer|attorney|vet|stylist|therapist)\b/i;
const TEAM = /\b(desk|team|department|office|billing|sales|support|reception|kitchen|pharmacy|service|front|counter|deli|bakery|catering|parts|desk)\b/i;

/** "Front desk" → "Can I talk to someone at the front desk?"; "Manager" → "…the manager?"; "Sam" → "…Sam?". */
export function askFor(name: string): string {
  const clean = name.trim();
  const lower = clean.toLowerCase();
  if (ROLE.test(clean)) return `Can I speak to the ${lower.replace(/^the\s+/, "")}?`;
  if (TEAM.test(clean)) return `Can I talk to someone at the ${lower.replace(/^the\s+/, "")}?`;
  return `Can I speak to ${clean}?`;
}

const MODE_WORD: Record<TransferMode, string> = { cold: "Cold", warm: "Warm", waterfall: "Waterfall" };

/**
 * Up to four things to say on the call, one per feature the operator set up, in the order that
 * shows the most (a transfer, a text, a booking, a message), topped up with the business's own
 * caller questions.
 */
export function tryCards(caps: PublicCapabilities, questions: string[], max = 4): TryCard[] {
  const out: TryCard[] = [];
  // One that works at any hour first: a card for a team that is closed right now only gets "I can't
  // put you through to them at the moment".
  const transfer = [...caps.transfers].sort((a, b) => Number(a.hours.length > 0) - Number(b.hours.length > 0))[0];
  if (transfer) {
    out.push({
      kind: "transfer",
      tag: `Transfer · ${MODE_WORD[transfer.mode]}`,
      say: askFor(transfer.name),
      detail: `Rings ${transfer.name}${transfer.hours.length ? ` · ${compactHours(transfer.hours)}` : ""}`,
    });
  }
  const link = caps.links[0];
  if (link) {
    const topic = link.triggers[0]?.trim() || "the link";
    out.push({
      kind: "link",
      tag: "Text a link",
      say: `Can you text me ${/^(the|a|an|your)\b/i.test(topic) ? topic : `the ${topic}`}?`,
      detail: caps.sms.doubleOptIn ? "Asks your OK first, then texts the link" : "Texts the link to your phone",
    });
  }
  if (caps.appointments) {
    out.push({
      kind: "booking",
      tag: "Booking · demo calendar",
      say: `Can I book a ${caps.appointments.title.toLowerCase()} for Saturday?`,
      detail: "Offers open times from the business hours",
    });
  }
  const message = caps.messages[0];
  if (message) {
    out.push({
      kind: "message",
      tag: "Message",
      say: /^(new|a)\b/i.test(message.name) ? `I'm calling as a ${message.name.toLowerCase()}. Can I leave a message?` : "Can I leave a message?",
      detail: message.brief || "Takes your name, number and what it's about",
    });
  }
  for (const q of questions) {
    if (out.length >= max) break;
    out.push({ kind: "question", tag: "Question", say: q, detail: "Answered from what it knows about the business" });
  }
  return out.slice(0, max);
}

/** Which kinds of card the call has done, read off the simulator's events. */
export function doneKinds(events: SimEvent[]): Set<TryKind> {
  const done = new Set<TryKind>();
  for (const e of events) {
    if (e.type === "transfer_requested") done.add("transfer");
    if (e.type === "link_sent" || e.type === "consent_requested") done.add("link");
    if (e.type === "message_taken") done.add("message");
    if (e.type === "booking_made") done.add("booking");
  }
  return done;
}

/** The after-call summary: what the receptionist did, one line each, in order. */
export function summaryLines(events: SimEvent[], answeredSomething: boolean): string[] {
  const lines: string[] = [];
  if (answeredSomething) lines.push("Answered your questions from what it knows about the business");
  for (const e of events) {
    const d = e.data;
    if (e.type === "transfer_final") {
      lines.push(d.success ? "Put you through, and the phone was answered" : "Tried to put you through; nobody took it, so it came back to you");
    } else if (e.type === "link_sent") {
      lines.push("Texted you the link");
    } else if (e.type === "consent_requested") {
      lines.push("Asked your OK before texting a link");
    } else if (e.type === "message_taken") {
      lines.push("Took a message for the business");
    } else if (e.type === "booking_made") {
      lines.push(`Booked ${String(d.when ?? "a time")} on the demo calendar`);
    }
  }
  return [...new Set(lines)];
}

const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SHORT: Record<string, string> = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat", Sunday: "Sun" };

/**
 * Hours as a person would say them: runs of days with the same times together.
 * "Mon–Fri 09:00–17:00", "Every day 08:00–21:30", "Mon–Sat 09:00–18:00 · Sun closed".
 */
export function compactHours(hours: { day: string; open: string; close: string; closed?: boolean }[]): string {
  if (!hours.length) return "Any time";
  const byDay = new Map<string, string>();
  for (const h of hours) {
    const times = h.closed ? "" : `${h.open}–${h.close}`;
    byDay.set(h.day, byDay.has(h.day) && times ? `${byDay.get(h.day)}, ${times}` : times);
  }
  const runs: { from: string; to: string; times: string }[] = [];
  for (const day of WEEK) {
    const times = byDay.get(day) ?? "";
    const last = runs[runs.length - 1];
    if (last && last.times === times && WEEK.indexOf(day) === WEEK.indexOf(last.to) + 1) last.to = day;
    else runs.push({ from: day, to: day, times });
  }
  const open = runs.filter((r) => r.times);
  if (open.length === 1 && open[0]!.from === "Monday" && open[0]!.to === "Sunday") return `Every day ${open[0]!.times}`;
  return open
    .map((r) => `${r.from === r.to ? SHORT[r.from] : `${SHORT[r.from]}–${SHORT[r.to]}`} ${r.times}`)
    .join(" · ");
}
