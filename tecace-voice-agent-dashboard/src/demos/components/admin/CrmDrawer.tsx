
import { promoFetch } from "@/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CrmTab } from "@/components/admin/CrmTab";
import { readJson } from "@/lib/http";
import type {
  CallLog,
  CrmNote,
  Customer,
  CustomerStats,
  TrackEvent,
} from "@/lib/types";
import { demoHref } from "@/routes";

type Payload = {
  customer: Customer;
  stats: CustomerStats;
  calls: CallLog[];
  events: TrackEvent[];
  notes: CrmNote[];
};

/**
 * One prospect's CRM, opened from the board or the feed.
 *
 * It loads on open rather than with the page: the board needs every prospect's
 * headline numbers, and nobody needs every prospect's timeline at once. The
 * link out is deliberate — this drawer is for working the deal, and anything
 * about the demo itself belongs on the customer page.
 */
export function CrmDrawer({
  customerId,
  onClose,
  onSaved,
}: {
  customerId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Always the *current* customerId, updated synchronously in the effect below before any
  // fetch's continuation can run — unlike the `customerId` a `load()` closure captures, which
  // is fixed for the whole in-flight request even after the drawer has since been reopened
  // on a different prospect.
  const wantedIdRef = useRef(customerId);

  const load = useCallback(async () => {
    if (!customerId) return;
    const wanted = customerId;
    try {
      const response = await promoFetch(`/api/admin/customers/${customerId}`, {
        cache: "no-store",
      });
      const payload = await readJson<Payload>(response);
      // A slower request for a previously open prospect resolving after a newer one was
      // opened must not overwrite it (nor let `save()` PATCH the wrong prospect afterwards).
      if (wanted !== wantedIdRef.current) return;
      setData(payload);
      setError(null);
    } catch (caught) {
      // Same reason as the success path: a stale prospect's failure must not be reported over
      // the one now on screen, which loaded fine.
      if (wanted !== wantedIdRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load this prospect.");
    }
  }, [customerId]);

  useEffect(() => {
    wantedIdRef.current = customerId;
    // Clearing first stops the previous prospect's timeline showing under the
    // next one's name while the fetch is in flight.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    void load();
  }, [load]);

  async function save(partial: Partial<Customer>) {
    if (!data) return;
    setData({ ...data, customer: { ...data.customer, ...partial } });
    try {
      const response = await promoFetch(`/api/admin/customers/${data.customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      });
      const payload = await readJson<{ customer: Customer }>(response);
      setData((current) =>
        current ? { ...current, customer: payload.customer! } : current,
      );
      onSaved();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save.");
      void load();
    }
  }

  const name = data?.customer.profile.name || data?.customer.businessName || "";

  return (
    <Sheet open={Boolean(customerId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[28rem] overflow-y-auto sm:max-w-[28rem]">
        <SheetHeader>
          <SheetTitle className="ta-headline-1">{name || "Prospect"}</SheetTitle>
          <SheetDescription className="ta-caption-1">
            {data?.customer.contactName || data?.customer.profile.address || ""}
          </SheetDescription>
        </SheetHeader>

        {error ? (
          <div className="bg-destructive/10 ta-label-1 text-destructive m-4 rounded-lg p-3">
            {error}
          </div>
        ) : null}

        <div className="space-y-4 p-4">
          {data ? (
            <>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={demoHref("demoProspect", data.customer.id)} />}
              >
                Open the customer
                <ArrowUpRight className="size-4" aria-hidden />
              </Button>
              <CrmTab
                customer={data.customer}
                notes={data.notes ?? []}
                events={data.events ?? []}
                calls={data.calls ?? []}
                onChange={(partial) => void save(partial)}
                onNoteAdded={() => {
                  void load();
                  onSaved();
                }}
              />
            </>
          ) : error ? null : (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
