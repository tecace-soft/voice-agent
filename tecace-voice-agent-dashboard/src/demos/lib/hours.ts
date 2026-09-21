import type { BusinessHour } from "./types";

/**
 * Research is allowed to come back without opening times — a B2B company often
 * publishes none — and it says so by leaving them empty. Both the prompt and
 * the knowledge panel have to survive that, or the day renders as
 * "undefined-undefined" and the receptionist reads it out.
 *
 * Returns null when the entry says nothing worth saying.
 */
export function describeHours(hour: BusinessHour): string | null {
  if (hour.closed) return "Closed";
  if (hour.open && hour.close) return `${hour.open} to ${hour.close}`;
  if (hour.open) return `From ${hour.open}`;
  if (hour.close) return `Until ${hour.close}`;
  return null;
}

/** The days that say something, paired with how to say it. */
export function knownHours(
  hours: BusinessHour[] | undefined,
): { day: string; text: string }[] {
  const out: { day: string; text: string }[] = [];
  for (const hour of hours ?? []) {
    const text = describeHours(hour);
    if (text) out.push({ day: hour.day, text });
  }
  return out;
}
