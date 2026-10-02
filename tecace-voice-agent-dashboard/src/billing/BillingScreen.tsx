import { useCallback, useEffect, useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { toast } from "sonner";
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
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, StatusBadge } from "@/components/admin/shared";
import { pricingHref } from "@/lib/links";
import { BackendError, getBilling, listCallMinutes, setBillingPlan, setPaymentMethod } from "../api/backend";
import type { AuthUser, Billing, PlanId } from "../api/types";
import { accountErrorMessage } from "../auth";
import { CardForm, cardInputFrom, EMPTY_CARD, type CardFormValue } from "./CardForm";
import { PlanPicker } from "./PlanPicker";
import { billingLine, cardExpiry, cardLabel, dollars, longDate, planById } from "./format";

// Billing: the plan, the card on file, and where the first bill stands. The money rule is the
// backend's (`db/billing.ts`); this page only says it. Payments are in TEST MODE until ax-billing
// (Stripe) is behind the card form, and the page says that too.

const STATUS: Record<Billing["status"], { label: string; kind: "neutral" | "active" | "positive" | "caution" }> = {
  none: { label: "No plan yet", kind: "neutral" },
  not_live: { label: "Not charged yet", kind: "active" },
  trial: { label: "Free trial", kind: "positive" },
  active: { label: "Billing monthly", kind: "positive" },
};

export function BillingScreen({ user }: { user: AuthUser }) {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { billing: next } = await getBilling();
      setBilling(next);
      setError(null);
    } catch (caught) {
      setError(accountErrorMessage(caught, "Couldn't load your billing."));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // This month's answered minutes, for the usage line: only meaningful once the line is live.
  useEffect(() => {
    if (user.status !== "production") return;
    let active = true;
    listCallMinutes()
      .then((usage) => active && setMinutes(usage.minutes.reduce((sum, row) => sum + row.currentMinutes, 0)))
      .catch(() => active && setMinutes(null));
    return () => {
      active = false;
    };
  }, [user.status]);

  async function choosePlan(plan: PlanId) {
    if (!billing || billing.plan === plan) return;
    setSavingPlan(true);
    try {
      setBilling((await setBillingPlan(plan)).billing);
      toast.success(`Plan changed to ${planById(plan)?.name ?? plan}.`);
    } catch (caught) {
      toast.error(accountErrorMessage(caught, "Couldn't change the plan."));
    } finally {
      setSavingPlan(false);
    }
  }

  if (user.role === "admin") {
    return (
      <>
        <PageHeader title="Billing" subtitle="Each customer's plan and card are on their own Billing page." />
        <p className="ta-body-2 text-muted-foreground">Open a customer under Accounts to see where their billing stands.</p>
      </>
    );
  }

  const plan = planById(billing?.plan);
  const status = billing ? STATUS[billing.status] : null;

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="Your plan, the card on file, and when the first bill comes."
        actions={status ? <StatusBadge kind={status.kind}>{status.label}</StatusBadge> : null}
      />

      {error ? <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">{error}</div> : null}

      {!billing ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-4">
            <Card className="rounded-xl border shadow-none">
              <CardContent className="flex flex-col gap-4 p-4 md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="ta-headline-2">Your plan</p>
                    <p className="ta-body-2 text-muted-foreground">
                      {plan
                        ? `${plan.name}: ${dollars(plan.monthly)} a month for ${plan.includedMinutes.toLocaleString("en-US")} minutes, then ${plan.overagePerMinute.toFixed(2).replace(/^/, "$")} a minute.`
                        : "Pick the plan that fits how much your phone rings."}
                    </p>
                  </div>
                  <a
                    href={pricingHref(user.businessId ?? undefined)}
                    target="_blank"
                    rel="noreferrer"
                    className="ta-label-1 text-primary inline-flex items-center gap-1 hover:underline"
                  >
                    Pricing and plans <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </div>
                <PlanPicker value={billing.plan} onChange={(next) => void choosePlan(next)} disabled={savingPlan} />
                {user.status === "production" && plan && minutes !== null ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="ta-caption-1 text-muted-foreground flex justify-between">
                      <span>Minutes this month</span>
                      <span className="tabular-nums">
                        {Math.round(minutes)} of {plan.includedMinutes.toLocaleString("en-US")}
                      </span>
                    </div>
                    <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
                      <div
                        className="bg-primary h-full rounded-full"
                        style={{ width: `${Math.min(100, (minutes / plan.includedMinutes) * 100)}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="rounded-xl border shadow-none">
              <CardContent className="flex flex-col gap-3 p-4 md:p-6">
                <p className="ta-headline-2">When you pay</p>
                <p className="ta-body-2">{billingLine(billing)}</p>
                <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                  <dt className="ta-caption-1 text-muted-foreground">Line went live</dt>
                  <dd className="ta-label-1">{billing.liveAt ? longDate(billing.liveAt) : "Not yet"}</dd>
                  <dt className="ta-caption-1 text-muted-foreground">Free trial</dt>
                  <dd className="ta-label-1">
                    {billing.trialEndsAt
                      ? `${billing.trialDays} days, until ${longDate(billing.trialEndsAt)}`
                      : `${billing.trialDays} days from the day your line goes live`}
                  </dd>
                  <dt className="ta-caption-1 text-muted-foreground">First bill</dt>
                  <dd className="ta-label-1">{billing.billingFrom ? longDate(billing.billingFrom) : "After the trial"}</dd>
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-xl border shadow-none self-start">
            <CardContent className="flex flex-col gap-4 p-4 md:p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="ta-headline-2">Payment method</p>
                <StatusBadge kind="caution">Test mode</StatusBadge>
              </div>
              {billing.paymentMethod ? (
                <div className="flex items-center gap-3 rounded-xl border p-3">
                  <span className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-lg">
                    <CreditCard className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="ta-label-1 truncate">{cardLabel(billing.paymentMethod)}</p>
                    <p className="ta-caption-1 text-muted-foreground">
                      Expires {cardExpiry(billing.paymentMethod)}
                      {billing.paymentMethod.name ? ` · ${billing.paymentMethod.name}` : ""}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="ta-body-2 text-muted-foreground">No card on file yet.</p>
              )}
              <Button variant={billing.paymentMethod ? "outline" : "default"} onClick={() => setCardOpen(true)} disabled={!billing.plan}>
                {billing.paymentMethod ? "Change card" : "Add a card"}
              </Button>
              {!billing.plan ? <p className="ta-caption-1 text-muted-foreground">Choose a plan first.</p> : null}
              <p className="ta-caption-1 text-muted-foreground">
                Payments aren&apos;t switched on yet. The card is checked but never charged, and only its last four digits are
                kept.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <CardDialog open={cardOpen} onOpenChange={setCardOpen} onSaved={(next) => setBilling(next)} />
    </>
  );
}

/** Add or replace the card on file (`PUT /billing/payment-method`). */
function CardDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (billing: Billing) => void;
}) {
  const [card, setCard] = useState<CardFormValue>(EMPTY_CARD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);

  async function save() {
    setError(null);
    const checked = cardInputFrom(card);
    if ("field" in checked) return setError(checked);
    setBusy(true);
    try {
      onSaved((await setPaymentMethod(checked.card)).billing);
      toast.success("Card saved.");
      onOpenChange(false);
      setCard(EMPTY_CARD);
    } catch (caught) {
      if (caught instanceof BackendError) setError({ field: caught.field, message: caught.message });
      else setError({ message: "Couldn't save the card." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="ta-headline-1">Card on file</DialogTitle>
          <DialogDescription className="ta-body-2">Used from the first bill on. Nothing is charged before then.</DialogDescription>
        </DialogHeader>
        <CardForm value={card} onChange={setCard} error={error} disabled={busy} idPrefix="billing-card" />
        {error && !error.field ? (
          <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3" role="alert">
            {error.message}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? "Saving" : "Save card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
