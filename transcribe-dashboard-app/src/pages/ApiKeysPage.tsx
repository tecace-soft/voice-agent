import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createApiKey, deleteApiKey, listAccounts, listApiKeys, revokeApiKey } from "../api/backend";
import type { ApiKey, AuthUser } from "../api/types";
import { accountErrorMessage } from "../auth";
import { IconCopy, IconKey, IconPlus, IconTrash } from "../icons";
import { formatDateTime } from "../lib";

// Keys other systems use to read the usage endpoint. Admins only — a key is access to a customer's
// call data, so issuing one is an administrator's decision.
//
// A key is shown exactly once, here, at the moment it is created: the backend keeps only a hash, so
// a lost key is replaced rather than looked up. That is why it gets a callout of its own with a copy
// button, the same as a generated password.

function SecretNotice({ name, secret, onDismiss }: { name: string; secret: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false); // clipboard blocked — it is on screen to copy by hand
    }
  }

  return (
    <div className="notice" role="status">
      <div className="notice-body">
        <div className="ta-label-1 notice-title">Key for {name}</div>
        <code className="secret">{secret}</code>
        <div className="ta-caption-1 muted">
          Shown once — copy it now and send it to whoever is building the integration. It can be
          revoked and replaced, but never read back. It belongs in their server, never in a browser
          or an app.
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

function scopeOf(key: ApiKey): string {
  if (!key.userId) return "Every business";
  return key.businessName || key.userName || key.userEmail || "One business";
}

export function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [customers, setCustomers] = useState<AuthUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [secret, setSecret] = useState<{ name: string; secret: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([listApiKeys(), listAccounts()])
      .then(([list, accounts]) => {
        setKeys(list);
        // Only customers can be a key's scope: an admin account is staff, not a business.
        setCustomers(accounts.filter((a) => a.role !== "admin").sort((a, b) => a.name.localeCompare(b.name)));
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load the API keys.")));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createApiKey(name.trim(), userId || undefined);
      setSecret({ name: created.key.name, secret: created.secret });
      setName("");
      setUserId("");
      setAdding(false);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't create that key."));
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(key: ApiKey) {
    if (!window.confirm(`Revoke "${key.name}"? Anything using it stops working immediately.`)) return;
    setBusy(true);
    setError(null);
    try {
      await revokeApiKey(key.id);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't revoke that key."));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(key: ApiKey) {
    setBusy(true);
    setError(null);
    try {
      await deleteApiKey(key.id);
      setConfirmingDelete(null);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't remove that key."));
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
        <SecretNotice name={secret.name} secret={secret.secret} onDismiss={() => setSecret(null)} />
      )}

      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">API keys</div>
            <div className="card-sub ta-caption-1">
              Let another system read call minutes from this service. Each integration gets its own
              key, so one can be cut off without disturbing the rest.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setAdding((open) => !open)}
            aria-expanded={adding}
          >
            <IconPlus size={14} />
            New key
          </button>
        </div>

        {adding && (
          <form className="inline-form" onSubmit={onCreate}>
            <label className="field">
              <span className="field-label ta-caption-1">What is it for</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                placeholder="Billing app"
              />
              <span className="field-hint ta-caption-2 muted">
                A name you'll recognise later, when deciding whether it is still needed.
              </span>
            </label>
            <label className="field">
              <span className="field-label ta-caption-1">Can read</span>
              <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Every business</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="field-hint ta-caption-2 muted">
                Give a key one business unless it genuinely needs them all.
              </span>
            </label>
            <div className="inline-form-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
                {busy ? "Creating…" : "Create key"}
              </button>
            </div>
          </form>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Can read</th>
                <th scope="col">Key</th>
                <th scope="col">Created</th>
                <th scope="col">Last used</th>
                <th scope="col" className="actions-col">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {keys === null ? (
                <tr>
                  <td className="table-empty" colSpan={6}>
                    Loading…
                  </td>
                </tr>
              ) : keys.length === 0 ? (
                <tr>
                  <td className="table-empty" colSpan={6}>
                    No keys yet. Create one when another system needs to read call minutes.
                  </td>
                </tr>
              ) : (
                keys.map((key) => (
                  <tr key={key.id}>
                    <td>
                      <span className="user-name ta-label-1">{key.name}</span>
                      {key.revokedAt && <span className="badge badge-neutral">Revoked</span>}
                    </td>
                    <td>{scopeOf(key)}</td>
                    <td>
                      <code className="ta-caption-1">{key.keyPrefix}…</code>
                    </td>
                    <td>
                      {formatDateTime(key.createdAt)}
                      {key.createdBy && <div className="ta-caption-2 muted">by {key.createdBy}</div>}
                    </td>
                    <td>{key.lastUsedAt ? formatDateTime(key.lastUsedAt) : "Never"}</td>
                    <td className="actions-col">
                      {confirmingDelete === key.id ? (
                        <span className="row-actions">
                          <span className="ta-caption-1 muted">Remove “{key.name}”?</span>
                          <button type="button" className="btn btn-quiet" onClick={() => setConfirmingDelete(null)}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => void onDelete(key)}
                            disabled={busy}
                          >
                            Remove
                          </button>
                        </span>
                      ) : (
                        <span className="row-actions">
                          {!key.revokedAt && (
                            <button
                              type="button"
                              className="btn btn-quiet"
                              onClick={() => void onRevoke(key)}
                              disabled={busy}
                              title="Stop this key working, keeping the record of it"
                            >
                              <IconKey size={14} />
                              Revoke
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-quiet"
                            onClick={() => setConfirmingDelete(key.id)}
                            disabled={busy}
                            title="Delete the record entirely"
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
        A key is sent as <code>Authorization: Bearer ak_…</code> and reads only the call-minutes
        endpoint. It never expires — revoke it when the integration is retired. Keys belong on a
        server: anything in a browser or a mobile app is readable by whoever has the app.
      </p>
    </div>
  );
}
