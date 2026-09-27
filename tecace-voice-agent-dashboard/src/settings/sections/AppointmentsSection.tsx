import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  checkCalendarOpenings,
  connectCalendar,
  disconnectCalendar,
  getCalendar,
  getCalendarTargets,
  setCalendarTarget,
  startCalendarOAuth,
  type CalendarOpening,
  type CalendarOverview,
  type CalendarProvider,
  type CalendarTarget,
} from "../../api/backend";
import { DAYS, defaultAppointments, type AppointmentSettings, type Day, type Window } from "../callSettings";
import { PROVIDER_GROUPS, PROVIDERS_UI, ProviderMark, providerUi, type ProviderUi } from "../calendarProviders";
import { SectionIntro } from "../SettingsShell";
import { FieldMessage, toFieldError, type CallSettingsBinding } from "./shared";

// Booking callers straight into the business's calendar.
//
// Two halves. WHERE bookings land is a connection — Google or Outlook by signing in, iCloud or any
// CalDAV calendar with an account and password, or a booking tool (Cal.com, Calendly, Squarespace
// Scheduling) with its API key — and it is live the moment it is made: there is one calendar. HOW
// the assistant books (length, notice, hours, what to ask) is part of the call settings, saved as a
// draft and published with the rest, so a test call can try new rules before callers get them.
//
// A demo shows the rules and the list of what can be connected, but connects nothing: a demo has no
// calendar, and its rules carry over to the business at onboarding.

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

function minutesLabel(n: number): string {
  if (n === 0) return "None";
  if (n % 60 === 0) return `${n / 60} hour${n === 60 ? "" : "s"}`;
  return n > 60 ? `${Math.floor(n / 60)} h ${n % 60} min` : `${n} minutes`;
}

/** Back from Google or Microsoft: the callback put the result in the query string. Read once, then cleared. */
function takeOAuthResult(): { ok: boolean; message: string } | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("calendar");
    if (!result) return null;
    const message = params.get("calendarMessage") ?? "";
    params.delete("calendar");
    params.delete("calendarMessage");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    return result === "connected"
      ? { ok: true, message: "Calendar connected." }
      : { ok: false, message: message || "The calendar didn't connect." };
  } catch {
    return null;
  }
}

export function AppointmentsSection({ binding, userId }: { binding: CallSettingsBinding; userId?: string }) {
  const demo = binding.mode === "demo";
  const readOnly = Boolean(binding.readOnly);
  const [overview, setOverview] = useState<CalendarOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; message: string } | null>(null);
  const [connecting, setConnecting] = useState<ProviderUi | null>(null);

  const load = useCallback(async () => {
    if (demo) return;
    try {
      setOverview(await getCalendar(userId));
      setLoadError(null);
    } catch (e) {
      setLoadError(toFieldError(e, "Couldn't load the calendar connection.").message);
    }
  }, [demo, userId]);

  useEffect(() => {
    setBanner(takeOAuthResult());
    void load();
  }, [load]);

  const statusOf = (id: string): CalendarProvider["status"] =>
    overview?.providers.find((p) => p.id === id)?.status ?? (providerUi(id)?.fields || id === "google-calendar" || id === "outlook" ? "ready" : "soon");

  async function startConnect(ui: ProviderUi) {
    if (ui.fields) {
      setConnecting(ui);
      return;
    }
    try {
      const { url } = await startCalendarOAuth(ui.id, window.location.href, userId);
      window.location.assign(url);
    } catch (e) {
      setBanner({ ok: false, message: toFieldError(e, "Couldn't start the sign-in.").message });
    }
  }

  const connection = overview?.connection ?? null;

  return (
    <div>
      <SectionIntro>
        Let the assistant book callers straight into your calendar while they're on the phone. It checks
        when you're free, offers a few times, and books the one the caller picks — then it's in your
        calendar like any other appointment. Changing or cancelling an existing appointment still goes
        to your team.
      </SectionIntro>

      {banner ? (
        <div
          role="status"
          className={`ta-caption-1 mb-6 rounded-lg p-3 ${banner.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}
        >
          {banner.message}
        </div>
      ) : null}

      <section className="space-y-3">
        <h3 className="ta-headline-2">Where bookings go</h3>
        {demo ? (
          <div className="bg-muted/50 flex items-start gap-3 rounded-lg p-3">
            <CalendarCheck className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="ta-caption-1 text-muted-foreground">
              Nothing is connected in the demo. Once onboarding starts, connect your calendar here in a few
              clicks — the booking rules below carry over.
            </p>
          </div>
        ) : loadError ? (
          <FieldMessage>{loadError}</FieldMessage>
        ) : !overview ? (
          <p className="ta-body-2 text-muted-foreground">Loading…</p>
        ) : connection ? (
          <ConnectionCard
            overview={overview}
            userId={userId}
            readOnly={readOnly}
            onChanged={load}
            onReconnect={() => {
              const ui = providerUi(connection.provider);
              if (ui) void startConnect(ui);
            }}
          />
        ) : (
          <p className="ta-body-2 text-muted-foreground">
            No calendar connected yet. Pick the one you use below.
          </p>
        )}
      </section>

      <ProviderGallery
        statusOf={statusOf}
        connectedId={connection?.provider ?? null}
        disabled={demo || readOnly || !overview}
        collapsed={Boolean(connection)}
        onConnect={(ui) => void startConnect(ui)}
      />

      <RulesCard binding={binding} connected={Boolean(connection)} bookingTool={connection ? providerUi(connection.provider)?.group === "booking" : false} />

      {overview?.bookings.length ? <RecentBookings bookings={overview.bookings} /> : null}

      {connecting ? (
        <ConnectDialog
          ui={connecting}
          userId={userId}
          onCancel={() => setConnecting(null)}
          onConnected={async () => {
            setConnecting(null);
            setBanner({ ok: true, message: `${connecting.name} connected.` });
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

// ---- The connected calendar -------------------------------------------------------------------

function ConnectionCard({
  overview,
  userId,
  readOnly,
  onChanged,
  onReconnect,
}: {
  overview: CalendarOverview;
  userId?: string;
  readOnly: boolean;
  onChanged: () => Promise<void>;
  onReconnect: () => void;
}) {
  const connection = overview.connection!;
  const [targets, setTargets] = useState<CalendarTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openings, setOpenings] = useState<CalendarOpening[] | null>(null);
  const ui = providerUi(connection.provider);
  const kindWord = ui?.group === "booking" ? "event type" : "calendar";

  useEffect(() => {
    let live = true;
    getCalendarTargets(userId)
      .then((r) => live && setTargets(r.targets))
      .catch((e) => live && setError(toFieldError(e, `Couldn't list the ${kindWord}s.`).message));
    return () => {
      live = false;
    };
  }, [userId, connection.provider, connection.connectedAt, kindWord]);

  async function act(name: string, run: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(toFieldError(e, "That didn't work. Try again.").message);
    } finally {
      setBusy(null);
    }
  }

  const broken = connection.status === "error";

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="bg-muted flex size-10 items-center justify-center rounded-lg">
          <ProviderMark id={connection.provider} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="ta-label-1">{ui?.name ?? connection.providerName}</p>
          <p className="ta-caption-1 text-muted-foreground truncate">{connection.account || "Connected account"}</p>
        </div>
        <span
          className={`ta-caption-2 rounded-full px-2 py-0.5 ${broken ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}
        >
          {broken ? "Needs reconnecting" : "Connected"}
        </span>
      </div>

      {broken ? (
        <div className="bg-destructive/10 ta-caption-1 text-destructive flex flex-wrap items-center gap-3 rounded-lg p-3">
          <span className="flex-1">
            {connection.lastError ?? "The calendar stopped accepting this connection."} Until it's reconnected, the
            assistant takes booking requests as messages.
          </span>
          {readOnly ? null : (
            <Button size="sm" variant="outline" onClick={onReconnect}>
              Reconnect
            </Button>
          )}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label className="ta-label-1">Bookings go into</Label>
        {targets ? (
          <Select
            value={connection.targetId ?? ""}
            disabled={readOnly || busy !== null}
            onValueChange={(v) =>
              v &&
              void act("target", async () => {
                await setCalendarTarget(String(v), userId);
                await onChanged();
              })
            }
          >
            <SelectTrigger className="w-full max-w-md" aria-label={`Choose the ${kindWord}`}>
              <SelectValue>
                {targets.find((t) => t.id === connection.targetId)?.name ?? connection.targetName ?? `Choose a ${kindWord}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                  {t.durationMinutes ? ` · ${t.durationMinutes} min` : ""}
                  {t.primary && ui?.group !== "booking" ? " · main calendar" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="ta-body-2">{connection.targetName ?? "Loading…"}</p>
        )}
        <p className="ta-caption-1 text-muted-foreground">
          {ui?.group === "booking"
            ? "The assistant offers this event type's openings and books through it, so its confirmations go out as usual."
            : "The assistant checks this calendar for free time and adds each booking to it."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            void act("openings", async () => {
              const answer = await checkCalendarOpenings({}, userId);
              setOpenings(answer.openings.length ? answer.openings : (answer.nearest ?? []));
              await onChanged();
            })
          }
        >
          <RefreshCw className="size-4" />
          {busy === "openings" ? "Checking" : "Check next openings"}
        </Button>
        {readOnly ? null : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              window.confirm(
                `Disconnect ${ui?.name ?? "this calendar"}?\n\nThe assistant stops booking and takes booking requests as messages instead. Bookings already made stay in the calendar.`,
              ) &&
              void act("disconnect", async () => {
                await disconnectCalendar(userId);
                await onChanged();
              })
            }
          >
            <Trash2 className="size-4" />
            Disconnect
          </Button>
        )}
      </div>

      {openings ? (
        openings.length ? (
          <div>
            <p className="ta-caption-1 text-muted-foreground mb-2">
              What a caller would be offered right now, with the draft booking rules:
            </p>
            <ul className="flex flex-wrap gap-2">
              {openings.map((o) => (
                <li key={o.start} className="bg-muted/50 ta-caption-1 rounded-full px-3 py-1 tabular-nums">
                  {o.spoken}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="ta-caption-1 text-muted-foreground">
            No openings in the booking window. Check the booking hours and how far ahead callers can book.
          </p>
        )
      ) : null}

      <FieldMessage>{error}</FieldMessage>
    </div>
  );
}

// ---- What can be connected ------------------------------------------------------------------

function StatusTag({
  status,
  connected,
  preview,
}: {
  status: CalendarProvider["status"];
  connected: boolean;
  /** Shown but not connectable from here (a demo): say it's available rather than offer a click. */
  preview: boolean;
}) {
  if (connected) return <span className="ta-caption-2 bg-primary/10 text-primary rounded-full px-2 py-0.5">Connected</span>;
  if (status === "ready") {
    return preview ? (
      <span className="ta-caption-2 bg-primary/10 text-primary rounded-full px-2 py-0.5">Available</span>
    ) : (
      <span className="ta-caption-2 text-primary">Connect</span>
    );
  }
  if (status === "needs_setup") {
    return <span className="ta-caption-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5">Needs setup</span>;
  }
  return <span className="ta-caption-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5">Coming soon</span>;
}

function ProviderGallery({
  statusOf,
  connectedId,
  disabled,
  collapsed,
  onConnect,
}: {
  statusOf: (id: string) => CalendarProvider["status"];
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
                  const usable = status === "ready" && !disabled && !connected;
                  return (
                    <button
                      key={ui.id}
                      type="button"
                      disabled={!usable}
                      onClick={() => onConnect(ui)}
                      title={
                        status === "needs_setup"
                          ? "This server has no sign-in set up for it yet. Your TecAce admin can add it."
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

function ConnectDialog({
  ui,
  userId,
  onCancel,
  onConnected,
}: {
  ui: ProviderUi;
  userId?: string;
  onCancel: () => void;
  onConnected: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = (ui.fields ?? []).find((f) => !values[f.key]?.trim());

  async function submit() {
    if (missing) {
      setError(`Add the ${missing.label.toLowerCase()}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await connectCalendar(ui.id, values, userId);
      await onConnected();
    } catch (e) {
      setError(toFieldError(e, "Couldn't connect. Check the details and try again.").message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="rounded-[20px] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ProviderMark id={ui.id} />
            Connect {ui.name}
          </DialogTitle>
          <DialogDescription>{ui.blurb}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {ui.steps ? (
            <ol className="bg-muted/40 ta-caption-1 list-decimal space-y-1 rounded-lg py-3 pr-3 pl-8">
              {ui.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
              {ui.link ? (
                <li className="list-none">
                  <a href={ui.link.href} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline">
                    {ui.link.label}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                </li>
              ) : null}
            </ol>
          ) : null}
          {(ui.fields ?? []).map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`cal-${field.key}`} className="ta-label-1">
                {field.label}
              </Label>
              <Input
                id={`cal-${field.key}`}
                type={field.type}
                autoComplete={field.type === "password" ? "off" : undefined}
                placeholder={field.placeholder}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
              {field.hint ? <p className="ta-caption-1 text-muted-foreground">{field.hint}</p> : null}
            </div>
          ))}
          {ui.note ? <p className="ta-caption-1 text-muted-foreground">{ui.note}</p> : null}
          <p className="ta-caption-1 text-muted-foreground">
            We check the details with {ui.name} before saving anything, and keep them encrypted.
          </p>
          <FieldMessage>{error}</FieldMessage>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Connecting" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- How the assistant books ----------------------------------------------------------------

function RulesCard({
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

function RecentBookings({ bookings }: { bookings: CalendarOverview["bookings"] }) {
  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <section className="mt-10 space-y-3">
      <h3 className="ta-headline-2">Booked by the assistant</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Caller</TableHead>
            <TableHead>Regarding</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bookings.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="ta-label-1 tabular-nums">
                {when(b.start)}
                {b.test ? (
                  <span className="ta-caption-2 bg-muted text-muted-foreground ml-2 rounded-full px-2 py-0.5">Test call</span>
                ) : null}
              </TableCell>
              <TableCell className="ta-caption-1">
                {b.callerName}
                {b.callerPhone ? <span className="text-muted-foreground block tabular-nums">{b.callerPhone}</span> : null}
              </TableCell>
              <TableCell className="ta-caption-1 max-w-xs truncate">{b.reason || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
