import { useEffect, useState, type FormEvent } from "react";
import { acceptLink, inspectLink } from "../api/backend";
import { accountErrorMessage, useAuth } from "../auth";
import { IconVoicemail } from "../icons";

// Where an invite (`#/welcome?token=`) or a password reset (`#/reset?token=`) lands: choose a
// password and you're signed in. The token is taken out of the address bar the moment the page
// reads it, so it isn't left in history or a shared screenshot; a used or expired link says so.

/** The link's token and kind, if the address is one. Read once, then cleared. */
export function takeLinkFromHash(): { token: string; purpose: "invite" | "reset" } | null {
  const match = /^#\/(welcome|reset)\?(.*)$/.exec(window.location.hash);
  if (!match) return null;
  const token = new URLSearchParams(match[2]).get("token");
  if (!token) return null;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/`);
  return { token, purpose: match[1] === "reset" ? "reset" : "invite" };
}

const MIN_PASSWORD = 10;

export function WelcomePage({ token, onDone }: { token: string; onDone: () => void }) {
  const { adopt } = useAuth();
  const [who, setWho] = useState<{ purpose: "invite" | "reset"; name: string; email: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    inspectLink(token).then(setWho, () => setInvalid(true));
  }, [token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== again) return setError("The two passwords don't match.");
    setPending(true);
    try {
      const { user } = await acceptLink(token, password);
      adopt(user);
      onDone();
    } catch (e) {
      setError(accountErrorMessage(e, "That didn't work. The link may have expired."));
      setPending(false);
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
            <span className="brand-sub ta-caption-2">Voice agent</span>
          </span>
        </div>

        {invalid ? (
          <>
            <div className="login-head">
              <h1 className="ta-heading-2">This link has expired</h1>
              <p className="muted ta-body-2">
                It was already used, replaced by a newer one, or is too old. Ask for a new link, or sign in if you
                already chose a password.
              </p>
            </div>
            <button type="button" className="btn btn-primary btn-block" onClick={onDone}>
              Go to sign in
            </button>
          </>
        ) : (
          <>
            <div className="login-head">
              <h1 className="ta-heading-2">{who?.purpose === "reset" ? "Set a new password" : `Welcome${who ? `, ${who.name}` : ""}`}</h1>
              <p className="muted ta-body-2">
                {who
                  ? who.purpose === "reset"
                    ? `For ${who.email}. You'll be signed out everywhere else.`
                    : `Choose a password for ${who.email}. You'll sign in with it from now on.`
                  : "Checking your link…"}
              </p>
            </div>
            {error && (
              <p className="error ta-label-1" role="alert">
                {error}
              </p>
            )}
            <label className="field">
              <span className="field-label ta-caption-1">New password</span>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                required
                autoFocus
              />
            </label>
            <label className="field">
              <span className="field-label ta-caption-1">Type it again</span>
              <input
                className="input"
                type="password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                autoComplete="new-password"
                required
              />
            </label>
            <p className="muted ta-caption-1">At least {MIN_PASSWORD} characters.</p>
            <button type="submit" className="btn btn-primary btn-block" disabled={pending || !who}>
              {pending ? "Saving…" : "Save and sign in"}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
