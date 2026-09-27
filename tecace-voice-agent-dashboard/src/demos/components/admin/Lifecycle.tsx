import { demoFetch } from "@/api";
import { useEffect, useState, type ReactNode } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/admin/shared";
import { readJson } from "@/lib/http";
import { PHASE_KIND, PHASE_LABELS, phaseOf } from "@/lib/phase";
import type { Customer } from "@/lib/types";
import { demoHref } from "@/routes";

// Dashboard-only (see PORTING.md): where a demo customer is in its life — demo, onboarding,
// production — on the one page that already belongs to them. No promo counterpart.
//
// The hand-off out of the demo is two-sided (phase-gates spec): the customer asks to be set up
// (`RequestSetup`), and an admin approves or declines on the operator's page (`LifecycleNotice`).

/** Max length of either note; the backend's `MAX_ONBOARDING_NOTE`. */
const MAX_NOTE = 1000;

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** The same customer, kept in step with what the page passes in and with this card's own writes. */
function useCustomer(customer: Customer, onChanged?: (next: Customer) => void) {
  const [current, setCurrent] = useState(customer);
  useEffect(() => setCurrent(customer), [customer]);
  const update = (next: Customer) => {
    setCurrent(next);
    onChanged?.(next);
  };
  return [current, update] as const;
}

async function post(path: string, body?: unknown): Promise<Customer> {
  const response = await demoFetch(path, {
    method: "POST",
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  if (response.status === 422) {
    throw new Error("This demo needs a bit more before it can be copied into business information.");
  }
  return (await readJson<{ customer: Customer }>(response)).customer;
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">{error}</div>
  ) : null;
}

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
      {phase === "demo" && customer.request ? (
        <StatusBadge kind="caution">Setup requested</StatusBadge>
      ) : null}
    </>
  );
}

/**
 * The operator's side of the lifecycle. While the customer is in the demo: their open request,
 * with Approve (copy into business information, onboarding) and Decline (a note they see). Once
 * they have left the demo: this record is only the demo now, and the receptionist callers hear is
 * the customer's own business information.
 */
export function LifecycleNotice({
  customer,
  onChanged,
}: {
  customer: Customer;
  onChanged?: (next: Customer) => void;
}) {
  const [current, update] = useCustomer(customer, onChanged);
  const [dialog, setDialog] = useState<"approve" | "decline" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phase = phaseOf(current);

  async function answer(which: "approve" | "decline") {
    setBusy(true);
    setError(null);
    try {
      const next =
        which === "approve"
          ? await post(`/customers/${current.id}/onboard`)
          : await post(`/customers/${current.id}/decline-request`, { note: note.trim() || undefined });
      update(next);
      setDialog(null);
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "demo") {
    if (current.request) {
      return (
        <div className="bg-warning/10 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3">
          <div className="space-y-1">
            <p className="ta-label-1 text-warning">
              Setup requested on {shortDate(current.request.requestedAt)}
            </p>
            {current.request.note ? (
              <p className="ta-body-2 text-foreground whitespace-pre-line">{current.request.note}</p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDialog("decline")}>
              Decline
            </Button>
            <Button onClick={() => setDialog("approve")}>
              Approve
              <ArrowRight className="size-4" />
            </Button>
          </div>

          <Dialog open={dialog !== null} onOpenChange={(open) => !busy && !open && setDialog(null)}>
            <DialogContent className="max-w-md rounded-2xl">
              <DialogHeader>
                <DialogTitle className="ta-headline-1">
                  {dialog === "approve" ? "Approve setup" : "Decline for now"}
                </DialogTitle>
                <DialogDescription className="ta-body-2">
                  {dialog === "approve"
                    ? "The demo is copied into the customer's own business information and they move to onboarding, where they can edit it and test calls. Their phone line stays off until you go live. This can't be undone."
                    : "The request is closed and the customer sees your note on their page. They can ask again."}
                </DialogDescription>
              </DialogHeader>
              {dialog === "decline" ? (
                <div className="space-y-2">
                  <Label htmlFor="decline-note" className="ta-label-1">
                    Note to the customer (optional)
                  </Label>
                  <Textarea
                    id="decline-note"
                    value={note}
                    maxLength={MAX_NOTE}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="For example: we need your opening hours first."
                  />
                </div>
              ) : null}
              <ErrorLine error={error} />
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  variant={dialog === "decline" ? "outline" : "default"}
                  onClick={() => dialog && void answer(dialog)}
                  disabled={busy}
                >
                  {busy ? "Saving" : dialog === "approve" ? "Approve" : "Decline"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      );
    }
    if (current.declined) {
      return (
        <div className="bg-secondary ta-label-1 text-muted-foreground rounded-lg p-3">
          Declined on {shortDate(current.declined.declinedAt)}
          {current.declined.note ? `: ${current.declined.note}` : "."}
        </div>
      );
    }
    return null;
  }

  return (
    <div className="bg-primary/10 ta-label-1 text-primary flex flex-wrap items-center justify-between gap-2 rounded-lg p-3">
      <span>
        {phase === "onboarding"
          ? "In onboarding. The customer now edits their own business information; changes here stay in the demo. Go live is on the Accounts page."
          : `In production${current.liveAt ? ` since ${shortDate(current.liveAt)}` : ""}. Changes here stay in the demo.`}
      </span>
      {current.accountEmail ? (
        <a
          className="inline-flex items-center gap-1 hover:underline"
          href={demoHref("business", undefined, { mailbox: current.accountEmail })}
        >
          Open their business information
          <ArrowRight className="size-4" />
        </a>
      ) : null}
    </div>
  );
}

/**
 * The customer's way out of the demo: they ask, we set it up. Sends
 * `POST /demo/customers/:id/request-onboarding` with an optional note; an admin approves on the
 * operator's page, after which this account moves to onboarding and their dashboard becomes the
 * Business section. While the request is open, or after a decline, the card says so.
 */
export function RequestSetup({
  customer,
  onChanged,
  variant = "card",
  extra,
}: {
  customer: Customer;
  onChanged?: (next: Customer) => void;
  /** "strip": one line across the top of the settings studio (B2), instead of a card. */
  variant?: "card" | "strip";
  /** The strip's second line: how the demo has been used. */
  extra?: ReactNode;
}) {
  const [current, update] = useCustomer(customer, onChanged);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      update(
        await post(`/customers/${current.id}/request-onboarding`, {
          note: note.trim() || undefined,
        }),
      );
      setOpen(false);
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send your request.");
    } finally {
      setBusy(false);
    }
  }

  const requested = current.request;
  const dialog = (
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="ta-headline-1">Request setup</DialogTitle>
            <DialogDescription className="ta-body-2">
              We&apos;ll review your request and get back to you. Once it&apos;s approved, your
              receptionist is copied into your own business information, where you can edit it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="request-note" className="ta-label-1">
              Anything we should know? (optional)
            </Label>
            <Textarea
              id="request-note"
              value={note}
              maxLength={MAX_NOTE}
              onChange={(event) => setNote(event.target.value)}
              placeholder="For example: we'd like to start next month."
            />
          </div>
          <ErrorLine error={error} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={busy}>
              {busy ? "Sending" : "Send request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );

  if (variant === "strip") {
    return (
      <div className="bg-primary/5 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 md:px-6">
        <div className="min-w-0 flex-1">
          <p className="ta-caption-1">
            {requested ? (
              <>
                <b className="font-semibold">Setup requested</b> on {shortDate(requested.requestedAt)}. We&apos;ll be in
                touch to set it up for your business. Until then, this is a preview: everything your receptionist
                knows and does, read only.
              </>
            ) : (
              <>
                <b className="font-semibold">A preview of your receptionist, read only.</b> Everything it knows and
                does. Want it for your business? Request setup, and you can then change any of it and test it before
                it takes real calls.
              </>
            )}
            {!requested && current.declined ? (
              <span className="text-foreground"> Not yet{current.declined.note ? `: ${current.declined.note}` : "."}</span>
            ) : null}
          </p>
          <p className="ta-caption-1 text-muted-foreground mt-0.5">
            {current.customerCode ? (
              <>
                Your customer ID: <span className="font-mono">{current.customerCode}</span>
                {extra ? " · " : null}
              </>
            ) : null}
            {extra}
          </p>
        </div>
        {requested ? (
          <StatusBadge kind="caution">Waiting for us</StatusBadge>
        ) : (
          <Button size="sm" onClick={() => setOpen(true)}>
            {current.declined ? "Ask again" : "Request setup"}
            <ArrowRight className="size-4" />
          </Button>
        )}
        {dialog}
      </div>
    );
  }

  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4 md:p-6">
        <div className="space-y-1">
          {requested ? (
            <>
              <p className="ta-headline-2">Setup requested</p>
              <p className="ta-body-2 text-muted-foreground">
                You asked on {shortDate(requested.requestedAt)}. We&apos;ll be in touch to set it up
                for your business.
              </p>
            </>
          ) : (
            <>
              <p className="ta-headline-2">Want this receptionist for your business?</p>
              <p className="ta-body-2 text-muted-foreground">
                This demo is view only. Ask us to set it up, and you can then change what it knows
                and how it answers, and test it before it takes real calls.
              </p>
              {current.declined ? (
                <p className="ta-label-1 text-foreground">
                  Not yet{current.declined.note ? `: ${current.declined.note}` : "."}
                </p>
              ) : null}
            </>
          )}
          {current.customerCode ? (
            <p className="ta-caption-1 text-muted-foreground">
              Your customer ID: <span className="font-mono">{current.customerCode}</span>
            </p>
          ) : null}
        </div>
        {requested ? (
          <StatusBadge kind="caution">Waiting for us</StatusBadge>
        ) : (
          <Button onClick={() => setOpen(true)}>
            {current.declined ? "Ask again" : "Request setup"}
            <ArrowRight className="size-4" />
          </Button>
        )}
      </CardContent>

      {dialog}
    </Card>
  );
}
