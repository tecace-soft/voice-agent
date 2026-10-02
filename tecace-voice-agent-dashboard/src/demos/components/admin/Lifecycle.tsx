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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/admin/shared";
import { readJson } from "@/lib/http";
import { PHASE_KIND, PHASE_LABELS, phaseOf } from "@/lib/phase";
import type { Customer } from "@/lib/types";
import { demoHref } from "@/routes";
import { toast } from "sonner";
import { useAuth } from "../../../auth";
import { RequestSetupDialog, type Moved } from "../../../billing/RequestSetupDialog";

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
      {phase === "demo" && customer.account?.source === "start" ? <StatusBadge kind="neutral">Signed up</StatusBadge> : null}
    </>
  );
}

/** What `POST /demo/customers/:id/onboard` answers (transcribe-backend business/onboard.ts). */
type Approval = {
  customer: Customer;
  invite: { token: string; link: string | null; expiresAt: string } | null;
  emailed: boolean;
};

async function approve(id: string, body: { requestId?: string; email?: string; name?: string }): Promise<Approval> {
  const response = await demoFetch(`/customers/${id}/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 422) {
    throw new Error("This demo needs a bit more before it can be copied into business information.");
  }
  return readJson<Approval>(response);
}

/** Who is asking, or who the account is: name, email, and how far to trust the email. */
function Requester({ customer }: { customer: Customer }) {
  const request = customer.request;
  const account = customer.account;
  const name = request?.name ?? account?.name;
  const email = request?.email ?? account?.email;
  if (!email) return null;
  const verified = request?.email ? false : Boolean(account?.verified);
  const source = request?.email ? "claim" : account?.source;
  const contact = customer.contactEmail?.trim().toLowerCase();
  const mismatch = Boolean(contact) && contact !== email.toLowerCase();
  return (
    <div className="space-y-1">
      <p className="ta-body-2 text-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold">{name}</span>
        <span className="text-muted-foreground">{email}</span>
        {request?.phone ? <span className="text-muted-foreground">· {request.phone}</span> : null}
        <StatusBadge kind={verified ? "positive" : "neutral"}>{verified ? "Email verified" : "Email not verified"}</StatusBadge>
        {source === "start" ? <StatusBadge kind="neutral">Signed up at /start</StatusBadge> : null}
        {source === "claim" ? <StatusBadge kind="neutral">From the demo page</StatusBadge> : null}
        {request?.openCount && request.openCount > 1 ? (
          <StatusBadge kind="caution">{request.openCount} requests</StatusBadge>
        ) : null}
      </p>
      {mismatch ? (
        <p className="ta-caption-1 text-warning">
          Not the contact on this demo ({customer.contactEmail}). Check they're from the business before approving.
        </p>
      ) : null}
    </div>
  );
}

/** After an approval: whether the customer was told, and their sign-in link when they need one. */
function Approved({ result, onClose }: { result: Approval; onClose: () => void }) {
  const link = result.invite ? (result.invite.link ?? `${window.location.origin}/#/welcome?token=${result.invite.token}`) : null;
  const [copied, setCopied] = useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="ta-headline-1">Approved</DialogTitle>
        <DialogDescription className="ta-body-2">
          {link
            ? result.emailed
              ? "They're in onboarding. We emailed them a link to choose a password; you can also send it yourself."
              : "They're in onboarding. Send them this link to choose a password and sign in (it works once, for 7 days)."
            : result.emailed
              ? "They're in onboarding, and we emailed them that they can edit now."
              : "They're in onboarding. They can sign in with the email and password they chose."}
        </DialogDescription>
      </DialogHeader>
      {link ? (
        <div className="flex gap-2">
          <input readOnly value={link} className="border-input bg-muted/40 ta-caption-1 min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono" onFocus={(e) => e.currentTarget.select()} />
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : null}
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}

/**
 * The operator's side of the lifecycle. While the customer is in the demo: their open request —
 * who asked and how far to trust it — with Approve (copy into business information, onboarding) and
 * Decline (a note they see); or, with nobody asking, Start onboarding for a customer set up by hand.
 * Once they have left the demo: this record is only the demo now, and the receptionist callers hear
 * is the customer's own business information.
 */
export function LifecycleNotice({
  customer,
  onChanged,
}: {
  customer: Customer;
  onChanged?: (next: Customer) => void;
}) {
  const [current, update] = useCustomer(customer, onChanged);
  const [dialog, setDialog] = useState<"approve" | "decline" | "start" | null>(null);
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<Approval | null>(null);
  const phase = phaseOf(current);

  const askedBy = current.request?.email ?? current.account?.email;
  const contact = current.contactEmail?.trim().toLowerCase();
  const needsCheck = Boolean(askedBy && contact && contact !== askedBy.toLowerCase());

  async function answer(which: "approve" | "decline" | "start") {
    setBusy(true);
    setError(null);
    try {
      if (which === "decline") {
        update(
          await post(`/customers/${current.id}/decline-request`, {
            note: note.trim() || undefined,
            requestId: current.request?.requestId,
          }),
        );
        setDialog(null);
      } else {
        const result = await approve(
          current.id,
          which === "start" && !current.account
            ? { email: email.trim(), name: name.trim() || undefined }
            : { requestId: current.request?.requestId },
        );
        setApproved(result);
        update(result.customer);
      }
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    if (busy) return;
    setDialog(null);
    setApproved(null);
    setChecked(false);
    setError(null);
  };

  const dialogs = (
    <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md rounded-2xl">
        {approved ? (
          <Approved result={approved} onClose={close} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="ta-headline-1">
                {dialog === "decline" ? "Decline for now" : dialog === "start" ? "Start onboarding" : "Approve setup"}
              </DialogTitle>
              <DialogDescription className="ta-body-2">
                {dialog === "decline"
                  ? "The request is closed and the customer sees your note. They can ask again."
                  : "The demo is copied into the customer's own business information and they move to onboarding, where they can edit it and test calls. Their phone line stays off until you go live. This can't be undone."}
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
            {dialog === "start" && !current.account ? (
              <div className="space-y-3">
                <p className="ta-caption-1 text-muted-foreground">
                  Nobody has signed up for this one. Enter the customer's email: we make their account and give you a link
                  for them to choose a password.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="start-email" className="ta-label-1">
                    Customer's email
                  </Label>
                  <Input id="start-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={current.contactEmail ?? ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="start-name" className="ta-label-1">
                    Their name (optional)
                  </Label>
                  <Input id="start-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={current.contactName ?? ""} />
                </div>
              </div>
            ) : null}
            {dialog !== "decline" && needsCheck ? (
              <label className="ta-caption-1 flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                <span>
                  {askedBy} isn't this demo's contact ({current.contactEmail}). I've checked they're from the business.
                </span>
              </label>
            ) : null}
            <ErrorLine error={error} />
            <DialogFooter>
              <Button variant="ghost" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant={dialog === "decline" ? "outline" : "default"}
                onClick={() => dialog && void answer(dialog)}
                disabled={
                  busy ||
                  (dialog !== "decline" && needsCheck && !checked) ||
                  (dialog === "start" && !current.account && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
                }
              >
                {busy ? "Saving" : dialog === "decline" ? "Decline" : dialog === "start" ? "Start onboarding" : "Approve"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  if (phase === "demo") {
    if (current.request) {
      return (
        <div className="bg-warning/10 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3">
          <div className="min-w-0 space-y-1">
            <p className="ta-label-1 text-warning">Setup requested on {shortDate(current.request.requestedAt)}</p>
            <Requester customer={current} />
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
          {dialogs}
        </div>
      );
    }
    return (
      <div className="bg-secondary flex flex-wrap items-center justify-between gap-3 rounded-lg p-3">
        <div className="min-w-0 space-y-1">
          {current.account ? (
            <>
              <p className="ta-label-1 text-muted-foreground">
                {current.account.source === "start" ? "Signed up; hasn't requested setup yet." : "Linked account; no request yet."}
              </p>
              <Requester customer={current} />
            </>
          ) : (
            <p className="ta-label-1 text-muted-foreground">No account yet. They can request setup from the demo page.</p>
          )}
          {current.declined ? (
            <p className="ta-caption-1 text-muted-foreground">
              Declined on {shortDate(current.declined.declinedAt)}
              {current.declined.note ? `: ${current.declined.note}` : "."}
            </p>
          ) : null}
        </div>
        <Button variant="outline" onClick={() => setDialog("start")}>
          Start onboarding
        </Button>
        {dialogs}
      </div>
    );
  }

  // Past the demo. The dialog stays mounted: an approval just made shows its result (and the sign-in
  // link) here, because the approval itself is what moved the phase on.
  return (
    <div className="bg-primary/10 ta-label-1 text-primary flex flex-wrap items-center justify-between gap-2 rounded-lg p-3">
      {dialogs}
      <span>
        {phase === "onboarding"
          ? "In onboarding. The customer now edits their own business information; changes here stay in the demo. Go live is on the Accounts page."
          : `In production${current.liveAt ? ` since ${shortDate(current.liveAt)}` : ""}. Changes here stay in the demo.`}
      </span>
      {current.accountEmail ? (
        <a
          className="inline-flex items-center gap-1 hover:underline"
          href={demoHref("business", undefined, { customer: current.accountEmail })}
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
  const [current] = useCustomer(customer, onChanged);
  const [open, setOpen] = useState(false);
  const { adopt } = useAuth();

  // The account is in onboarding now. Their Home is where the setup checklist lives; move there
  // first, then adopt the moved account, so no screen renders between the two states.
  const moved = (result: Moved) => {
    setOpen(false);
    window.location.hash = demoHref("dashboard");
    adopt(result.user);
    toast.success("Setup started. Everything is yours to change now.");
  };

  const requested = current.request;
  const dialog = (
    <RequestSetupDialog customerId={current.id} open={open} onOpenChange={setOpen} onMoved={moved} />
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
