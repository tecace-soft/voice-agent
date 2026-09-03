import { useCallback, useEffect, useState } from "react";
import { deleteInboundCall, listAccounts, listInboundCalls } from "../api/backend";
import type { AuthUser, InboundCall, MailboxScope } from "../api/types";
import { accountErrorMessage } from "../auth";
import { IconChevronDown, IconPhone, IconTrash, IconUsers } from "../icons";
import { formatDateTime, formatPhone } from "../lib";

// Calls the assistant answered, read the way a transcribed voicemail is read.
//
// The list answers the three questions someone actually has — who rang, on what number, and when —
// and the conversation itself is one click away. That split matters: a page of full transcripts is
// unscannable, and the reason to open this page is usually "did anyone call while I was out",
// not "read me every word".
//
// A caller's NAME is what they gave when asked and their callback number is one the assistant read
// back to confirm, which is the part a recording can never do. Where the network gave us a number
// too, it is shown as well — the number someone rings from is not always the one they want ringing
// back, and collapsing the two would quietly lose that.

function duration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function CallRow({
  call,
  showWho,
  onDeleted,
}: {
  call: InboundCall;
  showWho: boolean;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const name = call.callerName?.trim();
  const number = formatPhone(call.callbackNumber || call.caller);
  // Belt and braces with the backend's own normalising: a value that isn't an array here would
  // throw inside the render and take the WHOLE dashboard blank, not just this row. One malformed
  // record must never be able to do that.
  const turns = Array.isArray(call.turns) ? call.turns : [];

  // Deliberately only reachable once the call is OPEN. A trash icon on every collapsed row makes
  // it a mis-click to destroy a conversation nobody has read yet, and unlike a phone number a call
  // cannot be added back. Opening it first costs one click and means you see what you're deleting.
  async function onDelete() {
    const who = name || number || "this caller";
    if (!window.confirm(`Delete the call from ${who} on ${formatDateTime(call.startedAt)}?

The conversation is removed permanently — this can't be undone.`)) return;
    setFailed(null);
    setDeleting(true);
    try {
      await deleteInboundCall(call.id);
      onDeleted();
    } catch (e) {
      // Left on screen: a call that failed to delete is still there, and saying so beats a row
      // that silently stays put and looks like a bug.
      setFailed(accountErrorMessage(e, "Couldn't delete that call."));
      setDeleting(false);
    }
  }

  return (
    <li className={`call-item${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="call-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <IconChevronDown size={14} className={`icon chevron${open ? " is-open" : ""}`} />
        <span className="call-identity">
          <span className="ta-label-1">{name || "Caller didn't give a name"}</span>
          <span className="ta-caption-1 muted">
            {number || "No number"}
            {call.callbackRequested && " · asked for a callback"}
          </span>
        </span>
        <span className="call-when ta-caption-1 muted">
          {formatDateTime(call.startedAt)}
          {call.durationSeconds ? ` · ${duration(call.durationSeconds)}` : ""}
        </span>
      </button>

      {open && (
        <div className="call-detail">
          {call.summary && <p className="call-summary ta-body-2">{call.summary}</p>}
          {call.request && (
            <p className="ta-caption-1 muted call-request">Wanted: {call.request}</p>
          )}
          <ul className="call-turns">
            {turns.length === 0 ? (
              <li className="muted ta-caption-1">No conversation was captured for this call.</li>
            ) : (
              turns.map((turn, i) => (
                <li key={i} className={`call-turn call-turn-${turn.speaker}`}>
                  <span className="call-speaker ta-caption-2">
                    {turn.speaker === "agent" ? "Assistant" : name || "Caller"}
                  </span>
                  <span className="ta-body-2">{turn.text}</span>
                </li>
              ))
            )}
          </ul>
          <p className="call-meta ta-caption-2 muted">
            Rang {formatPhone(call.dialled)}
            {call.caller && call.callbackNumber && call.caller !== call.callbackNumber
              ? ` from ${formatPhone(call.caller)}`
              : ""}
            {showWho && call.userId === null ? " · not assigned to a customer" : ""}
          </p>
          {failed && <p className="error ta-caption-1">{failed}</p>}
          <div className="call-actions">
            <button
              type="button"
              className="btn btn-quiet call-delete"
              onClick={onDelete}
              disabled={deleting}
            >
              <IconTrash size={14} />
              {deleting ? "Deleting…" : "Delete this call"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function CallsPage({
  isAdmin = false,
  scope,
  onScope,
}: {
  isAdmin?: boolean;
  /** Which customer an admin is viewing, held in the URL so a refresh stays put. */
  scope?: MailboxScope;
  onScope?: (next: MailboxScope) => void;
}) {
  const [calls, setCalls] = useState<InboundCall[] | null>(null);
  const [customers, setCustomers] = useState<AuthUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const viewing = isAdmin ? customers.find((c) => c.email === scope) ?? null : null;

  useEffect(() => {
    if (!isAdmin) return;
    listAccounts()
      .then((all) => setCustomers(all.filter((u) => u.role !== "admin")))
      .catch(() => setCustomers([]));
  }, [isAdmin]);

  const load = useCallback(() => {
    // Admins default to everyone and narrow by picking someone; a customer is always their own.
    listInboundCalls(isAdmin ? viewing?.id : undefined)
      .then((rows) => {
        setCalls(rows);
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load calls.")));
  }, [isAdmin, viewing?.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="error ta-body-2">{error}</p>;

  return (
    <div className="view">
      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">
              {viewing ? `${viewing.name}'s calls` : "Calls the assistant answered"}
            </div>
            <div className="card-sub ta-caption-1">
              Someone rang and the assistant picked up. Open a call to read what was said.
            </div>
          </div>
          {isAdmin && customers.length > 0 && (
            <label className="call-picker">
              <IconUsers size={14} />
              <select
                className="input"
                value={(scope as string) ?? ""}
                onChange={(e) => onScope?.(e.target.value || undefined)}
                aria-label="Whose calls to show"
              >
                <option value="">Everyone</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.email}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {calls === null ? (
          <p className="feedback-empty muted ta-body-2">Loading…</p>
        ) : calls.length === 0 ? (
          <p className="feedback-empty muted ta-body-2">
            <IconPhone size={14} /> No calls yet. When someone rings and the assistant answers, the
            conversation appears here.
          </p>
        ) : (
          <ul className="call-list">
            {calls.map((call) => (
              <CallRow key={call.id} call={call} showWho={isAdmin} onDeleted={load} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
