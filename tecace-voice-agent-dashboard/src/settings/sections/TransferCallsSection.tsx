import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import {
  EmptyState,
  FieldMessage,
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

export function TransferCallsSection({ binding }: { binding: CallSettingsBinding }) {
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

  return (
    <div>
      {binding.publishBar}
      <SectionIntro>
        When a caller asks for a person or a team, or describes something that needs one, the assistant
        puts them through. It only transfers when a caller asks or when a scenario's conditions match,
        and never outside that scenario's hours — then it takes a message instead.
      </SectionIntro>

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {(["cold", "warm", "waterfall"] as TransferMode[]).map((mode) => (
          <div key={mode} className="rounded-xl border p-4">
            <p className="ta-label-1">
              {MODE_LABEL[mode]}
              {mode === "waterfall" && !binding.waterfallAllowed ? (
                <span className="ta-caption-2 text-muted-foreground ml-2">Not on your plan</span>
              ) : null}
            </p>
            <p className="ta-caption-1 text-muted-foreground mt-1">{MODE_EXPLAINER[mode]}</p>
          </div>
        ))}
      </div>

      <div className="bg-primary/5 mb-6 rounded-xl border p-4">
        <p className="ta-label-1">The number warm transfers come from</p>
        {binding.agentNumber ? (
          <>
            <p className="ta-headline-2 mt-1">{displayPhone(binding.agentNumber)}</p>
            <p className="ta-caption-1 text-muted-foreground mt-1">
              Save this number in your contacts. When the assistant has a call to hand over, it rings you
              from this number first.
            </p>
          </>
        ) : (
          <p className="ta-caption-1 text-muted-foreground mt-1">
            {binding.mode === "demo"
              ? "A demo has no phone line. Once this business goes live, transfers ring from its assistant's number."
              : "You'll see it here once a phone number is assigned to your assistant."}
          </p>
        )}
      </div>

      {rowError ? <FieldMessage>{rowError}</FieldMessage> : null}

      {scenarios.length === 0 ? (
        <EmptyState
          title="No transfers yet"
          action={
            <Button onClick={() => setEditing({ scenario: blankScenario(), index: -1 })}>
              <Plus className="size-4" />
              Add a transfer
            </Button>
          }
        >
          Add a transfer so callers can reach a person or team. Until then, the assistant takes a message
          whenever someone asks for a person.
        </EmptyState>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Rings</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">On</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenarios.map((scenario, index) => (
                <TableRow key={scenario.id}>
                  <TableCell>
                    <span className="ta-label-1">{scenario.name}</span>
                    {scenario.description ? (
                      <span className="ta-caption-1 text-muted-foreground block max-w-xs truncate">
                        {scenario.description}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{MODE_LABEL[scenario.mode]}</TableCell>
                  <TableCell className="ta-caption-1">
                    {scenario.numbers.map(displayPhone).join(" → ")}
                  </TableCell>
                  <TableCell className="ta-caption-1">{hoursSummary(scenario.hours)}</TableCell>
                  <TableCell className="text-right">
                    <Switch
                      checked={scenario.enabled}
                      // A waterfall on an account without the feature can be kept but not switched on.
                      disabled={scenario.mode === "waterfall" && !binding.waterfallAllowed}
                      onCheckedChange={(checked) => void toggle(scenario.id, checked)}
                      aria-label={`Turn the ${scenario.name} transfer ${scenario.enabled ? "off" : "on"}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${scenario.name}`}
                      onClick={() => setEditing({ scenario, index })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${scenario.name}`}
                      onClick={() => void remove(scenario.id)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center gap-3">
            <Button
              variant="outline"
              disabled={full}
              onClick={() => setEditing({ scenario: blankScenario(), index: -1 })}
            >
              <Plus className="size-4" />
              Add a transfer
            </Button>
            <span className="ta-caption-1 text-muted-foreground">
              {scenarios.length} of {MAX_SCENARIOS}
            </span>
          </div>
        </>
      )}

      {editing ? (
        <TransferDialog
          initial={editing.scenario}
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
      ) : null}
    </div>
  );
}

function TransferDialog({
  initial,
  index,
  waterfallAllowed,
  onCancel,
  onSave,
}: {
  initial: TransferScenario;
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
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[20px] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial.name ? `Edit ${initial.name}` : "Add a transfer"}</DialogTitle>
          <DialogDescription>Who callers can be put through to, and when.</DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
