import type { SetupTopic } from "./types.js";

// What the phone receptionist can, partly can, and cannot do — written down once, from an audit of
// the phone agent, so the setup consultant quotes this instead of guessing. A customer who asks for
// hold music or a press-1-to-accept hears "no, but here is what works" grounded in code, not a
// confident invention that the first real call disproves.
//
// When the phone agent learns something new, change the entry here in the same commit. The coverage
// test composes a call with everything switched on and fails if a tool it carries is not described.
//
// Pure, and importing no config or database, like the rest of src/setup's shapes.

export type CapabilityStatus = "supported" | "partial" | "unsupported";

export type Capability = {
  id: string;
  topic: SetupTopic | "general";
  label: string;
  status: CapabilityStatus;
  /** One or two plain sentences the consultant may repeat to the customer. */
  detail: string;
  /** What to suggest instead, when status is not "supported". */
  alternative?: string;
  /** The call tool (src/session/compose.ts) this describes, for the coverage test. */
  callTool?: "transfer_call" | "send_link" | "take_message" | "check_availability" | "book_appointment";
};

export const CAPABILITIES: readonly Capability[] = [
  // ---- transfers ----
  {
    id: "transfers.one_number",
    topic: "transfers",
    label: "Putting a caller through",
    status: "supported",
    callTool: "transfer_call",
    detail:
      "Each transfer rings one direct US number. When the caller asks for that person or team (or the description matches), the receptionist puts them through.",
  },
  {
    id: "transfers.ask_first",
    topic: "transfers",
    label: "Asking before dialling",
    status: "supported",
    detail: "It can collect a few things first (by default the caller's name and reason), then dial.",
  },
  {
    id: "transfers.whisper",
    topic: "transfers",
    label: "Announcing the caller",
    status: "supported",
    detail: "The colleague hears a short announcement of who is calling and why before being connected.",
  },
  {
    id: "transfers.keypress_accept",
    topic: "transfers",
    label: "Press 1 to accept",
    status: "unsupported",
    detail: "There is no press-1-to-accept; the colleague just answers.",
    alternative: "The announcement does the job; if they don't pick up, the caller comes back to the receptionist.",
  },
  {
    id: "transfers.hold_music",
    topic: "transfers",
    label: "Hold music",
    status: "unsupported",
    detail: "Hold music is never played.",
    alternative: "Don't mention hold music.",
  },
  {
    id: "transfers.waterfall",
    topic: "transfers",
    label: "Trying several numbers",
    status: "unsupported",
    detail: "It cannot try several numbers one after another, or ring several at once.",
    alternative: "One best number per situation, and a message if nobody answers.",
  },
  {
    id: "transfers.us_only",
    topic: "transfers",
    label: "Which numbers",
    status: "partial",
    detail: "Only US +1 ten-digit numbers, no extensions.",
    alternative: "A direct line or a mobile.",
  },
  {
    id: "transfers.number_unique",
    topic: "transfers",
    label: "One number, one transfer",
    status: "supported",
    detail: "A number can belong to only one transfer.",
  },
  {
    id: "transfers.hours",
    topic: "transfers",
    label: "Transfer hours",
    status: "supported",
    detail:
      "Each transfer can have hours (in the business's time zone); outside them it is not offered. Checked once, when the call starts.",
  },
  {
    id: "transfers.no_answer",
    topic: "transfers",
    label: "When nobody answers",
    status: "supported",
    detail:
      "It rings for a fixed time set by the service. No answer: the caller is back with the receptionist, who offers to take a message.",
  },
  {
    id: "transfers.voicemail_first",
    topic: "transfers",
    label: "The colleague's voicemail",
    status: "partial",
    detail: "If the colleague's voicemail picks up first, the caller lands in that voicemail.",
    alternative: "Use a number whose voicemail is slow or switched off.",
  },
  {
    id: "transfers.caller_id",
    topic: "transfers",
    label: "Caller ID",
    status: "partial",
    detail: "The colleague sees the service's number, not the caller's.",
    alternative: "The announcement says who is calling.",
  },

  // ---- messages ----
  {
    id: "messages.take_message",
    topic: "messages",
    label: "Taking a message",
    status: "supported",
    callTool: "take_message",
    detail:
      "Takes the caller's name, callback number and what it's about; messages appear under the dashboard's calls and on the shared Google Sheet.",
  },
  {
    id: "messages.briefs",
    topic: "messages",
    label: "What to ask, per situation",
    status: "supported",
    detail:
      "Per situation, a brief of what to ask (one question at a time). Only the first message of a call is saved, and the situation label itself is not saved — the answers are in the message text.",
  },
  {
    id: "messages.alerts",
    topic: "messages",
    label: "Message alerts",
    status: "unsupported",
    detail: "No email or text alert when a message arrives.",
    alternative: "Check the dashboard or the sheet.",
  },
  {
    id: "messages.after_hours_mode",
    topic: "messages",
    label: "After-hours mode",
    status: "unsupported",
    detail: "There is no separate after-hours greeting or mode.",
    alternative:
      "Give transfers hours (closed → nobody to reach → a message) and add a brief for after-hours situations. Opening hours themselves are answered from the business profile.",
  },
  {
    id: "messages.sms",
    topic: "messages",
    label: "Texting the caller",
    status: "unsupported",
    callTool: "send_link",
    detail: "The receptionist cannot text anyone during a phone call.",
    alternative: "Say the address or website out loud, or take a message.",
  },

  // ---- appointments ----
  {
    id: "appointments.book_new",
    topic: "appointments",
    label: "Booking new appointments",
    status: "supported",
    callTool: "book_appointment",
    detail:
      "Books NEW appointments straight into a connected Google Calendar, Outlook, Apple/CalDAV, Cal.com, Calendly or Squarespace Scheduling, once the settings are published.",
  },
  {
    id: "appointments.availability",
    topic: "appointments",
    label: "Checking free times",
    status: "supported",
    callTool: "check_availability",
    detail: "Checks free times in that calendar before offering one.",
  },
  {
    id: "appointments.change_cancel_lookup",
    topic: "appointments",
    label: "Existing appointments",
    status: "unsupported",
    detail: "Cannot reschedule, cancel or look up existing appointments.",
    alternative: "A transfer or a message.",
  },
  {
    id: "appointments.connect_here",
    topic: "appointments",
    label: "Connecting a calendar",
    status: "unsupported",
    detail: "The consultant cannot connect a calendar.",
    alternative: "Switch the rules on here; connect the calendar in the Appointments section.",
  },

  // ---- general ----
  {
    id: "general.language",
    topic: "general",
    label: "Languages",
    status: "supported",
    detail: "Answers in the caller's language automatically.",
  },
  {
    id: "general.knowledge",
    topic: "general",
    label: "Business facts",
    status: "supported",
    detail: "Opening hours, FAQs and policies come from the business profile (edited under Business information, not here).",
  },
  {
    id: "general.publish",
    topic: "general",
    label: "Draft until published",
    status: "supported",
    detail: "Everything written here is a DRAFT; nothing reaches callers until Publish.",
  },
];

export function capabilitiesFor(topic: SetupTopic): Capability[] {
  return CAPABILITIES.filter((c) => c.topic === topic);
}

const GROUPS: { status: CapabilityStatus; heading: string }[] = [
  { status: "supported", heading: "## What the receptionist can do" },
  { status: "partial", heading: "## What the receptionist can partly do" },
  { status: "unsupported", heading: "## What the receptionist cannot do" },
];

/** The manifest as prompt text: one bullet group per status, empty groups left out. */
export function renderCapabilities(topic?: SetupTopic): string {
  const rows = topic ? capabilitiesFor(topic) : [...CAPABILITIES];
  return GROUPS.map(({ status, heading }) => {
    const bullets = rows
      .filter((c) => c.status === status)
      .map((c) => `- ${c.label}: ${c.detail}${c.alternative ? ` Instead: ${c.alternative}` : ""}`);
    return bullets.length ? [heading, ...bullets].join("\n") : "";
  })
    .filter(Boolean)
    .join("\n\n");
}

// ---- playbooks ----
// Starting ideas per kind of business, so the consultant can suggest instead of asking an owner to
// invent a setup from a blank page. Suggestions only, and every one stays inside the manifest above:
// one number per transfer, no texting, booking only NEW appointments.

export type PlaybookKey = "restaurant" | "clinic" | "salon" | "contractor" | "office" | "retail" | "generic";
export type Playbook = { key: PlaybookKey; label: string; transfers: string[]; messages: string[]; appointments: string[] };

export const PLAYBOOKS: Record<PlaybookKey, Playbook> = {
  restaurant: {
    key: "restaurant",
    label: "restaurant",
    transfers: ["Manager for complaints or large parties", "Host stand for a table booked tonight", "Events coordinator for private dining"],
    messages: ["Catering or large-party inquiry: date, headcount, budget", "Lost item: what, when, where they sat", "Job applicant: name, role, availability"],
    appointments: ["Usually off — reservations live in OpenTable/Resy, which can't be connected", "On only for tastings or event walkthroughs kept in a calendar", "Changing a reservation: a transfer to the host stand or a message"],
  },
  clinic: {
    key: "clinic",
    label: "medical or dental practice",
    transfers: ["Front desk for urgent symptoms, straight through", "Billing for insurance or payment questions", "Nurse line for questions after a treatment"],
    messages: ["Prescription refill: patient name, medication, pharmacy", "Reschedule or cancel: patient name, current appointment, better times", "Records request: patient name, date of birth, where to send them"],
    appointments: ["On — new-patient consultations, 30 min, 1 day notice", "Existing patients moving a visit: a transfer or a message", "Keep the booking window short (2–4 weeks)"],
  },
  salon: {
    key: "salon",
    label: "salon or spa",
    transfers: ["Front desk for a same-day booking problem", "Owner or manager for complaints", "A stylist's own mobile, only if they want those calls"],
    messages: ["Running late or cancelling: name, appointment time", "Group or bridal booking: date, number of people, services", "Product question: which product, callback number"],
    appointments: ["On — a standard 45-minute slot, 2 hours notice", "Colour or bridal work: a message, it needs a consultation first", "A booking tool (Squarespace Scheduling, Calendly) sets lengths itself"],
  },
  contractor: {
    key: "contractor",
    label: "home-service business",
    transfers: ["On-call tech for emergencies (burst pipe, no heat), with after-hours hours", "Office for billing or a scheduled job", "Owner for large quotes or complaints"],
    messages: ["Quote request: address, what needs doing, how soon", "Service call: address, the problem, how urgent, access notes", "Follow-up on a past job: address, job date, what's wrong"],
    appointments: ["On — free estimate visits, 1 hour, 1 day notice", "Emergencies: a transfer, never a booked slot", "Off if the crew's schedule lives in a job app that can't be connected"],
  },
  office: {
    key: "office",
    label: "professional office",
    transfers: ["Assistant for existing clients", "The advisor on duty for urgent matters, with hours", "Billing for invoices"],
    messages: ["New client inquiry: name, what the matter is, how they heard of you", "Existing client: name, which matter, what they need", "Documents to drop off or sign: name, which document, a good time"],
    appointments: ["On — free 15- or 30-minute consultations, 1 day notice", "Off if every new client needs a conflict check first — a message instead", "Existing clients moving a meeting: a message"],
  },
  retail: {
    key: "retail",
    label: "shop",
    transfers: ["Store manager for complaints or return disputes", "Floor staff to check stock, during opening hours", "Online orders team for web order questions"],
    messages: ["Stock or special order: item, size or colour, callback number", "Return or exchange: order details, which item", "Wholesale or vendor inquiry: company, what they offer"],
    appointments: ["Usually off", "On for personal shopping or fittings, 30 or 60 min", "On for repair or alteration drop-offs"],
  },
  generic: {
    key: "generic",
    label: "business",
    transfers: ["Owner or manager for complaints or anything urgent", "Someone for billing or payments", "Whoever handles existing orders or jobs"],
    messages: ["General callback: name, number, what it's about", "New business inquiry: what they need, timeline, budget", "Complaint: what happened, when, what would put it right"],
    appointments: ["On if customers meet you by appointment: one standard length", "Off if you don't book time with customers", "Moving or cancelling a booking: a transfer or a message"],
  },
};

// First match wins, so the more specific kinds come first ("barber" before the restaurant's "bar").
const KEYWORDS: [PlaybookKey, string[]][] = [
  ["clinic", ["dental", "dentist", "clinic", "doctor", "medical"]],
  ["salon", ["salon", "spa", "barber", "nail"]],
  ["restaurant", ["restaurant", "cafe", "bar", "bakery"]],
  ["contractor", ["plumb", "electric", "roof", "hvac", "contractor", "landscap", "lawn", "cleaning"]],
  ["office", ["law", "attorney", "account", "cpa", "insurance", "real estate", "consult"]],
  ["retail", ["shop", "store", "retail", "boutique"]],
];

/** The playbook for a business profile's free-text `category`; generic when nothing matches. */
export function playbookFor(category: string): Playbook {
  const text = category.toLowerCase();
  const match = KEYWORDS.find(([, words]) => words.some((w) => text.includes(w)));
  return PLAYBOOKS[match ? match[0] : "generic"];
}

export function renderPlaybook(p: Playbook): string {
  return [
    `Ideas for a ${p.label} (suggest, don't assume):`,
    `- transfers: ${p.transfers.join("; ")}`,
    `- messages: ${p.messages.join("; ")}`,
    `- appointments: ${p.appointments.join("; ")}`,
  ].join("\n");
}
