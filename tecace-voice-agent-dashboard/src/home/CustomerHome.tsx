import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Circle, MessageSquare, Phone, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CallsPerDayChart } from "@/components/charts/CallsPerDayChart";
import { EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/admin/shared";
import { formatDuration } from "@/lib/analytics";
import { callerLabel, callsInWindow, inboundCallsPerDay, needsReply, outcomeKpis } from "@/lib/receptionistStats";
import { demoHref } from "@/routes";
import {
  getBilling,
  getBusinessProfile,
  getCalendar,
  getCallSettings,
  getReadiness,
  getTestCalls,
  listCallMinutes,
  listInboundCalls,
  type Readiness,
} from "../api/backend";
import type { AuthUser, Billing, BusinessProfileResponse, InboundCall } from "../api/types";
import { accountErrorMessage } from "../auth";
import { billingLine, longDate, planById } from "../billing/format";
import type { SectionId } from "../routing";

// A customer's Home (Dashboard › Overview for an account that is being set up or live). One screen
// per stage, each about the one thing that matters then:
//
//   pre-production  the setup checklist: what they do, what we do, and where each step is done;
//   production      the line's status and what callers wanted: answered, booked, messages, put through.
//
// The demo stage has its own Home (`demos/screens/MyReceptionistScreen.tsx`), and an account with no
// business (the transcribe app's customers) keeps the calls overview.

const PERIODS: Record<string, string> = { "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days" };

const sectionHref = (section: SectionId) => `#/business/${section}`;

export function CustomerHome({ user }: { user: AuthUser }) {
  return user.status === "production" ? <LiveHome user={user} /> : <OnboardingHome user={user} />;
}

// ---- onboarding ---------------------------------------------------------------------------------

type Step = {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  /** Ours to do, not theirs. */
  ours?: boolean;
  action?: { label: string; href: string; primary?: boolean };
};

function OnboardingHome({ user }: { user: AuthUser }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [business, setBusiness] = useState<BusinessProfileResponse | null>(null);
  const [steps, setSteps] = useState<{ callsDecided: boolean; calendar: boolean; testCalls: number; testMinutesLeft: number | null } | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      getReadiness(),
      getBusinessProfile(),
      getCallSettings().catch(() => null),
      getCalendar().catch(() => null),
      getTestCalls().catch(() => null),
      getBilling().catch(() => null),
    ])
      .then(([ready, profile, settings, calendar, tests, bill]) => {
        if (!active) return;
        setReadiness(ready);
        setBusiness(profile);
        const draft = settings?.draft;
        setSteps({
          callsDecided: Boolean(
            draft &&
              (draft.transfer.scenarios.length || draft.messages.scenarios.length || draft.links.scenarios.length || draft.appointments.enabled),
          ),
          calendar: Boolean((calendar as { connection?: unknown } | null)?.connection),
          testCalls: tests?.calls.length ?? 0,
          testMinutesLeft: tests?.usage ? Math.round(tests.usage.remainingSec / 60) : null,
        });
        setBilling(bill?.billing ?? null);
        setError(null);
      })
      .catch((caught) => active && setError(accountErrorMessage(caught, "Couldn't load your setup.")));
    return () => {
      active = false;
    };
  }, [user.id]);

  const agent = business?.profile?.agentName?.trim() || "Alex";
  const name = business?.profile?.profile?.name || business?.profile?.businessName || user.name;
  const item = (id: string) => readiness?.items.find((entry) => entry.id === id);
  const number = business?.number?.phoneE164 ?? item("number_assigned")?.detail ?? null;

  const list: Step[] | null =
    readiness && steps
      ? [
          {
            id: "info",
            title: "Check your business information",
            detail: "Hours, services, parking. Callers hear exactly this.",
            done: Boolean(item("business_info")?.ok),
            action: { label: "Change", href: sectionHref("business-info") },
          },
          {
            id: "calls",
            title: "Decide how calls are handled",
            detail: "Who gets put through, what to take a message about, what to text.",
            done: steps.callsDecided,
            action: { label: steps.callsDecided ? "Change" : "Set up", href: sectionHref("transfers") },
          },
          {
            id: "calendar",
            title: "Connect your calendar (optional)",
            detail: steps.calendar ? "Bookings go straight into it." : `So ${agent} can book appointments for callers.`,
            done: steps.calendar,
            action: { label: steps.calendar ? "Change" : "Connect", href: sectionHref("appointments") },
          },
          {
            id: "test",
            title: "Make a test call",
            detail:
              steps.testCalls > 0
                ? `${steps.testCalls} so far. Try a booking and a transfer.`
                : `Call ${agent} in the app and try a booking and a transfer.${steps.testMinutesLeft !== null ? ` ${steps.testMinutesLeft} test minutes left this month.` : ""}`,
            done: steps.testCalls > 0,
            action: { label: "Test call", href: sectionHref("test"), primary: steps.testCalls === 0 },
          },
          {
            id: "publish",
            title: "Publish",
            detail: "Callers only ever get what you've published.",
            done: Boolean(item("settings_published")?.ok),
            action: { label: item("settings_published")?.ok ? "Review" : "Review and publish", href: sectionHref("transfers") },
          },
          {
            id: "live",
            title: "We switch your number on",
            detail: number
              ? `${agent} answers on ${number}. We tell you how to forward your line, then switch it on.`
              : "We assign a number and tell you how to forward your line. Nothing to do yet.",
            done: false,
            ours: true,
          },
        ]
      : null;
  const done = list?.filter((step) => step.done).length ?? 0;
  const next = list?.find((step) => !step.done && !step.ours);

  return (
    <>
      <PageHeader
        title={`Let's get ${agent} on your line`}
        subtitle={`${name} is being set up. Your phone keeps working as it does today until the last step.`}
      />
      {error ? <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="rounded-xl border shadow-none">
          <CardContent className="p-4 md:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <p className="ta-headline-2">Setup</p>
              {list ? <span className="ta-caption-1 text-muted-foreground">{done} of {list.length} done</span> : null}
              <span className="flex-1" />
              {list ? (
                <div className="bg-muted h-1.5 w-40 overflow-hidden rounded-full" aria-hidden>
                  <div className="bg-primary h-full rounded-full" style={{ width: `${(done / list.length) * 100}%` }} />
                </div>
              ) : null}
            </div>
            {list ? (
              <ol className="mt-3 divide-y" aria-label="Setup steps">
                {list.map((step, index) => (
                  <li key={step.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 py-3.5">
                    <span
                      className={`grid size-6 place-items-center rounded-full border text-[11px] font-semibold ${
                        step.done
                          ? "bg-success border-success text-white"
                          : step === next
                            ? "border-primary bg-primary/10 text-primary"
                            : step.ours
                              ? "border-dashed text-muted-foreground"
                              : "text-muted-foreground"
                      }`}
                      aria-hidden
                    >
                      {step.done ? <Check className="size-3.5" /> : index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className={`ta-label-1 ${step.done ? "text-muted-foreground" : ""}`}>{step.title}</p>
                      <p className="ta-caption-1 text-muted-foreground">{step.detail}</p>
                    </div>
                    {step.ours ? (
                      <StatusBadge kind="neutral">TecAce</StatusBadge>
                    ) : step.action ? (
                      <Button
                        size="sm"
                        variant={step.action.primary && step === next ? "default" : "ghost"}
                        nativeButton={false}
                        render={<a href={step.action.href} />}
                      >
                        {step.action.label}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-3 space-y-3">
                {[0, 1, 2, 3].map((key) => (
                  <Skeleton key={key} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="rounded-xl border shadow-none">
            <CardContent className="flex flex-col gap-3 p-4 md:p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="ta-headline-2">Your phone line</p>
                <StatusBadge kind="neutral">Not switched on</StatusBadge>
              </div>
              <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <dt className="ta-caption-1 text-muted-foreground">Your number</dt>
                <dd className="ta-label-1">{business?.profile?.profile?.phone || "On your business information"}</dd>
                <dt className="ta-caption-1 text-muted-foreground">{agent}&apos;s number</dt>
                <dd className="ta-label-1">{number ?? <span className="text-muted-foreground">We&apos;ll assign one</span>}</dd>
                <dt className="ta-caption-1 text-muted-foreground">Forwarding</dt>
                <dd className="ta-label-1 text-muted-foreground">Not yet</dd>
              </dl>
              <p className="ta-caption-1 text-muted-foreground">Until it&apos;s on, callers reach you exactly as today.</p>
            </CardContent>
          </Card>

          {billing ? (
            <Card className="rounded-xl border shadow-none">
              <CardContent className="flex flex-col gap-2 p-4 md:p-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="ta-headline-2">Billing</p>
                  <a href={demoHref("billing")} className="ta-label-1 text-primary hover:underline">
                    Details
                  </a>
                </div>
                <p className="ta-body-2">{planById(billing.plan)?.name ?? "No plan"} plan</p>
                <p className="ta-caption-1 text-muted-foreground">{billingLine(billing)}</p>
              </CardContent>
            </Card>
          ) : null}

          <Card className="rounded-xl border shadow-none">
            <CardContent className="flex items-center gap-3 p-4">
              <MessageSquare className="text-muted-foreground size-5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="ta-label-1">Stuck?</p>
                <p className="ta-caption-1 text-muted-foreground">Answer a few questions and we fill in the rest.</p>
              </div>
              <Button size="sm" variant="outline" nativeButton={false} render={<a href={sectionHref("guided-setup")} />}>
                Guided setup
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

// ---- live --------------------------------------------------------------------------------------

function LiveHome({ user }: { user: AuthUser }) {
  const [days, setDays] = useState("30");
  const [calls, setCalls] = useState<InboundCall[] | null>(null);
  const [business, setBusiness] = useState<BusinessProfileResponse | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([listInboundCalls(), listCallMinutes().catch(() => null), getBusinessProfile().catch(() => null), getBilling().catch(() => null)])
      .then(([rows, , profile, bill]) => {
        if (!active) return;
        setCalls(rows);
        setBusiness(profile);
        setBilling(bill?.billing ?? null);
        setError(null);
      })
      .catch((caught) => {
        if (!active) return;
        setCalls([]);
        setError(accountErrorMessage(caught, "Couldn't load your calls."));
      });
    return () => {
      active = false;
    };
  }, [user.id]);

  const period = Number(days);
  const inWindow = useMemo(() => (calls ? callsInWindow(calls, period) : []), [calls, period]);
  const kpis = useMemo(() => outcomeKpis(inWindow), [inWindow]);
  const perDay = useMemo(() => (calls ? inboundCallsPerDay(calls, period) : []), [calls, period]);
  const replies = useMemo(() => (calls ? needsReply(calls).slice(0, 5) : []), [calls]);
  const loaded = calls !== null;

  const agent = business?.profile?.agentName?.trim() || "Alex";
  const name = business?.profile?.profile?.name || business?.profile?.businessName || user.name;
  const number = business?.number?.phoneE164 ?? null;
  const since = user.liveAt ? longDate(user.liveAt) : null;

  return (
    <>
      <PageHeader
        title={name}
        subtitle={since ? `${agent} has been answering your calls since ${since}.` : `${agent} is answering your calls.`}
        actions={
          <Select value={days} onValueChange={(value) => setDays(value ?? "30")}>
            <SelectTrigger className="w-40" aria-label="Select the reporting period">
              <SelectValue>{PERIODS[days]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PERIODS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <Card className="rounded-xl border shadow-none">
        <CardContent className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="bg-success size-2 rounded-full" aria-hidden />
          <p className="ta-body-2 min-w-0 flex-1">
            <b className="font-semibold">Line is on.</b>{" "}
            {number ? `Calls forwarded to ${number} are answered by ${agent}.` : `Forwarded calls are answered by ${agent}.`}
            {billing?.status === "trial" && billing.trialEndsAt ? ` Free trial until ${longDate(billing.trialEndsAt)}.` : ""}
          </p>
          <a href={sectionHref("launch")} className="ta-label-1 text-primary inline-flex items-center gap-1 hover:underline">
            Phone line <ArrowRight className="size-3.5" aria-hidden />
          </a>
        </CardContent>
      </Card>

      {error ? <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">{error}</div> : null}

      {!loaded ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard title="Calls answered" value={String(kpis.answered)} caption={`Last ${period} days`} />
          <StatCard title="Booked" value={String(kpis.booked)} caption="Appointments, straight into your calendar" />
          <StatCard
            title="Messages for you"
            value={String(kpis.messages)}
            caption={kpis.messages ? "Callers who left a message or asked for a call back" : "Nothing waiting"}
          />
          <StatCard title="Put through" value={String(kpis.transferred)} caption="Callers who reached a person" />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="rounded-xl border shadow-none xl:col-span-2">
          <CardContent className="p-4 md:p-6">
            <p className="ta-headline-2">Calls per day</p>
            <p className="ta-caption-1 text-muted-foreground">Answered by {agent}, last {period} days</p>
            <div className="mt-4 h-[240px]">{loaded ? <CallsPerDayChart data={perDay} /> : null}</div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border shadow-none">
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center gap-3">
              <p className="ta-headline-2 flex-1">Needs a reply</p>
              {replies.length ? (
                <a href={demoHref("calls")} className="ta-label-1 text-primary hover:underline">
                  All transcripts
                </a>
              ) : null}
            </div>
            <p className="ta-caption-1 text-muted-foreground">Messages and call-back requests, newest first</p>
            {replies.length ? (
              <ul className="mt-3 divide-y">
                {replies.map((call) => (
                  <li key={call.id} className="flex flex-col gap-0.5 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="ta-label-1 min-w-0 flex-1 truncate">{callerLabel(call)}</span>
                      <span className="ta-caption-1 text-muted-foreground shrink-0">{new Date(call.startedAt).toLocaleDateString()}</span>
                    </div>
                    <span className="ta-caption-1 text-muted-foreground line-clamp-2">{call.request || call.summary || "Asked to be called back"}</span>
                    {call.callbackNumber || call.caller ? (
                      <a href={`tel:${call.callbackNumber ?? call.caller}`} className="ta-caption-1 text-primary inline-flex items-center gap-1 hover:underline">
                        <Phone className="size-3" aria-hidden /> {call.callbackNumber ?? call.caller}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : loaded ? (
              <EmptyState icon={<Circle className="size-6" />} message="Nothing waiting. Messages callers leave show up here." />
            ) : (
              <Skeleton className="mt-3 h-32 w-full rounded-lg" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl border shadow-none">
        <CardContent className="p-4 md:p-6">
          <div className="flex items-center gap-3">
            <p className="ta-headline-2 flex-1">Recent calls</p>
            {inWindow.length ? (
              <a href={demoHref("calls")} className="ta-label-1 text-primary hover:underline">
                See all transcripts
              </a>
            ) : null}
          </div>
          {inWindow.length ? (
            <ul className="mt-3 divide-y">
              {inWindow.slice(0, 5).map((call) => (
                <li key={call.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                  <span className="ta-label-1">{callerLabel(call)}</span>
                  <span className="ta-caption-1 text-muted-foreground">{new Date(call.startedAt).toLocaleString()}</span>
                  <span className="ta-caption-1 text-muted-foreground tabular-nums">{formatDuration(call.durationSeconds ?? 0)}</span>
                  <span className="ta-body-2 text-muted-foreground min-w-0 flex-1 truncate">{call.request || call.summary || "—"}</span>
                </li>
              ))}
            </ul>
          ) : loaded ? (
            <EmptyState icon={<PhoneCall className="size-6" />} message={`No calls yet. Calls ${agent} answers show up here.`} />
          ) : (
            <Skeleton className="mt-3 h-32 w-full rounded-lg" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
