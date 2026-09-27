import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MAX_BRIEF, MAX_SCENARIOS, newId, type MessageScenario } from "../callSettings";
import { SectionIntro } from "../SettingsShell";
import { ExamplePicker, MESSAGE_EXAMPLES, MessageExchange } from "../examples";
import {
  FieldMessage,
  InlineEditor,
  ScenarioRow,
  Tag,
  localField,
  toFieldError,
  type CallSettingsBinding,
  type FieldError,
} from "./shared";

// How the assistant takes particular kinds of message. Without any scenario it takes the caller's
// name and what the call is about (it already has their number); a scenario is a short brief for a
// situation where the business wants more — the address for a quote, the insurer for a new patient.

export function TakeMessageSection({ binding }: { binding: CallSettingsBinding }) {
  const scenarios = binding.value.messages.scenarios;
  const [editing, setEditing] = useState<{ scenario: MessageScenario; index: number } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const change = (fn: (list: MessageScenario[]) => MessageScenario[]) =>
    binding.update((current) => ({ ...current, messages: { scenarios: fn(current.messages.scenarios) } }));

  async function run(action: () => Promise<void>) {
    setRowError(null);
    try {
      await action();
    } catch (e) {
      setRowError(toFieldError(e, "Couldn't save that.").message);
    }
  }

  const readOnly = Boolean(binding.readOnly);
  const showingExamples = readOnly && scenarios.length === 0;
  const rows = showingExamples ? MESSAGE_EXAMPLES.map((e) => e.scenario()) : scenarios;
  const fromExample = (example: (typeof MESSAGE_EXAMPLES)[number]) =>
    setEditing({ scenario: example.scenario(), index: -1 });
  const editor = editing ? (
    <MessageEditor
      key={editing.scenario.id}
      initial={editing.scenario}
      isNew={editing.index === -1}
      index={editing.index === -1 ? scenarios.length : editing.index}
      onCancel={() => setEditing(null)}
      onSave={async (scenario) => {
        await change((list) =>
          list.some((s) => s.id === scenario.id)
            ? list.map((s) => (s.id === scenario.id ? scenario : s))
            : [...list, scenario],
        );
        setEditing(null);
      }}
    />
  ) : null;

  return (
    <div>
      {binding.publishBar}
      <SectionIntro>
        When the assistant can't help a caller itself, it takes a message: their name and what it's about,
        using the number they called from. Add a scenario for situations where you want something more.
      </SectionIntro>

      <div className="bg-muted/40 mb-6 rounded-xl border p-4">
        <p className="ta-label-1">Every message, as standard</p>
        <p className="ta-caption-1 text-muted-foreground mt-1">
          Caller's name · the number they called from (asked only if it's withheld) · what the call is about ·
          when they'd like a callback, if they say. Messages appear under Answered calls.
        </p>
      </div>

      {rowError ? <FieldMessage>{rowError}</FieldMessage> : null}

      {showingExamples ? (
        <p className="ta-caption-1 text-muted-foreground mb-2">
          Examples of what you can set up. Your TecAce team sets these up with you during onboarding.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border">
        <ul className="divide-y">
          {editing?.index === -1 ? <li>{editor}</li> : null}
          {rows.map((scenario, index) => {
            const open = editing?.index === index && editing.scenario.id === scenario.id;
            return (
              <ScenarioRow
                key={scenario.id}
                open={open}
                onToggle={() => setEditing(open ? null : { scenario, index })}
                label={`Edit ${scenario.name}`}
                main={
                  <>
                    <span className="flex items-center gap-2">
                      <span className="ta-label-1 truncate">{scenario.name}</span>
                      {showingExamples ? <Tag>Example</Tag> : null}
                      {!scenario.enabled ? <Tag>Off</Tag> : null}
                    </span>
                    <span className="ta-caption-1 text-muted-foreground block truncate">{scenario.brief}</span>
                  </>
                }
                actions={
                  <>
                    <Switch
                      checked={scenario.enabled}
                      disabled={readOnly}
                      aria-label={`Turn ${scenario.name} ${scenario.enabled ? "off" : "on"}`}
                      onCheckedChange={(enabled) =>
                        void run(() => change((list) => list.map((s) => (s.id === scenario.id ? { ...s, enabled } : s))))
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${scenario.name}`}
                      onClick={() =>
                        window.confirm(`Delete "${scenario.name}"?`) &&
                        void run(() => change((list) => list.filter((s) => s.id !== scenario.id)))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </>
                }
              >
                {editor}
              </ScenarioRow>
            );
          })}
          {rows.length === 0 && !editing ? (
            <li className="ta-caption-1 text-muted-foreground px-4 py-6 text-center">
              No scenarios yet. Every message still gets the standard details above.
            </li>
          ) : null}
        </ul>
        <div className={readOnly ? "hidden" : "bg-muted/30 flex flex-wrap items-center gap-3 border-t px-4 py-2.5"}>
          <span className="ta-caption-1 text-muted-foreground">
            {scenarios.length} of {MAX_SCENARIOS}
            {scenarios.length ? " · click a row to edit it" : ""}
          </span>
          <span className="flex-1" />
          {scenarios.length < MAX_SCENARIOS ? (
            <ExamplePicker examples={MESSAGE_EXAMPLES} onPick={fromExample} label="Add an example" />
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={scenarios.length >= MAX_SCENARIOS || editing?.index === -1}
            onClick={() => setEditing({ scenario: { id: newId(), enabled: true, name: "", brief: "" }, index: -1 })}
          >
            <Plus className="size-4" />
            Add a scenario
          </Button>
        </div>
      </div>

      <div className="mt-8">
        <MessageExchange scenario={scenarios.find((s) => s.enabled)} />
      </div>

    </div>
  );
}

function MessageEditor({
  initial,
  isNew,
  index,
  onCancel,
  onSave,
}: {
  initial: MessageScenario;
  /** Not in the list yet: an empty form, or one started from an example. */
  isNew: boolean;
  index: number;
  onCancel: () => void;
  onSave: (scenario: MessageScenario) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const [tried, setTried] = useState(false);
  const where = error ? localField(error.field, "messages.scenarios", index) : undefined;
  const problems = {
    name: draft.name.trim() ? null : "Give this scenario a name.",
    brief: !draft.brief.trim()
      ? "Say what to ask callers in this situation."
      : draft.brief.length > MAX_BRIEF
        ? `Keep it to ${MAX_BRIEF} characters.`
        : null,
  };

  async function submit() {
    setTried(true);
    if (problems.name || problems.brief) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...draft, name: draft.name.trim(), brief: draft.brief.trim() });
    } catch (e) {
      setError(toFieldError(e, "Couldn't save this scenario."));
    } finally {
      setSaving(false);
    }
  }

  const show = (field: "name" | "brief") => (where === field ? error?.message : null) ?? (tried ? problems[field] : null);

  return (
    <InlineEditor title={isNew ? "Add a message scenario" : `Edit ${initial.name}`} description="A situation, and what the assistant should ask in it." onCancel={onCancel}>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="message-name" className="ta-label-1">
              Situation
            </Label>
            <Input
              id="message-name"
              value={draft.name}
              placeholder="Quote request"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <FieldMessage>{show("name")}</FieldMessage>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="message-brief" className="ta-label-1">
              Brief
            </Label>
            <Textarea
              id="message-brief"
              className="min-h-28"
              value={draft.brief}
              placeholder="When someone wants a quote, ask for the property address and roughly how big the job is. Let them know we reply within one business day."
              onChange={(e) => setDraft({ ...draft, brief: e.target.value })}
            />
            <p className="ta-caption-1 text-muted-foreground">
              {draft.brief.length} of {MAX_BRIEF}. Write it the way you'd brief a new receptionist.
            </p>
            <FieldMessage>{show("brief")}</FieldMessage>
          </div>
          <label className="ta-label-1 flex items-center justify-between gap-4 rounded-lg border p-3">
            On
            <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
          </label>
          {error && where === undefined ? <FieldMessage>{error.message}</FieldMessage> : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving" : "Save"}
          </Button>
        </div>
      </InlineEditor>
  );
}
