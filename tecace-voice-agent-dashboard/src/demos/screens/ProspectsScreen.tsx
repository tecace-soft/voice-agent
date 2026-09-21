
import { promoFetch } from "@/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/http";
import { isResearchStalled } from "@/lib/analytics";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerTable } from "@/components/admin/CustomerTable";
import { NewCustomerDialog } from "@/components/admin/NewCustomerDialog";
import { PageHeader } from "@/components/admin/shared";
import type { CustomerWithStats } from "@/lib/types";

export function ProspectsScreen() {
  const [customers, setCustomers] = useState<CustomerWithStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await promoFetch("/api/admin/customers", { cache: "no-store" });
      const data = await readJson<{ customers: CustomerWithStats[] }>(response);
      setCustomers(data.customers);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load customers.");
      setCustomers([]);
    }
  }, []);

  useEffect(() => {
    // Fetching on mount: the state lands in an async callback, which is what
    // the rule is meant to catch a synchronous version of.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Poll only while research is still running somewhere.
  useEffect(() => {
    // A stalled record never changes, so polling for it would never stop.
    const researching = customers?.some(
      (customer) => customer.status === "researching" && !isResearchStalled(customer),
    );
    if (researching && !pollRef.current) {
      pollRef.current = setInterval(() => void load(), 5000);
    }
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

  return (
    <>
      <PageHeader
        title="Prospects"
        subtitle="Each customer gets their own demo link."
        actions={<NewCustomerDialog onCreated={load} />}
      />
      {error ? (
        <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">
          {error}
        </div>
      ) : null}
      <Card className="rounded-xl border shadow-none">
        <CardContent className="p-4 md:p-6">
          {customers === null ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-64" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : (
            <CustomerTable customers={customers} onChanged={load} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
