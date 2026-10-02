import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  assignAgentNumber,
  buyAgentNumber,
  createAccount,
  declineGoLive,
  getReadiness,
  goLiveAccount,
  inviteAccount,
  listAccounts,
  listAgentNumbers,
  promoteAccount,
  removeAccount,
  resetAccountPassword,
  revokeAccountSessions,
  setAccountBusiness,
  setAccountRole,
  setAccountStatus,
  type Readiness,
} from "../api/backend";
import { ACCOUNT_STATUS_LABEL, type AccountStatus, type AgentNumber, type AuthUser, type Role } from "../api/types";
import { demoFetch } from "../demos/api";
import { readJson } from "../demos/lib/http";
import { accountErrorMessage } from "../auth";
import { forgetAccountNames } from "../people";
import {
  IconCopy,
  IconKey,
  IconPlus,
  IconPresentation,
  IconSignOut,
  IconTrash,
  IconUsers,
} from "../icons";
import { formatDateTime, formatPhone } from "../lib";

// Who can sign in to the dashboard, and what each of them may do. Admins only — the sidebar hides
// this page from a `user`, and the backend refuses their requests regardless.

const MIN_PASSWORD = 10;

// Up to two initials ("Jane Kim" -> "JK"), matching the sidebar's avatar.
function initials(user: AuthUser): string {
  const parts = (user.name.trim() || user.email).split(/[\s@._-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join("") || "?").toUpperCase();
}

// A generated password is shown exactly once — the backend only keeps the hash — so it gets a
// callout of its own with a copy button rather than a toast that can be missed.
function PasswordNotice({
  email,
  password,
  endsYourSession,
  onDismiss,
  onSignOut,
}: {
  email: string;
  password: string;
  endsYourSession: boolean;
  onDismiss: () => void;
  onSignOut: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false); // clipboard blocked — the password is on screen to copy by hand
    }
  }

  return (
    <div className="notice" role="status">
      <div className="notice-body">
        <div className="ta-label-1 notice-title">Password for {email}</div>
        <code className="secret">{password}</code>
        <div className="ta-caption-1 muted">
          Shown once — copy it now. It can be reset later, but never read back.
          {endsYourSession ? " Because this is your own account, you're signed out here too." : ""}
        </div>
      </div>
      <div className="notice-actions">
        <button type="button" className="btn btn-quiet" onClick={copy}>
          <IconCopy size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
        {endsYourSession ? (
          <button type="button" className="btn btn-primary" onClick={onSignOut}>
            Sign in again
          </button>
        ) : (
          <button type="button" className="btn btn-quiet" onClick={onDismiss}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}

// A sign-in link: the customer opens it and chooses their own password (7 days, once). Emailed too
// when this deployment can send email; the admin can always copy it.
function LinkNotice({ email, link, emailed, onDismiss }: { email: string; link: string; emailed: boolean; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="notice" role="status">
      <div className="notice-body">
        <div className="ta-label-1 notice-title">Sign-in link for {email}</div>
        <code className="secret">{link}</code>
        <div className="ta-caption-1 muted">
          {emailed ? "We emailed it to them too. " : ""}It works once, for 7 days; a new link replaces this one.
        </div>
      </div>
      <div className="notice-actions">
        <button type="button" className="btn btn-quiet" onClick={copy}>
          <IconCopy size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onDismiss}>
          Done
        </button>
      </div>
    </div>
  );
}

// The Demos customers an account can be linked to: id and name only — this page has no use for a
// prospect's calls or engagement, and the list is a dropdown.
type DemoOption = { id: string; businessName: string };

// Production is not offered here: it switches a phone line on, so it has its own button (Go live)
// behind the readiness checklist. It still shows for an account that is already there.
const STAGES: AccountStatus[] = ["unassigned", "demo", "pre-production"];

/**
 * The Go live checklist for an account being set up (`GET /business/readiness?userId=`), and the
 * button that switches its line on. Read when the panel opens and again after a refused Go live,
 * so what it shows is what the backend just checked.
 *
 * The number is the one item the admin can tick from here: while it is missing, the checklist offers
 * a number from the pool or a new one from Twilio, assigned to this account in the same step. Going
 * live is where a business gets its number, so that is where the control is — not on a page the
 * admin has to remember to visit first.
 */
function GoLive({
  user,
  busy,
  onGoLive,
  onAnswered,
}: {
  user: AuthUser;
  busy: boolean;
  onGoLive: () => Promise<void>;
  /** After "not yet": the list re-reads, so the row's Go live requested pill goes. */
  onAnswered: () => void;
}) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    getReadiness(user.id)
      .then((next) => {
        setReadiness(next);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [user.id]);
  useEffect(load, [load]);

  const needsNumber = readiness?.items.some((item) => item.id === "number_assigned" && !item.ok) ?? false;
  // The business's "my part is done": what they asked, and the admin's two answers — Go live, or
  // "not yet" with a note they read on their settings.
  const request = readiness?.request ?? null;
  const [declining, setDeclining] = useState(false);
  const [declineNote, setDeclineNote] = useState("");
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function decline() {
    setSending(true);
    setDeclineError(null);
    try {
      await declineGoLive(user.id, declineNote.trim() || undefined);
      setDeclining(false);
      setDeclineNote("");
      load();
      onAnswered();
    } catch (e) {
      setDeclineError(accountErrorMessage(e, "Couldn't send that."));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="lifecycle-note readiness" aria-label="Go live checklist">
      {request && (
        <p className="ta-label-1 golive-request" role="status">
          Go live requested on {formatDateTime(request.requestedAt)}
          {request.note ? <span className="muted"> · “{request.note}”</span> : null}
        </p>
      )}
      {!request && readiness?.declined && (
        <p className="ta-caption-1 muted">
          You said not yet on {formatDateTime(readiness.declined.declinedAt)}
          {readiness.declined.note ? `: “${readiness.declined.note}”` : "."}
        </p>
      )}
      <span className="field-label ta-caption-1">Go live checklist</span>
      {failed ? (
        <p className="ta-caption-1 muted">Couldn't read the checklist.</p>
      ) : readiness === null ? (
        <p className="ta-caption-1 muted">Checking…</p>
      ) : (
        <ul className="readiness-list">
          {readiness.items.map((item) => (
            <li
              key={item.id}
              className={`ta-label-1 ${item.ok ? "is-ok" : item.required ? "is-missing" : "is-advice"}`}
            >
              <span aria-hidden>{item.ok ? "✓" : item.required ? "✕" : "!"}</span>
              <span>
                {item.label}
                {!item.required && !item.ok ? " (recommended)" : ""}
                {item.detail ? <span className="muted"> · {item.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {needsNumber && <AssignNumber user={user} busy={busy} onDone={load} />}
      <div className="inline-form-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !readiness?.ready}
          title={readiness?.ready ? "Switch this business's phone line on" : "Tick every required item first"}
          onClick={() => void onGoLive().finally(load)}
        >
          Go live
        </button>
        {request && (
          <button type="button" className="btn" disabled={busy || sending} onClick={() => setDeclining((open) => !open)}>
            Not yet
          </button>
        )}
      </div>
      {request && declining && (
        <div className="inline-form lifecycle-assign" role="group" aria-label="Not yet">
          <label className="field">
            <span className="field-label ta-caption-1">Note to the business (optional)</span>
            <input
              className="input"
              value={declineNote}
              maxLength={1000}
              onChange={(e) => setDeclineNote(e.target.value)}
              placeholder="For example: add a transfer number first."
              disabled={sending}
            />
          </label>
          <div className="inline-form-actions">
            <button type="button" className="btn btn-primary" disabled={sending} onClick={() => void decline()}>
              {sending ? "Sending…" : "Send not yet"}
            </button>
          </div>
          {declineError && <p className="error ta-caption-1 lifecycle-note">{declineError}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Give this account a number: one already in the pool (registered or bought, unassigned), or a new one
 * bought from Twilio right now. Either way the backend writes the number's webhooks as part of it, so
 * the next item on the checklist — Twilio sends calls to the receptionist — ticks in the same move.
 */
function AssignNumber({ user, busy, onDone }: { user: AuthUser; busy: boolean; onDone: () => void }) {
  const [pool, setPool] = useState<AgentNumber[] | null>(null);
  const [picked, setPicked] = useState("");
  const [buying, setBuying] = useState(false);
  const [kind, setKind] = useState<"local" | "tollfree">("tollfree");
  const [areaCode, setAreaCode] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per purchase intent (see BuyCard on the Numbers page): a retried click finds the number the
  // first attempt bought and assigned, instead of buying another.
  const requestId = useRef(crypto.randomUUID());

  // Re-read after every attempt, not only the first paint: a refusal such as "already has a number"
  // or "that number was released" means the pool on screen is no longer the pool.
  const loadPool = useCallback(() => {
    let active = true;
    listAgentNumbers()
      .then((numbers) => active && setPool(numbers.filter((n) => !n.userId)))
      .catch(() => active && setPool([]));
    return () => {
      active = false;
    };
  }, []);
  useEffect(loadPool, [loadPool]);

  async function run(fallback: string, action: () => Promise<void>) {
    setWorking(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (e) {
      setError(accountErrorMessage(e, fallback));
      loadPool();
    } finally {
      setWorking(false);
    }
  }

  const disabled = busy || working;

  return (
    <div className="inline-form lifecycle-assign" role="group" aria-label="Assign a number">
      <label className="field">
        <span className="field-label ta-caption-1">Number from the pool</span>
        <select
          aria-label="Number from the pool"
          className="input"
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          disabled={disabled || pool === null}
        >
          <option value="">{pool === null ? "Loading…" : pool.length ? "Choose a number" : "No unassigned numbers"}</option>
          {(pool ?? []).map((n) => (
            <option key={n.id} value={n.id}>
              {formatPhone(n.phoneE164)}
              {n.label ? ` · ${n.label}` : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="inline-form-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || !picked}
          onClick={() => void run("Couldn't assign that number.", async () => {
            await assignAgentNumber(picked, user.id);
          })}
        >
          Assign
        </button>
        <button type="button" className="btn" disabled={disabled} onClick={() => setBuying((open) => !open)}>
          Buy a new number
        </button>
      </div>
      {buying && (
        <div className="inline-form lifecycle-buy" role="group" aria-label="Buy a new number">
          <label className="field">
            <span className="field-label ta-caption-1">Kind</span>
            <select aria-label="Kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as "local" | "tollfree")} disabled={disabled}>
              <option value="tollfree">Toll-free (recommended)</option>
              <option value="local">Local</option>
            </select>
          </label>
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
          <div className="inline-form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={disabled}
              onClick={() => void run("Couldn't buy a number.", async () => {
                await buyAgentNumber({
                  type: kind,
                  ...(areaCode.trim() ? { areaCode: areaCode.trim() } : {}),
                  assignTo: user.id,
                  requestId: requestId.current,
                });
                requestId.current = crypto.randomUUID();
                setBuying(false);
              })}
            >
              Buy and assign
            </button>
          </div>
          <p className="ta-caption-1 muted lifecycle-note">
            Bought from Twilio and billed monthly from now. Toll-free is recommended: texting from it later takes one
            form, and callers never see this number — they dial the business's own, which forwards to it.
          </p>
        </div>
      )}
      {error && (
        <p className="error ta-label-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Where a customer is in their life, for one account.
 *
 * The three controls are three decisions, kept apart on purpose. Linking says which Demos customer
 * this account grew out of and changes nothing anyone hears. The stage says what they see. The copy
 * is the one-way door: it writes the demo's knowledge and prompts into the customer's own Business
 * information, once, and from then on the two are unrelated — editing either leaves the other alone.
 */
function LifecyclePanel({
  user,
  demos,
  busy,
  onLink,
  onStage,
  onPromote,
  onGoLive,
  onAnswered,
}: {
  user: AuthUser;
  demos: DemoOption[] | null;
  busy: boolean;
  onLink: (businessId: string | null) => void;
  onStage: (status: AccountStatus) => void;
  onPromote: () => void;
  onGoLive: () => Promise<void>;
  onAnswered: () => void;
}) {
  const linked = demos?.find((d) => d.id === user.businessId) ?? null;
  return (
    <div className="inline-form" role="group" aria-label={`Lifecycle for ${user.name}`}>
      <label className="field">
        <span className="field-label ta-caption-1">Demo customer</span>
        {/* Named explicitly: a wrapping <label> lends its text to the control, but a <select> also
            contributes its selected option, so the name a screen reader reads would be
            "Demo customer Not linked" rather than the field's own name. */}
        <select
          aria-label="Demo customer"
          className="input"
          value={user.businessId ?? ""}
          disabled={busy || demos === null}
          onChange={(e) => onLink(e.target.value || null)}
        >
          <option value="">Not linked</option>
          {/* A link this account already has but the list no longer contains — a deleted demo —
              still shows, so it can be seen and cleared rather than reading "Not linked". */}
          {user.businessId && !linked && (
            <option value={user.businessId}>{user.businessId} (missing)</option>
          )}
          {(demos ?? []).map((demo) => (
            <option key={demo.id} value={demo.id}>
              {demo.businessName}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label ta-caption-1">Stage</span>
        <select
          aria-label="Stage"
          className="input"
          value={user.status}
          disabled={busy}
          onChange={(e) => onStage(e.target.value as AccountStatus)}
        >
          {STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {ACCOUNT_STATUS_LABEL[stage]}
            </option>
          ))}
          {user.status === "production" && (
            <option value="production">{ACCOUNT_STATUS_LABEL.production}</option>
          )}
        </select>
      </label>
      <div className="inline-form-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onPromote}
          disabled={busy || !user.businessId}
          title={
            user.businessId
              ? "Copy this demo's knowledge and prompts into their own Business information, once"
              : "Link a demo customer first"
          }
        >
          Copy demo into their business
        </button>
      </div>
      <p className="ta-caption-1 muted lifecycle-note">
        Copying happens once. After it, their Business information is theirs: changes there do not
        reach the demo, and changes to the demo do not reach their receptionist.
      </p>
      {user.status === "pre-production" && <GoLive user={user} busy={busy} onGoLive={onGoLive} onAnswered={onAnswered} />}
    </div>
  );
}

export function AccountsPage({ me, onSignOut }: { me: AuthUser; onSignOut: () => void }) {
  const [users, setUsers] = useState<AuthUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");

  const [secret, setSecret] = useState<{ email: string; password: string; self: boolean } | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  // Which account's lifecycle row is open, and the Demos customers it can be linked to. That list is
  // fetched once: it is a dropdown, and this page is not where prospects are managed.
  const [managing, setManaging] = useState<string | null>(null);
  const [demos, setDemos] = useState<DemoOption[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [signInLink, setSignInLink] = useState<{ email: string; link: string; emailed: boolean } | null>(null);
  // Set once an action has invalidated our own session; further calls would only 401.
  const [sessionEnded, setSessionEnded] = useState(false);

  const load = useCallback(() => {
    // Anything this page changes can rename or remove someone, so the shared email -> name lookup
    // the rest of the dashboard reads from is dropped and rebuilt on the next view.
    forgetAccountNames();
    listAccounts()
      .then((list) => {
        setUsers(list);
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load the accounts.")));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    demoFetch("/customers")
      .then((response) => readJson<{ customers: DemoOption[] }>(response))
      .then((payload) => {
        if (!active) return;
        setDemos(
          payload.customers
            .map((c) => ({ id: c.id, businessName: c.businessName }))
            .sort((a, b) => a.businessName.localeCompare(b.businessName)),
        );
      })
      // An empty list is honest here: the dropdown reads "Not linked" and the stage control still
      // works. Failing the whole page over a dropdown would be worse.
      .catch(() => active && setDemos([]));
    return () => {
      active = false;
    };
  }, []);

  // Mirrors the backend's "last admin" rule so the button is disabled rather than failing.
  const adminCount = users?.filter((u) => u.role === "admin").length ?? 0;

  // Anything done to your own account takes your session with it, so stop talking to the backend
  // and let the notice tell the person to sign in again.
  const afterAction = (targetId: string, endsSession: boolean) => {
    if (endsSession && targetId === me.id) setSessionEnded(true);
    else load();
  };

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    if (password && password.length < MIN_PASSWORD) {
      setError(`Passwords need at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createAccount(name, email, role, password || undefined);
      if (created.password) setSecret({ email: created.user.email, password: created.password, self: false });
      setName("");
      setEmail("");
      setPassword("");
      setRole("user");
      setAdding(false);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't add that account."));
    } finally {
      setBusy(false);
    }
  }

  async function onReset(user: AuthUser) {
    setBusy(true);
    setError(null);
    try {
      const result = await resetAccountPassword(user.id);
      if (result.password) {
        setSecret({ email: user.email, password: result.password, self: user.id === me.id });
      }
      afterAction(user.id, true);
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't reset that password."));
    } finally {
      setBusy(false);
    }
  }

  // Promoting or demoting takes effect on that person's next request — no re-login needed, because
  // the backend reads the role from the database each time.
  async function onChangeRole(user: AuthUser, next: Role) {
    setBusy(true);
    setError(null);
    try {
      await setAccountRole(user.id, next);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't change that role."));
    } finally {
      setBusy(false);
    }
  }

  // ---- the lifecycle. Each of these re-reads the list rather than patching the row in place: the
  // stage and the link are what the backend stored, and a promotion changes both.
  async function onLink(user: AuthUser, businessId: string | null) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await setAccountBusiness(user.id, businessId);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't link that demo customer."));
    } finally {
      setBusy(false);
    }
  }

  async function onStage(user: AuthUser, status: AccountStatus) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await setAccountStatus(user.id, status);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't change that stage."));
    } finally {
      setBusy(false);
    }
  }

  async function onPromote(user: AuthUser) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await promoteAccount(user.id);
      setNote(
        `Copied into ${user.name}'s Business information. From here the two are separate — ` +
          "editing one leaves the other alone.",
      );
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't copy that demo over."));
    } finally {
      setBusy(false);
    }
  }

  async function onGoLive(user: AuthUser) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await goLiveAccount(user.id);
      setNote(`${user.name}'s phone line is on. Calls to their number now reach their receptionist.`);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't switch that line on."));
    } finally {
      setBusy(false);
    }
  }

  async function onInvite(user: AuthUser) {
    setBusy(true);
    setError(null);
    try {
      const made = await inviteAccount(user.id);
      setSignInLink({
        email: user.email,
        link: made.link ?? `${window.location.origin}/#/welcome?token=${made.token}`,
        emailed: made.emailed,
      });
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't make a sign-in link."));
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(user: AuthUser) {
    setBusy(true);
    setError(null);
    try {
      await revokeAccountSessions(user.id);
      if (user.id === me.id) onSignOut();
      else afterAction(user.id, false);
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't sign that account out."));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(user: AuthUser) {
    setBusy(true);
    setError(null);
    try {
      await removeAccount(user.id);
      setConfirmingRemove(null);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't remove that account."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view">
      {error && (
        <p className="error ta-body-2" role="alert">
          {error}
        </p>
      )}

      {note && (
        <p className="muted ta-body-2" role="status">
          {note}
        </p>
      )}

      {signInLink && (
        <LinkNotice
          email={signInLink.email}
          link={signInLink.link}
          emailed={signInLink.emailed}
          onDismiss={() => setSignInLink(null)}
        />
      )}

      {secret && (
        <PasswordNotice
          email={secret.email}
          password={secret.password}
          endsYourSession={secret.self}
          onDismiss={() => setSecret(null)}
          onSignOut={onSignOut}
        />
      )}

      {sessionEnded && !secret && (
        <p className="muted ta-body-2">
          Your own session ended with that change.{" "}
          <button type="button" className="link-button" onClick={onSignOut}>
            Sign in again
          </button>
        </p>
      )}

      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">Accounts</div>
            <div className="card-sub ta-caption-1">
              Everyone who can sign in to this dashboard{users ? ` · ${users.length}` : ""}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setAdding((open) => !open)}
            aria-expanded={adding}
            disabled={sessionEnded}
          >
            <IconPlus size={14} />
            Add user
          </button>
        </div>

        {adding && (
          <form className="inline-form" onSubmit={onAdd}>
            <label className="field">
              <span className="field-label ta-caption-1">Name</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                placeholder="Sam Lee"
              />
            </label>
            <label className="field">
              <span className="field-label ta-caption-1">Email</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span className="field-label ta-caption-1">Password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Leave blank to generate one"
              />
            </label>
            <label className="field">
              <span className="field-label ta-caption-1">Role</span>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="user">User — reads the dashboard</option>
                <option value="admin">Admin — also manages accounts</option>
              </select>
            </label>
            <div className="inline-form-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Adding…" : "Add user"}
              </button>
            </div>
          </form>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Stage</th>
                <th scope="col">Last sign-in</th>
                <th scope="col" className="actions-col">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users === null ? (
                <tr>
                  <td className="table-empty" colSpan={6}>
                    Loading…
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <Fragment key={user.id}>
                  <tr>
                    <td>
                      <span className="person">
                        <span className="avatar avatar-sm" aria-hidden="true">
                          {initials(user)}
                        </span>
                        <span className="user-name ta-label-1">{user.name}</span>
                        {user.id === me.id && <span className="badge badge-neutral">You</span>}
                      </span>
                    </td>
                    <td>{user.email}</td>
                    <td>
                      <span className={user.role === "admin" ? "badge badge-admin" : "badge badge-neutral"}>
                        {user.role === "admin" ? "Admin" : "User"}
                      </span>
                    </td>
                    <td>
                      {/* Only `demo` restricts anything, so it is the only stage worth colouring.
                          An account nobody has placed reads as plain text rather than a badge —
                          it is the absence of a decision, not a state. */}
                      {user.status === "unassigned" ? (
                        <span className="muted ta-caption-1">Not placed</span>
                      ) : (
                        <span
                          className={
                            user.status === "demo" ? "badge badge-admin" : "badge badge-neutral"
                          }
                        >
                          {ACCOUNT_STATUS_LABEL[user.status]}
                        </span>
                      )}
                      {user.status === "pre-production" && user.liveRequest && (
                        <span className="badge badge-admin golive-pill" title="They've asked for their line to be switched on">
                          Go live requested
                        </span>
                      )}
                      {user.businessId && (
                        <div className="ta-caption-1 muted">
                          {demos?.find((d) => d.id === user.businessId)?.businessName ??
                            user.businessId}
                        </div>
                      )}
                    </td>
                    <td>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Never"}</td>
                    <td className="actions-col">
                      {confirmingRemove === user.id ? (
                        <span className="row-actions">
                          <span className="ta-caption-1 muted">Remove {user.name}?</span>
                          <button
                            type="button"
                            className="btn btn-quiet"
                            onClick={() => setConfirmingRemove(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => void onRemove(user)}
                            disabled={busy}
                          >
                            Remove
                          </button>
                        </span>
                      ) : (
                        <span className="row-actions">
                          <button
                            type="button"
                            className="btn btn-quiet"
                            onClick={() => void onChangeRole(user, user.role === "admin" ? "user" : "admin")}
                            disabled={
                              busy || sessionEnded || (user.role === "admin" && adminCount <= 1)
                            }
                            title={
                              user.role === "admin" && adminCount <= 1
                                ? "This is the last admin — promote someone else first"
                                : user.role === "admin"
                                  ? "Take away account management"
                                  : "Let this person manage accounts"
                            }
                          >
                            <IconUsers size={14} />
                            {user.role === "admin" ? "Make user" : "Make admin"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-quiet"
                            onClick={() => void onReset(user)}
                            disabled={busy || sessionEnded}
                            title="Generate a new password (signs this account out everywhere)"
                          >
                            <IconKey size={14} />
                            Reset password
                          </button>
                          <button
                            type="button"
                            className="btn btn-quiet"
                            onClick={() => void onInvite(user)}
                            disabled={busy || sessionEnded}
                            title="A one-time link for them to choose their own password"
                          >
                            <IconCopy size={14} />
                            Sign-in link
                          </button>
                          <button
                            type="button"
                            className="btn btn-quiet"
                            onClick={() => void onRevoke(user)}
                            disabled={busy || sessionEnded}
                            title="Invalidate this account's sessions, keeping its password"
                          >
                            <IconSignOut size={14} />
                            Sign out
                          </button>
                          <button
                            type="button"
                            className="btn btn-quiet"
                            onClick={() => setManaging((open) => (open === user.id ? null : user.id))}
                            aria-expanded={managing === user.id}
                            disabled={busy || sessionEnded}
                            title="Link a demo customer, set the stage, copy the demo over"
                          >
                            <IconPresentation size={14} />
                            Stage
                          </button>
                          <button
                            type="button"
                            className="btn btn-quiet"
                            onClick={() => setConfirmingRemove(user.id)}
                            disabled={busy || sessionEnded || user.id === me.id}
                            title={
                              user.id === me.id
                                ? "You can't remove your own account"
                                : "Remove this account"
                            }
                          >
                            <IconTrash size={14} />
                            Remove
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                  {managing === user.id && (
                    <tr>
                      <td colSpan={6}>
                        <LifecyclePanel
                          user={user}
                          demos={demos}
                          busy={busy}
                          onLink={(businessId) => void onLink(user, businessId)}
                          onStage={(status) => void onStage(user, status)}
                          onPromote={() => void onPromote(user)}
                          onGoLive={() => onGoLive(user)}
                          onAnswered={load}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="muted ta-caption-1 view-foot">
        Admins manage accounts; users only read the dashboard. New accounts get a generated password
        unless you set one, and there is no public sign-up — this page and the backend CLI are the
        only ways in. Stage is separate from role: it says where a customer is in their life, and
        only the demo stage takes a section away.
      </p>
    </div>
  );
}
