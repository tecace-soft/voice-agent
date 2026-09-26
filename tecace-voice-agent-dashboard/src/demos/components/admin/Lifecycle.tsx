import { demoFetch } from "@/api";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/admin/shared";
import { readJson } from "@/lib/http";
import { PHASE_KIND, PHASE_LABELS, phaseOf } from "@/lib/phase";
import type { Customer } from "@/lib/types";
import { demoHref } from "@/routes";

// Dashboard-only (see PORTING.md): where a demo customer is in its life — demo, onboarding,
// production — on the one page that already belongs to them. No promo counterpart.

/** The permanent id and the phase, for the header of the operator's page. */
export function LifecycleBadges({ customer }: { customer: Customer }) {
  const phase = phaseOf(customer);
  return (
    <>
      {customer.customerCode ? (
        <span className="ta-caption-1 text-muted-foreground font-mono" title="Customer ID">
          {customer.customerCode}
        </span>
      ) : null}
      <StatusBadge kind={PHASE_KIND[phase]}>{PHASE_LABELS[phase]}</StatusBadge>
    </>
  );
}

/**
 * Told to the operator once the customer has left the demo: this record is now only the demo, and
 * the receptionist callers hear is the customer's own business information.
 */
export function LifecycleNotice({ customer }: { customer: Customer }) {
  const phase = phaseOf(customer);
  if (phase === "demo") return null;
  return (
    <div className="bg-primary/10 ta-label-1 text-primary flex flex-wrap items-center justify-between gap-2 rounded-lg p-3">
      <span>
        {phase === "onboarding"
          ? "In onboarding. The customer now edits their own business information; changes here stay in the demo."
          : "In production. Changes here stay in the demo."}
      </span>
      {customer.accountEmail ? (
        <a
          className="inline-flex items-center gap-1 hover:underline"
          href={demoHref("business", undefined, { mailbox: customer.accountEmail })}
        >
          Open their business information
          <ArrowRight className="size-4" />
        </a>
      ) : null}
    </div>
  );
}

/**
 * The customer's own way out of the demo. Copies the demo into their business information and moves
 * the account to onboarding (`POST /demo/customers/:id/onboard`), then hands over to `onOnboarded`,
 * which takes them to the Business section.
 */
export function StartOnboarding({
  customer,
  onOnboarded,
}: {
  customer: Customer;
  onOnboarded: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const response = await demoFetch(`/customers/${customer.id}/onboard`, { method: "POST" });
      if (response.status === 422) {
        throw new Error(
          "Your receptionist needs a bit more before it can be set up. We'll be in touch.",
        );
      }
      await readJson(response);
      await onOnboarded();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start onboarding.");
      setBusy(false);
    }
  }

  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4 md:p-6">
        <div className="space-y-1">
          <p className="ta-headline-2">Ready to use this receptionist?</p>
          <p className="ta-body-2 text-muted-foreground">
            Start onboarding to make it yours: add what it should know and adjust how it answers.
          </p>
          {customer.customerCode ? (
            <p className="ta-caption-1 text-muted-foreground">
              Your customer ID: <span className="font-mono">{customer.customerCode}</span>
            </p>
          ) : null}
        </div>
        <Button onClick={() => setOpen(true)}>
          Start onboarding
          <ArrowRight className="size-4" />
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="ta-headline-1">Start onboarding</DialogTitle>
            <DialogDescription className="ta-body-2">
              Your receptionist is copied into your own business information, where you can add
              what it knows and adjust it. After this you manage it there, and this demo page
              closes. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">
              {error}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void start()} disabled={busy}>
              {busy ? "Starting" : "Start onboarding"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
