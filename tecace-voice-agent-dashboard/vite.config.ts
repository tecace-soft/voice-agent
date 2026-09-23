import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Dev server on 5175 (the admin dashboard uses 5173 and the transcribe dashboard 5174, so all
// three can run at once).
//
// Nothing is proxied. The Demo screens used to reach voiceagent_promo through a /promo-api proxy;
// their data now lives in transcribe-db and transcribe-backend serves it under /demo/*, so they go
// straight to BACKEND_URL like every other screen.
//
// The prospect-facing demo page (/c/<id>) stays on the promo and is only ever linked to
// (VITE_PUBLIC_DEMO_BASE_URL) — decided in stage 5. Promo HTML must not run on this origin: the
// dashboard's admin bearer token lives in localStorage here, and that page is public.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // transcribe-backend's base URL, baked into the bundle at build time as __BACKEND_URL__.
  // Deliberately NOT a VITE_ name: Vite only exposes VITE_-prefixed vars to browser code, so this
  // is injected here instead — the deployment's env var is just BACKEND_URL. (It is still public:
  // the browser makes these calls, so the URL ships in the JS either way. The plain name only keeps
  // the build tool out of the deployment's settings.) VITE_BACKEND_URL is still read as a fallback,
  // because the regression harness builds the original transcribe-dashboard-app, which uses it.
  const backend = (env.BACKEND_URL || env.VITE_BACKEND_URL || "").replace(/\/$/, "");
  // The demo links the Prospects screen copies and emails (src/demos/lib/share.ts, kept verbatim)
  // fall back to this app's own origin without it — a link that opens the dashboard's sign-in, not
  // the demo. A warning, not a failure: compare.py and tw_probe.py build without it (demos_e2e.py sets it).
  if (command === "build" && !env.VITE_PUBLIC_DEMO_BASE_URL) {
    console.warn(
      "\n[warning] VITE_PUBLIC_DEMO_BASE_URL is not set: copied/emailed demo links will point at " +
        "this dashboard's own origin (its sign-in page), not the demo. Set it to the promo's " +
        "public origin (see README).\n",
    );
  }
  return {
    plugins: [react()],
    // Ported promo code imports "@/components/…", "@/lib/…" exactly as in its own repo; @/ is
    // src/demos, which mirrors the promo's layout. The regex only matches "@/" — never "@base-ui/…".
    resolve: {
      alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./src/demos/", import.meta.url)) }],
    },
    server: { port: 5175 },
    define: {
      __BACKEND_URL__: JSON.stringify(backend),
    },
  };
});
