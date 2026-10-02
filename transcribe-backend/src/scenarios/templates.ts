import type { CallSettings } from "../business/callSettings.js";
import { calendarSlots } from "../calendar/availability.js";
import { isoDay, nextDay, zonedDate, zonedIso, zonedMinutes } from "../calendar/time.js";
import type { BusinessProfile } from "../demo/types.js";
import type { ScenarioDefinition, TemplateId } from "./types.js";

// The twelve built-in scenarios, filled in from a business's own settings.
//
// Times are written as placeholders — {slotA}, {slotA.spoken}, {slotB.clock} — because "tomorrow at
// 3 PM" only means something on the day a pass runs. They are resolved when the pass starts, against
// the openings the sandbox calendar will really offer, so a booking scenario never asks for a time
// the business is closed.

export type TemplateContext = { profile: BusinessProfile; settings: CallSettings; language: "ko" | "en" };

export type Template = {
  id: TemplateId;
  title: string;
  applies: (c: TemplateContext) => boolean;
  build: (c: TemplateContext) => ScenarioDefinition;
};

const say = (c: TemplateContext, en: string, ko: string) => (c.language === "ko" ? ko : en);
const canBook = (c: TemplateContext) => c.settings.appointments.enabled;
const reachable = (c: TemplateContext) => c.settings.transfer.scenarios.some((s) => s.enabled && s.numbers.length > 0);

const firstServiceName = (c: TemplateContext) => c.profile.services.map((s) => s.name?.trim() ?? "").find(Boolean) ?? "";

const PHONE = {
  en: { said: "206-555-0134", saidKo: "206-555-0134", digits: "2065550134", fixedSaid: "it ends in 0135", fixed: "2065550135" },
  ko: { said: "010-1234-5678", saidKo: "010-1234-5678이에요", digits: "01012345678", fixedSaid: "끝자리가 5679예요", fixed: "01012345679" },
};
const phone = (c: TemplateContext) => PHONE[c.language];
// A receptionist that reads a time or a number back is waiting for this.
const yes = (c: TemplateContext) => say(c, "Yes, that's right.", "네, 맞아요.");
const bookLine = (c: TemplateContext) =>
  say(
    c,
    `Please book {slotA.spoken} under the name Kim Minsu. My number is ${phone(c).said}.`,
    `김민수 이름으로 {slotA.spoken}에 예약해 주세요. 번호는 ${phone(c).saidKo}.`,
  );
const messageLine = (c: TemplateContext) =>
  say(
    c,
    `Hi, this is Kim Minsu. Could someone call me back at ${phone(c).said} about a quote?`,
    `안녕하세요, 김민수입니다. 견적 문의 때문에 ${phone(c).said}로 연락 부탁드려요.`,
  );

export const TEMPLATES: Template[] = [
  {
    id: "S01",
    title: "Business hours",
    applies: (c) => c.profile.hours.some((h) => !h.closed),
    build: (c) => ({
      customerLines: [say(c, "What time are you open until today?", "오늘 몇 시까지 영업하세요?")],
      language: c.language,
      world: {},
      expect: { judge: ["Gives today's closing time from the business hours, or says the business is closed today if it is"] },
    }),
  },
  {
    id: "S02",
    title: "Address",
    applies: (c) => Boolean(c.profile.address.trim()),
    build: (c) => ({
      customerLines: [say(c, "Where are you located?", "거기 주소가 어떻게 되나요?")],
      language: c.language,
      world: {},
      expect: {
        judge: [
          "Gives the business's address as it appears in the business information",
          "Does not add parking, directions or landmarks that are not in the business information",
        ],
      },
    }),
  },
  {
    id: "S03",
    title: "Unknown price",
    applies: (c) => c.profile.services.length > 0 && c.profile.services.every((s) => !s.price?.trim()) && Boolean(firstServiceName(c)),
    build: (c) => {
      const service = firstServiceName(c);
      return {
        customerLines: [say(c, `How much does ${service} cost?`, `${service} 가격이 얼마예요?`)],
        language: c.language,
        world: {},
        expect: {
          judge: ["Does not state a price or a price range", "Offers a way to find out, such as a callback, a message or the website"],
        },
      };
    },
  },
  {
    id: "S04",
    title: "Availability only",
    applies: canBook,
    build: (c) => ({
      customerLines: [say(c, "Is {slotA.spoken} available?", "{slotA.spoken}에 예약 가능한가요?")],
      language: c.language,
      world: {},
      expect: {
        tools: [{ name: "check_availability" }],
        forbidden: ["book_appointment"],
        final: { bookings: 0 },
        judge: ["Tells the caller whether {slotA.spoken} is open, based on the availability check"],
      },
    }),
  },
  {
    id: "S05",
    title: "Booking",
    applies: canBook,
    build: (c) => ({
      customerLines: [bookLine(c), yes(c)],
      language: c.language,
      world: {},
      expect: {
        tools: [{ name: "book_appointment", args: { start: "{slotA}" }, times: 1 }],
        final: { bookings: 1 },
        judge: ["Confirms the booking for {slotA.spoken} only after the booking tool said it was booked"],
      },
    }),
  },
  {
    id: "S06",
    title: "Correction mid-sentence",
    applies: canBook,
    build: (c) => ({
      customerLines: [
        say(
          c,
          `I'd like to book {slotA.spoken}. Oh wait, not {slotA.clock}, make it {slotB.clock}. The name is Kim Minsu, and my number is ${phone(c).said}.`,
          `{slotA.spoken}에 예약하고 싶어요. 아, {slotA.clock} 말고 {slotB.clock}에 해주세요. 이름은 김민수, 번호는 ${phone(c).saidKo}.`,
        ),
        yes(c),
      ],
      language: c.language,
      world: {},
      expect: {
        tools: [{ name: "book_appointment", args: { start: "{slotB}" }, times: 1 }],
        final: { bookings: 1 },
        judge: ["Books the corrected time, {slotB.spoken}, not {slotA.spoken}"],
      },
    }),
  },
  {
    id: "S07",
    title: "Missing details",
    applies: canBook,
    build: (c) => ({
      customerLines: [say(c, "I'd like to make an appointment.", "예약하고 싶어요.")],
      language: c.language,
      world: {},
      expect: {
        forbidden: ["book_appointment"],
        final: { bookings: 0 },
        judge: ["Asks the caller for the details it needs (when, and their name) instead of guessing them"],
      },
    }),
  },
  {
    id: "S08",
    title: "Time unavailable",
    applies: canBook,
    build: (c) => ({
      customerLines: [bookLine(c), say(c, "No thanks, I'll call back another time.", "아니요, 괜찮아요. 다음에 다시 전화할게요.")],
      language: c.language,
      world: { fullSlots: ["{slotA}"] },
      expect: {
        final: { bookings: 0 },
        judge: [
          "Only says {slotA.spoken} is unavailable after a tool (check_availability or book_appointment) said so",
          "Tells the caller {slotA.spoken} is not available",
          "Offers other open times",
        ],
      },
    }),
  },
  {
    id: "S09",
    title: "Transfer, nobody answers",
    applies: reachable,
    build: (c) => ({
      customerLines: [say(c, "Can I speak to someone from your team, please?", "직원분과 직접 통화하고 싶어요.")],
      language: c.language,
      world: { transferAnswer: "no_answer" },
      expect: {
        tools: [{ name: "transfer_call" }],
        judge: ["After the transfer goes unanswered, tells the caller and offers to take a message"],
      },
    }),
  },
  {
    id: "S10",
    title: "Take a message",
    applies: () => true,
    build: (c) => ({
      customerLines: [messageLine(c), yes(c)],
      language: c.language,
      world: {},
      expect: {
        tools: [{ name: "take_message", args: { callback_number: phone(c).digits }, times: 1 }],
        final: { messages: 1 },
        judge: ["The message it takes says the caller wants a quote"],
      },
    }),
  },
  {
    id: "S11",
    title: "Corrected phone number",
    applies: () => true,
    build: (c) => ({
      customerLines: [
        say(
          c,
          `Hi, this is Kim Minsu, please have someone call me about a quote. My number is ${phone(c).said} — sorry, no, ${phone(c).fixedSaid}.`,
          `안녕하세요, 김민수입니다. 견적 때문에 연락 부탁드려요. 번호는 ${phone(c).said}, 아, 아니에요, ${phone(c).fixedSaid}.`,
        ),
        yes(c),
      ],
      language: c.language,
      world: {},
      expect: { tools: [{ name: "take_message", args: { callback_number: phone(c).fixed }, times: 1 }], final: { messages: 1 } },
    }),
  },
  {
    id: "S12",
    title: "Tool failure",
    applies: () => true,
    build: (c) =>
      canBook(c)
        ? {
            customerLines: [bookLine(c), yes(c)],
            language: c.language,
            world: { failTool: "book_appointment" },
            expect: {
              tools: [{ name: "book_appointment" }],
              final: { bookings: 0 },
              judge: [
                "Does not tell the caller the appointment is booked",
                "Tells the caller what happens next, such as a callback or a message for the team",
              ],
            },
          }
        : {
            customerLines: [messageLine(c), yes(c)],
            language: c.language,
            world: { failTool: "take_message" },
            expect: {
              tools: [{ name: "take_message" }],
              final: { messages: 0 },
              judge: ["Does not tell the caller the message was recorded", "Tells the caller what happens next, such as calling back later"],
            },
          },
  },
];

export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id);

/**
 * The two appointment times the booking scenarios use, both on the same day: the first day after
 * today with a pair of openings an hour or more apart. slotA is the earliest opening at or after
 * 3 PM that has such a partner (else the day's earliest that does); slotB is the first opening at
 * least an hour after it. With no such pair on any day, slotA is the first day's preferred opening
 * and slotB is null. Null when booking is off or the window has nothing.
 */
export function scenarioSlots(input: {
  settings: CallSettings;
  profile: BusinessProfile;
  timeZone: string;
  now: number;
}): { slotA: number; slotB: number | null } | null {
  const rules = input.settings.appointments;
  if (!rules.enabled) return null;
  const { timeZone, now } = input;
  const day = (at: number) => isoDay(zonedDate(at, timeZone));
  const starts = calendarSlots({ rules, profileHours: input.profile.hours, busy: [], now, timeZone });
  const later = starts.filter((s) => day(s) !== day(now));
  if (!later.length) return null;
  const afternoon = (s: number) => zonedMinutes(s, timeZone) >= 15 * 60;
  const days = new Map<string, number[]>();
  for (const s of later) days.set(day(s), [...(days.get(day(s)) ?? []), s]);
  const partner = (list: number[], s: number) => list.find((t) => t >= s + 60 * 60_000);
  for (const list of days.values()) {
    const pairable = list.filter((s) => partner(list, s) !== undefined);
    const slotA = pairable.find(afternoon) ?? pairable[0];
    if (slotA !== undefined) return { slotA, slotB: partner(list, slotA)! };
  }
  const first = [...days.values()][0]!;
  return { slotA: first.find(afternoon) ?? first[0]!, slotB: null };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const KO_WEEKDAYS: Record<string, string> = {
  Monday: "월요일",
  Tuesday: "화요일",
  Wednesday: "수요일",
  Thursday: "목요일",
  Friday: "금요일",
  Saturday: "토요일",
  Sunday: "일요일",
};

function dayPhrase(at: number, now: number, timeZone: string, language: "ko" | "en"): string {
  const d = zonedDate(at, timeZone);
  const tomorrow = isoDay(d) === isoDay(nextDay(zonedDate(now, timeZone)));
  if (language === "ko") return tomorrow ? "내일" : `${d.month}월 ${d.day}일 ${KO_WEEKDAYS[d.weekday] ?? ""}`.trim();
  return tomorrow ? "tomorrow" : `${d.weekday}, ${MONTHS[d.month - 1]} ${d.day}`;
}

function clockPhrase(at: number, timeZone: string, language: "ko" | "en"): string {
  const m = zonedMinutes(at, timeZone);
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const h12 = h24 % 12 || 12;
  if (language === "ko") return `${h24 < 12 ? "오전" : "오후"} ${h12}시${min ? ` ${min}분` : ""}`;
  return `${h12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
}

/** {slotA}, {slotA.clock}, {slotA.day}, {slotA.spoken} and the same for slotB. Empty without slots. */
export function placeholderValues(
  slots: { slotA: number; slotB: number | null } | null,
  now: number,
  timeZone: string,
  language: "ko" | "en",
): Record<string, string> {
  if (!slots) return {};
  const values: Record<string, string> = {};
  for (const [key, at] of [["slotA", slots.slotA], ["slotB", slots.slotB]] as const) {
    if (at === null) continue;
    const day = dayPhrase(at, now, timeZone, language);
    const clock = clockPhrase(at, timeZone, language);
    values[key] = zonedIso(at, timeZone);
    values[`${key}.clock`] = clock;
    values[`${key}.day`] = day;
    values[`${key}.spoken`] = language === "ko" ? `${day} ${clock}` : `${day} at ${clock}`;
  }
  return values;
}

const TOKEN = /\{(slot[^}]*)\}/g;
const KNOWN = new Set(["slotA", "slotB"].flatMap((k) => [k, `${k}.clock`, `${k}.day`, `${k}.spoken`]));

/** Every placeholder in a definition filled in, or why it can't be. */
export function resolveDefinition(
  definition: ScenarioDefinition,
  values: Record<string, string>,
): { ok: true; definition: ScenarioDefinition } | { ok: false; error: string } {
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const fill = (s: string) =>
    s.replace(TOKEN, (whole, key: string) => {
      if (!KNOWN.has(key)) {
        unknown.add(key);
        return whole;
      }
      const value = values[key];
      if (value === undefined) missing.add(key);
      return value ?? whole;
    });
  const walk = (x: unknown): unknown =>
    typeof x === "string"
      ? fill(x)
      : Array.isArray(x)
        ? x.map(walk)
        : x && typeof x === "object"
          ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
          : x;
  const resolved = walk(definition) as ScenarioDefinition;
  if (unknown.size) {
    return {
      ok: false,
      error: `Unknown placeholder {${[...unknown][0]}}. Use {slotA}, {slotA.spoken}, {slotA.day}, {slotA.clock} or the same for slotB.`,
    };
  }
  if (missing.size) {
    const key = [...missing][0]!;
    return {
      ok: false,
      error: key.startsWith("slotB")
        ? "This scenario needs two open appointment times on the same day, and the calendar doesn't have them."
        : `This scenario needs an open appointment time ({${key}}), and booking is off or has no openings.`,
    };
  }
  return { ok: true, definition: resolved };
}
