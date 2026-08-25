import { useEffect, useState } from "react";
import { listMailboxes } from "../api/backend";
import type { MailboxScope, MailboxSummary } from "../api/types";
import { formatDateTime, formatMailbox } from "../lib";

// Who the data on screen belongs to, when it belongs to more than one person. Shown only in an
// admin's "all mailboxes" view: the totals above it are sums across everyone, and this says who
// they're made of — and lets you jump straight into one.
export function MailboxBreakdown({ onPick }: { onPick?: (mailbox: MailboxScope) => void }) {
  const [mailboxes, setMailboxes] = useState<MailboxSummary[] | null>(null);

  useEffect(() => {
    let active = true;
    listMailboxes()
      .then((list) => active && setMailboxes(list))
      .catch(() => active && setMailboxes([])); // a failure here shouldn't take the page down
    return () => {
      active = false;
    };
  }, []);

  if (!mailboxes || mailboxes.length === 0) return null;

  const totalProcessed = mailboxes.reduce((sum, m) => sum + m.processed, 0);

  return (
    <section className="card">
      <div className="card-toolbar">
        <div>
          <div className="card-title ta-headline-2">Whose data this is</div>
          <div className="card-sub ta-caption-1">
            {mailboxes.length} {mailboxes.length === 1 ? "mailbox" : "mailboxes"} · the figures above
            are the total across all of them
          </div>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Mailbox</th>
              <th className="num" scope="col">
                Runs
              </th>
              <th className="num" scope="col">
                Transcribed
              </th>
              <th className="num" scope="col">
                Share
              </th>
              <th className="num" scope="col">
                Failed
              </th>
              <th scope="col">Last run</th>
            </tr>
          </thead>
          <tbody>
            {mailboxes.map((m) => (
              <tr key={m.mailboxEmail ?? "unattributed"}>
                <td>
                  {onPick ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onPick(m.mailboxEmail)}
                      title={`Show only ${formatMailbox(m.mailboxEmail)}`}
                    >
                      {formatMailbox(m.mailboxEmail)}
                    </button>
                  ) : (
                    formatMailbox(m.mailboxEmail)
                  )}
                </td>
                <td className="num">{m.runs.toLocaleString()}</td>
                <td className="num">{m.processed.toLocaleString()}</td>
                <td className="num">
                  {totalProcessed === 0 ? "—" : `${((m.processed / totalProcessed) * 100).toFixed(1)}%`}
                </td>
                <td className={`num${m.failed > 0 ? " is-danger" : ""}`}>{m.failed.toLocaleString()}</td>
                <td>{m.lastRunAt ? formatDateTime(m.lastRunAt) : "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
