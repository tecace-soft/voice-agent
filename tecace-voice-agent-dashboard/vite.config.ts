import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Dev server on 5175 (the admin dashboard uses 5173 and the transcribe dashboard 5174, so all
// three can run at once).
//
// /promo-api goes to voiceagent_promo's /api (PROMO_API_URL — server-side only, so no VITE_
// prefix; default a local `npm run dev` on :3000). Proxying rather than calling it cross-origin
// keeps the promo's httpOnly admin cookie same-origin with no change to the promo, and `vite
// preview` uses the same proxy. A deployed build needs that one path as a Vercel rewrite (added at
// first deploy — see README).
//
// Nothing else of the promo is proxied. The prospect-facing demo page (/c/<id>) stays on the promo
// and is only ever linked to (VITE_PUBLIC_DEMO_BASE_URL) — decided in stage 5. Promo HTML must not
// run on this origin: the dashboard's admin bearer token lives in localStorage here, and that page
// is public.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const promo = (env.PROMO_API_URL || "http://localhost:3000").replace(/\/$/, "");
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
  const proxy = {
    "/promo-api": {
      target: promo,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/promo-api/, "/api"),
    },
  };
  return {
    plugins: [react()],
    // Ported promo code imports "@/components/…", "@/lib/…" exactly as in its own repo; @/ is
    // src/demos, which mirrors the promo's layout. The regex only matches "@/" — never "@base-ui/…".
    resolve: {
      alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./src/demos/", import.meta.url)) }],
    },
    server: { port: 5175, proxy },
    preview: { proxy },
    // Shown on the "demo service unreachable" card in development, so a wrong target is obvious.
    define: { __PROMO_TARGET__: JSON.stringify(mode === "development" ? promo : "") },
  };
});
