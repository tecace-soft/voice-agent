import { useEffect, useState } from "react";
import { PhoneOff } from "lucide-react";
import { publicFetch } from "@/publicApi";
import { Toaster } from "@/components/ui/sonner";
import { resolveCallSound } from "@/lib/call-audio";
import { customerLink } from "@/lib/share";
import { LIVE_VOICE_OPTIONS } from "@/lib/types";
import type { BusinessProfile, CustomerPrompts, ResearchSource } from "@/lib/types";
import type { DemoAllowance } from "@/lib/analytics";
import { isPromoId } from "@/routes";
import { PublicDemoScreen } from "@/screens/PublicDemoScreen";
import { PublicPricingScreen } from "@/screens/PublicPricingScreen";
import { PublicScenariosScreen } from "@/screens/PublicScenariosScreen";

// The prospect's side of the app, and the only thing `c.html` loads.
//
// It is a separate document from the dashboard on purpose, not a view inside it:
//
//  * it cannot be reached from the Demos tabs, because it is not one of them — there is no ViewId,
//    no PATHS entry and no sidebar item to add by accident;
//  * a prospect never downloads the admin bundle. Nothing reachable from here imports
//    `api/backend.ts`, `auth.tsx` or `App.tsx`. To be exact about what that buys: the two documents
//    share an origin, so any script on it could read `localStorage` whatever was bundled — what this
//    gets is a smaller bundle and a graph that can be checked, which `tests/public-entry.test.ts`
//    does. A real boundary would be a separate origin;
//  * the links are real paths (`/c/<id>`), which is what an emailed link has to be — the dashboard's
//    own router is hash-based and `#/c/<id>` is not a link you send anyone.
//
// `vercel.json` sends `/c/*` here; `vite.config.ts` builds it as a second entry.

/** The demo, as `GET /demo/public/customers/:id` sends it. */
type PublicCustomer = {
  customerId: string;
  name: string;
  category?: string;
  address?: string;
  phone?: string;
  agentName: string;
  language?: string;
  callSound?: Parameters<typeof resolveCallSound>[0];
  voice: string;
  profile: BusinessProfile;
  prompts: Pick<CustomerPrompts, "live" | "backend" | "greeting">;
  dossier: string;
  sources: ResearchSource[];
  researchedAt?: string;
  demo: DemoAllowance;
};

type Page = "demo" | "scenarios" | "pricing";

/**
 * Which demo, and which of its three pages — read from the path rather than a hash.
 *
 * Anything that is not one of the three shapes is not a demo link, and is treated as one that does
 * not exist. The id is checked against `isPromoId` before it can be spliced into an API path, for
 * the same reason `routes.ts` checks it there: `/c/..%2F..%2Fanalytics` must not become a request to
 * a route this page has no business reading.
 */
export function parsePath(pathname: string): { id: string; page: Page } | null {
  const parts = pathname.split("/").filter(Boolean);
  const [c, rawId, rest, extra] = parts;
  if (c !== "c" || !rawId || extra !== undefined) return null;

  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return null; // a malformed escape is not an id
  }
  if (!isPromoId(id)) return null;

  if (rest === undefined) return { id, page: "demo" };
  if (rest === "scenarios") return { id, page: "scenarios" };
  if (rest === "pricing") return { id, page: "pricing" };
  return null;
}

/** The promo's `app/c/[id]/not-found.tsx`, word for word. */
function NotAvailable() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <PhoneOff className="size-6 text-muted-foreground" aria-hidden />
      <h1 className="ta-headline-1">This demo isn&apos;t available.</h1>
      <p className="ta-body-2 text-muted-foreground">
        The link may be paused or expired. Ask for a new one.
      </p>
    </main>
  );
}

/**
 * Nothing at all until the demo is known.
 *
 * Deliberately blank rather than a spinner or a skeleton of the page: the first thing a prospect
 * sees should be the business's own name, and a flash of scaffolding before it reads as a page that
 * is still being built. The read is one request against a primary key.
 */
function Loading() {
  return <main className="min-h-dvh" aria-busy="true" />;
}

export function PublicApp() {
  const route = parsePath(window.location.pathname);
  const [customer, setCustomer] = useState<PublicCustomer | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    route ? "loading" : "unavailable",
  );

  useEffect(() => {
    if (!route) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await publicFetch(`/customers/${encodeURIComponent(route.id)}`);
        if (cancelled) return;
        if (!response.ok) {
          // Every reason — paused, still being prepared, no such demo — is the same quiet page, as
          // the promo's `notFound()` was. The backend sends which it is; the page does not say,
          // because "paused" is the operator's word and means nothing to the business.
          setState("unavailable");
          return;
        }
        const data = (await response.json()) as { customer?: PublicCustomer };
        if (cancelled) return;
        if (!data.customer) {
          setState("unavailable");
          return;
        }
        setCustomer(data.customer);
        setState("ready");
      } catch {
        // The backend is unreachable. The prospect meets the quiet page rather than an error; the
        // operator finds the real reason in the logs.
        if (!cancelled) setState("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
    // The path does not change while this document is open: every link out of it is a real
    // navigation, so there is exactly one load per page view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The `.tw` boundary, as `DemosGate` is for the admin side: the promo's Tailwind is scoped to it
  // and does nothing outside. Unlike the admin side this is a whole page rather than a card on the
  // dashboard's canvas, so it paints its own background — see the note in styles/index.css.
  return (
    <div className="tw">
      <div className="bg-background text-foreground min-h-dvh">
        {state === "loading" ? <Loading /> : null}
        {state === "unavailable" || !customer ? (
          state === "loading" ? null : (
            <NotAvailable />
          )
        ) : (
          <Rendered customer={customer} page={route?.page ?? "demo"} />
        )}
      </div>
      <Toaster position="bottom-right" />
    </div>
  );
}

function Rendered({ customer, page }: { customer: PublicCustomer; page: Page }) {
  // Built here rather than sent by the server: this page's own address IS the demo link, so reading
  // it off `window.location` is both correct by construction and one less thing to configure. It is
  // what removed `VITE_PUBLIC_DEMO_BASE_URL`.
  const demoUrl = customerLink(customer.customerId);

  if (page === "scenarios") {
    return (
      <PublicScenariosScreen
        customerId={customer.customerId}
        name={customer.name}
        category={customer.category}
        agentName={customer.agentName}
        demoUrl={demoUrl}
      />
    );
  }

  if (page === "pricing") {
    return (
      <PublicPricingScreen
        customerId={customer.customerId}
        name={customer.name}
        agentName={customer.agentName}
        demoUrl={demoUrl}
      />
    );
  }

  // The two the promo's server component resolved before rendering. Both are client-side lists, so
  // the backend sends the raw `voice` and `callSound` and they are read against the same `lib/`
  // copies the admin side uses.
  const voice = LIVE_VOICE_OPTIONS.find((option) => option.id === customer.voice);

  return (
    <PublicDemoScreen
      customerId={customer.customerId}
      name={customer.name}
      category={customer.category}
      address={customer.address}
      phone={customer.phone}
      agentName={customer.agentName}
      language={customer.language}
      callSound={resolveCallSound(customer.callSound)}
      voiceLabel={voice ? `${voice.label}, ${voice.accent}` : customer.voice}
      profile={customer.profile}
      prompts={customer.prompts}
      dossier={customer.dossier}
      sources={customer.sources}
      researchedAt={customer.researchedAt}
      demo={customer.demo}
      demoUrl={demoUrl}
    />
  );
}
