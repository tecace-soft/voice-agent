import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeMyPassword } from "../api/backend";
import { accountErrorMessage } from "../auth";

// Change your own password, from the sidebar's key button. Needs the current one; every other
// session is signed out and this one carries on with a fresh token. Mounted only while open, so the
// transcribe screens' markup is unchanged (compare.py).

const MIN_PASSWORD = 10;

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (next.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (next !== again) return setError("The two new passwords don't match.");
    setBusy(true);
    try {
      await changeMyPassword(current, next);
      setDone(true);
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't change your password."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="ta-headline-1">{done ? "Password changed" : "Change password"}</DialogTitle>
          <DialogDescription className="ta-body-2">
            {done ? "You're still signed in here, and signed out everywhere else." : "You'll stay signed in here; other devices are signed out."}
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-current" className="ta-label-1">
                Current password
              </Label>
              <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-new" className="ta-label-1">
                New password
              </Label>
              <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-again" className="ta-label-1">
                New password again
              </Label>
              <Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
            </div>
            {error ? (
              <p role="alert" className="ta-caption-1 bg-destructive/10 text-destructive rounded-lg px-3 py-2">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving" : "Change password"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
