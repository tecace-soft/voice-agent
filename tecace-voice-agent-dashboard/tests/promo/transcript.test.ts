import { describe, expect, it } from "vitest";
import { appendFragment, transcriptText } from "../../src/demos/lib/transcript";
import type { TranscriptEntry } from "../../src/demos/lib/types";

function build(fragments: Parameters<typeof appendFragment>[1][]): TranscriptEntry[] {
  return fragments.reduce<TranscriptEntry[]>(
    (entries, fragment) => appendFragment(entries, fragment),
    [],
  );
}

describe("appendFragment", () => {
  it("joins consecutive fragments from one speaker", () => {
    const entries = build([
      { speaker: "receptionist", delta: "Thank you ", startMs: 0, endMs: 400 },
      { speaker: "receptionist", delta: "for calling.", startMs: 400, endMs: 900 },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("Thank you for calling.");
    expect(entries[0]!.endMs).toBe(900);
  });

  it("starts a new bubble after a long gap", () => {
    const entries = build([
      { speaker: "caller", delta: "Hi.", startMs: 0, endMs: 300 },
      { speaker: "caller", delta: "Are you open?", startMs: 5000, endMs: 5600 },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[1]!.text).toBe("Are you open?");
  });

  it("keeps speakers apart and orders bubbles by start time", () => {
    const entries = build([
      { speaker: "caller", delta: "Hi there.", startMs: 0, endMs: 500 },
      { speaker: "receptionist", delta: "Hello.", startMs: 600, endMs: 900 },
      { speaker: "caller", delta: "Are you open?", startMs: 950, endMs: 1400 },
    ]);
    expect(entries.map((entry) => entry.speaker)).toEqual([
      "caller",
      "receptionist",
      "caller",
    ]);
    expect(entries[2]!.text).toBe("Are you open?");
  });

  it("merges interleaved overlap back into the right speaker", () => {
    const entries = build([
      { speaker: "receptionist", delta: "We close at ", startMs: 0, endMs: 500 },
      { speaker: "caller", delta: "Sorry, ", startMs: 300, endMs: 700 },
      { speaker: "receptionist", delta: "nine.", startMs: 700, endMs: 1000 },
    ]);
    expect(entries).toHaveLength(2);
    const receptionist = entries.find((entry) => entry.speaker === "receptionist");
    expect(receptionist?.text).toBe("We close at nine.");
  });
});

describe("transcriptText", () => {
  it("labels each line by speaker", () => {
    const entries = build([
      { speaker: "caller", delta: "Hi.", startMs: 0, endMs: 200 },
      { speaker: "receptionist", delta: "Hello.", startMs: 3000, endMs: 3200 },
    ]);
    expect(transcriptText(entries)).toBe("Caller: Hi.\nReceptionist: Hello.");
  });
});
