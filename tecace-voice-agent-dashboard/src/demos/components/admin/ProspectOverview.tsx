import { demoFetch } from "@/api";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Copy, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AddDemoTimeMenu } from "@/components/admin/AddDemoTimeMenu";
import { LifecycleNotice } from "@/components/admin/Lifecycle";
import { StatCard, StatusBadge } from "@/components/admin/shared";
import { STAGE_LABEL, toDateValue } from "@/components/admin/crm-shared";
import { CallsPerDayChart } from "@/components/charts/CallsPerDayChart";
import { callsPerDay, dueFollowUps, formatDuration, gapRollup, isResearchStalled } from "@/lib/analytics";
import { readJson } from "@/lib/http";
import { phaseOf } from "@/lib/phase";
import { customerLink, emailBody, emailSubject } from "@/lib/share";
import { CUSTOMER_STAGES, DEFAULT_DEMO_MINUTES, type CallLog, type CrmNote, type Customer, type CustomerStage, type CustomerStats } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatHash } from "../../../routing";

// Dashboard-only (see PORTING.md): the prospect page's Overview tab, after
// docs/mockups/admin/prospect.html. Where the deal is (a stepper), what to do next (one card that
// changes with the lifecycle), the link's numbers, and, in a right rail, everything about the
// link, the deal and the contact. The cards save as they go: each change PATCHes its own field.

const CHART_DAYS = 14;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

type Patch = (partial: Partial<Customer>) => Promise<void>;

// ---- Stepper -------------------------------------------------------------------------------------

export function ProspectStepper({ customer, stats }: { customer: Customer; stats: CustomerStats }) {
  const phase = phaseOf(customer);
  const steps = [
    { label: "Researched", done: Boolean(customer.researchedAt) },
    { label: "Link shared", done: stats.views > 0 || Boolean(customer.lastContactedAt) || ["contacted", "interested", "won"].includes(customer.stage ?? "") },
    { label: "Tried it", done: stats.calls > 0 },
    { label: "Setup requested", done: Boolean(customer.request) || phase !== "demo" },
    { label: "Onboarding", done: phase !== "demo" },
    { label: "Live", done: phase === "production" },
  ];
  const now = steps.findIndex((step) => !step.done);
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Where this prospect is">
      {steps.map((step, index) => {
        const state = step.done ? "done" : index === now ? "now" : "later";
        return (
          <li key={step.label} className={cn("ta-label-1 flex items-center gap-2", state === "later" && "text-muted-foreground")}>
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full tabular-nums",
                state === "done" && "bg-success/10 text-success",
                state === "now" && "bg-primary text-primary-foreground",
                state === "later" && "bg-muted text-muted-foreground",
              )}
              aria-hidden
            >
              {state === "done" ? <Check className="size-3.5" /> : <span className="ta-caption-1">{index + 1}</span>}
            </span>
            {step.label}
            {state === "now" ? <span className="sr-only">(current step)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

// ---- Next step -----------------------------------------------------------------------------------

export function NextStepCard({
  customer,
  stats,
  researching,
  onResearch,
  onLifecycle,
  onPatch,
  emailTabHref,
}: {
  customer: Customer;
  stats: CustomerStats;
  researching: boolean;
  onResearch: () => void;
  onLifecycle: (next: Customer) => void;
  onPatch: Patch;
  emailTabHref: string;
}) {
  const phase = phaseOf(customer);
  const stalled = isResearchStalled(customer);
  const unresearched = customer.status === "ready" && !customer.researchedAt;
  const due = customer.followUpAt && dueFollowUps([customer]).length > 0;
  const contact = customer.contactName || "the contact";

  let heading: string;
  let body: React.ReactNode;
  let kind: "caution" | "active" | "neutral" | "negative" = "neutral";
  if (phase !== "demo" || customer.request) {
    heading = customer.request
      ? `${customer.request.name || customer.account?.name || contact} asked to set this up`
      : phase === "onboarding"
        ? "Approved. Waiting on go live."
        : "Live";
    kind = customer.request ? "caution" : "active";
    body = <LifecycleNotice customer={customer} onChanged={onLifecycle} />;
  } else if (due) {
    heading = `Follow up with ${contact}, due ${shortDate(customer.followUpAt!)}`;
    kind = "caution";
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="ta-body-2 min-w-0 flex-1">The date you set has passed. Add a note on the deal, then clear the date or set the next one.</p>
        <Button variant="outline" onClick={() => void onPatch({ followUpAt: "", lastContactedAt: new Date().toISOString().slice(0, 10) })}>
          Done, clear the date
        </Button>
      </div>
    );
  } else if (customer.status === "error" || stalled) {
    heading = stalled ? "Research stalled" : "Research failed";
    kind = "negative";
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="ta-body-2 min-w-0 flex-1">
          {stalled
            ? `Running since ${new Date(customer.updatedAt).toLocaleString()}, longer than it takes. The run behind it is gone.`
            : customer.error || "The run did not finish."}{" "}
          Run it again from here.
        </p>
        <Button onClick={onResearch} disabled={researching}>
          <RefreshCw className={cn("size-4", researching && "animate-spin")} />
          {researching ? "Researching" : "Run research again"}
        </Button>
      </div>
    );
  } else if (customer.status === "researching") {
    heading = "Researching the business";
    body = <p className="ta-body-2">Reading the website and public listings, about two minutes. This page updates when it finishes.</p>;
  } else if (unresearched) {
    heading = "Research the business";
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="ta-body-2 min-w-0 flex-1">
          The receptionist knows nothing yet. Research reads the website and public listings, about two minutes, and fills in
          Business information. Or fill it in by hand under Receptionist.
        </p>
        <Button onClick={onResearch} disabled={researching}>
          <RefreshCw className={cn("size-4", researching && "animate-spin")} />
          {researching ? "Researching" : "Run research"}
        </Button>
      </div>
    );
  } else if (stats.views === 0 && customer.active) {
    heading = customer.contactName ? `Send the demo to ${customer.contactName}` : "Send the demo link";
    kind = "active";
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="ta-body-2 min-w-0 flex-1">The receptionist is ready and the link is live. The outreach email is written for you.</p>
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(`${emailSubject(customer.profile.name)}\n\n${emailBody(customer.profile.name, customer.contactName, customerLink(customer.id))}`);
            toast.success("Email copied.");
          }}
        >
          <Copy className="size-4" />
          Copy email
        </Button>
        <Button nativeButton={false} render={<a href={emailTabHref} />}>
          Outreach email
          <ArrowRight className="size-4" />
        </Button>
      </div>
    );
  } else {
    heading = customer.active ? "Waiting on them" : "The demo link is paused";
    body = <LifecycleNotice customer={customer} onChanged={onLifecycle} />;
  }

  return (
    <Card className={cn("rounded-xl border shadow-none", kind === "caution" && "border-warning", kind === "negative" && "border-destructive")} data-next-step>
      <CardContent className="flex flex-col gap-3 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind={kind}>Next step</StatusBadge>
          <h2 className="ta-headline-2">{heading}</h2>
          {customer.request ? <span className="ta-caption-1 text-muted-foreground ml-auto">{new Date(customer.request.requestedAt).toLocaleString()}</span> : null}
        </div>
        {body}
      </CardContent>
    </Card>
  );
}

// ---- Stats, chart, what to fix ----------------------------------------------------------------

export function ProspectStats({ stats, calls, customer }: { stats: CustomerStats; calls: CallLog[]; customer: Customer }) {
  const minutes = customer.demoMinutes ?? DEFAULT_DEMO_MINUTES;
  const tests = calls.filter((call) => call.isTest).length;
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard title="Link opens" value={String(stats.views)} caption={`${stats.visitors} ${stats.visitors === 1 ? "person" : "people"}`} />
      <StatCard title="Calls" value={String(stats.calls)} caption={tests ? `${tests} test ${tests === 1 ? "call" : "calls"} left out` : "Customer calls"} />
      <StatCard title="Minutes" value={String(Math.round((stats.totalSec / 60) * 10) / 10)} caption={`of ${minutes} demo minutes`} />
      <StatCard
        title="Average call"
        value={formatDuration(stats.calls ? stats.totalSec / stats.calls : 0)}
        caption={stats.lastCallAt ? `Last call ${new Date(stats.lastCallAt).toLocaleDateString()}` : "No calls yet"}
      />
    </div>
  );
}

export function CallsChartCard({ calls }: { calls: CallLog[] }) {
  const customerCalls = calls.filter((call) => !call.isTest);
  const reviewed = customerCalls.filter((call) => call.review);
  const happy = reviewed.filter((call) => call.review?.sentiment === "happy").length;
  const unreviewed = customerCalls.length - reviewed.length;
  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="ta-headline-2">Calls per day</p>
            <p className="ta-caption-1 text-muted-foreground">Customer calls, the last {CHART_DAYS} days</p>
          </div>
          {happy ? <StatusBadge kind="positive">Happy {happy}</StatusBadge> : null}
          {unreviewed ? <StatusBadge kind="neutral">Not reviewed {unreviewed}</StatusBadge> : null}
        </div>
        <div className="mt-4 h-48">
          <CallsPerDayChart data={callsPerDay(calls, CHART_DAYS)} />
        </div>
      </CardContent>
    </Card>
  );
}

export function WhatToFixCard({ calls, customerId }: { calls: CallLog[]; customerId: string }) {
  const gaps = gapRollup(calls);
  if (!gaps.length) return null;
  const faqsHref = formatHash({ view: "demoProspect", id: customerId, section: "faqs", mailbox: undefined });
  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="p-4 md:p-6">
        <section>
          <h2 className="ta-headline-2 flex items-center gap-2">
            <Wrench className="text-muted-foreground size-4" aria-hidden />
            What to fix
          </h2>
          <p className="ta-caption-1 text-muted-foreground mt-1">Where the receptionist ran out of answers. Commonest first.</p>
          <ul className="mt-4 flex flex-col gap-2.5">
            {gaps.map((gap) => (
              <li key={gap.text} className="flex items-center gap-3">
                <StatusBadge kind="caution">
                  <span className="tabular-nums">{gap.count}</span> {gap.count === 1 ? "call" : "calls"}
                </StatusBadge>
                <span className="ta-body-2 min-w-0 flex-1">{gap.text}</span>
                <Button size="sm" variant="outline" nativeButton={false} render={<a href={faqsHref} />}>
                  Add an FAQ
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}

// ---- Right rail: the link, the deal, the contact ---------------------------------------------

export function DemoLinkCard({
  customer,
  stats,
  onPatch,
  onAddedTime,
}: {
  customer: Customer;
  stats: CustomerStats;
  onPatch: Patch;
  onAddedTime: (customer: Customer) => void;
}) {
  const link = customerLink(customer.id);
  const minutes = customer.demoMinutes ?? DEFAULT_DEMO_MINUTES;
  const usedSec = stats.totalSec;
  const spent = Math.min(1, minutes > 0 ? usedSec / (minutes * 60) : 1);
  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="flex flex-col gap-3 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <h2 className="ta-headline-2 flex-1">Demo link</h2>
          <label className="ta-caption-1 text-muted-foreground flex items-center gap-2">
            {customer.active ? "Live" : "Paused"}
            <Switch checked={customer.active} onCheckedChange={(checked) => void onPatch({ active: checked })} aria-label="Toggle the demo link" />
          </label>
        </div>
        <div className="flex gap-2">
          <Input readOnly value={link} className="min-w-0 flex-1 font-mono text-xs" aria-label="Customer link" />
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy link"
            title="Copy link"
            onClick={() => {
              void navigator.clipboard.writeText(link);
              toast.success("Link copied.");
            }}
          >
            <Copy className="size-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="ta-caption-1 text-muted-foreground flex justify-between">
            <span>Demo minutes</span>
            <span className="tabular-nums">
              <b className="text-foreground">{formatDuration(usedSec)}</b> of {minutes}:00 used
            </span>
          </div>
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full" aria-hidden>
            <div className={cn("h-full rounded-full", spent >= 1 ? "bg-destructive" : spent >= 0.8 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.round(spent * 100)}%` }} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="ta-caption-1 text-muted-foreground">
              {spent >= 1 ? "Spent: the call button is closed." : `The call button closes at ${minutes}:00.`} Your test calls don&apos;t count.
            </span>
            <AddDemoTimeMenu customerId={customer.id} demoMinutes={customer.demoMinutes} onAdded={onAddedTime} />
          </div>
        </div>
        {!customer.active ? <p className="ta-caption-1 text-muted-foreground">Paused: the link shows an unavailable message.</p> : null}
      </CardContent>
    </Card>
  );
}

export function DealCard({
  customer,
  notes,
  onPatch,
  onNoteAdded,
}: {
  customer: Customer;
  notes: CrmNote[];
  onPatch: Patch;
  onNoteAdded: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const stage = customer.stage ?? "new";
  const recent = [...notes].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);

  async function addNote() {
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    try {
      const response = await demoFetch(`/customers/${customer.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      await readJson<{ note: CrmNote }>(response);
      setDraft("");
      onNoteAdded();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save the note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="flex flex-col gap-3 p-4 md:p-6">
        <h2 className="ta-headline-2">Deal</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="deal-stage" className="ta-caption-1 text-muted-foreground">
              Stage
            </Label>
            <Select value={stage} onValueChange={(value) => void onPatch({ stage: (value as CustomerStage) ?? "new" })}>
              <SelectTrigger id="deal-stage" aria-label="Deal stage" className="w-full">
                <SelectValue>{STAGE_LABEL[stage]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CUSTOMER_STAGES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {STAGE_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deal-followup" className="ta-caption-1 text-muted-foreground">
              Follow up on
            </Label>
            <Input
              id="deal-followup"
              type="date"
              value={toDateValue(customer.followUpAt)}
              onChange={(event) => void onPatch({ followUpAt: event.target.value || "" })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-note" className="ta-caption-1 text-muted-foreground">
            Add a note
          </Label>
          <Textarea
            id="deal-note"
            className="min-h-16"
            placeholder="Called, left a voicemail."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="ta-caption-1 text-muted-foreground">
              {customer.lastContactedAt ? `Last contacted ${shortDate(customer.lastContactedAt)}` : "Not contacted yet"}
            </span>
            <Button size="sm" variant="outline" onClick={() => void addNote()} disabled={saving || !draft.trim()}>
              {saving ? "Saving" : "Add note"}
            </Button>
          </div>
        </div>
        {recent.length ? (
          <ul className="flex flex-col gap-2.5 border-t pt-3" aria-label="Notes">
            {recent.map((note) => (
              <li key={note.id} className="flex flex-col">
                <span className="ta-body-2">{note.text}</span>
                <span className="ta-caption-1 text-muted-foreground">{new Date(note.at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ContactCard({ customer, onPatch }: { customer: Customer; onPatch: Patch }) {
  const [form, setForm] = useState({ contactName: customer.contactName ?? "", contactEmail: customer.contactEmail ?? "", label: customer.label ?? "" });
  useEffect(() => {
    setForm({ contactName: customer.contactName ?? "", contactEmail: customer.contactEmail ?? "", label: customer.label ?? "" });
  }, [customer.contactName, customer.contactEmail, customer.label]);

  function commit(key: keyof typeof form) {
    const stored = customer[key] ?? "";
    if (form[key].trim() === stored) return;
    void onPatch({ [key]: form[key].trim() });
  }

  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="flex flex-col gap-3 p-4 md:p-6">
        <h2 className="ta-headline-2">Contact</h2>
        {(
          [
            ["contactName", "Name", "text"],
            ["contactEmail", "Email", "email"],
            ["label", "Label", "text"],
          ] as const
        ).map(([key, label, type]) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`contact-${key}`} className="ta-caption-1 text-muted-foreground">
              {label}
            </Label>
            <Input
              id={`contact-${key}`}
              type={type}
              value={form[key]}
              placeholder={key === "label" ? "Met at the expo" : ""}
              onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
              onBlur={() => commit(key)}
              onKeyDown={(event) => event.key === "Enter" && commit(key)}
            />
          </div>
        ))}
        <p className="ta-caption-1 text-muted-foreground">Saved when you leave a field.</p>
      </CardContent>
    </Card>
  );
}
