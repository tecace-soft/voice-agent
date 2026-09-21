import { useEffect, useState } from "react";
import { listProspects, PromoError, type PromoProspect } from "../api";
import { PROSPECT_STATUS_LABEL } from "../prospectStatus";

// Every business with a demo link, read through the proxy. A stage-3 stand-in for the promo's
// Customers table: enough to prove the proxy, the cookie and the record-id route end to end.
export function DemoProspectsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [prospects, setProspects] = useState<PromoProspect[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listProspects()
      .then((list) => active && setProspects(list))
      .catch((err: unknown) => {
        if (!active) return;
        // A 401 is the gate's job (it swaps in the unlock card); anything else is shown here.
        if (err instanceof PromoError && err.kind === "locked") return;
        setError(err instanceof Error ? err.message : "Couldn't load prospects.");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b px-6 py-4">
        <h2 className="ta-headline-2 text-foreground">Prospects</h2>
        <p className="ta-caption-1 mt-1 text-muted-foreground">
          Every business with a demo link. Coming soon: the full editor.
        </p>
      </header>
      {error ? (
        <p role="alert" className="ta-body-2 px-6 py-4 text-destructive">
          {error}
        </p>
      ) : !prospects ? (
        <p className="ta-body-2 px-6 py-4 text-muted-foreground">Loading prospects…</p>
      ) : prospects.length === 0 ? (
        <p className="ta-body-2 px-6 py-4 text-muted-foreground">No prospects yet.</p>
      ) : (
        <ul>
          {prospects.map((p) => (
            <li key={p.id} className="border-t first:border-t-0">
              <button
                type="button"
                onClick={() => onOpen(p.id)}
                className="flex w-full items-center justify-between gap-4 px-6 py-3 text-left transition-colors hover:bg-accent"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="ta-label-1 truncate text-foreground">{p.profile.name || p.businessName}</span>
                  <span className="ta-caption-1 text-muted-foreground">{p.profile.category || "No category yet"}</span>
                </span>
                <span className="ta-caption-1 shrink-0 text-muted-foreground">{PROSPECT_STATUS_LABEL[p.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
