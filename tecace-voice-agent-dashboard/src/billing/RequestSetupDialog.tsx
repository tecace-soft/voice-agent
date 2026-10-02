import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { demoFetch } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Customer } from "@/lib/types";
import { TRIAL_DAYS } from "@/lib/pricing";
import { BackendError, getBilling } from "../api/backend";
import type { AuthUser, Billing, PlanId } from "../api/types";
import { CardForm, cardInputFrom, EMPTY_CARD, type CardFormValue } from "./CardForm";
import { PlanPicker } from "./PlanPicker";
import { cardLabel, dollars, planById } from "./format";

// "Request setup", from the demo stage: pick a plan, put a card on file, and the account moves to
// onboarding there and then (`POST /demo/customers/:id/request-onboarding`). Three steps in one
// dialog, so the person always sees where they are and what it costs — and that it costs nothing
// until their line is live.

export interface Moved {
  customer: Customer;
  user: AuthUser;
  billing: Billing;
}

const MAX_NOTE = 1000;

type Step = "plan" | "card" | "confirm";

/** The route answers its errors as `{ error: <sentence>, code, field }`; keep the field. */
async function requestSetup(customerId: string, body: unknown): Promise<Moved> {
  const response = await demoFetch(`/customers/${customerId}/request-onboarding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: { error?: string; field?: string } & Partial<Moved> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* not JSON: the status is the message */
  }
  if (!response.ok) {
    throw new BackendError(parsed.error || `Request failed (${response.status}).`, response.status, parsed.field);
  }
  return parsed as Moved;
}

export function RequestSetupDialog({
  customerId,
  open,
  onOpenChange,
  onMoved,
}: {
  customerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account is in onboarding now: adopt the user and go to their Home. */
  onMoved: (moved: Moved) => void;
}) {
  const [step, setStep] = useState<Step>("plan");
  const [plan, setPlan] = useState<PlanId | null>(null);
  const [existing, setExisting] = useState<Billing | null>(null);
  const [useExistingCard, setUseExistingCard] = useState(false);
  const [card, setCard] = useState<CardFormValue>(EMPTY_CARD);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);

  // What they already chose on the Billing page, if anything.
  useEffect(() => {
    if (!open) return;
    let active = true;
    getBilling()
      .then(({ billing }) => {
        if (!active) return;
        setExisting(billing);
        setPlan((current) => current ?? billing.plan ?? "standard");
        setUseExistingCard(Boolean(billing.paymentMethod));
      })
      .catch(() => active && setPlan((current) => current ?? "standard"));
    return () => {
      active = false;
    };
  }, [open]);

  const chosen = planById(plan);

  function next() {
    setError(null);
    if (step === "plan") {
      if (!plan) return setError({ message: "Pick a plan to continue." });
      setStep("card");
    } else if (step === "card") {
      if (!useExistingCard) {
        const checked = cardInputFrom(card);
        if ("field" in checked) return setError(checked);
      }
      setStep("confirm");
    }
  }

  function back() {
    setError(null);
    setStep(step === "confirm" ? "card" : "plan");
  }

  async function submit() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const payment = useExistingCard ? undefined : cardInputFrom(card);
      if (payment && "field" in payment) {
        setStep("card");
        setError(payment);
        return;
      }
      const moved = await requestSetup(customerId, {
        plan,
        ...(payment ? { payment: payment.card } : {}),
        note: note.trim() || undefined,
      });
      onMoved(moved);
    } catch (caught) {
      if (caught instanceof BackendError) {
        if (caught.field) setStep("card");
        setError({ field: caught.field, message: caught.message });
      } else {
        setError({ message: caught instanceof Error ? caught.message : "Could not start setup." });
      }
    } finally {
      setBusy(false);
    }
  }

  const steps: Step[] = ["plan", "card", "confirm"];

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="ta-headline-1">
            {step === "plan" ? "Choose a plan" : step === "card" ? "Add a card" : "Start setup"}
          </DialogTitle>
          <DialogDescription className="ta-body-2">
            {step === "plan"
              ? "Every plan does the same work; they differ by minutes. You can change it any time."
              : step === "card"
                ? `Nothing is charged until your line is live. Your ${TRIAL_DAYS}-day free trial starts that day.`
                : "Setup starts as soon as you confirm: every setting becomes yours to change and test."}
          </DialogDescription>
        </DialogHeader>

        <ol className="ta-caption-1 text-muted-foreground flex items-center gap-2" aria-label="Steps">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={`grid size-5 place-items-center rounded-full text-[11px] font-semibold ${
                  s === step ? "bg-primary text-primary-foreground" : i < steps.indexOf(step) ? "bg-success/15 text-success" : "bg-muted"
                }`}
              >
                {i < steps.indexOf(step) ? <Check className="size-3" aria-hidden /> : i + 1}
              </span>
              <span className={s === step ? "text-foreground font-semibold" : ""}>
                {s === "plan" ? "Plan" : s === "card" ? "Card" : "Confirm"}
              </span>
              {i < steps.length - 1 ? <span className="bg-border h-px w-6" aria-hidden /> : null}
            </li>
          ))}
        </ol>

        {step === "plan" ? <PlanPicker value={plan} onChange={setPlan} disabled={busy} /> : null}

        {step === "card" ? (
          existing?.paymentMethod && useExistingCard ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
              <div>
                <p className="ta-label-1">{cardLabel(existing.paymentMethod)}</p>
                <p className="ta-caption-1 text-muted-foreground">Already on file.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setUseExistingCard(false)}>
                Use a different card
              </Button>
            </div>
          ) : (
            <CardForm value={card} onChange={setCard} error={error} disabled={busy} idPrefix="setup-card" />
          )
        ) : null}

        {step === "confirm" && chosen ? (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl border p-4">
              <dt className="ta-caption-1 text-muted-foreground">Plan</dt>
              <dd className="ta-label-1">
                {chosen.name}, {dollars(chosen.monthly)}/month, {chosen.includedMinutes.toLocaleString("en-US")} minutes
              </dd>
              <dt className="ta-caption-1 text-muted-foreground">Card</dt>
              <dd className="ta-label-1">
                {useExistingCard && existing?.paymentMethod
                  ? cardLabel(existing.paymentMethod)
                  : `Card ending ${card.number.replace(/\D/g, "").slice(-4)}`}
                <span className="ta-caption-1 text-muted-foreground"> · test mode</span>
              </dd>
              <dt className="ta-caption-1 text-muted-foreground">First bill</dt>
              <dd className="ta-label-1">
                {TRIAL_DAYS} days after your line goes live. Nothing before that.
              </dd>
            </dl>
            <div className="space-y-2">
              <Label htmlFor="setup-note" className="ta-label-1">
                Anything we should know? (optional)
              </Label>
              <Textarea
                id="setup-note"
                value={note}
                maxLength={MAX_NOTE}
                onChange={(event) => setNote(event.target.value)}
                placeholder="For example: we'd like to start next month."
              />
            </div>
          </div>
        ) : null}

        {error && !error.field ? (
          <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3" role="alert">
            {error.message}
          </div>
        ) : null}

        <DialogFooter className="sm:justify-between">
          {step === "plan" ? (
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
          ) : (
            <Button variant="ghost" onClick={back} disabled={busy}>
              <ArrowLeft className="size-4" aria-hidden /> Back
            </Button>
          )}
          {step === "confirm" ? (
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? "Starting" : "Start setup"}
            </Button>
          ) : (
            <Button onClick={next} disabled={busy}>
              Continue <ArrowRight className="size-4" aria-hidden />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
