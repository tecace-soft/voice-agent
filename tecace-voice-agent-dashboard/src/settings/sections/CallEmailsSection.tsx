import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { getCallEmails, saveCallEmails, type CallEmails } from "../../api/backend";
import { accountErrorMessage } from "../../auth";
import { SectionIntro } from "../SettingsShell";

// A summary of each call, emailed to the account's own address. One switch, saved on the flip like
// the press-to-accept switch in Call forwarding; a failed save puts it back.
//
// It loads and saves itself (GET/PUT /business/call-emails): the setting is the account's, not the
// business profile's, so it doesn't ride on BusinessSettings' profile saves. Business only — a demo
// has no inbox to send to, so DemoSettings doesn't list it.

export function CallEmailsSection({ userId }: { userId?: string }) {
  const [state, setState] = useState<CallEmails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getCallEmails(userId).then(
      (next) => live && setState(next),
      (e) => live && setLoadError(accountErrorMessage(e, "Couldn't load this setting. Reload the page to try again.")),
    );
    return () => {
      live = false;
    };
  }, [userId]);

  async function flip(on: boolean) {
    setState((s) => s && { ...s, enabled: on });
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      setState(await saveCallEmails(on, userId));
      setSaved(true);
    } catch (e) {
      setState((s) => s && { ...s, enabled: !on });
      setError(accountErrorMessage(e, "Couldn't save that. Nothing was changed."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionIntro>
        Get an email after each call your receptionist answers: who called, what they wanted and how
        the call ended. The full conversation stays under Transcripts.
      </SectionIntro>

      {loadError ? (
        <p className="ta-label-1 text-destructive" role="alert">
          {loadError}
        </p>
      ) : !state ? (
        <p className="ta-body-2 text-muted-foreground">Loading…</p>
      ) : (
        <div className="rounded-xl border p-4">
          <label className="ta-label-1 flex items-center justify-between gap-4">
            Email me a summary after each call
            <Switch checked={state.enabled} disabled={saving} onCheckedChange={(on) => void flip(on)} />
          </label>
          <p className="ta-caption-1 text-muted-foreground mt-1">Sent to {state.email}</p>
          {error ? (
            <p className="ta-label-1 text-destructive mt-2" role="alert">
              {error}
            </p>
          ) : saved ? (
            <p className="ta-caption-1 text-muted-foreground mt-2">Saved. This applies from the next call.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
