import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScenarioPassDetail, ScenarioRun, ScenarioTest } from "../../api/types";
import { Exchange } from "@/components/public/Exchange";
import { SectionIntro } from "../SettingsShell";
import { estimateLine, expectationLine, passSummaryLine, runTimeline, runnerActivity, verdictLabel } from "./format";
import { ScenarioEditor } from "./ScenarioEditor";
import { useScenarioTests } from "./useScenarioTests";

// Scenario tests (admin only): written test calls run once against the real receptionist, with
// sandbox tools, each graded. One press of Run selected runs each ticked scenario once and stops.
// Text only — nothing here plays audio.

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function ScenarioTestsSection({ userId }: { userId: string }) {
  const s = useScenarioTests(userId);
  const [settings, setSettings] = useState<"draft" | "published">("draft");
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ScenarioTest | "new" | null>(null);

  const scenarios = s.list?.scenarios ?? [];
  const selected = scenarios.filter((x) => x.applicable && !unticked.has(x.id));
  const running = s.runningPass;

  function toggle(id: string) {
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmRun() {
    if (!s.list || !selected.length) return;
    const estimate = estimateLine(selected.length, s.list.perRunEstimateUsd);
    if (window.confirm(`Run ${estimate}? Each scenario runs once, then it stops.`)) {
      void s.run(settings, selected.map((x) => x.id));
    }
  }

  return (
    <div>
      <SectionIntro>
        Each ticked scenario is spoken to the receptionist once, by a synthesized caller, with test tools — nothing
        is booked, texted or put through for real. Results show what was said, which tools ran, and why each passed
        or failed. Then it stops until you run it again. A test call skips the phone line's own safety nets, so
        confirm anything that matters with a real call.
      </SectionIntro>

      {s.error ? <p className="ta-body-2 text-destructive mb-4">{s.error}</p> : null}
      {s.list && !s.list.runnerConfigured ? (
        <p className="ta-body-2 text-muted-foreground mb-4">The scenario runner isn't set up on this server yet.</p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="ta-label-1 mr-1">Settings to test</span>
        {(["draft", "published"] as const).map((k) => (
          <Button key={k} size="sm" aria-pressed={settings === k} variant={settings === k ? "default" : "outline"} onClick={() => setSettings(k)}>
            {k === "draft" ? "Draft" : "Published"}
          </Button>
        ))}
      </div>

      <ul className="mb-4 divide-y rounded-xl border">
        {scenarios.map((x) => (
          <li key={x.id} className={`flex items-start gap-3 p-3 ${x.applicable ? "" : "opacity-50"}`}>
            <input
              type="checkbox"
              className="mt-1"
              aria-label={`Include ${x.title}`}
              checked={x.applicable && !unticked.has(x.id)}
              disabled={!x.applicable}
              onChange={() => toggle(x.id)}
            />
            <div className="min-w-0 flex-1">
              <p className="ta-label-1">
                {x.templateId ? `${x.templateId} · ` : ""}
                {x.title}
              </p>
              <p className="ta-caption-1 text-muted-foreground truncate">“{x.definition.customerLines[0]}”</p>
              <p className="ta-caption-1 text-muted-foreground truncate">{expectationLine(x.definition)}</p>
              {!x.applicable ? <p className="ta-caption-1 text-muted-foreground">Not available with these settings.</p> : null}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(x)}>
              Edit
            </Button>
          </li>
        ))}
      </ul>

      {editing ? (
        <ScenarioEditor
          key={editing === "new" ? "new" : editing.id}
          scenario={editing === "new" ? null : editing}
          busy={s.busy}
          onCancel={() => setEditing(null)}
          onSave={async (title, definition) => {
            if (await s.save(editing === "new" ? null : editing.id, title, definition)) setEditing(null);
          }}
          onReset={
            editing !== "new" && editing.templateId
              ? () => {
                  if (window.confirm("Replace your edits with the built-in version?")) {
                    void s.reset(editing.id).then((ok) => ok && setEditing(null));
                  }
                }
              : undefined
          }
          onDelete={
            editing !== "new" && !editing.templateId
              ? () => {
                  if (window.confirm("Delete this scenario?")) void s.remove(editing.id).then((ok) => ok && setEditing(null));
                }
              : undefined
          }
        />
      ) : null}

      {running ? (
        <RunnerStatus
          activity={runnerActivity(running, s.open?.pass.id === running.id ? s.open.runs : null)}
          stopping={s.busy}
          onStop={() => void s.stop()}
        />
      ) : null}

      <div className="mb-8 flex flex-wrap items-center gap-2">
        {running ? null : (
          <Button onClick={confirmRun} disabled={s.busy || !selected.length || !s.list?.runnerConfigured}>
            Run selected{s.list && selected.length ? ` · ${estimateLine(selected.length, s.list.perRunEstimateUsd)}` : ""}
          </Button>
        )}
        <Button variant="outline" onClick={() => setEditing("new")}>
          Add scenario
        </Button>
      </div>

      {s.open ? <PassResult detail={s.open} /> : null}

      {s.passes.length > 1 ? (
        <div className="mt-8">
          <p className="ta-headline-2 mb-3">All runs</p>
          <ul className="space-y-1">
            {s.passes.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`ta-body-2 text-left hover:underline ${p.id === s.open?.pass.id ? "text-primary" : ""}`}
                  onClick={() => void s.openPass(p.id)}
                >
                  {passSummaryLine(p, when(p.createdAt))}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Shown while the runner works through a pass: a spinning ring, what it's on, and how far along. */
function RunnerStatus(props: { activity: { line: string; percent: number }; stopping: boolean; onStop: () => void }) {
  return (
    <div className="border-primary/30 bg-primary/5 mb-4 flex items-center gap-4 rounded-xl border p-4" role="status" aria-live="polite">
      <Loader2 className="text-primary size-8 shrink-0 motion-safe:animate-spin" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="ta-label-1">Test runner is active</p>
        <p className="ta-caption-1 text-muted-foreground truncate">{props.activity.line}</p>
        <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-150 ease-out"
            style={{ width: `${props.activity.percent}%` }}
          />
        </div>
      </div>
      <Button variant="outline" onClick={props.onStop} disabled={props.stopping}>
        Stop
      </Button>
    </div>
  );
}

function PassResult({ detail }: { detail: ScenarioPassDetail }) {
  const [openRun, setOpenRun] = useState<string | null>(null);
  return (
    <div>
      <p className="ta-headline-2 mb-1">Result</p>
      <p className="ta-body-2 text-muted-foreground mb-3">{passSummaryLine(detail.pass, when(detail.pass.createdAt))}</p>
      <ul className="divide-y rounded-xl border">
        {detail.runs.map((run) => (
          <li key={run.id} className="p-3">
            <button type="button" aria-expanded={openRun === run.id} className="flex w-full items-center gap-3 text-left" onClick={() => setOpenRun(openRun === run.id ? null : run.id)}>
              <span
                className={`ta-label-1 flex w-28 items-center gap-1.5 ${run.verdict === "pass" ? "text-primary" : run.verdict === "fail" ? "text-destructive" : ""}`}
              >
                {detail.pass.status === "running" && (run.status === "running" || run.status === "grading") ? (
                  <Loader2 className="text-primary size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
                ) : null}
                {verdictLabel(run, detail.pass.status)}
              </span>
              <span className="ta-body-2 flex-1">{run.title}</span>
              <span className="ta-caption-1 text-muted-foreground">
                {run.durationSec != null ? `${run.durationSec}s` : ""}
                {run.costUsd != null ? ` · $${run.costUsd.toFixed(2)}` : ""}
              </span>
            </button>
            {openRun === run.id ? <RunDetail run={run} /> : null}
          </li>
        ))}
      </ul>
      {detail.pass.status !== "running" ? (
        <p className="ta-caption-1 text-muted-foreground mt-3">
          Next: confirm on a real call with the Test call panel beside these settings.
        </p>
      ) : null}
    </div>
  );
}

function RunDetail({ run }: { run: ScenarioRun }) {
  return (
    <div className="mt-3 space-y-3">
      {run.errorReason ? <p className="ta-body-2 text-destructive">Run error: {run.errorReason}</p> : null}
      {run.failures.length ? (
        <ul className="ta-body-2 space-y-1">
          {run.failures.map((f, i) => (
            <li key={i} className="text-destructive">
              <span aria-hidden="true">✗ </span>
              {f.kind === "judge" ? "Judge: " : ""}
              {f.text}
              {f.evidence ? <span className="text-muted-foreground"> — “{f.evidence}”</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex max-h-[560px] flex-col gap-3 overflow-y-auto rounded-xl border p-4" role="region" aria-label="Test call transcript">
        {runTimeline(run).map((item, i) =>
          item.kind === "turn" ? (
            <Exchange key={i} speaker={item.speaker} text={item.text} callerLabel="Test caller" />
          ) : (
            <p key={i} className={`ta-caption-1 font-mono ${item.ok ? "text-muted-foreground" : "text-destructive"}`}>
              <span aria-hidden="true">⚙ </span>
              {item.summary}
            </p>
          ),
        )}
        {run.transcript.length === 0 && run.sandbox.calls.length === 0 ? (
          <p className="ta-caption-1 text-muted-foreground">Nothing was captured for this run.</p>
        ) : null}
      </div>
    </div>
  );
}
