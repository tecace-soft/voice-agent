import { useState, type FormEvent } from "react";
import { accountErrorMessage, useAuth } from "../auth";
import { IconVoicemail } from "../icons";

// Reached from the sign-in screen's "Create the first account" link, which only appears while the
// backend reports that no accounts exist. This is how the very first login gets created without
// anyone needing shell access; once it succeeds the route closes for good and everyone else is
// added from the Accounts page.
const MIN_PASSWORD = 10;

export function SetupPage({ onBack }: { onBack: () => void }) {
  const { createFirstAccount } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // The length and match rules are checked here rather than with `minLength` on the input, so both
  // failures are reported the same way instead of one as a native browser bubble.
  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for the password.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await createFirstAccount(name, email, password);
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't create the account. Try again."));
      setPending(false); // on success the app swaps this page out, so only reset on failure
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <IconVoicemail size={16} />
          </span>
          <span className="brand-text">
            <span className="brand-name">TecAce</span>
            <span className="brand-sub ta-caption-2">Transcribe</span>
          </span>
        </div>

        <div className="login-head">
          <h1 className="ta-heading-2">Create the first account</h1>
          <p className="muted ta-body-2">
            Nobody can sign in to this dashboard yet. This account gets in, and adds everyone else.
          </p>
        </div>

        {error && (
          <p className="error ta-label-1" role="alert">
            {error}
          </p>
        )}

        <label className="field">
          <span className="field-label ta-caption-1">Name</span>
          <input
            className="input"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            autoFocus
            required
            placeholder="Jane Kim"
          />
        </label>

        <label className="field">
          <span className="field-label ta-caption-1">Email</span>
          <input
            className="input"
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            placeholder="you@tecace.com"
          />
        </label>

        <label className="field">
          <span className="field-label ta-caption-1">Password</span>
          <input
            className="input"
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
          <span className="field-hint ta-caption-2 muted">At least {MIN_PASSWORD} characters.</span>
        </label>

        <label className="field">
          <span className="field-label ta-caption-1">Confirm password</span>
          <input
            className="input"
            type="password"
            name="confirmPassword"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>

        <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
          {pending ? "Creating…" : "Create account and sign in"}
        </button>

        <div className="login-alt">
          <button type="button" className="link-button ta-caption-1" onClick={onBack}>
            Back to sign in
          </button>
        </div>
      </form>
    </main>
  );
}
