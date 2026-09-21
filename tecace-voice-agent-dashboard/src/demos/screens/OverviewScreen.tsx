
import { promoFetch } from "@/api";
import { useCallback, useEffect, useState } from "react";
import { PhoneCall } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CallsPerDayChart } from "@/components/charts/CallsPerDayChart";
import { TopCustomersChart } from "@/components/charts/TopCustomersChart";
import { ChartCard, EmptyState, StatCard, StatusBadge, PageHeader } from "@/components/admin/shared";
import { formatDuration, type DayBucket, type Kpis } from "@/lib/analytics";
import { readJson } from "@/lib/http";
import { demoHref } from "@/routes";

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

const PERIODS: Record<string, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
};

const STATUS_KIND = {
  completed: "positive",
  started: "active",
  abandoned: "caution",
  failed: "negative",
} as const;

export function OverviewScreen() {
  const [days, setDays] = useState("30");
  const [includeTests, setIncludeTests] = useState(false);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await promoFetch(
        `/api/admin/analytics?days=${days}${includeTests ? "&includeTests=1" : ""}`,
        { cache: "no-store" },
      );
      setData(await readJson<Analytics>(response));
      setError(null);
    } catch (caught) {
      // Without this the page sits on its skeleton forever and says nothing.
      setError(caught instanceof Error ? caught.message : "Could not load analytics.");
    }
  }, [days, includeTests]);

  useEffect(() => {
    // Fetching on mount: the state lands in an async callback, which is what
    // the rule is meant to catch a synchronous version of.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="How target customers are testing their demo."
        actions={
          <div className="flex flex-wrap items-center gap-4">
            <label className="ta-label-1 flex items-center gap-2">
              <Switch
                checked={includeTests}
                onCheckedChange={setIncludeTests}
                aria-label="Include my test calls in the numbers"
              />
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

      {error ? (
        <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">
          {error}
        </div>
      ) : null}

      {data === null ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard
            title="Customers"
            value={String(data.kpis.customers)}
            caption={`${data.kpis.totalViews} link opens`}
          />
          <StatCard
            title="Tested"
            value={String(data.kpis.testedCustomers)}
            caption={`Called at least once, last ${data.window} days`}
          />
          <StatCard
            title="Calls"
            value={String(data.kpis.totalCalls)}
            caption={
              data.testCallCount && !data.includeTests
                ? `${data.testCallCount} of your test calls left out`
                : `Average ${formatDuration(data.kpis.avgCallSec)} per call`
            }
          />
          <StatCard
            title="Minutes"
            value={String(data.kpis.totalMinutes)}
            caption={`Customer voice minutes, last ${data.window} days`}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard
          title="Calls per day"
          description={`Last ${data?.window ?? 30} days${
            data?.includeTests ? ", test calls included" : ", test calls excluded"
          }`}
          className="lg:col-span-2"
        >
          <div className="h-[280px]">
            {data ? <CallsPerDayChart data={data.callsPerDay} /> : null}
          </div>
        </ChartCard>
        <ChartCard title="Top customers" description="Voice minutes">
          <div className="h-[280px]">
            {data && data.topCustomers.length ? (
              <TopCustomersChart data={data.topCustomers} />
            ) : (
              <EmptyState
                icon={<PhoneCall className="size-6" />}
                message="No calls yet. Share a link to get started."
              />
            )}
          </div>
        </ChartCard>
      </div>

      <Card className="rounded-xl border shadow-none">
        <CardHeader>
          <CardTitle className="ta-headline-2">Recent calls</CardTitle>
        </CardHeader>
        <CardContent>
          {data && data.recentCalls.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ta-caption-1 text-muted-foreground">
                    Business
                  </TableHead>
                  <TableHead className="ta-caption-1 text-muted-foreground">
                    Contact
                  </TableHead>
                  <TableHead className="ta-caption-1 text-muted-foreground">
                    Started
                  </TableHead>
                  <TableHead className="ta-caption-1 text-muted-foreground text-right">
                    Duration
                  </TableHead>
                  <TableHead className="ta-caption-1 text-muted-foreground text-right">
                    Turns
                  </TableHead>
                  <TableHead className="ta-caption-1 text-muted-foreground">
                    Status
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentCalls.map((call) => (
                  <TableRow key={call.id} className="hover:bg-accent h-11">
                    <TableCell className="ta-label-1">
                      <a
                        href={demoHref("demoProspect", call.customerId)}
                        className="hover:underline"
                      >
                        {call.customerName}
                      </a>
                      {call.isTest ? (
                        <span className="ta-caption-1 text-muted-foreground ml-2">
                          Test
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="ta-label-1">{call.contactName || "—"}</TableCell>
                    <TableCell className="ta-label-1">
                      {new Date(call.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="ta-label-1 text-right tabular-nums">
                      {formatDuration(call.durationSec)}
                    </TableCell>
                    <TableCell className="ta-label-1 text-right tabular-nums">
                      {call.turns}
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind={STATUS_KIND[call.status]}>
                        {call.status}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={<PhoneCall className="size-6" />}
              message="No calls yet. Send a demo link to a customer to get started."
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}
