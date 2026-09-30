import { useState } from "react";
import { ArrowRight } from "lucide-react";
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
import { StatusBadge } from "@/components/admin/shared";
import { requestGoLive, type Readiness } from "../../api/backend";
import { accountErrorMessage } from "../../auth";
import { customerPart } from "../sectionChecks";

// "Request go live": the onboarding business's way of saying its part is done — the same hand-off as
// the demo's Request setup (demos/components/admin/Lifecycle.tsx), one stage later. An admin answers
// with Go live or "not yet" on the Accounts page.
//
// Drawn in two places that must always agree: the strip across the top of the settings (`strip`) and
// the foot of Launch instructions' checklist (`card`). Both read the same readiness body, and a sent
// request hands the new body back through `onChanged`, so they change together.

const MAX_NOTE = 1000;

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

type Props = {
  readiness: Readiness;
  /** The business itself. An admin looking at its settings sees where it stands, and no button. */
  canRequest: boolean;
  onChanged: (next: Readiness) => void;
  variant: "strip" | "card";
  /** Strip only: opens Launch instructions, where the checklist is. */
  onOpenChecklist?: () => void;
};

export function RequestGoLive({ readiness, canRequest, onChanged, variant, onOpenChecklist }: Props) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const part = customerPart(readiness);
  const requested = readiness.request ?? null;
  const declined = requested ? null : (readiness.declined ?? null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      onChanged(await requestGoLive(note.trim() || undefined));
      setOpen(false);
      setNote("");
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't send your request. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const who = canRequest ? "you" : "they";
  const message = requested ? (
    <>
      <b className="font-semibold">Go live requested</b> on {shortDate(requested.requestedAt)}.{" "}
      {canRequest
        ? "We'll assign your receptionist's number and switch your line on. Test calls work meanwhile."
        : "Assign a number and switch the line on from Accounts."}
    </>
  ) : part.ready ? (
    <>
      <b className="font-semibold">{canRequest ? "Your part is done." : "Their part is done."}</b>{" "}
      {canRequest
        ? "Request go live and we'll assign your number and switch your line on."
        : "They haven't requested go live yet. You can switch the line on from Accounts."}
    </>
  ) : (
    <>
      <b className="font-semibold">{canRequest ? "You're being set up." : "Being set up."}</b> The phone line stays off
      until go live. Finish {canRequest ? "your" : "their"} part ({part.done} of {part.total} done), then {who} can
      request go live.
    </>
  );

  const action = requested ? (
    <StatusBadge kind="caution">{canRequest ? "Waiting for us" : "Waiting for you"}</StatusBadge>
  ) : canRequest && part.ready ? (
    <Button size={variant === "strip" ? "sm" : "default"} onClick={() => setOpen(true)}>
      {declined ? "Ask again" : "Request go live"}
      <ArrowRight className="size-4" aria-hidden />
    </Button>
  ) : variant === "strip" && !part.ready && onOpenChecklist ? (
    <Button size="sm" variant="outline" onClick={onOpenChecklist}>
      See what's left
    </Button>
  ) : variant === "card" && canRequest ? (
    <Button disabled title="Finish your part first">
      Request go live
      <ArrowRight className="size-4" aria-hidden />
    </Button>
  ) : null;

  const dialog = (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="ta-headline-1">Request go live</DialogTitle>
          <DialogDescription className="ta-body-2">
            We&apos;ll check your setup, assign your receptionist&apos;s number and switch your line on. Then you
            forward your calls to it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="golive-note" className="ta-label-1">
            Anything we should know? (optional)
          </Label>
          <Textarea
            id="golive-note"
            value={note}
            maxLength={MAX_NOTE}
            onChange={(event) => setNote(event.target.value)}
            placeholder="For example: we'd like to start on Monday."
          />
        </div>
        {error ? (
          <p className="ta-label-1 text-destructive" role="alert">
            {error}
          </p>
        ) : null}
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

  const declinedLine = declined ? (
    <span className="text-foreground">
      {" "}
      Not yet{declined.note ? `: ${declined.note}` : "."}
    </span>
  ) : null;

  if (variant === "strip") {
    return (
      <div className="bg-primary/5 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5" role="status" aria-label="Go live">
        <p className="ta-caption-1 min-w-0 flex-1">
          {message}
          {declinedLine}
        </p>
        {action}
        {dialog}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4" aria-label="Go live">
      <p className="ta-body-2 text-muted-foreground min-w-0 flex-1 basis-[36ch]">
        {message}
        {declinedLine}
      </p>
      {action}
      {dialog}
    </div>
  );
}
