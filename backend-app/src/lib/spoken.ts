// Human/spoken-friendly formatting of ISO instants in the business timezone, so the
// voice agent can read times back naturally (e.g. "Tuesday, August 4 at 2:00 PM").

export function formatSpoken(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // unparseable — return as-is
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${date} at ${time}`;
}

// Join spoken labels as a natural list: "A", "A and B", "A, B, or C".
export function joinSpoken(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}
