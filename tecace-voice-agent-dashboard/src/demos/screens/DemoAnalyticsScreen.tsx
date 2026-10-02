import { demoFetch } from "@/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PhoneCall } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CallsPerDayChart } from "@/components/charts/CallsPerDayChart";
import { ChartCard, EmptyState, StatCard, StatusBadge, PageHeader } from "@/components/admin/shared";
import { ENTRY_ICON, HEAT_KIND, HEAT_LABEL, sinceLabel } from "@/components/admin/crm-shared";
import { dueFollowUps, formatDuration, type DayBucket, type FeedEntry, type Kpis } from "@/lib/analytics";
import { phaseOf } from "@/lib/phase";
import { readJson } from "@/lib/http";
import type { CustomerWithStats } from "@/lib/types";
import { demoHref } from "@/routes";

// Dashboard-only (see PORTING.md): Demo analytics, after docs/mockups/admin/demo-analytics.html.
// The promo's admin Overview (how the demo links are used) and its CRM page's numbers and feed
// on one screen: four cards across the two, the calls chart, the link-to-deal funnel, the most
// active prospects and the latest activity. The board the CRM page also had is the Prospects
// list's Board view.

type RecentCall = {
  id: string;
  customerId: string;
  customerName: string;
  contactName: string;
  startedAt: string;
  durationSec: number;
  status: "started" | "completed" | "failed" | "abandoned";
  isTest: boolean;
  turns: number;
};

type Analytics = {
  kpis: Kpis;
  window: number;
  callsPerDay: DayBucket[];
  topCustomers: { id: string; name: string; minutes: number; calls: number }[];
  recentCalls: RecentCall[];
  testCallCount: number;
  includeTests: boolean;
};

type Crm = { customers: CustomerWithStats[]; feed: FeedEntry[] };

const PERIODS: Record<string, string> = { "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days" };

type FeedFilter = "all" | FeedEntry["kind"];
const FEED_FILTERS: Record<FeedFilter, string> = { all: "Everything", call: "Calls", view: "Link opens", note: "Notes" };

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "0%";
}

/** From research to live: how many prospects got each far. Counted on every prospect, not the period. */
function funnel(customers: CustomerWithStats[]) {
  const researched = customers.filter((customer) => Boolean(customer.researchedAt));
  const opened = researched.filter((customer) => customer.stats.views > 0);
  const called = researched.filter((customer) => customer.stats.calls > 0);
  const asked = customers.filter((customer) => Boolean(customer.request) || phaseOf(customer) !== "demo");
  const live = customers.filter((customer) => phaseOf(customer) === "production");
  return [
    { label: "Researched", count: researched.length },
    { label: "Opened the link", count: opened.length },
    { label: "Called the demo", count: called.length },
    { label: "Asked for setup", count: asked.length },
    { label: "Live", count: live.length },
  ];
}

export function DemoAnalyticsScreen() {
  const [days, setDays] = useState("30");
  const [includeTests, setIncludeTests] = useState(false);
  const [data, setData] = useState<Analytics | null>(null);
  const [crm, setCrm] = useState<Crm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");

  const load = useCallback(async () => {
    try {
      const response = await demoFetch(`/analytics?days=${days}${includeTests ? "&includeTests=1" : ""}`, { cache: "no-store" });
      setData(await readJson<Analytics>(response));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the analytics.");
    }
  }, [days, includeTests]);

  const loadCrm = useCallback(async () => {
    try {
      const response = await demoFetch("/crm", { cache: "no-store" });
      setCrm(await readJson<Crm>(response));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the prospects.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCrm();
  }, [loadCrm]);

  const customers = crm?.customers ?? [];
  const steps = useMemo(() => funnel(customers), [customers]);
  const open = customers.filter((customer) => (customer.stage ?? "new") !== "won" && (customer.stage ?? "new") !== "lost");
  const asked = customers.filter((customer) => Boolean(customer.request)).length;
  const overdue = dueFollowUps(customers).length;
  const openedBy = customers.filter((customer) => customer.stats.views > 0).length;
  const heatOf = useMemo(() => new Map(customers.map((customer) => [customer.id, customer.heat])), [customers]);
  const feed = useMemo(
    () => (crm?.feed ?? []).filter((entry) => feedFilter === "all" || entry.kind === feedFilter).slice(0, 12),
    [crm, feedFilter],
  );
  const openDealsCaption = [asked ? `${asked} asked for setup` : null, overdue ? `${overdue} follow-up${overdue === 1 ? "" : "s"} overdue` : null]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <PageHeader
        title="Demo analytics"
        subtitle="How prospects use their demo links, and where deals stand."
        actions={
          <div className="flex flex-wrap items-center gap-4">
            <label className="ta-label-1 flex items-center gap-2">
              <Switch checked={includeTests} onCheckedChange={setIncludeTests} aria-label="Include my test calls in the numbers" />
              Include my test calls
            </label>
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
          </div>
        }
      />

      {error ? <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">{error}</div> : null}

      {data === null || crm === null ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard
            title="Links opened"
            value={String(data.kpis.totalViews)}
            caption={`by ${openedBy} of ${customers.length} prospect${customers.length === 1 ? "" : "s"}`}
          />
          <StatCard
            title="Prospects who called"
            value={String(data.kpis.testedCustomers)}
            caption={`${percent(data.kpis.testedCustomers, openedBy)} of those who opened, last ${data.window} days`}
          />
          <StatCard
            title="Demo calls"
            value={String(data.kpis.totalCalls)}
            caption={
              data.testCallCount && !data.includeTests
                ? `${data.kpis.totalMinutes} minutes in total, ${data.testCallCount} of your test calls left out`
                : `${data.kpis.totalMinutes} minutes in total, ${formatDuration(data.kpis.avgCallSec)} a call`
            }
          />
          <StatCard title="Open deals" value={String(open.length)} caption={openDealsCaption || "Not won or lost"} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard
          title="Demo calls per day"
          description={`Last ${data?.window ?? 30} days${data?.includeTests ? ", test calls included" : ", test calls excluded"}`}
          className="lg:col-span-2"
        >
          <div className="h-[280px]">{data ? <CallsPerDayChart data={data.callsPerDay} /> : null}</div>
        </ChartCard>
        <ChartCard title="From link to deal" description="Every prospect, how far each got">
          {crm ? (
            <ol className="flex flex-col gap-3.5" aria-label="From link to deal">
              {steps.map((step) => (
                <li key={step.label} className="flex flex-col gap-1">
                  <span className="ta-label-1 flex justify-between">
                    <span>{step.label}</span>
                    <span className="tabular-nums">{step.count}</span>
                  </span>
                  <span className="bg-muted block h-1.5 overflow-hidden rounded-full" aria-hidden>
                    <span
                      className="bg-primary block h-full rounded-full"
                      style={{ width: `${steps[0]!.count ? Math.round((step.count / steps[0]!.count) * 100) : 0}%` }}
                    />
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <Skeleton className="h-52 w-full" />
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="rounded-xl border shadow-none">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="ta-headline-2">Most active prospects</CardTitle>
            <a href={demoHref("demoProspects")} className="ta-caption-1 text-primary hover:underline">
              All prospects
            </a>
          </CardHeader>
          <CardContent>
            {data && data.topCustomers.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ta-caption-1 text-muted-foreground">Prospect</TableHead>
                    <TableHead className="ta-caption-1 text-muted-foreground text-right">Calls</TableHead>
                    <TableHead className="ta-caption-1 text-muted-foreground text-right">Minutes</TableHead>
                    <TableHead className="ta-caption-1 text-muted-foreground">Heat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topCustomers.map((top) => {
                    const heat = heatOf.get(top.id);
                    return (
                      <TableRow key={top.id} className="hover:bg-accent h-11">
                        <TableCell className="ta-label-1">
                          <a href={demoHref("demoProspect", top.id)} className="hover:underline">
                            {top.name}
                          </a>
                        </TableCell>
                        <TableCell className="ta-label-1 text-right tabular-nums">{top.calls}</TableCell>
                        <TableCell className="ta-label-1 text-right tabular-nums">{top.minutes}</TableCell>
                        <TableCell>
                          {heat ? <StatusBadge kind={HEAT_KIND[heat.level]}>{HEAT_LABEL[heat.level]}</StatusBadge> : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <EmptyState icon={<PhoneCall className="size-6" />} message="No calls yet. Share a demo link to get started." />
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl border shadow-none">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="ta-headline-2">Latest activity</CardTitle>
            <Select value={feedFilter} onValueChange={(value) => setFeedFilter((value as FeedFilter) ?? "all")}>
              <SelectTrigger className="h-8 w-36" aria-label="Which activity to show">
                <SelectValue>{FEED_FILTERS[feedFilter]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FEED_FILTERS) as FeedFilter[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {FEED_FILTERS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {crm === null ? (
              <Skeleton className="h-40 w-full" />
            ) : feed.length === 0 ? (
              <p className="ta-caption-1 text-muted-foreground">Nothing yet. Send a demo link and what they do with it lands here.</p>
            ) : (
              <ul className="space-y-1" aria-label="Latest activity">
                {feed.map((entry, index) => {
                  const Icon = ENTRY_ICON[entry.kind];
                  return (
                    <li key={`${entry.customerId}-${entry.kind}-${entry.at}-${index}`}>
                      <a
                        href={demoHref("demoProspect", entry.customerId)}
                        className="hover:bg-accent flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-left"
                      >
                        <Icon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="ta-label-1 block truncate">{entry.customerName}</span>
                          <span className="ta-caption-2 text-muted-foreground block truncate">{entry.text}</span>
                        </span>
                        <span className="ta-caption-2 text-muted-foreground shrink-0 tabular-nums">{sinceLabel(entry.at)}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
