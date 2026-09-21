import { useEffect, useState } from "react";
import { getProspect, PromoError, type PromoProspect } from "../api";
import { PROSPECT_STATUS_LABEL } from "../prospectStatus";

// One prospect, addressed by id in the URL (#/demos/prospects/<id>) so it survives a refresh and
// can be linked. A stage-3 stand-in for the promo's customer detail page.
export function DemoProspectPage({ id, onBack }: { id: string; onBack: () => void }) {
  const [prospect, setProspect] = useState<PromoProspect | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setProspect(null);
    setError(null);
    getProspect(id)
      .then((p) => active && setProspect(p))
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof PromoError && err.kind === "locked") return; // the gate handles it
        setError(
          err instanceof PromoError && err.kind === "failed" && err.status === 404
            ? "That prospect doesn't exist."
            : err instanceof Error
              ? err.message
              : "Couldn't load this prospect.",
        );
      });
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="ta-label-1 self-start text-primary hover:underline">
        ← All prospects
      </button>
      <section className="rounded-xl border bg-card px-6 py-5">
        {error ? (
          <p role="alert" className="ta-body-2 text-destructive">
            {error}
          </p>
        ) : !prospect ? (
          <p className="ta-body-2 text-muted-foreground">Loading…</p>
        ) : (
          <>
            <h2 className="ta-title-3 text-foreground">{prospect.profile.name || prospect.businessName}</h2>
            <p className="ta-body-2 mt-1 text-muted-foreground">
              {prospect.profile.category || "No category yet"} · {PROSPECT_STATUS_LABEL[prospect.status]}
            </p>
            <p className="ta-caption-1 mt-4 text-muted-foreground">
              Coming soon: knowledge, prompts, sources, sharing and test calls.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
