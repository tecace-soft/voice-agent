import { useEffect, useState } from "react";
import { BackendError, connectTwilioNumber, listTwilioNumbers, registerAgentNumber } from "../api/backend";
import type { TwilioNumber, TwilioNumbersResponse } from "../api/types";
import { accountErrorMessage } from "../auth";
import { IconPhone } from "../icons";
import { formatPhone } from "../lib";

// The numbers on our Twilio account, above the Agent numbers list. Admin only (it lives on that page).
//
// Two separate facts per number, because both have to be true before a caller reaches a business:
// Twilio has to send the call to the agent (Agent column), and the number has to be in our list with
// an owner (In our list column), or the agent answers neutrally. Either can be fixed from this row.
//
// Twilio not being configured on the backend is a normal state for a deployment, not a failure, so
// it reads as a plain note and the rest of the page works as before.

const STATUS_BADGE: Record<TwilioNumber["status"], { label: string; className: string }> = {
  connected: { label: "Connected", className: "badge badge-success" },
  not_connected: { label: "Not connected", className: "badge badge-warning" },
  elsewhere: { label: "Points elsewhere", className: "badge badge-warning" },
};

export function TwilioNumbersCard({ reloadKey, onChanged }: { reloadKey: number; onChanged: () => void }) {
  const [data, setData] = useState<TwilioNumbersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySid, setBusySid] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listTwilioNumbers()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (alive) setError(accountErrorMessage(e, "Couldn't load the numbers on our Twilio account."));
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  async function onConnect(number: TwilioNumber) {
    setBusySid(number.sid);
    setError(null);
    try {
      try {
        await connectTwilioNumber(number.sid);
      } catch (e) {
        // Ringing some other webhook may be on purpose, so the backend asks first and names it.
        if (!(e instanceof BackendError && e.status === 409)) throw e;
        if (!window.confirm(e.message)) return;
        await connectTwilioNumber(number.sid, true);
      }
      onChanged();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't connect that number to the agent."));
    } finally {
      setBusySid(null);
    }
  }

  async function onAdd(number: TwilioNumber) {
    setBusySid(number.sid);
    setError(null);
    try {
      await registerAgentNumber(number.phoneE164, "");
      onChanged();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't add that number to the list."));
    } finally {
      setBusySid(null);
    }
  }

  const notConfigured = data?.configured === false;
  const canConnect = Boolean(data?.agentUrl);

  return (
    <section className="card twilio-numbers">
      <div className="card-head">
        <div>
          <div className="card-title ta-headline-2">On our Twilio account</div>
          <div className="card-sub ta-caption-1">
            Every number we own on Twilio. A number reaches a business when Twilio sends its calls to
            the agent and it's in the list below with someone assigned.
          </div>
        </div>
      </div>

      {notConfigured ? (
        <p className="muted ta-caption-1">
          Twilio isn't connected to the backend yet. Set TWILIO_ACCOUNT_SID and an API key on the
          backend to see our numbers here.
        </p>
      ) : (
        <>
          {error && (
            <p className="error ta-label-1" role="alert">
              {error}
            </p>
          )}
          {data && !canConnect && (
            <p className="muted ta-caption-1">
              The agent's address (AGENT_PUBLIC_URL) isn't set on the backend, so numbers can't be
              connected from here.
            </p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Number</th>
                  <th scope="col">Agent</th>
                  <th scope="col">In our list</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data === null ? (
                  <tr>
                    <td className="table-empty" colSpan={4}>
                      {error ? "—" : "Loading…"}
                    </td>
                  </tr>
                ) : data.numbers.length === 0 ? (
                  <tr>
                    <td className="table-empty" colSpan={4}>
                      No numbers on the Twilio account.
                    </td>
                  </tr>
                ) : (
                  data.numbers.map((n) => {
                    const badge = STATUS_BADGE[n.status];
                    const busy = busySid === n.sid;
                    return (
                      <tr key={n.sid}>
                        <td>
                          <span className="number-cell">
                            <IconPhone size={14} />
                            {formatPhone(n.phoneE164)}
                          </span>
                        </td>
                        <td>
                          <span className={badge.className} title={n.voiceUrl ?? "No voice URL set"}>
                            {badge.label}
                          </span>
                        </td>
                        <td className={n.registered?.userId ? undefined : "muted"}>
                          {!n.registered
                            ? "Not added"
                            : n.registered.userId
                              ? (n.registered.userName ?? n.registered.userEmail)
                              : "Not assigned"}
                        </td>
                        <td className="num">
                          <span className="twilio-actions">
                            {n.status !== "connected" && canConnect && (
                              <button type="button" className="btn" disabled={busy} onClick={() => onConnect(n)}>
                                Connect to agent
                              </button>
                            )}
                            {!n.registered && (
                              <button type="button" className="btn" disabled={busy} onClick={() => onAdd(n)}>
                                Add to list
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
