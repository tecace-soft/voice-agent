import { useEffect, useState } from "react";
import { listMailboxes } from "../api/backend";
import type { MailboxScope, MailboxSummary } from "../api/types";
import { IconInbox } from "../icons";
import { displayName, useAccountNames } from "../people";

// Admin-only control for choosing whose voicemail data the dashboard is showing. A `user` never
// sees this: the backend pins them to the mailbox matching their own account email, so there is
// nothing for them to choose between.
//
// The value is encoded as a string for the <select> and mapped back: "" = every mailbox,
// "unattributed" = the runs reported before mailboxes were recorded.
export const ALL = "";
export const UNATTRIBUTED = "unattributed";

export function toScope(value: string): MailboxScope {
  if (value === ALL) return undefined;
  if (value === UNATTRIBUTED) return null;
  return value;
}

export function fromScope(scope: MailboxScope): string {
  if (scope === undefined) return ALL;
  if (scope === null) return UNATTRIBUTED;
  return scope;
}

export function MailboxPicker({
  value,
  onChange,
}: {
  value: MailboxScope;
  onChange: (next: MailboxScope) => void;
}) {
  const [mailboxes, setMailboxes] = useState<MailboxSummary[] | null>(null);
  const names = useAccountNames();

  useEffect(() => {
    let active = true;
    listMailboxes()
      .then((list) => active && setMailboxes(list))
      .catch(() => active && setMailboxes([])); // the picker is a filter; a failure shouldn't block the page
    return () => {
      active = false;
    };
  }, []);

  // Nothing to choose between until the transcribe-app has reported for more than one mailbox.
  if (!mailboxes || mailboxes.length === 0) return null;

  return (
    <label className="mailbox-picker" title="Whose voicemail data to show">
      <IconInbox size={14} />
      <span className="sr-only">Mailbox</span>
      <select
        className="select"
        value={fromScope(value)}
        onChange={(e) => onChange(toScope(e.target.value))}
      >
        <option value={ALL}>All mailboxes</option>
        {mailboxes.map((m) => (
          <option
            key={m.mailboxEmail ?? UNATTRIBUTED}
            value={m.mailboxEmail ?? UNATTRIBUTED}
            title={m.mailboxEmail ?? undefined}
          >
            {displayName(m.mailboxEmail, names)} ({m.processed.toLocaleString()})
          </option>
        ))}
      </select>
    </label>
  );
}
