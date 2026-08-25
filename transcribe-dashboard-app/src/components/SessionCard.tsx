import type { TranscribeAnalytics } from "../api/types";
import { formatDateTime, formatDuration, formatMailbox } from "../lib";

type Session = TranscribeAnalytics["sessions"][number];

const pct = (part: number, whole: number) => (whole <= 0 ? 0 : (part / whole) * 100);

// One transcribed session, read on its own terms: what it found, what it managed, and how long the
// app had been quiet before it. The bar splits what it found into transcribed / already handled /
// failed, so a session that mostly re-read old voicemails looks different from one that did real
// work, even when both "transcribed" the same number.
export function SessionCard({
  session,
  share,
  showMailbox = false,
}: {
  session: Session;
  share: number;
  /** Whose session this was — shown when the list mixes mailboxes. */
  showMailbox?: boolean;
}) {
  const attempted = session.processed + session.failed;
  const successRate = attempted === 0 ? 100 : pct(session.processed, attempted);
  const newWork = pct(attempted, session.voicemails);

  const segments = [
    { key: "processed", label: "Transcribed", value: session.processed, className: "seg-processed" },
    { key: "skipped", label: "Already handled", value: session.skipped, className: "seg-skipped" },
    { key: "failed", label: "Failed", value: session.failed, className: "seg-failed" },
  ].filter((s) => s.value > 0);

  return (
    <li className={`session${session.failed > 0 ? " has-failure" : ""}`}>
      <div className="session-head">
        <div className="session-when">
          <span className="session-title">
            <span className="ta-label-1 session-time">{formatDateTime(session.createdAt)}</span>
            {showMailbox && (
              <span className={`badge badge-mailbox${session.mailboxEmail ? "" : " is-unattributed"}`}>
                {formatMailbox(session.mailboxEmail)}
              </span>
            )}
          </span>
          <span className="ta-caption-1 muted">
            {session.sincePreviousSeconds > 0
              ? `${formatDuration(session.sincePreviousSeconds)} after the previous run`
              : "First run on record"}
          </span>
        </div>
        <div className="session-headline">
          <span className="session-count">{session.processed}</span>
          <span className="ta-caption-1 muted">
            transcribed{share > 0 ? ` · ${share.toFixed(1)}% of the listed sessions` : ""}
          </span>
        </div>
      </div>

      <div
        className="session-bar"
        role="img"
        aria-label={`${session.voicemails} found: ${segments.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(", ")}`}
      >
        {segments.map((s) => (
          <span
            key={s.key}
            className={`seg ${s.className}`}
            style={{ width: `${pct(s.value, session.voicemails)}%` }}
            title={`${s.label}: ${s.value} of ${session.voicemails} found`}
          />
        ))}
      </div>

      <dl className="session-stats">
        <div>
          <dt className="ta-caption-1 muted">Found</dt>
          <dd className="ta-label-1">{session.voicemails}</dd>
        </div>
        <div>
          <dt className="ta-caption-1 muted">Transcribed</dt>
          <dd className="ta-label-1">{session.processed}</dd>
        </div>
        <div>
          <dt className="ta-caption-1 muted">Already handled</dt>
          <dd className="ta-label-1">{session.skipped}</dd>
        </div>
        <div>
          <dt className="ta-caption-1 muted">Failed</dt>
          <dd className={`ta-label-1${session.failed > 0 ? " is-danger" : ""}`}>{session.failed}</dd>
        </div>
        <div>
          <dt className="ta-caption-1 muted">Success rate</dt>
          <dd className="ta-label-1">{successRate.toFixed(0)}%</dd>
        </div>
        <div>
          <dt className="ta-caption-1 muted">New work</dt>
          <dd className="ta-label-1">{newWork.toFixed(0)}%</dd>
        </div>
      </dl>
    </li>
  );
}
