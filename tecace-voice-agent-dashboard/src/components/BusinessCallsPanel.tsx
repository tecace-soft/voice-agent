import { useCallback, useState } from "react";
import { listInboundCalls } from "../api/backend";
import type { CallMinutes, InboundCall, MailboxScope } from "../api/types";
import { accountErrorMessage } from "../auth";
import { IconChevronDown } from "../icons";
import { CallList } from "./CallList";
import { TalkTimeCards, formatTalkTime } from "./TalkTime";

// One business's calls and talk time, collapsed to a summary row until you open it.
//
// The admin's "every business" view of Answered calls, built the same way as the per-person panels
// on Overview and Analytics: each business keeps its own numbers and its own calls, instead of every
// customer's conversations interleaved in one list. The closed row's figures come from the talk-time
// list that is already loaded, so many businesses cost one request; a business's calls are fetched
// the first time its panel is opened, and kept if it is closed and reopened.

export function BusinessCallsPanel({
  minutes,
  onScope,
}: {
  minutes: CallMinutes;
  onScope?: (next: MailboxScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState<InboundCall[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unassigned = minutes.userId === null;
  // The business leads, the person and address support it — the same order as everywhere else.
  const title = unassigned
    ? "Not assigned to a customer"
    : minutes.businessName || minutes.name || minutes.email || "Unnamed business";
  const sub = unassigned
    ? "calls on agent numbers nobody owns"
    : [minutes.businessName ? minutes.name : null, minutes.email].filter(Boolean).join(" · ");

  const load = useCallback(() => {
    setLoading(true);
    listInboundCalls(minutes.userId ?? "unassigned")
      .then((rows) => {
        setCalls(rows);
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load this business's calls.")))
      .finally(() => setLoading(false));
  }, [minutes.userId]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && calls === null && !loading) load();
  }

  return (
    <section className={`person-panel${open ? " is-open" : ""}`}>
      <button type="button" className="person-panel-head" aria-expanded={open} onClick={toggle}>
        <span className="panel-chevron" aria-hidden="true">
          <IconChevronDown size={16} />
        </span>

        <span className="panel-who">
          <span className={`panel-name${unassigned ? " is-unattributed" : ""}`}>{title}</span>
          {sub && <span className="panel-sub ta-caption-1 muted">{sub}</span>}
        </span>

        <span className="panel-figures">
          <span className="panel-figure">
            <span className="panel-figure-value">{formatTalkTime(minutes.currentSeconds)}</span>
            <span className="ta-caption-2 muted">this month</span>
          </span>
          <span className="panel-figure">
            <span className="panel-figure-value">{formatTalkTime(minutes.previousSeconds)}</span>
            <span className="ta-caption-2 muted">last month</span>
          </span>
        </span>
      </button>

      {open && (
        <div className="person-panel-body">
          <div className="view">
            <TalkTimeCards minutes={minutes} />
            <section className="card">
              <div className="card-toolbar">
                <div>
                  <div className="card-title ta-headline-2">Answered calls</div>
                  <div className="card-sub ta-caption-1">
                    {unassigned
                      ? "Calls that rang a number no customer owns. Assign the number under Agent numbers."
                      : `Calls ${title} received. Open one to read what was said.`}
                  </div>
                </div>
                {!unassigned && minutes.email && (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => onScope?.(minutes.email)}
                  >
                    View only this business
                  </button>
                )}
              </div>
              {error ? (
                <p className="error ta-body-2">{error}</p>
              ) : calls === null ? (
                <p className="feedback-empty muted ta-body-2">Loading…</p>
              ) : (
                <CallList calls={calls} onDeleted={load} />
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
