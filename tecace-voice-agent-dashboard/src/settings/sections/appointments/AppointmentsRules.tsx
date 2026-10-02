import { useEffect, useState } from "react";
import { CalendarCheck, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DAYS, defaultAppointments, type AppointmentSettings, type Day, type Window } from "../../callSettings";
import { PROVIDER_GROUPS, PROVIDERS_UI, ProviderMark, type ProviderUi } from "../../calendarProviders";
import { SectionIntro } from "../../SettingsShell";
import { FieldMessage, toFieldError, type CallSettingsBinding } from "../shared";

// The half of the Appointments screen that needs no server: the booking rules, the hours bookings may
// start in, and the gallery of what can be connected. The business's screen
// (`AppointmentsSection.tsx`) adds the live connection around them; a demo — in the operator's
// console, the demo customer's own view, and the public demo page — shows just these, and connects
// nothing. Kept apart so the public page's bundle never reaches the dashboard's API client.

/** `CalendarProviderStatus` in `api/backend.ts`, repeated so this file needs nothing from it. */
export type ProviderStatus = "ready" | "needs_setup" | "soon";

/**
 * Whether a business can connect this one right now: only when the server says `ready`. Offering a
 * tile the server would refuse is a dead end, so anything else is shown but not clickable —
 * `needs_setup` (built, but this server has no Google / Microsoft sign-in app) as "Not available",
 * `soon` (no connection built yet) as "Coming soon". Any account stage gets the same answer.
 */
export function offered(status: ProviderStatus): boolean {
  return status === "ready";
}

const LENGTHS = [15, 20, 30, 45, 60, 90, 120];
const GAPS = [0, 5, 10, 15, 30];
const NOTICE: { value: number; label: string }[] = [
  { value: 0, label: "No minimum" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 240, label: "4 hours" },
  { value: 1440, label: "1 day" },
  { value: 2880, label: "2 days" },
];
const HORIZON = [7, 14, 30, 60, 90];

export function minutesLabel(n: number): string {
  if (n === 0) return "None";
  if (n % 60 === 0) return `${n / 60} hour${n === 60 ? "" : "s"}`;
  return n > 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n} minutes`;
}

// ---- What can be connected ------------------------------------------------------------------

function StatusTag({
  status,
  connected,
  preview,
}: {
  status: ProviderStatus;
  connected: boolean;
  /** Shown but not connectable from here (a demo): say it's available rather than offer a click. */
  preview: boolean;
}) {
  if (connected) return <span className="ta-caption-2 bg-primary/10 text-primary rounded-full px-2 py-0.5">Connected</span>;
  if (offered(status)) {
    return preview ? (
      <span className="ta-caption-2 bg-primary/10 text-primary rounded-full px-2 py-0.5">Available</span>
    ) : (
      <span className="ta-caption-2 text-primary">Connect</span>
    );
  }
  if (status === "needs_setup") {
    return <span className="ta-caption-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5">Not available</span>;
  }
  return <span className="ta-caption-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5">Coming soon</span>;
}

export function ProviderGallery({
  statusOf,
  connectedId,
  disabled,
  collapsed,
  onConnect,
}: {
  statusOf: (id: string) => ProviderStatus;
  connectedId: string | null;
  disabled: boolean;
  collapsed: boolean;
  onConnect: (ui: ProviderUi) => void;
}) {
  const [open, setOpen] = useState(!collapsed);
  useEffect(() => setOpen(!collapsed), [collapsed]);

  return (
    <section className="mt-8 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="ta-headline-2">{collapsed ? "Use a different calendar" : "Connect your calendar"}</h3>
        {collapsed ? (
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Show all"}
          </Button>
        ) : null}
      </div>
      {open
        ? PROVIDER_GROUPS.map((group) => (
            <div key={group.id} className="space-y-2">
              <div>
                <p className="ta-label-1">{group.title}</p>
                <p className="ta-caption-2 text-muted-foreground">{group.blurb}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {PROVIDERS_UI.filter((p) => p.group === group.id).map((ui) => {
                  const status = statusOf(ui.id);
                  const connected = ui.id === connectedId;
                  const usable = offered(status) && !disabled && !connected;
                  return (
                    <button
                      key={ui.id}
                      type="button"
                      disabled={!usable}
                      onClick={() => onConnect(ui)}
                      title={
                        status === "needs_setup"
                          ? "Not available on this dashboard yet. Until it is, the assistant takes these bookings as messages."
                          : status === "soon"
                            ? "Not connectable yet. Until it is, the assistant takes these bookings as messages."
                            : undefined
                      }
                      className="hover:border-ring/60 hover:bg-accent disabled:hover:bg-transparent disabled:hover:border-border ta-label-1 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-default"
                    >
                      <span className={status === "soon" ? "opacity-60" : undefined}>
                        <ProviderMark id={ui.id} />
                      </span>
                      <span className={`flex-1 truncate ${status === "soon" ? "text-muted-foreground" : ""}`}>{ui.name}</span>
                      <StatusTag status={status} connected={connected} preview={disabled} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        : null}
      {open ? (
        <div className="text-muted-foreground ta-caption-1 flex items-center gap-2.5 rounded-lg border border-dashed px-3 py-2.5">
          <Plus className="size-4 shrink-0" aria-hidden />
          Running something else? Tell your TecAce contact — if it has a booking API, we can connect it.
        </div>
      ) : null}
    </section>
  );
}

// ---- How the assistant books ----------------------------------------------------------------

export function RulesCard({
  binding,
  connected,
  bookingTool,
}: {
  binding: CallSettingsBinding;
  connected: boolean;
  bookingTool: boolean;
}) {
  const stored = binding.value.appointments ?? defaultAppointments();
  const readOnly = Boolean(binding.readOnly);
  const [draft, setDraft] = useState<AppointmentSettings>(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(stored), [JSON.stringify(stored)]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);
  const patch = (next: Partial<AppointmentSettings>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, ...next }));
  };

  async function save(next = draft) {
    setSaving(true);
    setError(null);
    try {
      await binding.update((current) => ({ ...current, appointments: next }));
      setSaved(true);
    } catch (e) {
      setError(toFieldError(e, "Couldn't save the booking rules.").message);
    } finally {
      setSaving(false);
    }
  }

  const numberSelect = (
    label: string,
    value: number,
    options: { value: number; label: string }[],
    onChange: (n: number) => void,
    hint?: string,
  ) => (
    <div className="space-y-1.5">
      <Label className="ta-label-1">{label}</Label>
      <Select value={String(value)} disabled={readOnly} onValueChange={(v) => v && onChange(Number(v))}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue>{options.find((o) => o.value === value)?.label ?? minutesLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={String(o.value)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint ? <p className="ta-caption-1 text-muted-foreground">{hint}</p> : null}
    </div>
  );

  return (
    <section className="mt-10 space-y-5 rounded-xl border p-4">
      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="ta-headline-2 block">Book appointments on calls</span>
          <span className="ta-caption-1 text-muted-foreground block max-w-xl">
            {connected || binding.mode === "demo"
              ? "When it's on, callers who want to book are offered open times and booked in. When it's off, the assistant takes their preferred time as a message."
              : "Connect a calendar above for this to take effect. Until then the assistant takes the caller's preferred time as a message."}
          </span>
        </span>
        <Switch
          checked={draft.enabled}
          disabled={readOnly || saving}
          aria-label="Book appointments on calls"
          onCheckedChange={(enabled) => {
            const next = { ...draft, enabled };
            setDraft(next);
            void save(next);
          }}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="appt-title" className="ta-label-1">
            What callers book
          </Label>
          <Input
            id="appt-title"
            value={draft.title}
            disabled={readOnly}
            maxLength={80}
            placeholder="Consultation"
            onChange={(e) => patch({ title: e.target.value })}
          />
          <p className="ta-caption-1 text-muted-foreground">Said to the caller and used as the calendar title.</p>
        </div>
        {bookingTool
          ? null
          : numberSelect(
              "Length",
              draft.durationMinutes,
              LENGTHS.map((n) => ({ value: n, label: minutesLabel(n) })),
              (n) => patch({ durationMinutes: n }),
            )}
        {bookingTool
          ? null
          : numberSelect(
              "Gap around other events",
              draft.bufferMinutes,
              GAPS.map((n) => ({ value: n, label: minutesLabel(n) })),
              (n) => patch({ bufferMinutes: n }),
              "Kept free before and after everything already in the calendar.",
            )}
        {numberSelect("Minimum notice", draft.minNoticeMinutes, NOTICE, (n) => patch({ minNoticeMinutes: n }), "The soonest a caller can book from now.")}
        {numberSelect(
          "How far ahead",
          draft.horizonDays,
          HORIZON.map((n) => ({ value: n, label: `${n} days` })),
          (n) => patch({ horizonDays: n }),
        )}
      </div>

      {bookingTool ? (
        <p className="ta-caption-1 text-muted-foreground">
          Length, hours and gaps come from the event type in your booking tool.
        </p>
      ) : (
        <BookingHours hours={draft.hours} readOnly={readOnly} onChange={(hours) => patch({ hours })} />
      )}

      <div className="space-y-1.5">
        <Label htmlFor="appt-instructions" className="ta-label-1">
          Anything the assistant should know
        </Label>
        <Textarea
          id="appt-instructions"
          value={draft.instructions}
          disabled={readOnly}
          maxLength={500}
          placeholder="Ask whether it's their first visit. Only book adults; for children, take a message."
          onChange={(e) => patch({ instructions: e.target.value })}
        />
        <p className="ta-caption-1 text-muted-foreground">{draft.instructions.length} of 500</p>
      </div>

      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? "Saving" : "Save booking rules"}
          </Button>
          <span className="ta-caption-1 text-muted-foreground">
            {saved && !dirty
              ? binding.mode === "business"
                ? "Saved to the draft. Test it with a call, then publish."
                : "Saved."
              : binding.mode === "business"
                ? "Saved as a draft: test calls use it, callers get it once you publish."
                : ""}
          </span>
        </div>
      )}
      <FieldMessage>{error}</FieldMessage>
    </section>
  );
}

function BookingHours({
  hours,
  readOnly,
  onChange,
}: {
  hours: Window[];
  readOnly: boolean;
  onChange: (hours: Window[]) => void;
}) {
  const same = hours.length === 0;
  return (
    <div className="space-y-2">
      <Label className="ta-label-1">When appointments can start</Label>
      <div className="flex flex-wrap gap-2">
        <Button variant={same ? "default" : "outline"} size="sm" disabled={readOnly} onClick={() => onChange([])}>
          Business hours
        </Button>
        <Button
          variant={same ? "outline" : "default"}
          size="sm"
          disabled={readOnly}
          onClick={() =>
            same &&
            onChange(
              (["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as Day[]).map((day) => ({ day, open: "09:00", close: "17:00" })),
            )
          }
        >
          Set booking hours
        </Button>
      </div>
      {same ? (
        <p className="ta-caption-1 text-muted-foreground">
          Uses the hours in Business information. Add them there if they're missing, or nothing can be booked.
        </p>
      ) : (
        <div className="space-y-2">
          {hours.map((w, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select
                value={w.day}
                disabled={readOnly}
                onValueChange={(v) => v && onChange(hours.map((h, j) => (j === i ? { ...h, day: v as Day } : h)))}
              >
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
                disabled={readOnly}
                aria-label="From"
                onChange={(e) => onChange(hours.map((h, j) => (j === i ? { ...h, open: e.target.value } : h)))}
              />
              <span className="ta-caption-1 text-muted-foreground">to</span>
              <Input
                type="time"
                className="w-32"
                value={w.close}
                disabled={readOnly}
                aria-label="Until"
                onChange={(e) => onChange(hours.map((h, j) => (j === i ? { ...h, close: e.target.value } : h)))}
              />
              {readOnly ? null : (
                <Button variant="ghost" size="icon-sm" aria-label="Remove these hours" onClick={() => onChange(hours.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
          {readOnly ? null : (
            <Button variant="outline" size="sm" onClick={() => onChange([...hours, { day: "Saturday", open: "09:00", close: "13:00" }])}>
              <Plus className="size-4" />
              Add hours
            </Button>
          )}
        </div>
      )}
    </div>
  );
}


// ---- A demo's screen -------------------------------------------------------------------------

/** Every provider as connectable-once-onboarding-starts: a demo shows the list and connects nothing. */
const demoStatus = (ui: ProviderUi): ProviderStatus =>
  ui.fields || ui.id === "google-calendar" || ui.id === "outlook" ? "ready" : "soon";

export function DemoAppointmentsSection({ binding, notice }: { binding: CallSettingsBinding; notice?: string }) {
  return (
    <div>
      <SectionIntro>
        Let the assistant book callers straight into your calendar while they're on the phone. It checks
        when you're free, offers a few times, and books the one the caller picks — then it's in your
        calendar like any other appointment. Changing or cancelling an existing appointment still goes
        to your team.
      </SectionIntro>
      <section className="space-y-3">
        <h3 className="ta-headline-2">Where bookings go</h3>
        <div className="bg-muted/50 flex items-start gap-3 rounded-lg p-3">
          <CalendarCheck className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="ta-caption-1 text-muted-foreground">
            {notice ??
              "A demo has no calendar. Once onboarding starts, the calendar is connected from the business's own page — Business information › Appointments, signed in as that account (an admin: pick the account first). The booking rules below carry over."}
          </p>
        </div>
      </section>
      <ProviderGallery
        statusOf={(id) => {
          const ui = PROVIDERS_UI.find((p) => p.id === id);
          return ui ? demoStatus(ui) : "soon";
        }}
        connectedId={null}
        disabled
        collapsed={false}
        onConnect={() => {}}
      />
      <RulesCard binding={binding} connected={false} bookingTool={false} />
    </div>
  );
}
