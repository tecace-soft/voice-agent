import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createAccount,
  listAccounts,
  removeAccount,
  resetAccountPassword,
  revokeAccountSessions,
} from "../api/backend";
import type { AuthUser } from "../api/types";
import { accountErrorMessage } from "../auth";
import { IconCopy, IconKey, IconPlus, IconSignOut, IconTrash } from "../icons";
import { formatDateTime } from "../lib";

// Who can sign in to the dashboard. Any signed-in person can manage this list — there are no roles,
// because everyone with an account here is already staff.

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

export function AccountsPage({ me, onSignOut }: { me: AuthUser; onSignOut: () => void }) {
  const [users, setUsers] = useState<AuthUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [secret, setSecret] = useState<{ email: string; password: string; self: boolean } | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  // Set once an action has invalidated our own session; further calls would only 401.
  const [sessionEnded, setSessionEnded] = useState(false);

  const load = useCallback(() => {
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
      const created = await createAccount(name, email, password || undefined);
      if (created.password) setSecret({ email: created.user.email, password: created.password, self: false });
      setName("");
      setEmail("");
      setPassword("");
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
            Add teammate
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
                placeholder="sam@tecace.com"
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
            <div className="inline-form-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Adding…" : "Add account"}
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
                <th scope="col">Last sign-in</th>
                <th scope="col" className="actions-col">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users === null ? (
                <tr>
                  <td className="table-empty" colSpan={4}>
                    Loading…
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id}>
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="muted ta-caption-1 view-foot">
        New accounts get a generated password unless you set one. There is no public sign-up — this
        page and the backend CLI are the only ways in.
      </p>
    </div>
  );
}
