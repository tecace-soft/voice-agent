import { useCallback, useEffect, useState } from "react";
import { listAccounts, listCallMinutes, listInboundCalls } from "../api/backend";
import type { AuthUser, CallMinutes, InboundCall, MailboxScope } from "../api/types";
import { accountErrorMessage } from "../auth";
import { BusinessCallsPanel } from "../components/BusinessCallsPanel";
import { CallList } from "../components/CallList";
import { TalkTimeCards } from "../components/TalkTime";
import { IconChevronLeft, IconPhone, IconUsers } from "../icons";

// Answered calls and talk time — always ONE business at a time, like the rest of the dashboard.
//
//   a customer                  -> their own business: talk time, then their calls
//   an admin, one business      -> that business, the same page the customer sees
//   an admin, every business    -> one collapsible panel per business, busiest first
//
// Every business keeps its own numbers and its own calls; nothing on this page ever blends two
// customers together. The business an admin is looking at lives in the URL, so a refresh stays put.

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
  const [customers, setCustomers] = useState<AuthUser[] | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    listAccounts()
      .then((all) => setCustomers(all.filter((u) => u.role !== "admin")))
      .catch(() => setCustomers([]));
  }, [isAdmin]);

  // A customer is always their own business; the backend pins them there whatever is asked for.
  if (!isAdmin) return <BusinessCalls />;

  // Until the accounts arrive there is no telling whether the URL names a customer, and rendering
  // every business first would flash the wrong page before snapping to the right one.
  if (customers === null) return <p className="muted ta-body-2">Loading…</p>;

  const viewing = customers.find((c) => c.email === scope) ?? null;
  if (!viewing) return <CallBoards customers={customers} scope={scope} onScope={onScope} />;
  return <BusinessCalls viewing={viewing} customers={customers} scope={scope} onScope={onScope} />;
}

// Who to show, for an admin. "Every business" opens the per-business panels.
function BusinessPicker({
  customers,
  scope,
  onScope,
}: {
  customers: AuthUser[];
  scope?: MailboxScope;
  onScope?: (next: MailboxScope) => void;
}) {
  if (customers.length === 0) return null;
  return (
    <label className="call-picker">
      <IconUsers size={14} />
      <select
        className="input"
        value={typeof scope === "string" ? scope : ""}
        onChange={(e) => onScope?.(e.target.value || undefined)}
        aria-label="Which business to show"
      >
        <option value="">Every business</option>
        {customers.map((c) => (
          <option key={c.id} value={c.email}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

// ONE business: its talk time, then its calls. `viewing` is set when an admin has picked someone;
// absent, it is the signed-in customer's own.
function BusinessCalls({
  viewing,
  customers = [],
  scope,
  onScope,
}: {
  viewing?: AuthUser;
  customers?: AuthUser[];
  scope?: MailboxScope;
  onScope?: (next: MailboxScope) => void;
}) {
  const [calls, setCalls] = useState<InboundCall[] | null>(null);
  const [minutes, setMinutes] = useState<CallMinutes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minutesError, setMinutesError] = useState<string | null>(null);
  const userId = viewing?.id;

  const loadCalls = useCallback(() => {
    listInboundCalls(userId)
      .then((rows) => {
        setCalls(rows);
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load calls.")));
  }, [userId]);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  useEffect(() => {
    let active = true;
    // Cleared first, so switching business never shows the previous one's figures under the new name.
    setMinutes(null);
    listCallMinutes(userId)
      .then(({ minutes: rows }) => {
        if (!active) return;
        setMinutes(rows[0] ?? null);
        setMinutesError(null);
      })
      .catch((e) => active && setMinutesError(accountErrorMessage(e, "Couldn't load talk time.")));
    return () => {
      active = false;
    };
  }, [userId]);

  if (error) return <p className="error ta-body-2">{error}</p>;

  return (
    <div className="view">
      {viewing && (
        <div className="viewing-as" role="status">
          <button type="button" className="btn btn-quiet" onClick={() => onScope?.(undefined)}>
            <IconChevronLeft size={14} />
            All businesses
          </button>
          <span className="ta-label-1">
            Showing <strong>{viewing.name}</strong>'s calls and talk time
          </span>
          <span className="ta-caption-2 muted">{viewing.email}</span>
        </div>
      )}

      {/* A talk-time failure is reported where the figures would be; the calls still load. */}
      {minutesError ? (
        <p className="error ta-body-2">{minutesError}</p>
      ) : (
        minutes && <TalkTimeCards minutes={minutes} />
      )}

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
          {viewing && <BusinessPicker customers={customers} scope={scope} onScope={onScope} />}
        </div>

        {calls === null ? (
          <p className="feedback-empty muted ta-body-2">Loading…</p>
        ) : (
          <CallList calls={calls} onDeleted={loadCalls} />
        )}
      </section>
    </div>
  );
}

// EVERY business, for an admin: one panel each, never one list of everyone's calls.
function CallBoards({
  customers,
  scope,
  onScope,
}: {
  customers: AuthUser[];
  scope?: MailboxScope;
  onScope?: (next: MailboxScope) => void;
}) {
  const [rows, setRows] = useState<CallMinutes[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listCallMinutes()
      .then(({ minutes }) => {
        if (!active) return;
        setRows(minutes);
        setError(null);
      })
      .catch((e) => active && setError(accountErrorMessage(e, "Couldn't load the businesses.")));
    return () => {
      active = false;
    };
  }, []);

  if (error) return <p className="error ta-body-2">{error}</p>;
  if (rows === null) return <p className="muted ta-body-2">Loading…</p>;

  const businesses = rows.filter((r) => r.userId !== null).length;

  return (
    <div className="view">
      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">Calls and talk time, by business</div>
            <div className="card-sub ta-caption-1">
              {businesses} {businesses === 1 ? "business" : "businesses"}, busiest this month first.
              Open one to see its talk time and the calls it answered — or pick a business to view
              it on its own.
            </div>
          </div>
          <BusinessPicker customers={customers} scope={scope} onScope={onScope} />
        </div>
        {rows.length === 0 && (
          <p className="feedback-empty muted ta-body-2">
            <IconPhone size={14} /> No businesses yet. Assign an agent number to a customer under
            Agent numbers, and their calls and talk time appear here.
          </p>
        )}
      </section>

      {rows.map((row) => (
        <BusinessCallsPanel key={row.userId ?? "unassigned"} minutes={row} onScope={onScope} />
      ))}
    </div>
  );
}
