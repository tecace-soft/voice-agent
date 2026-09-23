import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";

// Everything in the Demos section renders through here. There is nothing to unlock any more: the
// demo data lives in transcribe-db behind this dashboard's own admin session, and the Demo group is
// already admin-only, so whoever can see these views is already allowed to read them.
//
// What is left is the `.tw` boundary — the promo's Tailwind styling applies inside this element and
// nowhere else — plus the flex column the promo's pages relied on, the toaster, and one error card
// for the case the screens themselves cannot report: `__BACKEND_URL__` was never set, so every
// request would go to this app's own origin and come back as the SPA's index.html.
export function DemosGate({ children }: { children: ReactNode }) {
  // A build-time constant, so this cannot change while the app is running.
  const configured = Boolean(__BACKEND_URL__);

  return (
    <div className="tw">
      {!configured ? (
        <section className="max-w-lg rounded-xl border bg-card p-6">
          <h2 className="ta-headline-1 text-foreground">Backend URL not set</h2>
          <p className="ta-body-2 mt-1 text-muted-foreground">
            The demos read from transcribe-backend, and this build has no backend URL baked into it.
            Set <code>BACKEND_URL</code> and rebuild.
          </p>
        </section>
      ) : (
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
