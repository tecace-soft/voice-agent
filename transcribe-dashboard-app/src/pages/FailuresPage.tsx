import { useCallback, useEffect, useRef, useState } from "react";
import { acknowledgeFailures, listFailures } from "../api/backend";
import type { MailboxScope, TranscribeFailure, TranscribeStats, VoicemailRun } from "../api/types";
import { RunsPage } from "./RunsPage";
import { accountErrorMessage } from "../auth";
import { IconAlert, IconCheck } from "../icons";
import { formatDateTime, formatMailbox } from "../lib";

// Why voicemails failed, and the reason itself rather than just a count.
//
// A failed voicemail is never lost — the poller doesn't mark it done, so the next pass retries it.
// So the useful question is never "what do I do now" but "is this one blip or something broken",
// and only the error text answers that. "5 failed" cannot.
//
// Opening this page acknowledges what's here: the badge is about what is NEW, and having looked at
// the list is exactly the condition it should clear on. The rows themselves stay — clearing a
// notification must not erase the history of a problem that may still be worth explaining later.

// Errors that come in bursts and mean the same thing get grouped, so a Sheets outage that hit
// twelve voicemails reads as one incident rather than twelve identical cards.
function groupKey(f: TranscribeFailure): string {
  return f.error.replace(/\d+/g, "#").slice(0, 160);
}

export function FailuresPage({
  mailbox,
  data,
  showMailbox,
  onUnseenChange,
}: {
  mailbox?: MailboxScope;
  /** Stats, for the failed-runs table below. Null while they load — the reasons don't wait on it. */
  data: TranscribeStats | null;
  showMailbox?: boolean;
  /** Reports the sidebar badge count: what's outstanding on arrival, then 0 once acknowledged. */
  onUnseenChange?: (unseen: number) => void;
}) {
  const [failures, setFailures] = useState<TranscribeFailure[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(0);
  // Acknowledge once per visit, not once per render — StrictMode double-invokes effects in dev, and
  // a second POST would report "0 cleared" and make the confirmation flicker.
  const acked = useRef<string>("");

  const load = useCallback(() => {
    const key = String(mailbox ?? "all");
    listFailures(mailbox)
      .then(async ({ failures: rows, unacknowledged }) => {
        setFailures(rows);
        setError(null);
        onUnseenChange?.(unacknowledged);
        if (unacknowledged > 0 && acked.current !== key) {
          acked.current = key;
          const { cleared: n } = await acknowledgeFailures(mailbox);
          setCleared(n);
          // Clear the sidebar badge as soon as the server has confirmed it, so the number doesn't
          // linger until the next page load and read as "still unread".
          onUnseenChange?.(0);
        }
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load failures.")));
  }, [mailbox, onUnseenChange]);

  useEffect(() => {
    load();
  }, [load]);

  // What to reveal when a run's row is clicked. Returns null for a run we have no stored reasons
  // for — runs that failed before this feature existed — so those rows stay plain rather than
  // expanding to an empty box that looks broken.
  const detailsFor = (run: VoicemailRun) => {
    const mine = (failures ?? []).filter((f) => f.runId === run.id);
    if (!mine.length) return null;
    return (
      <ul className="run-detail-list">
        {mine.map((f) => (
          <li key={f.id}>
            <p className="failure-error ta-body-2">{f.error}</p>
            <p className="failure-files ta-caption-2 muted">
              {f.filename} · from {f.fromAddr}
            </p>
          </li>
        ))}
      </ul>
    );
  };

  if (error) return <p className="error ta-body-2">{error}</p>;

  const groups = new Map<string, TranscribeFailure[]>();
  for (const f of failures ?? []) {
    const key = groupKey(f);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
  }

  return (
    <div className="view">
      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">Why transcriptions failed</div>
            <div className="card-sub ta-caption-1">
              Newest first. A failed voicemail isn't lost — it's retried on the next pass, so this is
              here to tell a one-off blip from something that needs fixing.
            </div>
          </div>
          {cleared > 0 && (
            <span className="badge badge-success" role="status">
              <IconCheck size={12} />
              {cleared} marked as seen
            </span>
          )}
        </div>

        {failures === null ? (
          <p className="feedback-empty muted ta-body-2">Loading…</p>
        ) : failures.length === 0 ? (
          <p className="feedback-empty muted ta-body-2">
            Nothing has failed. Any voicemail that can't be transcribed will appear here with the
            reason.
          </p>
        ) : (
          <ul className="failure-list">
            {[...groups.values()].map((rows) => {
              const first = rows[0]!;
              return (
                <li key={first.id} className="failure-item">
                  <div className="failure-head">
                    <span className="badge badge-danger">
                      <IconAlert size={12} />
                      {rows.length === 1 ? "1 voicemail" : `${rows.length} voicemails`}
                    </span>
                    <span className="ta-caption-1 muted">{formatDateTime(first.createdAt)}</span>
                    {first.mailboxEmail && (
                      <span className="ta-caption-1 muted">{formatMailbox(first.mailboxEmail)}</span>
                    )}
                    {!first.acknowledgedAt && <span className="badge badge-outline">New</span>}
                  </div>
                  <p className="failure-error ta-body-2">{first.error}</p>
                  <p className="failure-files ta-caption-2 muted">
                    {rows
                      .slice(0, 4)
                      .map((r) => r.filename)
                      .join(", ")}
                    {rows.length > 4 && ` and ${rows.length - 4} more`}
                    {" · from "}
                    {first.fromAddr}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {data && <RunsPage data={data} onlyFailed showMailbox={showMailbox} detailsFor={detailsFor} />}
    </div>
  );
}
