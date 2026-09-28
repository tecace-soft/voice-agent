import { demoFetch } from "@/api";
import { useCallback, useEffect, useState } from "react";
import { MessageCircleQuestion, PhoneCall } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityTab } from "@/components/admin/ActivityTab";
import { RequestSetup } from "@/components/admin/Lifecycle";
import { EmptyState, StatCard } from "@/components/admin/shared";
import { CallsPerDayChart } from "@/components/charts/CallsPerDayChart";
import {
  callerSaid,
  callsPerDay,
  distinctVisitors,
  formatDuration,
  gapRollup,
} from "@/lib/analytics";
import { readJson } from "@/lib/http";
import type { CallLog, Customer, CustomerStats, TrackEvent } from "@/lib/types";
import { demoHref } from "@/routes";

// Dashboard-only (see PORTING.md): the demo customer's own Overview and Call activity, beside the
// read-only settings ("My receptionist › Settings"). The same record the operator's customer page
// reads — `GET /demo/customers/:id` already answers it to its owner — shown the owner's way: no
// operator controls, and our own test calls left out.

type Payload = {
  customer: Customer;
  stats: CustomerStats;
  calls: CallLog[];
  events: TrackEvent[];
};

const CHART_DAYS = 14;

export function MyReceptionistScreen({ id, page }: { id: string; page: "overview" | "calls" }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await readJson<Payload>(await demoFetch(`/customers/${id}`, { cache: "no-store" })));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load your receptionist.");
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) {
    return <p className="ta-body-2 text-destructive p-4 md:p-6">{error}</p>;
  }
  if (!data) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  const { customer, stats, events } = data;
  // Our own test calls are ours, not theirs.
  const calls = data.calls.filter((call) => !call.isTest);
  const name = customer.profile.name || customer.businessName || "Your receptionist";
  const agent = customer.agentName || "Your receptionist";

  const setup = (
    <div className="overflow-hidden rounded-xl border">
      <RequestSetup
        customer={customer}
        onChanged={(next) => setData((current) => (current ? { ...current, customer: { ...current.customer, ...next } } : current))}
        variant="strip"
      />
    </div>
  );

  if (page === "calls") {
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <header>
          <h1 className="ta-heading-2">Call activity</h1>
          <p className="ta-body-2 text-muted-foreground">
            Every call to {agent} on your demo, newest first: what the caller wanted, how it went, and the full
            transcript.
          </p>
        </header>
        <Card className="rounded-xl border shadow-none">
          <CardContent className="p-4 md:p-6">
            <ActivityTab calls={calls} customerId={id} readOnly />
          </CardContent>
        </Card>
      </div>
    );
  }

  const days = callsPerDay(calls, CHART_DAYS);
  const gaps = gapRollup(calls).slice(0, 5);
  const recent = calls.slice(0, 3);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="ta-heading-2">Overview</h1>
        <p className="ta-body-2 text-muted-foreground">How {name}'s demo receptionist has been used so far.</p>
      </header>

      {setup}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        <StatCard title="Link opens" value={String(stats.views)} />
        <StatCard title="People" value={String(distinctVisitors(events, calls))} caption="Different visitors" />
        <StatCard title="Calls" value={String(stats.calls)} />
        <StatCard title="Minutes" value={String(Math.round((stats.totalSec / 60) * 10) / 10)} />
        <StatCard
          title="Average call"
          value={formatDuration(stats.calls ? stats.totalSec / stats.calls : 0)}
          caption={stats.lastCallAt ? `Last call ${new Date(stats.lastCallAt).toLocaleDateString()}` : "No calls yet"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="rounded-xl border shadow-none xl:col-span-2">
          <CardContent className="p-4 md:p-6">
            <p className="ta-headline-2">Calls per day</p>
            <p className="ta-caption-1 text-muted-foreground">The last {CHART_DAYS} days</p>
            <div className="mt-4 h-56">
              <CallsPerDayChart data={days} />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border shadow-none">
          <CardContent className="p-4 md:p-6">
            <p className="ta-headline-2 flex items-center gap-2">
              <MessageCircleQuestion className="text-muted-foreground size-4" aria-hidden />
              What it couldn't answer
            </p>
            <p className="ta-caption-1 text-muted-foreground">
              Callers asked, {agent} didn't know. Add these once your receptionist is set up.
            </p>
            {gaps.length ? (
              <ul className="mt-3 space-y-1.5">
                {gaps.map((gap) => (
                  <li key={gap.text} className="flex items-baseline gap-3">
                    <span className="ta-numeric text-warning w-6 shrink-0 text-right">{gap.count}</span>
                    <span className="ta-body-2">{gap.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ta-body-2 text-muted-foreground mt-3">Nothing yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl border shadow-none">
        <CardContent className="p-4 md:p-6">
          <div className="flex items-center gap-3">
            <p className="ta-headline-2 flex-1">Recent calls</p>
            {calls.length ? (
              <a href={demoHref("myCalls")} className="ta-label-1 text-primary hover:underline">
                See all calls
              </a>
            ) : null}
          </div>
          {recent.length ? (
            <ul className="mt-3 divide-y">
              {recent.map((call) => (
                <li key={call.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                  <span className="ta-label-1">{new Date(call.startedAt).toLocaleString()}</span>
                  <span className="ta-caption-1 text-muted-foreground tabular-nums">
                    {formatDuration(call.durationSec)}
                  </span>
                  <span className="ta-body-2 text-muted-foreground min-w-0 flex-1 truncate">
                    {call.review?.tested || callerSaid(call) || "No words exchanged"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<PhoneCall className="size-6" />}
              message="No calls yet. Open your demo link and call your receptionist."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
