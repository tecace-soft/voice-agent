import { describe, expect, it } from "vitest";
import type { ScenarioDefinition, ScenarioPassSummary, ScenarioRun } from "../src/api/types";
import { estimateLine, expectationLine, passSummaryLine, runTimeline, verdictLabel } from "../src/settings/scenarios/format";

// What the Scenario tests section says about a pass and a run. Pure, so it is tested here and the
// component only lays it out.

const pass = (over: Partial<ScenarioPassSummary> = {}): ScenarioPassSummary => ({
  id: "p",
  settingsKind: "draft",
  status: "completed",
  createdAt: "2026-10-01T21:02:00Z",
  finishedAt: "2026-10-01T21:10:00Z",
  runs: 8,
  done: 8,
  passed: 6,
  failed: 1,
  errors: 1,
  costUsd: 0.58,
  ...over,
});

describe("scenario test wording", () => {
  it("estimates before a run", () => {
    expect(estimateLine(8, 0.08)).toBe("8 scenarios · about 8 min · about $0.64");
    expect(estimateLine(1, 0.08)).toBe("1 scenario · about 1 min · about $0.08");
  });

  it("sums up a pass", () => {
    expect(passSummaryLine(pass(), "1 Oct 14:02")).toBe(
      "Draft settings · 1 Oct 14:02 · 8 runs · 6 passed · 1 failed · 1 run error · $0.58",
    );
    expect(passSummaryLine(pass({ status: "running", done: 3, errors: 0 }), "now")).toBe(
      "Draft settings · now · 8 runs · 6 passed · 1 failed · $0.58 · running 3/8",
    );
    expect(passSummaryLine(pass({ status: "cancelled", errors: 0, settingsKind: "published" }), "x")).toContain(
      "Published settings",
    );
  });

  it("labels a run by what happened to it", () => {
    expect(verdictLabel({ status: "done", verdict: "pass" }, "completed")).toBe("Passed");
    expect(verdictLabel({ status: "done", verdict: "run_error" }, "completed")).toBe("Run error");
    expect(verdictLabel({ status: "queued", verdict: null }, "running")).toBe("Queued");
    expect(verdictLabel({ status: "queued", verdict: null }, "cancelled")).toBe("Not run");
    expect(verdictLabel({ status: "running", verdict: null }, "interrupted")).toBe("Interrupted");
    expect(verdictLabel({ status: "grading", verdict: null }, "running")).toBe("Grading");
  });

  it("puts tool calls between the turns where they happened", () => {
    const run: Pick<ScenarioRun, "transcript" | "sandbox" | "startedAt"> = {
      startedAt: "2026-10-01T21:00:00.000Z",
      transcript: [
        { id: "t1", speaker: "receptionist", text: "Hi", startMs: 0, endMs: 900 },
        { id: "t2", speaker: "caller", text: "Book 4 PM", startMs: 2000, endMs: 3000 },
        { id: "t3", speaker: "receptionist", text: "Booked", startMs: 6000, endMs: 7000 },
      ],
      sandbox: {
        calls: [{ name: "book_appointment", args: { start: "2026-10-02T16:00:00-07:00" }, ok: true, output: { booked: true }, at: "2026-10-01T21:00:04.000Z" }],
        bookings: [],
        messages: [],
      },
    };
    const items = runTimeline(run);
    expect(items.map((i) => (i.kind === "turn" ? i.text : i.name))).toEqual(["Hi", "Book 4 PM", "book_appointment", "Booked"]);
    const tool = items[2]!;
    expect(tool.kind === "tool" && tool.summary).toBe('book_appointment(start: 2026-10-02T16:00:00-07:00) → {"booked":true}');
  });
});

describe("expectationLine", () => {
  const def = (expect: ScenarioDefinition["expect"]): ScenarioDefinition => ({ customerLines: ["hi"], language: "en", world: {}, expect });
  it("lists tools, forbidden tools, final counts and judge checks", () => {
    expect(
      expectationLine(
        def({
          tools: [{ name: "book_appointment" }, { name: "send_text", times: 2 }],
          forbidden: ["transfer_call"],
          final: { bookings: 1, messages: 0 },
          judge: ["polite", "brief"],
        }),
      ),
    ).toBe("book_appointment · send_text ×2 · never: transfer_call · 1 booking · 0 messages · 2 judge checks");
  });
  it("says judge checks only when nothing is declared", () => {
    expect(expectationLine(def({}))).toBe("Judge checks only");
  });
});
