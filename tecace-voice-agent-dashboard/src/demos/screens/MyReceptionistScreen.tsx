import { demoFetch } from "@/api";
import { useCallback, useEffect, useState } from "react";
import { MessageCircleQuestion, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityTab } from "@/components/admin/ActivityTab";
import { RequestSetup } from "@/components/admin/Lifecycle";
import { EmptyState } from "@/components/admin/shared";
import { callerSaid, formatDuration, gapRollup } from "@/lib/analytics";
import { readJson } from "@/lib/http";
import type { CallLog, Customer, CustomerStats, TrackEvent } from "@/lib/types";
import { demoHref } from "@/routes";
import { customerLink } from "@/lib/share";

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

  const { customer, stats } = data;
  // Our own test calls are ours, not theirs.
  const calls = data.calls.filter((call) => !call.isTest);
  const name = customer.profile.name || customer.businessName || "Your receptionist";
  const agent = customer.agentName || "Your receptionist";


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
        <ActivityTab calls={calls} customerId={id} readOnly />
      </div>
    );
  }

  const gaps = gapRollup(calls).slice(0, 5);
  const recent = calls.slice(0, 3);
  const profile = customer.profile;
  const settings = customer.callSettings;
  const can = [
    settings?.transfer.scenarios.length ? "put callers through" : "",
    settings?.links.scenarios.length ? "text a link" : "",
    settings?.appointments?.enabled ? `book ${settings.appointments.title.toLowerCase() || "an appointment"}` : "",
    "take a message",
  ].filter(Boolean);
  const knows = [
    profile.hours?.length ? "your hours" : "",
    profile.services?.length ? `${profile.services.length} services` : "",
    profile.faqs?.length ? `${profile.faqs.length} questions callers ask` : "",
    profile.policies && Object.values(profile.policies).some(Boolean) ? "parking, payment and policies" : "",
  ].filter(Boolean);
  const minutes = customer.demoMinutes ?? 0;
  const usedMin = Math.round((stats.totalSec / 60) * 10) / 10;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="ta-heading-2">{name}</h1>
        <p className="ta-body-2 text-muted-foreground">{agent}, the receptionist we built for {name}, is ready to try.</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          {/* The one thing to do at this stage: hear it. */}
          <Card className="border-primary/30 bg-primary/5 rounded-xl border shadow-none">
            <CardContent className="flex flex-wrap items-center gap-4 p-4 md:p-6">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="ta-headline-2">Call {agent} and hear it answer for your business</p>
                <p className="ta-body-2 text-muted-foreground">
                  Ask what your callers ask. It knows your business from your website, and can {can.length > 1 ? `${can.slice(0, -1).join(", ")} or ${can[can.length - 1]}` : can[0]}.
                </p>
                <p className="ta-caption-1 text-muted-foreground">
                  {minutes ? `${minutes} demo minutes, ${usedMin} used. ` : ""}Ask us for more any time.
                </p>
              </div>
              <Button size="lg" className="h-11" nativeButton={false} render={<a href={customerLink(id)} target="_blank" rel="noreferrer" />}>
                <PhoneCall className="size-4" aria-hidden /> Call {agent}
              </Button>
            </CardContent>
          </Card>

          <RequestSetup
            customer={customer}
            onChanged={(next) => setData((current) => (current ? { ...current, customer: { ...current.customer, ...next } } : current))}
          />

          <Card className="rounded-xl border shadow-none">
            <CardContent className="p-4 md:p-6">
              <p className="ta-headline-2 flex items-center gap-2">
                <MessageCircleQuestion className="text-muted-foreground size-4" aria-hidden />
                What {agent} couldn't answer
              </p>
              <p className="ta-caption-1 text-muted-foreground">
                Callers asked, {agent} didn't know. You add these during setup.
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

          <Card className="rounded-xl border shadow-none">
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center gap-3">
                <p className="ta-headline-2 flex-1">Your calls</p>
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
                  message={`No calls yet. Call ${agent} from the button above.`}
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="rounded-xl border shadow-none">
            <CardContent className="flex flex-col gap-3 p-4 md:p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="ta-headline-2">{agent}</p>
                <span className="ta-caption-2 bg-muted rounded-full px-2 py-0.5 font-semibold">Preview</span>
              </div>
              <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <dt className="ta-caption-1 text-muted-foreground">Knows</dt>
                <dd className="ta-body-2">{knows.length ? knows.join(", ") : "What your website says"}</dd>
                <dt className="ta-caption-1 text-muted-foreground">Can</dt>
                <dd className="ta-body-2">{can.join(", ")}</dd>
                <dt className="ta-caption-1 text-muted-foreground">Calls</dt>
                <dd className="ta-body-2 tabular-nums">
                  {stats.calls} so far{stats.calls ? `, ${formatDuration(stats.calls ? stats.totalSec / stats.calls : 0)} on average` : ""}
                </dd>
              </dl>
              <Button variant="outline" size="sm" nativeButton={false} render={<a href={demoHref("demoProspect", id)} />}>
                See everything it knows
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-xl border shadow-none">
            <CardContent className="flex flex-col gap-3 p-4 md:p-6">
              <p className="ta-headline-2">How setup works</p>
              <ol className="flex flex-col gap-2.5">
                {[
                  ["Request setup", "Pick a plan and add a card. Nothing is charged before your line is live."],
                  ["Check and adjust", `Hours, prices, who gets transfers. Test ${agent} with calls in the app.`],
                  ["Forward your line", "Missed calls, or every call. We switch it on, and your free trial starts."],
                ].map(([title, body], index) => (
                  <li key={title} className="flex items-start gap-3">
                    <span className="bg-primary/10 text-primary grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold">
                      {index + 1}
                    </span>
                    <div>
                      <p className="ta-label-1">{title}</p>
                      <p className="ta-caption-1 text-muted-foreground">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
