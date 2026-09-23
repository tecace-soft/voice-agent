
import { demoFetch } from "@/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { CrmDrawer } from "@/components/admin/CrmDrawer";
import { PipelineBoard } from "@/components/admin/PipelineBoard";
import { FOLLOW_UP_ICON, STAGE_LABEL } from "@/components/admin/crm-shared";
import { PageHeader, StatCard } from "@/components/admin/shared";
import { dueFollowUps, stageCounts, type FeedEntry } from "@/lib/analytics";
import { readJson } from "@/lib/http";
import type { CustomerStage, CustomerWithStats } from "@/lib/types";

type Payload = { customers: CustomerWithStats[]; feed: FeedEntry[] };

export function PipelineScreen() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await demoFetch("/crm", { cache: "no-store" });
      setData(await readJson<Payload>(response));
      setError(null);
      hasLoadedRef.current = true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not load the pipeline.";
      setError(message);
      // A refresh failure after the board is already showing has nowhere to render `error`
      // (only the pre-data skeleton branch shows it), so make it visible as a toast too —
      // otherwise a failed recovery reload after a failed move leaves the card silently
      // parked in the wrong column.
      if (hasLoadedRef.current) toast.error(message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function move(customer: CustomerWithStats, stage: CustomerStage) {
    // Moved on screen first: a board that waits for the network before the card
    // moves feels broken, and a failure puts it back.
    setData((current) =>
      current
        ? {
            ...current,
            customers: current.customers.map((entry) =>
              entry.id === customer.id ? { ...entry, stage } : entry,
            ),
          }
        : current,
    );
    try {
      const response = await demoFetch(`/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      await readJson<{ customer: unknown }>(response);
      toast.success(`Moved to ${STAGE_LABEL[stage]}.`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not move it.");
      void load();
    }
  }

  if (!data) {
    return (
      <div className="space-y-4">
        {error ? (
          <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">
            {error}
          </div>
        ) : null}
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const { customers, feed } = data;
  const counts = stageCounts(customers);
  const due = dueFollowUps(customers);
  const overdueIds = new Set(due.map((customer) => customer.id));
  const hot = customers.filter((customer) => customer.heat.level === "hot");
  const open = customers.filter(
    (customer) => (customer.stage ?? "new") !== "won" && (customer.stage ?? "new") !== "lost",
  );

  return (
    <>
      <PageHeader
        title="CRM"
        subtitle="Every prospect at once: where the deal stands, and what they have actually done."
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard title="Open deals" value={String(open.length)} caption="Not won or lost" />
        <StatCard
          title="Interested"
          value={String(counts.interested)}
          caption="Said yes to a conversation"
        />
        <StatCard
          title="Running hot"
          value={String(hot.length)}
          caption="On the demo recently, and for a while"
        />
        <StatCard
          title="Follow-ups due"
          value={String(due.length)}
          caption={due.length ? "Past the date you set" : "Nothing overdue"}
        />
      </div>

      {due.length ? (
        <Card className="border-warning/40 bg-warning/5 rounded-xl shadow-none">
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <span className="ta-label-1 text-warning flex items-center gap-1.5">
              <FOLLOW_UP_ICON className="size-4" aria-hidden />
              Due now
            </span>
            {due.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => setOpenId(customer.id)}
                className="ta-caption-1 hover:bg-accent rounded-full border px-2.5 py-1"
              >
                {customer.profile.name || customer.businessName || "Unnamed"}
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/*
        Side by side only where five columns and a feed both fit. Below that the
        board takes the full width and the feed goes under it — at xl the board
        was clipping Won and Lost off the right edge.
      */}
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3">
        <Card className="rounded-xl border shadow-none 2xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="ta-headline-2">Pipeline</CardTitle>
            <p className="ta-caption-1 text-muted-foreground">
              Yours to set — nothing moves a prospect on its own. Hottest first
              inside each column.
            </p>
          </CardHeader>
          <CardContent>
            {customers.length === 0 ? (
              <p className="ta-caption-1 text-muted-foreground py-8 text-center">
                No prospects yet. Add one under Customers.
              </p>
            ) : (
              <PipelineBoard
                customers={customers}
                overdueIds={overdueIds}
                onOpen={(customer) => setOpenId(customer.id)}
                onMove={(customer, stage) => void move(customer, stage)}
              />
            )}
          </CardContent>
        </Card>

        <Card className="rounded-xl border shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="ta-headline-2">Activity</CardTitle>
            <p className="ta-caption-1 text-muted-foreground">
              Across every prospect, newest first. Click one to work the deal.
            </p>
          </CardHeader>
          <CardContent className="max-h-[28rem] overflow-y-auto 2xl:max-h-[32rem]">
            <ActivityFeed entries={feed} onOpen={(id) => setOpenId(id)} />
          </CardContent>
        </Card>
      </div>

      <CrmDrawer customerId={openId} onClose={() => setOpenId(null)} onSaved={load} />
    </>
  );
}
