import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ScenarioDefinition, ScenarioTest } from "../../api/types";

// The editor for one scenario. The section keys it by scenario id, so switching scenarios remounts it
// with that scenario's fields.

const LANGUAGES = { en: "English", ko: "Korean" } as const;

export function ScenarioEditor(props: {
  scenario: ScenarioTest | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (title: string, definition: ScenarioDefinition) => Promise<void>;
  onReset?: () => void;
  onDelete?: () => void;
}) {
  const start = props.scenario?.definition;
  const [title, setTitle] = useState(props.scenario?.title ?? "");
  const [lines, setLines] = useState((start?.customerLines ?? []).join("\n"));
  const [language, setLanguage] = useState<"ko" | "en">(start?.language ?? "en");
  const [rules, setRules] = useState(JSON.stringify({ world: start?.world ?? {}, expect: start?.expect ?? {} }, null, 2));
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rules);
    } catch {
      setProblem("Test conditions and expectations must be valid JSON.");
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      setProblem("Test conditions and expectations must be a JSON object with world and expect.");
      return;
    }
    const { world, expect } = parsed as { world?: ScenarioDefinition["world"]; expect?: ScenarioDefinition["expect"] };
    setProblem(null);
    try {
      await props.onSave(title, {
        customerLines: lines.split("\n").map((l) => l.trim()).filter(Boolean),
        language,
        world: world ?? {},
        expect: expect ?? {},
      });
    } catch {
      setProblem("Couldn't save this scenario. Try again.");
    }
  }

  return (
    <div className="mb-6 space-y-3 rounded-xl border p-4">
      <p className="ta-label-1">{props.scenario ? "Edit scenario" : "New scenario"}</p>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" />
      <div>
        <p className="ta-caption-1 text-muted-foreground mb-1">
          What the caller says — one line per turn, up to three. Times: {"{slotA.spoken}"}, {"{slotB.clock}"}.
        </p>
        <Textarea rows={3} value={lines} onChange={(e) => setLines(e.target.value)} aria-label="Caller lines" />
      </div>
      <div className="flex items-center gap-2">
        <span className="ta-caption-1">Language</span>
        <Select value={language} onValueChange={(v) => v && setLanguage(v as "ko" | "en")}>
          <SelectTrigger aria-label="Language" className="w-40">
            <SelectValue>{LANGUAGES[language]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="ko">Korean</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <p className="ta-caption-1 text-muted-foreground mb-1">Test conditions and expectations (JSON). Never shown to the receptionist.</p>
        <Textarea rows={10} className="font-mono" value={rules} onChange={(e) => setRules(e.target.value)} aria-label="Conditions and expectations" />
      </div>
      {problem ? <p className="ta-body-2 text-destructive">{problem}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={props.busy}>
          Save
        </Button>
        <Button variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        {props.onReset ? (
          <Button variant="ghost" onClick={props.onReset} disabled={props.busy}>
            Reset to template
          </Button>
        ) : null}
        {props.onDelete ? (
          <Button variant="ghost" className="text-destructive" onClick={props.onDelete} disabled={props.busy}>
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  );
}
