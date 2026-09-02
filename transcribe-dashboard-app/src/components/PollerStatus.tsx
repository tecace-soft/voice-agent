import { useEffect, useState } from "react";
import { listPollers } from "../api/backend";
import type { MailboxScope, PollerHeartbeat } from "../api/types";
import { IconAlert, IconCheck } from "../icons";
import { formatDateTime, formatMailbox } from "../lib";

// Is the poller still running?
//
// Nothing else on this dashboard can answer that. Every other number describes work that happened;
// a poller that died at 3am produces no rows, no errors and no failures — it looks exactly like a
// quiet night, and the first anyone hears is a customer asking where their voicemails went.
//
// Loud when something is wrong, nearly silent otherwise. A permanent green "all systems normal"
// panel is read once and then never again, which is the wrong reflex for the one indicator that
// matters only on the day it changes.

function ago(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, seconds)}s ago`;
  const mins = Math.round(seconds / 60);
  if (mins < 90) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)} days ago`;
}

export function PollerStatus({ mailbox }: { mailbox?: MailboxScope }) {
  const [pollers, setPollers] = useState<PollerHeartbeat[] | null>(null);

  useEffect(() => {
    let active = true;
    listPollers(mailbox)
      .then((r) => active && setPollers(r.pollers))
      .catch(() => {
        /* the backend being unreachable is its own visible failure elsewhere; don't double-report */
      });
    // Re-check on the poller's own timescale rather than once per page load, so a dashboard left
    // open on a wall display notices a poller going quiet.
    const timer = setInterval(() => {
      listPollers(mailbox)
        .then((r) => active && setPollers(r.pollers))
        .catch(() => {});
    }, 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [mailbox]);

  if (!pollers || pollers.length === 0) return null;

  const offline = pollers.filter((p) => !p.online);
  const erroring = pollers.filter((p) => p.online && !p.lastCycleOk);

  // Healthy and quiet: one unobtrusive line, not a panel.
  if (offline.length === 0 && erroring.length === 0) {
    const newest = pollers[0]!;
    return (
      <p className="poller-ok ta-caption-1 muted">
        <IconCheck size={12} />
        {pollers.length === 1 ? "Poller running" : `${pollers.length} pollers running`} · last check{" "}
        {ago(newest.secondsSinceSeen)}
      </p>
    );
  }

  return (
    <section className={`card poller-card${offline.length ? " is-offline" : " is-warning"}`}>
      <div className="card-head">
        <div>
          <div className="card-title ta-headline-2">
            {offline.length > 0
              ? offline.length === 1
                ? "A poller has stopped reporting"
                : `${offline.length} pollers have stopped reporting`
              : "A poller is erroring"}
          </div>
          <div className="card-sub ta-caption-1">
            {offline.length > 0
              ? "No voicemails are being transcribed for the mailboxes below until it is running again."
              : "The poller is alive but its last pass failed. See Failed runs for the reason."}
          </div>
        </div>
      </div>

      <ul className="poller-list">
        {[...offline, ...erroring].map((p) => (
          <li key={p.mailboxEmail ?? "unattributed"} className="poller-item">
            <span className={`dot-mark ${p.online ? "is-warning" : "is-danger"}`} />
            <span className="poller-who">
              <span className="ta-label-1">{formatMailbox(p.mailboxEmail)}</span>
              <span className="ta-caption-2 muted">
                {p.online ? "Last pass failed" : "Silent"} · last seen {ago(p.secondsSinceSeen)} (
                {formatDateTime(p.lastSeenAt)})
                {p.host ? ` · ${p.host}` : ""}
              </span>
            </span>
            {p.detail && <code className="poller-detail ta-caption-2">{p.detail}</code>}
          </li>
        ))}
      </ul>

      {offline.length > 0 && (
        <p className="poller-foot ta-caption-1 muted">
          <IconAlert size={12} />
          Expected a check-in every {Math.round((pollers[0]?.intervalSeconds ?? 300) / 60)} min. On
          the server: <code>sudo systemctl status transcribe-poller</code>
        </p>
      )}
    </section>
  );
}
