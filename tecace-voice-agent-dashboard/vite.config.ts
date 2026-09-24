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
// Two entry documents. `index.html` is the dashboard; `c.html` is the prospect-facing demo page
// at /c/<id>, which this app now serves itself (it used to live on the promo and be linked to
// through VITE_PUBLIC_DEMO_BASE_URL — that variable is gone, and with it the link that silently
// pointed at this app's own sign-in when nobody set it).
//
// They are two documents rather than two routes for a reason: the demo page is public, so a
// prospect must not download the admin bundle. Nothing reachable from `src/public/main.tsx` imports
// the dashboard's auth, which is what keeps the session token in localStorage out of reach of the
// code that page runs. `vercel.json` sends /c/* to c.html.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // transcribe-backend's base URL, baked into the bundle at build time as __BACKEND_URL__.
  // Deliberately NOT a VITE_ name: Vite only exposes VITE_-prefixed vars to browser code, so this
  // is injected here instead — the deployment's env var is just BACKEND_URL. (It is still public:
  // the browser makes these calls, so the URL ships in the JS either way. The plain name only keeps
  // the build tool out of the deployment's settings.) VITE_BACKEND_URL is still read as a fallback,
  // because the regression harness builds the original transcribe-dashboard-app, which uses it.
  const backend = (env.BACKEND_URL || env.VITE_BACKEND_URL || "").replace(/\/$/, "");
  return {
    plugins: [react()],
    // Ported promo code imports "@/components/…", "@/lib/…" exactly as in its own repo; @/ is
    // src/demos, which mirrors the promo's layout. The regex only matches "@/" — never "@base-ui/…".
    resolve: {
      alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./src/demos/", import.meta.url)) }],
    },
    server: { port: 5175 },
    build: {
      rollupOptions: {
        // Named explicitly because adding one input replaces Vite's default of index.html alone.
        input: {
          index: fileURLToPath(new URL("./index.html", import.meta.url)),
          c: fileURLToPath(new URL("./c.html", import.meta.url)),
        },
      },
    },
    define: {
      __BACKEND_URL__: JSON.stringify(backend),
    },
  };
});
