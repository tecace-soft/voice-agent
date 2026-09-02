import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  assignAgentNumber,
  deleteAgentNumber,
  listAccounts,
  listAgentNumbers,
  registerAgentNumber,
} from "../api/backend";
import type { AgentNumber, AuthUser } from "../api/types";
import { accountErrorMessage } from "../auth";
import { IconAlert, IconPhone, IconTrash } from "../icons";
import { formatDateTime } from "../lib";

// Which phone number the voice agent answers for which customer. Admin only.
//
// Assigning a number is a different act from a customer editing their own business details, and
// carries different risk: get the details wrong and one company's blurb is off; get the number
// wrong and a stranger calling company A hears company B's facts read aloud. So this page is
// admins only, while the details themselves stay editable by the person they belong to.
//
// A number with no owner is not an error state to be hidden — it is the normal state between
// buying a line and assigning it, and it is exactly what an admin needs to see, because the agent
// answers those calls neutrally with no idea whose business it is.

export function NumbersPage() {
  const [numbers, setNumbers] = useState<AgentNumber[] | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    Promise.all([listAgentNumbers(), listAccounts()])
      .then(([n, u]) => {
        setNumbers(n);
        // Customers only. An admin is TecAce staff, not a business the agent answers for, so there
        // is nothing for it to say if a call came in on their line. The backend refuses it too —
        // this list is the convenience, that is the rule.
        setUsers(u.filter((x) => x.role !== "admin").sort((a, b) => a.name.localeCompare(b.name)));
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load the agent's numbers.")));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    if (!phone.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await registerAgentNumber(phone.trim(), label);
      setPhone("");
      setLabel("");
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't register that number."));
    } finally {
      setBusy(false);
    }
  }

  async function onAssign(id: string, userId: string) {
    setError(null);
    try {
      await assignAgentNumber(id, userId || null);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't assign that number."));
    }
  }

  async function onDelete(number: AgentNumber) {
    if (!window.confirm(`Remove ${number.phoneE164}? The agent will stop answering for it.`)) return;
    setError(null);
    try {
      await deleteAgentNumber(number.id);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't remove that number."));
    }
  }

  const unassigned = (numbers ?? []).filter((n) => !n.userId).length;

  return (
    <div className="view">
      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title ta-headline-2">Agent phone numbers</div>
            <div className="card-sub ta-caption-1">
              When one of these rings, the agent answers as the person it's assigned to. A number
              can belong to only one customer — one line per business is what keeps the agent from
              reading the wrong company's details to a caller. Admin accounts can't hold a number:
              there'd be no business for the agent to answer as.
            </div>
          </div>
        </div>

        <form className="feedback-form" onSubmit={onRegister}>
          {error && (
            <p className="error ta-label-1" role="alert">
              {error}
            </p>
          )}
          <div className="number-form">
            <label className="field">
              <span className="field-label ta-caption-1">Twilio number</span>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 206 555 1234"
                inputMode="tel"
              />
            </label>
            <label className="field">
              <span className="field-label ta-caption-1">Label (optional)</span>
              <input
                className="input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Acme main line"
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy || !phone.trim()}>
              {busy ? "Adding…" : "Add number"}
            </button>
          </div>
          <span className="field-hint ta-caption-2 muted">
            Any format works — it's stored as +12065551234 so it matches what Twilio sends.
          </span>
        </form>
      </section>

      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">
              Assigned numbers
              {unassigned > 0 && (
                <span className="badge badge-warning number-unassigned">
                  <IconAlert size={12} />
                  {unassigned} unassigned
                </span>
              )}
            </div>
            <div className="card-sub ta-caption-1">
              An unassigned number still rings — the agent just answers neutrally, without claiming
              to be any particular business.
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Label</th>
                <th scope="col">Answers as</th>
                <th scope="col">Added</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {numbers === null ? (
                <tr>
                  <td className="table-empty" colSpan={5}>
                    Loading…
                  </td>
                </tr>
              ) : numbers.length === 0 ? (
                <tr>
                  <td className="table-empty" colSpan={5}>
                    No numbers yet. Add the Twilio number the agent answers on.
                  </td>
                </tr>
              ) : (
                numbers.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <span className="number-cell">
                        <IconPhone size={14} />
                        {n.phoneE164}
                      </span>
                    </td>
                    <td className="muted">{n.label || "—"}</td>
                    <td>
                      <select
                        className="input number-assign"
                        value={n.userId ?? ""}
                        onChange={(e) => onAssign(n.id, e.target.value)}
                        aria-label={`Who ${n.phoneE164} answers as`}
                      >
                        <option value="">— Not assigned —</option>
                        {/* A number assigned to an admin before this rule existed still has to
                            render, or the row would silently show as unassigned and nobody could
                            see what to fix. Shown, labelled, and re-assignable — just not
                            re-selectable once changed. */}
                        {n.userId && !users.some((u) => u.id === n.userId) && (
                          <option value={n.userId}>
                            {n.userName ?? n.userEmail} · admin — reassign to a customer
                          </option>
                        )}
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.email})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="muted ta-caption-1">{formatDateTime(n.createdAt)}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() => onDelete(n)}
                        title={`Delete ${n.phoneE164} from this list entirely`}
                        aria-label={`Delete ${n.phoneE164}`}
                      >
                        <IconTrash size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="muted ta-caption-1 view-foot">
          <strong>Set someone to "Not assigned"</strong> to take a number off their account. Their
          account and everything on it is untouched — only who the agent answers as changes, and
          the number stays in this list ready to be given to someone else. The <strong>delete</strong>
          button is different: it removes the number from this list entirely, so the agent stops
          recognising it at all.
        </p>
      </section>
    </div>
  );
}
