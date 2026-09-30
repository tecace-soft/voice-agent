import { useEffect, useMemo, useState } from "react";
import { PhoneCall } from "lucide-react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CallsPerDayChart } from "@/components/charts/CallsPerDayChart";
import { ChartCard, EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/admin/shared";
import { formatDuration } from "@/lib/analytics";
import {
  callerLabel,
  callsInWindow,
  inboundCallsPerDay,
  outcomeBadge,
  receptionistKpis,
  talkTime,
} from "@/lib/receptionistStats";
import { demoHref } from "@/routes";
import { listAccounts, listCallMinutes, listInboundCalls } from "../../api/backend";
import type { AuthUser, CallMinutes, InboundCall } from "../../api/types";
import { accountErrorMessage } from "../../auth";

// Dashboard-only (see PORTING.md): Dashboard › Overview. The Demo Overview's page (OverviewScreen),
// for the receptionist a business actually runs: its answered calls, minutes, calls per day and
// recent calls. The cross-prospect cards (Customers, Top customers) have no one-business version and
// are left out.
//
//   a customer                 -> their own business (the backend pins them there)
//   an admin, one business     -> that business, picked here and held in `?customer=`
//   an admin, every business   -> every business's calls together, with a Business column

const PERIODS: Record<string, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
};

const EVERY_BUSINESS = "__all__";
const RECENT = 10;

export function ReceptionistOverviewScreen({
  isAdmin,
  customer,
  onCustomer,
}: {
  isAdmin: boolean;
  /** The business an admin is viewing (its account email); undefined = every business. */
  customer?: string;
  onCustomer: (next: string | undefined) => void;
}) {
  const [days, setDays] = useState("30");
  const [accounts, setAccounts] = useState<AuthUser[] | null>(isAdmin ? null : []);
  const [calls, setCalls] = useState<InboundCall[] | null>(null);
  const [minutes, setMinutes] = useState<CallMinutes[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    listAccounts()
      .then((all) => active && setAccounts(all.filter((u) => u.role !== "admin")))
      .catch(() => active && setAccounts([]));
    return () => {
      active = false;
    };
  }, [isAdmin]);

  // Until the accounts arrive an admin's `?customer=` can't be turned into an id, and loading every
  // business first would flash the wrong numbers before snapping to the right ones.
  const viewing = isAdmin && accounts ? (accounts.find((a) => a.email === customer) ?? null) : null;
  const ready = !isAdmin || accounts !== null;
  const userId = viewing?.id;

  useEffect(() => {
    if (!ready) return;
    let active = true;
    // Cleared first, so switching business never shows the previous one's numbers under the new name.
    setCalls(null);
    setMinutes(null);
    Promise.all([listInboundCalls(userId), listCallMinutes(userId)])
      .then(([rows, usage]) => {
        if (!active) return;
        setCalls(rows);
        setMinutes(usage.minutes);
        setError(null);
      })
      .catch((e) => active && setError(accountErrorMessage(e, "Couldn't load your calls.")));
    return () => {
      active = false;
    };
  }, [ready, userId]);

  const period = Number(days);
  const inWindow = useMemo(() => (calls ? callsInWindow(calls, period) : []), [calls, period]);
  const kpis = useMemo(() => receptionistKpis(inWindow), [inWindow]);
  const perDay = useMemo(() => (calls ? inboundCallsPerDay(calls, period) : []), [calls, period]);
  const talk = minutes ? talkTime(minutes) : null;
  const recent = (calls ?? []).slice(0, RECENT);
  const everyBusiness = isAdmin && !viewing;
  const names = useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.name])), [accounts]);
  const loaded = calls !== null && minutes !== null;

  const subtitle = viewing
    ? `How ${viewing.name}'s receptionist is answering calls.`
    : everyBusiness
      ? "How every business's receptionist is answering calls."
      : "How your receptionist is answering calls.";

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-4">
            {isAdmin && accounts && accounts.length > 0 ? (
              <Select
                value={viewing?.email ?? EVERY_BUSINESS}
                onValueChange={(value) => onCustomer(!value || value === EVERY_BUSINESS ? undefined : value)}
              >
                <SelectTrigger className="w-56" aria-label="Which business to show">
                  <SelectValue>{viewing?.name ?? "Every business"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EVERY_BUSINESS}>Every business</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.email}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
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
        <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">{error}</div>
      ) : null}

      {!loaded ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard
            title="Calls"
            value={String(kpis.calls)}
            caption={`Average ${formatDuration(kpis.avgCallSec)} per call`}
          />
          <StatCard
            title="Minutes"
            value={String(kpis.minutes)}
            caption={`Answered-call minutes, last ${period} days`}
          />
          <StatCard
            title="Callbacks requested"
            value={String(kpis.callbacks)}
            caption={`Callers who asked to be called back, last ${period} days`}
          />
          <StatCard
            title="Talk time this month"
            value={String(talk?.current ?? 0)}
            caption={`${talk?.previous ?? 0} minutes last month, every agent call`}
          />
        </div>
      )}

      <ChartCard title="Calls per day" description={`Last ${period} days`}>
        <div className="h-[280px]">{loaded ? <CallsPerDayChart data={perDay} /> : null}</div>
      </ChartCard>

      <Card className="rounded-xl border shadow-none">
        <CardHeader>
          <CardTitle className="ta-headline-2">Recent calls</CardTitle>
          {calls && calls.length ? (
            <CardAction>
              <a
                href={demoHref("calls", undefined, viewing ? { customer: viewing.email } : undefined)}
                className="ta-label-1 text-primary hover:underline"
              >
                See all calls
              </a>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {recent.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  {everyBusiness ? (
                    <TableHead className="ta-caption-1 text-muted-foreground">Business</TableHead>
                  ) : null}
                  <TableHead className="ta-caption-1 text-muted-foreground">Caller</TableHead>
                  <TableHead className="ta-caption-1 text-muted-foreground">Request</TableHead>
                  <TableHead className="ta-caption-1 text-muted-foreground">Started</TableHead>
                  <TableHead className="ta-caption-1 text-muted-foreground text-right">Duration</TableHead>
                  <TableHead className="ta-caption-1 text-muted-foreground text-right">Turns</TableHead>
                  <TableHead className="ta-caption-1 text-muted-foreground">Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((call) => {
                  const outcome = outcomeBadge(call);
                  return (
                    <TableRow key={call.id} className="hover:bg-accent h-11">
                      {everyBusiness ? (
                        <TableCell className="ta-label-1">
                          {call.userId ? (names.get(call.userId) ?? "—") : "Unassigned"}
                        </TableCell>
                      ) : null}
                      <TableCell className="ta-label-1">{callerLabel(call)}</TableCell>
                      <TableCell className="ta-label-1 text-muted-foreground max-w-[320px] truncate">
                        {call.request || call.summary || "—"}
                      </TableCell>
                      <TableCell className="ta-label-1">{new Date(call.startedAt).toLocaleString()}</TableCell>
                      <TableCell className="ta-label-1 text-right tabular-nums">
                        {formatDuration(call.durationSeconds ?? 0)}
                      </TableCell>
                      <TableCell className="ta-label-1 text-right tabular-nums">{call.turns.length}</TableCell>
                      <TableCell>
                        <StatusBadge kind={outcome.kind}>{outcome.label}</StatusBadge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : loaded ? (
            <EmptyState
              icon={<PhoneCall className="size-6" />}
              message="No calls yet. Calls your receptionist answers show up here."
            />
          ) : (
            <Skeleton className="h-40 w-full rounded-xl" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
