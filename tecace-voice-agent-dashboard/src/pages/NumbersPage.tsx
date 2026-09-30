import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  assignAgentNumber,
  buyAgentNumber,
  configureAgentNumber,
  deleteAgentNumber,
  getNumberWebhooks,
  listAccounts,
  listAgentNumbers,
  releaseAgentNumber,
  searchAvailableNumbers,
  syncAgentNumbers,
} from "../api/backend";
import type { AgentNumber, AuthUser, AvailableNumber, NumberWebhooks } from "../api/types";
import { accountErrorMessage } from "../auth";
import { IconAlert, IconPhone, IconRefresh, IconTrash } from "../icons";
import { formatDateTime, formatPhone } from "../lib";

// Which phone number the voice agent answers for which customer, and what Twilio knows about each
// one. Admin only.
//
// Assigning a number is a different act from a customer editing their own business details, and
// carries different risk: get the details wrong and one company's blurb is off; get the number
// wrong and a stranger calling company A hears company B's facts read aloud. So this page is
// admins only, while the details themselves stay editable by the person they belong to.
//
// A number with no owner is not an error state to be hidden — it is the normal state between
// buying a line and assigning it, and it is exactly what an admin needs to see, because the agent
// answers those calls neutrally with no idea whose business it is.
//
// The Twilio side: the backend can bring the account's numbers in (sync), buy new ones, write each
// number's webhooks so a call reaches the receptionist, and let a number go. A number registered by
// hand before that existed is opaque until a sync matches it, and is deleted rather than released.

const KIND_LABEL = { local: "Local", tollfree: "Toll-free" } as const;

/** The webhook column, as a badge: what Twilio has against what the backend wants. */
function WebhookBadge({ number }: { number: AgentNumber }) {
  if (!number.twilioSid) {
    return (
      <span className="badge badge-neutral" title="Not matched to the Twilio account; sync to check it">
        Registered by hand
      </span>
    );
  }
  switch (number.webhookState) {
    case "ok":
      return <span className="badge badge-success">Configured</span>;
    case "stale":
      return (
        <span className="badge badge-warning" title="Twilio points this number somewhere else; Configure repairs it">
          Out of date
        </span>
      );
    case "error":
      return (
        <span className="badge badge-danger" title={number.webhookError ?? undefined}>
          Failed
        </span>
      );
    default:
      return <span className="badge badge-neutral">Not checked</span>;
  }
}

/**
 * Why a managed number isn't "Configured", in words: which of the three URLs Twilio has differs from
 * what the backend wants. Empty when there is nothing to say (configured, hand-registered, or the
 * backend didn't say what it wants).
 */
function webhookReasons(n: AgentNumber, wanted: NumberWebhooks | null): string[] {
  if (!n.twilioSid || n.webhookState === "ok" || !wanted?.voiceUrl) return [];
  if (n.webhookState === "error") return [n.webhookError ?? "Twilio refused the last change."];
  const reasons: string[] = [];
  if (n.voiceUrl !== wanted.voiceUrl) {
    reasons.push(n.voiceUrl ? `Calls go to ${hostOf(n.voiceUrl)}, not the receptionist` : "No voice URL — calls reach nobody");
  }
  if (n.voiceFallbackUrl !== wanted.voiceFallbackUrl) reasons.push("No fallback if the receptionist is down");
  if (n.statusCallbackUrl !== wanted.statusCallback) reasons.push("No call status reports");
  return reasons;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function NumbersPage() {
  const [numbers, setNumbers] = useState<AgentNumber[] | null>(null);
  const [released, setReleased] = useState<AgentNumber[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [webhooks, setWebhooks] = useState<NumberWebhooks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which number's release confirmation is open; the number has to be typed back.
  const [releasing, setReleasing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");

  const load = useCallback(() => {
    Promise.all([
      listAgentNumbers({ includeReleased: true }),
      listAccounts(),
      getNumberWebhooks().catch(() => null),
    ])
      .then(([all, u, w]) => {
        setNumbers(all.filter((n) => !n.releasedAt));
        setReleased(all.filter((n) => n.releasedAt));
        // Customers only. An admin is TecAce staff, not a business the agent answers for, so there
        // is nothing for it to say if a call came in on their line. The backend refuses it too —
        // this list is the convenience, that is the rule.
        setUsers(u.filter((x) => x.role !== "admin").sort((a, b) => a.name.localeCompare(b.name)));
        setWebhooks(w);
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load the agent's numbers.")));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Sync needs only credentials; buying, configuring and releasing also need the two origins the
  // webhooks are built from. `webhooks` null = the backend couldn't say (older backend, or the read
  // failed), and every Twilio action stays off rather than failing one by one.
  const canSync = webhooks?.twilio === true;
  const twilioReady = webhooks?.configured === true;
  const setupNotice =
    webhooks === null
      ? "Couldn't read whether Twilio is set up on this server, so syncing, buying, configuring and releasing are off for now. Assigning still works."
      : !webhooks.twilio
        ? "Twilio isn't set up on this server, so numbers already in the list can be assigned, but not synced, bought, configured or released. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (or TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET) on the backend."
        : !webhooks.webhooks
          ? "The backend has Twilio credentials but not the addresses its webhooks point at, so it can sync but not buy, configure or release. Set AGENT_PUBLIC_URL and PUBLIC_BACKEND_URL on the backend."
          : null;

  async function act(fallback: string, action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const said = await action();
      if (said) setNote(said);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  const onSync = () =>
    act("Couldn't sync with Twilio.", async () => {
      const result = await syncAgentNumbers();
      const missing = result.missing.length
        ? ` · ${result.missing.length} not in Twilio: ${result.missing.map(formatPhone).join(", ")}`
        : "";
      return `Synced ${result.twilioCount} ${result.twilioCount === 1 ? "number" : "numbers"} from Twilio (${result.added} new)${missing}`;
    });

  const onAssign = (id: string, userId: string) =>
    act("Couldn't assign that number.", async () => {
      await assignAgentNumber(id, userId || null);
      return null;
    });

  const onConfigure = (number: AgentNumber) =>
    act("Couldn't configure that number.", async () => {
      await configureAgentNumber(number.id);
      return `${formatPhone(number.phoneE164)} sends its calls to the receptionist.`;
    });

  const onRelease = (number: AgentNumber) =>
    act("Couldn't release that number.", async () => {
      await releaseAgentNumber(number.id, confirm.trim());
      setReleasing(null);
      setConfirm("");
      return `${formatPhone(number.phoneE164)} was released. Twilio stops billing it and it leaves this list.`;
    });

  const onDelete = (number: AgentNumber) => {
    if (!window.confirm(`Remove ${formatPhone(number.phoneE164)}? The agent will stop answering for it.`)) return;
    void act("Couldn't remove that number.", async () => {
      await deleteAgentNumber(number.id);
      return null;
    });
  };

  const onBought = (number: AgentNumber) => {
    setNote(`Bought ${formatPhone(number.phoneE164)}. It's in the list below, ready to be assigned.`);
    load();
  };

  // Every managed number whose webhooks aren't what the backend wants, repaired one after another.
  // One at a time, so a refusal names its number and the ones before it are already fixed.
  const outOfDate = (numbers ?? []).filter((n) => n.twilioSid && (n.webhookState === "stale" || n.webhookState === "error"));
  const onConfigureAll = () =>
    act("Couldn't configure every number.", async () => {
      for (const number of outOfDate) {
        try {
          await configureAgentNumber(number.id);
        } catch (e) {
          throw new Error(`${formatPhone(number.phoneE164)}: ${accountErrorMessage(e, "Twilio refused it.")}`);
        }
      }
      return `Configured ${outOfDate.length} ${outOfDate.length === 1 ? "number" : "numbers"}: calls reach the receptionist.`;
    });

  // Buying a released number back: Twilio sells it again only if nobody else has taken it — after a
  // release it may be held back for a while, and then it goes to whoever asks first.
  const onBuyBack = (number: AgentNumber) =>
    act("Couldn't buy that number back.", async () => {
      await buyAgentNumber({ phoneNumber: number.phoneE164, requestId: `buy-back-${number.id}-${number.releasedAt}` });
      return `${formatPhone(number.phoneE164)} is back, unassigned and configured.`;
    });

  const onForget = (number: AgentNumber) => {
    if (!window.confirm(`Forget ${formatPhone(number.phoneE164)}? It's already released; this only removes it from the list.`)) return;
    void act("Couldn't remove that number.", async () => {
      await deleteAgentNumber(number.id);
      return null;
    });
  };

  const unassigned = (numbers ?? []).filter((n) => !n.userId).length;

  return (
    <div className="view">
      <BuyCard enabled={twilioReady} busy={busy} onBought={onBought} onError={setError} />

      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">
              Numbers
              {unassigned > 0 && (
                <span className="badge badge-warning number-unassigned">
                  <IconAlert size={12} />
                  {unassigned} unassigned
                </span>
              )}
            </div>
            <div className="card-sub ta-caption-1">
              The Twilio account's numbers. When one rings, the agent answers as the customer it's
              assigned to; an unassigned number still rings, and the agent answers neutrally. Webhooks
              say whether Twilio sends the number's calls to the receptionist at all.
            </div>
          </div>
          <div className="number-toolbar-actions">
            {outOfDate.length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => void onConfigureAll()}
                disabled={busy || !twilioReady}
                title="Write the receptionist's webhooks onto every number that is out of date"
              >
                Configure {outOfDate.length} out of date
              </button>
            )}
            <button type="button" className="btn" onClick={onSync} disabled={busy || !canSync} title={canSync ? "Bring the Twilio account's numbers into this list" : "Twilio isn't set up on this server"}>
              <IconRefresh size={14} />
              Sync from Twilio
            </button>
          </div>
        </div>

        {(setupNotice || error || note) && (
          <div className="number-messages">
            {setupNotice && <p className="notice-slim ta-caption-1">{setupNotice}</p>}
            {error && (
              <p className="error ta-label-1" role="alert">
                {error}
              </p>
            )}
            {note && (
              <p className="ta-label-1 number-note" role="status">
                {note}
              </p>
            )}
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Type</th>
                <th scope="col">Label</th>
                <th scope="col">Answers as</th>
                <th scope="col">Webhooks</th>
                <th scope="col">Added</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {numbers === null ? (
                <tr>
                  <td className="table-empty" colSpan={7}>
                    Loading…
                  </td>
                </tr>
              ) : numbers.length === 0 ? (
                <tr>
                  <td className="table-empty" colSpan={7}>
                    No numbers yet. Sync the Twilio account or buy one.
                  </td>
                </tr>
              ) : (
                numbers.map((n) => (
                  <NumberRow
                    key={n.id}
                    number={n}
                    users={users}
                    reasons={webhookReasons(n, webhooks)}
                    busy={busy}
                    twilioReady={twilioReady}
                    releasing={releasing === n.id}
                    confirm={confirm}
                    onConfirmChange={setConfirm}
                    onAssign={(userId) => void onAssign(n.id, userId)}
                    onConfigure={() => void onConfigure(n)}
                    onStartRelease={() => {
                      setReleasing(n.id);
                      setConfirm("");
                    }}
                    onCancelRelease={() => setReleasing(null)}
                    onRelease={() => void onRelease(n)}
                    onDelete={() => onDelete(n)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="muted ta-caption-1 card-foot number-foot">
          <strong>Set someone to "Not assigned"</strong> to take a number off their account. Their
          account and everything on it is untouched — only who the agent answers as changes, and
          the number stays in this list ready to be given to someone else. <strong>Release</strong> gives a
          number bought here back to Twilio: it stops ringing and stops being billed, and it can't be undone.
          Numbers bought in the Twilio console are released there. <strong>Delete</strong> only forgets a
          number registered by hand.
        </p>
      </section>

      {released.length > 0 && (
        <section className="card">
          <details className="number-released">
            <summary className="card-head">
              <span>
                <span className="card-title ta-headline-2">Released numbers</span>
                <span className="card-sub ta-caption-1 number-released-sub">
                  {released.length} given back to Twilio. Buy back works only while Twilio still has the number
                  for sale — after a release it may be held for a while, and then it goes to whoever asks first.
                </span>
              </span>
            </summary>
            <ul className="number-results number-released-list" aria-label="Released numbers">
              {released.map((n) => (
                <li key={n.id}>
                  <span>
                    <span className="ta-label-1 number-cell">
                      <IconPhone size={14} />
                      {formatPhone(n.phoneE164)}
                    </span>
                    <span className="muted ta-caption-1 number-meta">
                      {n.label ? `${n.label} · ` : ""}released {formatDateTime(n.releasedAt!)}
                    </span>
                  </span>
                  <span className="row-actions">
                    <button type="button" className="btn" onClick={() => void onBuyBack(n)} disabled={busy || !twilioReady}>
                      Buy back
                    </button>
                    <button type="button" className="btn btn-quiet" onClick={() => onForget(n)} disabled={busy}>
                      Forget
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}

function NumberRow({
  number: n,
  users,
  reasons,
  busy,
  twilioReady,
  releasing,
  confirm,
  onConfirmChange,
  onAssign,
  onConfigure,
  onStartRelease,
  onCancelRelease,
  onRelease,
  onDelete,
}: {
  number: AgentNumber;
  users: AuthUser[];
  /** Why its webhooks aren't configured, one line each; empty when there's nothing to say. */
  reasons: string[];
  busy: boolean;
  twilioReady: boolean;
  releasing: boolean;
  confirm: string;
  onConfirmChange: (value: string) => void;
  onAssign: (userId: string) => void;
  onConfigure: () => void;
  onStartRelease: () => void;
  onCancelRelease: () => void;
  onRelease: () => void;
  onDelete: () => void;
}) {
  const shown = formatPhone(n.phoneE164);
  return (
    <>
      <tr>
        <td>
          <span className="number-cell">
            <IconPhone size={14} />
            {shown}
          </span>
        </td>
        <td className="muted">{n.numberType ? KIND_LABEL[n.numberType] : "—"}</td>
        <td className="muted">{n.label || "—"}</td>
        <td>
          <select
            className="input number-assign"
            value={n.userId ?? ""}
            onChange={(e) => onAssign(e.target.value)}
            aria-label={`Who ${shown} answers as`}
            disabled={busy}
          >
            <option value="">— Not assigned —</option>
            {/* A number assigned to an admin before this rule existed still has to render, or the
                row would silently show as unassigned and nobody could see what to fix. Shown,
                labelled, and re-assignable — just not re-selectable once changed. */}
            {n.userId && !users.some((u) => u.id === n.userId) && (
              <option value={n.userId}>{n.userName ?? n.userEmail} · admin — reassign to a customer</option>
            )}
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </td>
        <td>
          <WebhookBadge number={n} />
          {reasons.length > 0 && (
            <ul className="number-reasons ta-caption-2 muted">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </td>
        <td className="muted ta-caption-1">{formatDateTime(n.createdAt)}</td>
        <td className="num">
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={onConfigure}
              disabled={busy || !twilioReady}
              title={
                n.twilioSid
                  ? "Write the receptionist's webhooks onto this number at Twilio"
                  : "Look this number up in the Twilio account and, if it's there, write the webhooks"
              }
            >
              Configure
            </button>
            {n.twilioSid ? (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={onStartRelease}
                disabled={busy || !twilioReady || Boolean(n.userId) || !n.purchasedAt}
                title={
                  !n.purchasedAt
                    ? "Bought in the Twilio console, not here — release it there if it's really no longer needed"
                    : n.userId
                      ? "Un-assign it first"
                      : `Give ${shown} back to Twilio`
                }
              >
                Release
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={onDelete}
                disabled={busy}
                title={`Delete ${shown} from this list entirely`}
                aria-label={`Delete ${shown}`}
              >
                <IconTrash size={14} />
              </button>
            )}
          </div>
        </td>
      </tr>
      {releasing && (
        <tr>
          <td colSpan={7}>
            <div className="number-confirm" role="group" aria-label={`Release ${shown}`}>
              <label className="field">
                <span className="field-label ta-caption-1">Type the number to release it</span>
                <input
                  className="input"
                  value={confirm}
                  onChange={(e) => onConfirmChange(e.target.value)}
                  placeholder={n.phoneE164}
                  inputMode="tel"
                  autoFocus
                />
              </label>
              <button type="button" className="btn btn-danger" onClick={onRelease} disabled={busy || !confirm.trim()}>
                Release number
              </button>
              <button type="button" className="btn btn-quiet" onClick={onCancelRelease} disabled={busy}>
                Cancel
              </button>
              <span className="field-hint ta-caption-2 muted">
                Twilio stops billing it and callers get a disconnected tone. This can't be undone; the number goes back
                on sale.
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Buying: pick a kind and, for a local number, an area code; search; buy one of the results. Toll-free
 * is recommended because texting from it later needs one verification form, where a local number needs
 * per-business 10DLC registration — and callers never see the agent's area code anyway, since they dial
 * the business's own number, which forwards.
 */
function BuyCard({
  enabled,
  busy,
  onBought,
  onError,
}: {
  enabled: boolean;
  busy: boolean;
  onBought: (number: AgentNumber) => void;
  onError: (message: string | null) => void;
}) {
  const [kind, setKind] = useState<"local" | "tollfree">("tollfree");
  const [areaCode, setAreaCode] = useState("");
  const [label, setLabel] = useState("");
  const [results, setResults] = useState<AvailableNumber[] | null>(null);
  const [working, setWorking] = useState(false);
  // One id per purchase intent, not per click: a retry after a timeout must find the number the first
  // attempt bought rather than buy a second one. A new id only once a purchase has succeeded.
  const requestId = useRef(crypto.randomUUID());

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    onError(null);
    try {
      setResults(await searchAvailableNumbers({ type: kind, areaCode: areaCode.trim() || undefined }));
    } catch (e) {
      onError(accountErrorMessage(e, "Couldn't search Twilio for numbers."));
    } finally {
      setWorking(false);
    }
  }

  async function onBuy(candidate: AvailableNumber) {
    setWorking(true);
    onError(null);
    try {
      const bought = await buyAgentNumber({
        phoneNumber: candidate.phoneNumber,
        type: candidate.type,
        ...(label.trim() ? { label: label.trim() } : {}),
        requestId: requestId.current,
      });
      requestId.current = crypto.randomUUID();
      setResults(null);
      setLabel("");
      onBought(bought.number);
    } catch (e) {
      onError(accountErrorMessage(e, "Couldn't buy that number."));
    } finally {
      setWorking(false);
    }
  }

  const disabled = busy || working || !enabled;

  return (
    <section className="card" role="group" aria-label="Buy a number">
      <div className="card-head">
        <div>
          <div className="card-title ta-headline-2">Buy a number</div>
          <div className="card-sub ta-caption-1">
            A new line from Twilio, with its webhooks set as it's bought, so it rings the receptionist from the first
            call. It arrives unassigned; give it to a customer from the list below or from their Go live checklist.
            Toll-free is recommended: texting from it later takes one verification form, and callers never see
            this number anyway — they dial the business's own, which forwards here.
          </div>
        </div>
      </div>
      <form className="number-buy number-body" onSubmit={onSearch}>
        <fieldset className="number-kinds">
          <legend className="field-label ta-caption-1">Kind</legend>
          <label className="number-kind ta-label-1">
            <input type="radio" name="number-kind" checked={kind === "tollfree"} onChange={() => setKind("tollfree")} disabled={disabled} />
            Toll-free <span className="badge badge-admin badge-sm">Recommended</span>
          </label>
          <label className="number-kind ta-label-1">
            <input type="radio" name="number-kind" checked={kind === "local"} onChange={() => setKind("local")} disabled={disabled} />
            Local
          </label>
        </fieldset>
        <label className="field">
          <span className="field-label ta-caption-1">Area code (optional)</span>
          <input
            className="input"
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder={kind === "tollfree" ? "833" : "206"}
            inputMode="numeric"
            disabled={disabled}
          />
        </label>
        <label className="field">
          <span className="field-label ta-caption-1">Label (optional)</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Acme main line" disabled={disabled} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={disabled} title={enabled ? "Ask Twilio what it sells" : "Twilio isn't set up on this server"}>
          {working ? "Searching…" : "Search"}
        </button>
      </form>
      {results !== null && (
        <ul className="number-results" aria-label="Numbers for sale">
          {results.length === 0 ? (
            <li className="muted ta-caption-1">Twilio has nothing of that kind there right now. Try another area code.</li>
          ) : (
            results.map((candidate) => (
              <li key={candidate.phoneNumber}>
                <span>
                  <span className="ta-label-1 number-cell">
                    <IconPhone size={14} />
                    {formatPhone(candidate.phoneNumber)}
                  </span>
                  <span className="muted ta-caption-1 number-meta">
                    {KIND_LABEL[candidate.type]}
                    {candidate.locality ? ` · ${candidate.locality}${candidate.region ? `, ${candidate.region}` : ""}` : ""}
                    {candidate.capabilities.sms ? " · voice and text" : " · voice only"}
                  </span>
                </span>
                <button type="button" className="btn btn-primary" onClick={() => void onBuy(candidate)} disabled={disabled}>
                  Buy
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
