import {
  DAYS,
  displayPhone,
  type AppointmentSettings,
  type MessageScenario,
  type TransferScenario,
  type TransferMode,
  type Window,
} from "../callSettings";

// The wording a non-technical owner reads on the guided setup's board cards: what each setting
// does, in plain words, never the form's field names. Pure, so it's tested without rendering.

// The settings screens already format phone numbers; the board reads them the same way.
export { displayPhone };

/** "09:00" → "9am", "17:30" → "5:30pm". Anything that isn't HH:MM is returned as is. */
export function hourLabel(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h % 24 < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m[2] === "00" ? "" : `:${m[2]}`}${suffix}`;
}

// A day's windows as one phrase: "9am–12pm, 1pm–5pm".
function dayRanges(windows: Window[]): string {
  return [...windows]
    .sort((a, b) => a.open.localeCompare(b.open))
    .map((w) => `${hourLabel(w.open)}–${hourLabel(w.close)}`)
    .join(", ");
}

/** "Weekdays 9am–5pm", "Mon–Wed 9am–5pm · Sat 9am–1pm"; no hours is "Any time". */
export function compactHours(hours: Window[]): string {
  if (!hours.length) return "Any time";
  // Consecutive days with the same hours become one run.
  const runs: { first: number; last: number; from: string; to: string; ranges: string }[] = [];
  DAYS.forEach((day, i) => {
    const windows = hours.filter((w) => w.day === day);
    if (!windows.length) return;
    const ranges = dayRanges(windows);
    const short = day.slice(0, 3);
    const prev = runs[runs.length - 1];
    if (prev && prev.last === i - 1 && prev.ranges === ranges) Object.assign(prev, { last: i, to: short });
    else runs.push({ first: i, last: i, from: short, to: short, ranges });
  });
  return runs
    .map(({ first, last, from, to, ranges }) => {
      const days =
        first === 0 && last === 6
          ? "Every day"
          : first === 0 && last === 4
            ? "Weekdays"
            : first === last
              ? from
              : `${from}–${to}`;
      return `${days} ${ranges}`;
    })
    .join(" · ");
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** Minutes of notice as people say them: "2 hours", "1 day". 0 is "no" ("At least no notice"). */
export function noticeLabel(min: number): string {
  if (min <= 0) return "no";
  if (min % 1440 === 0) return plural(min / 1440, "day");
  if (min % 60 === 0) return plural(min / 60, "hour");
  return plural(min, "minute");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export type CardLine = { key: string; title: string; detail: string[]; tag?: string; off?: boolean };

const MODE_TAG: Record<TransferMode, string> = {
  cold: "Straight through",
  warm: "Asks first",
  waterfall: "One after another",
};

export function transferCard(s: TransferScenario): CardLine {
  return {
    key: `transfer:${s.id}`,
    title: s.name,
    tag: MODE_TAG[s.mode],
    off: !s.enabled,
    detail: [
      s.description || `When callers ask for ${s.name}`,
      s.numbers.map(displayPhone).join(" → "),
      compactHours(s.hours),
      s.mode !== "cold" && s.collectBefore
        ? `Asks for ${lowerFirst(s.collectBefore)} first`
        : "Puts the caller straight through",
    ],
  };
}

export function messageCard(s: MessageScenario): CardLine {
  const brief = s.brief.trim();
  return {
    key: `message:${s.id}`,
    title: s.name,
    detail: [brief ? truncate(brief, 110) : "Takes the caller's name, number and what it's about"],
    off: !s.enabled,
  };
}

export function appointmentsCard(a: AppointmentSettings): CardLine {
  if (!a.enabled) {
    return {
      key: "appointments",
      title: "Not booking appointments",
      detail: ["Takes the caller's preferred time as a message"],
      off: true,
    };
  }
  return {
    key: "appointments",
    title: "Books appointments",
    detail: [
      `${a.title || "Appointment"} · ${a.durationMinutes} min`,
      `At least ${noticeLabel(a.minNoticeMinutes)} notice · up to ${a.horizonDays} days ahead`,
      a.hours.length ? compactHours(a.hours) : "During business hours",
      ...(a.instructions ? [truncate(a.instructions, 90)] : []),
    ],
  };
}

export function timezoneCard(tz?: string): CardLine {
  if (!tz) {
    return { key: "timezone", title: "Not set", detail: ["The consultant sets it, or it's taken from your address"] };
  }
  const city = (tz.split("/").pop() ?? tz).replace(/_/g, " ");
  return { key: "timezone", title: city, detail: [tz, "Used for transfer hours and booking times"] };
}
