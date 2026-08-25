import { useState, type ReactNode } from "react";
import { getTranscribeStats } from "../api/backend";
import type { MailboxScope, MailboxSummary, TranscribeStats } from "../api/types";
import { IconChevronDown } from "../icons";
import { formatDateTime, formatMailbox } from "../lib";

// One person's dashboard, collapsed to a summary row until you open it.
//
// The whole point is that an admin's "all mailboxes" view otherwise blends everyone into one set of
// numbers. Here each person keeps their own, and the figures on the closed row come from the
// per-mailbox summary that is already loaded — so a list of twenty people costs one request, not
// twenty. The full data for a person is fetched the first time their card is opened, and kept if
// they close and reopen it.

export function PersonPanel({
  mailbox,
  accountName,
  children,
}: {
  mailbox: MailboxSummary;
  accountName?: string | null;
  children: (data: TranscribeStats) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TranscribeStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scope: MailboxScope = mailbox.mailboxEmail; // null here means the unattributed group
  const label = formatMailbox(mailbox.mailboxEmail);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || data || loading) return; // already have it, or on the way

    setLoading(true);
    getTranscribeStats(scope)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this person's data."))
      .finally(() => setLoading(false));
  }

  return (
    <section className={`person-panel${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="person-panel-head"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="panel-chevron" aria-hidden="true">
          <IconChevronDown size={16} />
        </span>

        <span className="panel-who">
          {/* the person first, the address second — you pick a person, not a string */}
          <span className={`panel-name${mailbox.mailboxEmail ? "" : " is-unattributed"}`}>
            {accountName ?? label}
          </span>
          <span className="panel-sub ta-caption-1 muted">
            {accountName && mailbox.mailboxEmail ? `${mailbox.mailboxEmail} · ` : ""}
            {mailbox.lastRunAt ? `last run ${formatDateTime(mailbox.lastRunAt)}` : "no runs yet"}
          </span>
        </span>

        {/* the numbers worth seeing without opening anything */}
        <span className="panel-figures">
          <span className="panel-figure">
            <span className="panel-figure-value">{mailbox.processed.toLocaleString()}</span>
            <span className="ta-caption-2 muted">transcribed</span>
          </span>
          <span className="panel-figure">
            <span className="panel-figure-value">{mailbox.today.toLocaleString()}</span>
            <span className="ta-caption-2 muted">today</span>
          </span>
          <span className="panel-figure">
            <span className="panel-figure-value">{mailbox.last7Days.toLocaleString()}</span>
            <span className="ta-caption-2 muted">last 7 days</span>
          </span>
          <span className="panel-figure">
            <span className={`panel-figure-value${mailbox.failed > 0 ? " is-danger" : ""}`}>
              {mailbox.failed.toLocaleString()}
            </span>
            <span className="ta-caption-2 muted">failed</span>
          </span>
        </span>
      </button>

      {open && (
        <div className="person-panel-body">
          {loading && <p className="muted ta-body-2 panel-status">Loading {label}…</p>}
          {error && <p className="error ta-body-2">{error}</p>}
          {data && children(data)}
        </div>
      )}
    </section>
  );
}
