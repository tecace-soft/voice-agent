import { useState, type FormEvent } from "react";
import { signInErrorMessage, useAuth } from "../auth";
import { IconVoicemail } from "../icons";

// The whole app behind one form, and the screen everyone lands on. There is no open sign-up: the
// only way through to creating an account is the first-run link below, which the backend closes the
// moment any account exists. Everyone after that is added by an admin.
export function LoginPage({
  needsSetup,
  onCreateFirstAccount,
}: {
  needsSetup: boolean;
  onCreateFirstAccount: () => void;
}) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(signInErrorMessage(e));
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
          <h1 className="ta-heading-2">Sign in</h1>
          <p className="muted ta-body-2">Voicemail transcription dashboard.</p>
        </div>

        {error && (
          <p className="error ta-label-1" role="alert">
            {error}
          </p>
        )}

        <label className="field">
          <span className="field-label ta-caption-1">Email</span>
          <input
            className="input"
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
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
            autoComplete="current-password"
            required
          />
        </label>

        <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>

        {needsSetup ? (
          <div className="login-alt">
            <p className="muted ta-caption-1">This dashboard has no accounts yet.</p>
            <button type="button" className="btn btn-quiet btn-block" onClick={onCreateFirstAccount}>
              Create the first account
            </button>
          </div>
        ) : (
          <p className="login-foot muted ta-caption-1">
            Need an account? Ask your TecAce admin to create one.
          </p>
        )}
      </form>
    </main>
  );
}
