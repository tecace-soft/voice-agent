import { useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { usePromoAuth } from "./PromoAuth";
import { UnlockCard } from "./UnlockCard";

// Everything in the Demos section renders through here: it asks the promo on the first visit and
// shows the unlock card, an "unreachable" card, or the view. It is also the `.tw` boundary — the
// promo's Tailwind styling applies inside this element and nowhere else. The wrapper itself stays
// bare (inside @scope a utility can't style the scope root).
export function DemosGate({ children }: { children: ReactNode }) {
  const { state, recheck } = usePromoAuth();

  useEffect(() => {
    if (state === "idle") recheck();
  }, [state, recheck]);

  return (
    <div className="tw">
      {(state === "idle" || state === "checking") && (
        <p className="ta-body-2 text-muted-foreground">Checking the demo service…</p>
      )}
      {state === "locked" && <UnlockCard />}
      {state === "unreachable" && (
        <section className="max-w-lg rounded-xl border bg-card p-6">
          <h2 className="ta-headline-1 text-foreground">Demo service unreachable</h2>
          <p className="ta-body-2 mt-1 text-muted-foreground">
            The demos come from the promo app, and it didn't answer. Check that it's running, then
            try again.
          </p>
          {__PROMO_TARGET__ && (
            <p className="ta-caption-1 mt-2 text-muted-foreground">
              Dev proxy target: {__PROMO_TARGET__} (set PROMO_API_URL to change it)
            </p>
          )}
          <button
            type="button"
            onClick={recheck}
            className="ta-label-1 mt-4 h-10 rounded-lg border px-4 text-foreground transition-colors hover:bg-accent"
          >
            Try again
          </button>
        </section>
      )}
      {state === "unlocked" && (
        // The promo's pages are fragments that relied on their layout's `flex-col gap` — this is it.
        // The toaster lives here, inside .tw, so toasts get the promo styling and only exist on
        // Demos views. It sits after the flex column, not in it: sonner renders a zero-height
        // <section> that would otherwise be one more flex child and add a gap at the bottom.
        <>
          <div className="flex flex-col gap-4 md:gap-6">{children}</div>
          <Toaster position="bottom-right" />
        </>
      )}
    </div>
  );
}
