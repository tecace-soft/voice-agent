import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Dev server on 5175 (the admin dashboard uses 5173 and the transcribe dashboard 5174, so all
// three can run at once).
//
// /promo-api goes to voiceagent_promo's /api (PROMO_API_URL — server-side only, so no VITE_
// prefix; default a local `npm run dev` on :3000). /promo-page/c/ goes to the promo's public demo
// page only — deliberately narrower than the whole app: this origin also holds the dashboard's
// admin bearer token in localStorage, so proxying the promo's own admin UI or API here (anything
// outside /c/) would put that token on the same origin as promo surfaces we don't control.
// Proxying rather than calling it cross-origin keeps the promo's httpOnly admin cookie same-origin
// with no change to the promo. `vite preview` uses the same proxy. A deployed build needs the same
// two paths as Vercel rewrites (added at first deploy — see README): /promo-api/:path* and, just
// as narrow, /promo-page/c/:path* — never a bare /promo-page/:path*.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const promo = (env.PROMO_API_URL || "http://localhost:3000").replace(/\/$/, "");
  const proxy = {
    "/promo-api": {
      target: promo,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/promo-api/, "/api"),
    },
    "/promo-page/c/": {
      target: promo,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/promo-page/, ""),
    },
  };
  return {
    plugins: [react()],
    server: { port: 5175, proxy },
    preview: { proxy },
    // Shown on the "demo service unreachable" card in development, so a wrong target is obvious.
    define: { __PROMO_TARGET__: JSON.stringify(mode === "development" ? promo : "") },
  };
});
