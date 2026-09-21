import type { TranscriptEntry, TranscriptSpeaker } from "./types";

/** Fragments closer than this to the previous one join the same bubble. */
export const BUBBLE_GAP_MS = 1500;

export type Fragment = {
  speaker: TranscriptSpeaker;
  delta: string;
  startMs: number;
  endMs: number;
};

/**
 * GPT-Live emits timed fragments, never turns, and the two speakers can
 * overlap. Join consecutive fragments from one speaker into a bubble, then
 * keep the bubbles ordered by when they started.
 */
export function appendFragment(
  entries: TranscriptEntry[],
  fragment: Fragment,
): TranscriptEntry[] {
  const lastIndex = entries.map((entry) => entry.speaker).lastIndexOf(fragment.speaker);
  const lastForSpeaker = lastIndex === -1 ? undefined : entries[lastIndex];

  // Anything the other speaker said since then only counts as a turn change if
  // it started after this speaker stopped. Overlapping speech is full duplex,
  // not a new turn.
  const interrupted =
    lastForSpeaker !== undefined &&
    entries
      .slice(lastIndex + 1)
      .some((entry) => entry.startMs >= lastForSpeaker.endMs);

  const withinGap =
    lastForSpeaker !== undefined &&
    fragment.startMs - lastForSpeaker.endMs <= BUBBLE_GAP_MS;

  if (lastForSpeaker && withinGap && !interrupted) {
    return entries.map((entry) =>
      entry.id === lastForSpeaker.id
        ? {
            ...entry,
            text: entry.text + fragment.delta,
            endMs: Math.max(entry.endMs, fragment.endMs),
          }
        : entry,
    );
  }

  const next: TranscriptEntry = {
    id: `${fragment.speaker}-${fragment.startMs}-${entries.length}`,
    speaker: fragment.speaker,
    text: fragment.delta,
    startMs: fragment.startMs,
    endMs: fragment.endMs,
  };
  return [...entries, next].sort((a, b) => a.startMs - b.startMs);
}

export function transcriptText(entries: TranscriptEntry[]): string {
  return entries
    .map((entry) => `${entry.speaker === "caller" ? "Caller" : "Receptionist"}: ${entry.text.trim()}`)
    .join("\n");
}
