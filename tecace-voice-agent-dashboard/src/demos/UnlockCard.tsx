import { useState, type FormEvent } from "react";
import { PromoError } from "./api";
import { usePromoAuth } from "./PromoAuth";

// One password field for the promo's own admin password. Success sets the promo's 7-day cookie on
// this origin, so it's asked for once per browser, not once per visit.
export function UnlockCard() {
  const { unlock } = usePromoAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
    } catch (err) {
      setError(
        err instanceof PromoError
          ? err.kind === "unreachable"
            ? "Couldn't reach the demo service. Try again in a moment."
            : err.message
          : "Something went wrong. Try again.",
      );
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-md rounded-xl border bg-card p-6">
      <h2 className="ta-headline-1 text-foreground">Unlock demos</h2>
      <p className="ta-body-2 mt-1 text-muted-foreground">
        The demos run on the promo app, which has its own admin password. Enter it once and it
        stays unlocked on this browser until you sign out (up to 7 days).
      </p>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
        {/* A hidden, read-only username field so password managers offer to save this as its own
            "promo-admin" credential instead of overwriting the dashboard login they already have. */}
        <input type="text" name="username" autoComplete="username" value="promo-admin" readOnly hidden />
        <label className="flex flex-col gap-1.5">
          <span className="ta-label-1 text-foreground">Promo password</span>
          <input
            type="password"
            name="promo-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="ta-body-2 h-10 rounded-lg border border-input bg-background px-3 text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </label>
        {error && (
          <p role="alert" className="ta-body-2 text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="ta-label-1 h-10 rounded-lg bg-primary px-4 text-primary-foreground transition-colors hover:bg-primary-strong disabled:opacity-50"
        >
          {busy ? "Unlocking…" : "Unlock demos"}
        </button>
      </form>
    </section>
  );
}
