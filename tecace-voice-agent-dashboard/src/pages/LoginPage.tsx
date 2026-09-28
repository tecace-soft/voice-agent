import { useState, type FormEvent } from "react";
import { forgotPassword } from "../api/backend";
import { signInErrorMessage, useAuth } from "../auth";
import { IconVoicemail } from "../icons";

// The whole app behind one form, and the screen everyone lands on. Accounts come from an admin, from
// the first-run link below (closed the moment any account exists), or — for customers — from signing
// up: claiming a demo from its page, or at /start (shown here when this deployment can send email).
export function LoginPage({
  needsSetup,
  onCreateFirstAccount,
}: {
  needsSetup: boolean;
  onCreateFirstAccount: () => void;
}) {
  const { signIn, mail, signupOpen } = useAuth();
  const [mode, setMode] = useState<"signin" | "forgot" | "sent">("signin");
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

  async function onForgot(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await forgotPassword(email.trim());
      setMode("sent");
    } catch (e) {
      setError(signInErrorMessage(e));
    } finally {
      setPending(false);
    }
  }

  const brand = (
    <div className="login-brand">
      <span className="brand-mark" aria-hidden="true">
        <IconVoicemail size={16} />
      </span>
      <span className="brand-text">
        <span className="brand-name">TecAce</span>
        <span className="brand-sub ta-caption-2">Transcribe</span>
      </span>
    </div>
  );

  if (mode !== "signin") {
    return (
      <main className="login-shell">
        <form className="login-card" onSubmit={onForgot}>
          {brand}
          <div className="login-head">
            <h1 className="ta-heading-2">Reset your password</h1>
            <p className="muted ta-body-2">
              {mode === "sent"
                ? `If ${email.trim()} has an account, a link to set a new password is on its way. It works for 60 minutes.`
                : "Enter your email and we'll send you a link to set a new password."}
            </p>
          </div>
          {error && (
            <p className="error ta-label-1" role="alert">
              {error}
            </p>
          )}
          {mode === "forgot" ? (
            <>
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
              <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
                {pending ? "Sending…" : "Send reset link"}
              </button>
            </>
          ) : null}
          <button type="button" className="btn btn-quiet btn-block" onClick={() => setMode("signin")}>
            Back to sign in
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        {brand}

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

        {mail ? (
          <button
            type="button"
            className="btn btn-quiet btn-block"
            onClick={() => {
              setError(null);
              setMode("forgot");
            }}
          >
            Forgot password?
          </button>
        ) : null}

        {needsSetup ? (
          <div className="login-alt">
            <p className="muted ta-caption-1">This dashboard has no accounts yet.</p>
            <button type="button" className="btn btn-quiet btn-block" onClick={onCreateFirstAccount}>
              Create the first account
            </button>
          </div>
        ) : signupOpen ? (
          <p className="login-foot muted ta-caption-1">
            New here? <a href="/start">Create your AI receptionist</a>
          </p>
        ) : (
          <p className="login-foot muted ta-caption-1">
            Need an account? Ask your TecAce admin to create one.
          </p>
        )}
      </form>
    </main>
  );
}
