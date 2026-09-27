import { useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Pause, Phone, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  DAYS,
  DEFAULT_COLLECT_BEFORE,
  HOLD_MUSIC,
  HOLD_MUSIC_LABEL,
  HOLD_MUSIC_PREVIEW,
  MAX_SCENARIOS,
  MAX_WATERFALL_NUMBERS,
  MODE_EXPLAINER,
  MODE_LABEL,
  displayPhone,
  hoursSummary,
  newId,
  phoneProblem,
  type Day,
  type HoldMusic,
  type TransferMode,
  type TransferScenario,
  type Window,
} from "../callSettings";
import { SectionIntro } from "../SettingsShell";
import { ExamplePicker, TRANSFER_EXAMPLES, TransferExchange } from "../examples";
import {
  EmptyState,
  FieldMessage,
  InlineEditor,
  ScenarioRow,
  Tag,
  localField,
  toFieldError,
  type CallSettingsBinding,
  type FieldError,
} from "./shared";

// Who the assistant can put a caller through to, and how.
//
// Each scenario is one person or team, the way a caller asks for them ("Billing", "Sam"), with the
// conditions that decide it and the hours it may be used. The assistant only ever learns about the
// scenarios that are switched on and open when the call starts, so a scenario outside its hours is
// one it cannot offer — the phone agent and the in-app test call are told the same.

const MODE_TONE: Record<TransferMode, "blue" | "amber" | "green"> = { cold: "blue", warm: "amber", waterfall: "green" };

function blankScenario(): TransferScenario {
  return {
    id: newId(),
    enabled: true,
    mode: "warm",
    name: "",
    description: "",
    numbers: [""],
    collectBefore: DEFAULT_COLLECT_BEFORE,
    holdMusic: "classical",
    hours: [],
  };
}

export function TransferCallsSection({
  binding,
  notes,
}: {
  binding: CallSettingsBinding;
  /** Under the intro: an older single transfer number still in use, the admin's waterfall switch. */
  notes?: ReactNode;
}) {
  const scenarios = binding.value.transfer.scenarios;
  const [editing, setEditing] = useState<{ scenario: TransferScenario; index: number } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // Every change goes through `update`, applied to the latest list and matched by id, so a toggle
  // made while another save is in flight cannot undo it.
  const change = (fn: (list: TransferScenario[]) => TransferScenario[]) =>
    binding.update((current) => ({
      ...current,
      transfer: { ...current.transfer, scenarios: fn(current.transfer.scenarios) },
    }));

  async function toggle(id: string, enabled: boolean) {
    setRowError(null);
    try {
      await change((list) => list.map((s) => (s.id === id ? { ...s, enabled } : s)));
    } catch (e) {
      setRowError(toFieldError(e, "Couldn't change that.").message);
    }
  }

  async function remove(id: string) {
    const scenario = scenarios.find((s) => s.id === id);
    if (!scenario || !window.confirm(`Delete the "${scenario.name}" transfer?`)) return;
    setRowError(null);
    try {
      await change((list) => list.filter((s) => s.id !== id));
    } catch (e) {
      setRowError(toFieldError(e, "Couldn't delete that.").message);
    }
  }

  const full = scenarios.length >= MAX_SCENARIOS;
  const readOnly = Boolean(binding.readOnly);
  // Nothing set up yet and nothing to edit with: show what it could look like instead of an empty box.
  const showingExamples = readOnly && scenarios.length === 0;
  const rows = showingExamples
    ? TRANSFER_EXAMPLES.map((e) => ({ ...e.scenario(), numbers: e.sampleNumbers }))
    : scenarios;
  const fromExample = (example: (typeof TRANSFER_EXAMPLES)[number]) =>
    setEditing({ scenario: example.scenario(), index: -1 });
  const sample = scenarios.find((s) => s.enabled) ?? scenarios[0];
  const editor = editing ? (
    <TransferEditor
      key={editing.scenario.id}
      initial={editing.scenario}
      isNew={editing.index === -1}
      index={editing.index === -1 ? scenarios.length : editing.index}
      waterfallAllowed={binding.waterfallAllowed}
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
        Put callers through to a person when they ask, or when a situation below comes up. Only inside each
        transfer's hours; outside them, the assistant takes a message.
      </SectionIntro>

      {notes}

      {rowError ? <FieldMessage>{rowError}</FieldMessage> : null}

      {showingExamples ? (
        <p className="ta-caption-1 text-muted-foreground mb-2">
          Examples of what you can set up. Your TecAce team sets these up with you during onboarding.
        </p>
      ) : null}

      {rows.length === 0 && !editing ? (
        <EmptyState
          title="No transfers yet"
          action={
            <div className="flex flex-col items-center gap-3">
              <Button onClick={() => setEditing({ scenario: blankScenario(), index: -1 })}>
                <Plus className="size-4" />
                Add a transfer
              </Button>
              <ExamplePicker examples={TRANSFER_EXAMPLES} onPick={fromExample} />
            </div>
          }
        >
          Add a transfer so callers can reach a person or team. Until then, the assistant takes a message
          whenever someone asks for a person.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-[10px] border" role="table" aria-label="Transfers">
          {/* Column heads, lined up with each row's summary (ScenarioRow's `meta`) and its switch. */}
          <div
            role="row"
            className="bg-muted/50 text-muted-foreground/80 hidden items-center gap-4 border-b py-2 pr-3 pl-4 text-[11px] tracking-[0.05em] uppercase @2xl:flex"
          >
            <span role="columnheader" className="flex-1">Name</span>
            <span role="columnheader" className="w-[76px]">Type</span>
            <span role="columnheader" className="w-32">Rings</span>
            <span role="columnheader" className="w-36">When</span>
            <span role="columnheader" className={readOnly ? "w-7 text-right" : "w-16 text-right"}>On</span>
          </div>
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
                        <span className="ta-label-1 truncate font-semibold!">{scenario.name}</span>
                        {/* On narrow screens the columns are hidden, so the type rides with the name. */}
                        <span className="@2xl:hidden">
                          <Tag tone={MODE_TONE[scenario.mode]}>{MODE_LABEL[scenario.mode]}</Tag>
                        </span>
                        {showingExamples ? <Tag>Example</Tag> : null}
                        {!scenario.enabled ? <Tag>Off</Tag> : null}
                      </span>
                      {scenario.description ? (
                        <span className="ta-caption-1 text-muted-foreground block truncate">{scenario.description}</span>
                      ) : null}
                    </>
                  }
                  meta={
                    <>
                      <span className="w-[76px]">
                        <Tag tone={MODE_TONE[scenario.mode]}>{MODE_LABEL[scenario.mode]}</Tag>
                      </span>
                      <span className="w-32 truncate font-mono text-[12px]" title={scenario.numbers.map(displayPhone).join(" → ")}>
                        {displayPhone(scenario.numbers[0] ?? "")}
                        {scenario.numbers.length > 1 ? (
                          <span className="text-muted-foreground"> +{scenario.numbers.length - 1}</span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground w-36 truncate text-[12px]" title={hoursSummary(scenario.hours)}>
                        {hoursSummary(scenario.hours)}
                      </span>
                    </>
                  }
                  actions={
                    <span className="flex items-center justify-end gap-1">
                      <Switch
                        checked={scenario.enabled}
                        // A waterfall on an account without the feature can be kept but not switched on.
                        disabled={readOnly || (scenario.mode === "waterfall" && !binding.waterfallAllowed)}
                        onCheckedChange={(checked) => void toggle(scenario.id, checked)}
                        aria-label={`Turn the ${scenario.name} transfer ${scenario.enabled ? "off" : "on"}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${scenario.name}`}
                        onClick={() => void remove(scenario.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  }
                >
                  {editor}
                </ScenarioRow>
              );
            })}
          </ul>
          {readOnly ? null : (
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-2.5">
              <span className="ta-caption-1">
                {scenarios.length} of {MAX_SCENARIOS}
              </span>
              <span className="flex-1" />
              {full ? null : <ExamplePicker examples={TRANSFER_EXAMPLES} onPick={fromExample} label="Start from" />}
              <Button
                variant="outline"
                size="sm"
                disabled={full || editing?.index === -1}
                onClick={() => setEditing({ scenario: blankScenario(), index: -1 })}
              >
                <Plus className="size-4" />
                Add a transfer
              </Button>
            </div>
          )}
        </div>
      )}

      {/* What the three types do: text under the list, not three more boxes. */}
      <div className="mt-6 grid gap-4 border-t pt-4 md:grid-cols-3" aria-label="Transfer types">
        {(["cold", "warm", "waterfall"] as TransferMode[]).map((mode) => (
          <div key={mode}>
            <p className="flex items-center gap-2">
              <Tag tone={MODE_TONE[mode]}>{MODE_LABEL[mode]}</Tag>
              {mode === "waterfall" && !binding.waterfallAllowed ? (
                <span className="ta-caption-2 text-muted-foreground">Not on your plan</span>
              ) : null}
            </p>
            <p className="ta-caption-1 text-muted-foreground mt-1.5 leading-[17px]">{MODE_EXPLAINER[mode]}</p>
          </div>
        ))}
      </div>

      {/* Where warm transfers ring from, in one line. */}
      <p className="ta-caption-1 text-muted-foreground mt-4 flex items-start gap-2 border-t pt-3.5">
        <Phone className="mt-px size-3.5 shrink-0" />
        {binding.agentNumber ? (
          <span>
            Warm transfers ring you from{" "}
            <span className="text-foreground font-mono">{displayPhone(binding.agentNumber)}</span>, your
            assistant's number. Save it in your contacts so you know it's a call being handed over.
          </span>
        ) : binding.mode === "demo" ? (
          <span>A demo has no phone line. Once this business goes live, warm transfers ring from its assistant's number.</span>
        ) : (
          <span>Warm transfers ring you from your assistant's number, shown here once one is assigned.</span>
        )}
      </p>

      <div className="mt-6">
        <TransferExchange businessName={binding.businessName} scenario={sample} />
      </div>
    </div>
  );
}

function TransferEditor({
  initial,
  isNew,
  index,
  waterfallAllowed,
  onCancel,
  onSave,
}: {
  initial: TransferScenario;
  /** Not in the list yet: an empty form, or one started from an example. */
  isNew: boolean;
  index: number;
  waterfallAllowed: boolean;
  onCancel: () => void;
  onSave: (scenario: TransferScenario) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TransferScenario>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  const [triedSave, setTriedSave] = useState(false);

  const patch = (partial: Partial<TransferScenario>) => setDraft((d) => ({ ...d, ...partial }));
  const where = error ? localField(error.field, "transfer.scenarios", index) : undefined;
  const messageFor = (field: string) => (where === field ? error?.message : undefined);

  function setMode(mode: TransferMode) {
    const numbers =
      mode === "waterfall"
        ? draft.numbers.length >= 2
          ? draft.numbers
          : [...draft.numbers, ""].slice(0, 2)
        : draft.numbers.slice(0, 1);
    patch({
      mode,
      numbers: numbers.length ? numbers : [""],
      collectBefore: mode === "cold" ? draft.collectBefore : draft.collectBefore || DEFAULT_COLLECT_BEFORE,
    });
  }

  const numberProblems = draft.numbers.map((n) => phoneProblem(n));
  const nameMissing = !draft.name.trim();
  const blocked = nameMissing || numberProblems.some(Boolean);

  async function submit() {
    setTriedSave(true);
    if (blocked) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...draft, name: draft.name.trim(), numbers: draft.numbers.map((n) => n.trim()) });
    } catch (e) {
      setError(toFieldError(e, "Couldn't save this transfer."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <InlineEditor title={isNew ? "Add a transfer" : `Edit ${initial.name}`} description="Who callers can be put through to, and when." onCancel={onCancel}>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label className="ta-label-1">Type</Label>
            <Tabs value={draft.mode} onValueChange={(value) => setMode(value as TransferMode)}>
              <TabsList>
                <TabsTrigger value="cold">Cold</TabsTrigger>
                <TabsTrigger value="warm">Warm</TabsTrigger>
                <TabsTrigger value="waterfall" disabled={!waterfallAllowed && draft.mode !== "waterfall"}>
                  Waterfall
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="ta-caption-1 text-muted-foreground">
              {MODE_EXPLAINER[draft.mode]}
              {!waterfallAllowed ? " Waterfall is available on a higher plan — ask us to turn it on." : ""}
            </p>
            <FieldMessage>{messageFor("mode")}</FieldMessage>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="transfer-name" className="ta-label-1">
              Name
            </Label>
            <Input
              id="transfer-name"
              value={draft.name}
              placeholder="Billing, Sam, or All transfer requests"
              onChange={(e) => patch({ name: e.target.value })}
              aria-invalid={Boolean(messageFor("name") || (triedSave && nameMissing))}
            />
            <p className="ta-caption-1 text-muted-foreground">A person or a team, the way a caller would ask for them.</p>
            <FieldMessage>{messageFor("name") ?? (triedSave && nameMissing ? "Give this transfer a name." : null)}</FieldMessage>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="transfer-description" className="ta-label-1">
              When to use it (optional)
            </Label>
            <Textarea
              id="transfer-description"
              value={draft.description}
              maxLength={500}
              placeholder="Put callers through for leaks, flooding, or no water. Don't use this if they ask for John by name."
              onChange={(e) => patch({ description: e.target.value })}
            />
            <p className="ta-caption-1 text-muted-foreground">
              Conditions, keywords and exceptions, in plain words. The assistant reads this to decide.
            </p>
            <FieldMessage>{messageFor("description")}</FieldMessage>
          </div>

          <NumbersField
            mode={draft.mode}
            numbers={draft.numbers}
            onChange={(numbers) => patch({ numbers })}
            problems={triedSave ? numberProblems : []}
            serverError={where?.startsWith("numbers") ? { field: where, message: error?.message ?? "" } : null}
          />

          {draft.mode !== "cold" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="transfer-collect" className="ta-label-1">
                  What to ask before transferring
                </Label>
                <Input
                  id="transfer-collect"
                  value={draft.collectBefore}
                  onChange={(e) => patch({ collectBefore: e.target.value })}
                />
                <p className="ta-caption-1 text-muted-foreground">
                  The assistant asks this first, then tells your team who is calling and why.
                </p>
                <FieldMessage>{messageFor("collectBefore")}</FieldMessage>
              </div>
              <HoldMusicField value={draft.holdMusic} onChange={(holdMusic) => patch({ holdMusic })} />
            </>
          ) : null}

          <HoursField hours={draft.hours} onChange={(hours) => patch({ hours })} error={where?.startsWith("hours") ? error?.message : undefined} />

          <label className="ta-label-1 flex items-center justify-between gap-4 rounded-lg border p-3">
            <span>
              On
              <span className="ta-caption-1 text-muted-foreground block">Switch it off to keep it without using it.</span>
            </span>
            <Switch checked={draft.enabled} onCheckedChange={(enabled) => patch({ enabled })} />
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

function NumbersField({
  mode,
  numbers,
  onChange,
  problems,
  serverError,
}: {
  mode: TransferMode;
  numbers: string[];
  onChange: (numbers: string[]) => void;
  problems: (string | null)[];
  serverError: { field: string; message: string } | null;
}) {
  const many = mode === "waterfall";
  const move = (from: number, to: number) => {
    const next = [...numbers];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    onChange(next);
  };
  return (
    <div className="space-y-1.5">
      <Label className="ta-label-1">{many ? "Numbers, in the order to try them" : "Number to put callers through to"}</Label>
      {numbers.map((number, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-center gap-2">
            {many ? <span className="ta-caption-1 text-muted-foreground w-5">{i + 1}.</span> : null}
            <Input
              value={number}
              inputMode="tel"
              placeholder="(206) 555-0134"
              aria-label={many ? `Number ${i + 1}` : "Number"}
              onChange={(e) => onChange(numbers.map((n, j) => (j === i ? e.target.value : n)))}
              aria-invalid={Boolean(problems[i] || serverError?.field === `numbers[${i}]`)}
            />
            {many ? (
              <>
                <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move down"
                  disabled={i === numbers.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove number"
                  disabled={numbers.length <= 2}
                  onClick={() => onChange(numbers.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </>
            ) : null}
          </div>
          <FieldMessage>{serverError?.field === `numbers[${i}]` ? serverError.message : problems[i]}</FieldMessage>
        </div>
      ))}
      {many && numbers.length < MAX_WATERFALL_NUMBERS ? (
        <Button variant="outline" size="sm" onClick={() => onChange([...numbers, ""])}>
          <Plus className="size-4" />
          Add a number
        </Button>
      ) : null}
      <p className="ta-caption-1 text-muted-foreground">
        US numbers only, no extensions. It can't be the number your assistant answers on.
        {many ? " Each rings for about 20 seconds before the next." : ""}
      </p>
      {serverError?.field === "numbers" ? <FieldMessage>{serverError.message}</FieldMessage> : null}
    </div>
  );
}

function HoldMusicField({ value, onChange }: { value: HoldMusic; onChange: (music: HoldMusic) => void }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  function toggle() {
    if (!audio.current) return;
    if (playing) {
      audio.current.pause();
      setPlaying(false);
    } else {
      audio.current.src = HOLD_MUSIC_PREVIEW[value];
      void audio.current.play().then(() => setPlaying(true), () => setPlaying(false));
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="ta-label-1">Hold music</Label>
      <div className="flex items-center gap-2">
        <Select
          value={value}
          onValueChange={(v) => {
            audio.current?.pause();
            setPlaying(false);
            if (v) onChange(v as HoldMusic);
          }}
        >
          <SelectTrigger className="w-56" aria-label="Hold music">
            <SelectValue>{HOLD_MUSIC_LABEL[value]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {HOLD_MUSIC.map((music) => (
              <SelectItem key={music} value={music}>
                {HOLD_MUSIC_LABEL[music]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={toggle}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          {playing ? "Stop" : "Preview"}
        </Button>
        <audio ref={audio} onEnded={() => setPlaying(false)} preload="none" />
      </div>
      <p className="ta-caption-1 text-muted-foreground">What the caller hears while your team is being rung.</p>
    </div>
  );
}

function HoursField({ hours, onChange, error }: { hours: Window[]; onChange: (hours: Window[]) => void; error?: string }) {
  const always = hours.length === 0;
  return (
    <div className="space-y-2">
      <Label className="ta-label-1">When it can be used</Label>
      <div className="flex gap-2">
        <Button variant={always ? "default" : "outline"} size="sm" onClick={() => onChange([])}>
          Any time
        </Button>
        <Button
          variant={always ? "outline" : "default"}
          size="sm"
          onClick={() =>
            always &&
            onChange(
              (["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as Day[]).map((day) => ({
                day,
                open: "09:00",
                close: "17:00",
              })),
            )
          }
        >
          Set hours
        </Button>
      </div>
      {!always ? (
        <div className="space-y-2">
          {hours.map((w, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select value={w.day} onValueChange={(v) => v && onChange(hours.map((h, j) => (j === i ? { ...h, day: v as Day } : h)))}>
                <SelectTrigger className="w-36" aria-label="Day">
                  <SelectValue>{w.day}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((day) => (
                    <SelectItem key={day} value={day}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="time"
                className="w-32"
                value={w.open}
                aria-label="From"
                onChange={(e) => onChange(hours.map((h, j) => (j === i ? { ...h, open: e.target.value } : h)))}
              />
              <span className="ta-caption-1 text-muted-foreground">to</span>
              <Input
                type="time"
                className="w-32"
                value={w.close}
                aria-label="Until"
                onChange={(e) => onChange(hours.map((h, j) => (j === i ? { ...h, close: e.target.value } : h)))}
              />
              <Button variant="ghost" size="icon-sm" aria-label="Remove these hours" onClick={() => onChange(hours.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange([...hours, { day: "Saturday", open: "09:00", close: "13:00" }])}
          >
            <Plus className="size-4" />
            Add hours
          </Button>
          <p className="ta-caption-1 text-muted-foreground">
            Outside these hours the assistant doesn't offer this transfer — it takes a message instead.
          </p>
        </div>
      ) : null}
      <FieldMessage>{error}</FieldMessage>
    </div>
  );
}
