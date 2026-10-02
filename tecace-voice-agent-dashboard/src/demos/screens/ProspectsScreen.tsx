import { demoFetch } from "@/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { Columns3, List } from "lucide-react";
import { toast } from "sonner";
import { readJson } from "@/lib/http";
import { isResearchStalled } from "@/lib/analytics";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRemembered } from "@/components/ui/data-table";
import { NewProspectDialog } from "@/components/admin/NewProspectDialog";
import { PipelineBoard } from "@/components/admin/PipelineBoard";
import { ProspectTable } from "@/components/admin/ProspectTable";
import { STAGE_LABEL } from "@/components/admin/crm-shared";
import { PageHeader } from "@/components/admin/shared";
import { dueFollowUps } from "@/lib/analytics";
import type { CustomerStage, CustomerWithStats } from "@/lib/types";
import { demoHref } from "@/routes";

// Dashboard-only (see PORTING.md): Prospects, after docs/mockups/admin/prospects.html. The promo's
// Customers list and its CRM board are two views of the same records, so they are one screen with
// a Table / Board switch; the old `#/demos/pipeline` address lands here on the board.

export type ProspectsView = "table" | "board";

export const PROSPECTS_VIEW_KEY = "prospects.view";

export function ProspectsScreen() {
  const [customers, setCustomers] = useState<CustomerWithStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useRemembered<ProspectsView>(PROSPECTS_VIEW_KEY, "table");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await demoFetch("/customers", { cache: "no-store" });
      const data = await readJson<{ customers: CustomerWithStats[] }>(response);
      setCustomers(data.customers);
      setError(null);
      hasLoadedRef.current = true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not load the prospects.";
      setError(message);
      // A refresh that fails after the list is on screen keeps what is shown and says so as a
      // toast too: otherwise a failed recovery reload after a failed board move leaves the card
      // silently parked in the wrong column.
      if (hasLoadedRef.current) toast.error(message);
      else setCustomers([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Poll only while research is still running somewhere. A stalled record never changes, so
  // polling for it would never stop.
  useEffect(() => {
    const researching = customers?.some((customer) => customer.status === "researching" && !isResearchStalled(customer));
    if (researching && !pollRef.current) pollRef.current = setInterval(() => void load(), 5000);
    if (!researching && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [customers, load]);

  // Moved on screen first: a board that waits for the network before the card moves feels broken,
  // and a failure puts it back.
  async function move(customer: CustomerWithStats, stage: CustomerStage) {
    setCustomers((current) => current?.map((entry) => (entry.id === customer.id ? { ...entry, stage } : entry)) ?? current);
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

  return (
    <>
      <PageHeader
        title="Prospects"
        subtitle="Every business we built a demo for, from first research to live."
        actions={
          <div className="flex items-center gap-3">
            <Tabs value={view} onValueChange={(value) => setView((value as ProspectsView) ?? "table")}>
              <TabsList aria-label="Table or board">
                <TabsTrigger value="table">
                  <List className="size-4" aria-hidden />
                  Table
                </TabsTrigger>
                <TabsTrigger value="board">
                  <Columns3 className="size-4" aria-hidden />
                  Board
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <NewProspectDialog onCreated={load} />
          </div>
        }
      />
      {error ? <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">{error}</div> : null}
      <Card className="rounded-xl border shadow-none">
        <CardContent className="p-4 md:p-6">
          {customers === null ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-64" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : view === "board" ? (
            <div className="space-y-3">
              <p className="ta-caption-1 text-muted-foreground">
                Where each deal stands. Yours to set: nothing moves a prospect on its own. Hottest first inside a column; a card opens the prospect.
              </p>
              {customers.length === 0 ? (
                <p className="ta-caption-1 text-muted-foreground py-8 text-center">No prospects yet. Add the first one above.</p>
              ) : (
                <PipelineBoard
                  customers={customers}
                  overdueIds={new Set(dueFollowUps(customers).map((customer) => customer.id))}
                  onOpen={(customer) => (window.location.hash = demoHref("demoProspect", customer.id))}
                  onMove={(customer, stage) => void move(customer, stage)}
                />
              )}
            </div>
          ) : (
            <ProspectTable customers={customers} onChanged={load} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
