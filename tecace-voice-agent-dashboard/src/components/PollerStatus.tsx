import { useCallback, useEffect, useState } from "react";
import { listPollers } from "../api/backend";
import type { MailboxScope, PollerHeartbeat } from "../api/types";
import { IconAlert, IconRefresh } from "../icons";
import { formatDateTime, formatMailbox } from "../lib";

// Is the poller still running?
//
// Nothing else on this dashboard can answer that. Every other number describes work that happened;
// a poller that died at 3am produces no rows, no errors and no failures — it looks exactly like a
// quiet night, and the first anyone hears is a customer asking where their voicemails went.
//
// This is ALWAYS on screen, in all four states. The first version hid itself while healthy, on the
// theory that a permanent green panel gets ignored. That was wrong for a different reason: with
// nothing rendered, "everything is fine" and "this was never deployed" looked identical, so the one
// question it exists to answer — is it running? — had no visible answer either way.

type State = "unknown" | "online" | "erroring" | "offline" | "unreachable";

function ago(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, seconds)} seconds ago`;
  const mins = Math.round(seconds / 60);
  if (mins < 90) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`;
}

const LABEL: Record<State, string> = {
  unknown: "No poller has reported yet",
  online: "Poller running",
  erroring: "Poller running, last pass failed",
  offline: "Poller has stopped reporting",
  unreachable: "Can't read poller status",
};

export function PollerStatus({ mailbox }: { mailbox?: MailboxScope }) {
  const [pollers, setPollers] = useState<PollerHeartbeat[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(() => {
    listPollers(mailbox)
      .then((r) => {
        setPollers(r.pollers);
        setFailed(null);
        setCheckedAt(new Date());
      })
      .catch((e) => {
        // A failed REQUEST is not "no poller has reported" — mapping it to the empty state is
        // exactly how a broken read looked identical to a poller that had never run, and cost a
        // deploy cycle chasing the wrong end of the system. Say which it is.
        setPollers([]);
        setFailed(e instanceof Error ? e.message : "Request failed");
        setCheckedAt(new Date());
      });
  }, [mailbox]);

  useEffect(() => {
    load();
    // Re-check on the poller's own timescale, so a dashboard left open on a screen notices a
    // poller going quiet without anyone refreshing the page.
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (pollers === null) return null; // first load only; a flash of "unknown" would be a lie

  const offline = pollers.filter((p) => !p.online);
  const erroring = pollers.filter((p) => p.online && !p.lastCycleOk);
  const state: State = failed
    ? "unreachable"
    : pollers.length === 0
      ? "unknown"
      : offline.length > 0
        ? "offline"
        : erroring.length > 0
          ? "erroring"
          : "online";

  const newest = [...pollers].sort((a, b) => a.secondsSinceSeen - b.secondsSinceSeen)[0];
  const problems = [...offline, ...erroring];

  return (
    <section className={`card poller-card poller-${state}`}>
      <div className="poller-bar">
        <span className={`poller-dot poller-dot-${state}`} aria-hidden="true" />
        <div className="poller-headline">
          <span className="ta-label-1">
            {LABEL[state]}
            {pollers.length > 1 && state === "online" ? ` (${pollers.length})` : ""}
          </span>
          <span className="ta-caption-2 muted">
            {state === "unreachable"
              ? failed
              : state === "unknown"
                ? "Deploy the backend, then restart the poller. It reports in every cycle."
                : `Last check-in ${ago(newest!.secondsSinceSeen)} · expects one every ${Math.round(
                  newest!.intervalSeconds / 60,
                  )} min`}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-quiet poller-refresh"
          onClick={load}
          title="Check again now"
        >
          <IconRefresh size={14} />
          {checkedAt ? checkedAt.toLocaleTimeString() : "Check"}
        </button>
      </div>

      {problems.length > 0 && (
        <ul className="poller-list">
          {problems.map((p) => (
            <li key={p.mailboxEmail ?? "unattributed"} className="poller-item">
              <span className={`dot-mark ${p.online ? "is-warning" : "is-danger"}`} />
              <span className="poller-who">
                <span className="ta-label-1">{formatMailbox(p.mailboxEmail)}</span>
                <span className="ta-caption-2 muted">
                  {p.online ? "Last pass failed" : "Silent"} · last seen{" "}
                  {formatDateTime(p.lastSeenAt)}
                  {p.host ? ` · ${p.host}` : ""}
                </span>
              </span>
              {p.detail && <code className="poller-detail ta-caption-2">{p.detail}</code>}
            </li>
          ))}
        </ul>
      )}

      {state === "offline" && (
        <p className="poller-foot ta-caption-1 muted">
          <IconAlert size={12} />
          No voicemails are being transcribed until it is running again.
          <code>sudo systemctl status transcribe-poller</code>
        </p>
      )}
    </section>
  );
}
