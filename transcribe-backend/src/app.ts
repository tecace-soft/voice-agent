import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { env } from "./config/env.js";
import { ensureDbReady } from "./db/client.js";
import { ensureSeedAdmin } from "./auth/seed.js";
import { auth } from "./routes/auth.js";
import { feedback } from "./routes/feedback.js";
import { health } from "./routes/health.js";
import { business } from "./routes/business.js";
import { calls } from "./routes/calls.js";
import { transcribe } from "./routes/transcribe.js";
import { usage } from "./routes/usage.js";
import { apiKeys } from "./routes/apiKeys.js";
import { demo } from "./routes/demo.js";
import { demoPublic } from "./routes/demoPublic.js";

// Compose the application from controllers. Exported WITHOUT `.listen()` so tests can call it
// directly and so the entrypoint owns the server lifecycle. Add controllers with another `.use()`.
// CORS lets the transcribe dashboard call this API from the browser; with no configured origins it
// reflects any origin (dev), otherwise it restricts to the configured list.
export const app = new Elysia()
  // `authorization` has to be allowed explicitly, otherwise the browser's preflight rejects the
  // dashboard's signed-in requests.
  .use(
    cors({
      ...(env.corsOrigins.length ? { origin: env.corsOrigins } : {}),
      // PUT is here for the business-profile save. Every method a route uses has to be
      // listed: the browser preflights anything outside the simple set, and a missing one
      // fails at the preflight — which surfaces as "couldn't reach the server" rather than
      // as an HTTP error, so it looks like the backend is down instead of picky.
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["content-type", "authorization", "x-transcribe-key"],
    }),
  )
  // Self-migrate on cold start: ensure the schema is ready before any handler runs a query, then
  // apply the optional SEED_ADMIN_* bootstrap account. Both are cached per process.
  .onBeforeHandle({ as: "global" }, async () => {
    await ensureDbReady();
    await ensureSeedAdmin();
  })
  .get("/", () => ({ name: "transcribe-backend", message: "Elysia is running" }))
  .use(health)
  .use(auth)
  .use(feedback)
  .use(transcribe)
  .use(business)
  .use(calls)
  .use(usage)
  .use(apiKeys)
  .use(demo)
  // Last, and NOT behind the admin guard: the prospect's side of a demo link. Its own file says why
  // each handler is safe to leave open. Mounted after `demo` so a path collision would be a startup
  // error rather than a public route quietly shadowing an admin one — the prefixes (`/demo` and
  // `/demo/public`) do not overlap, and this keeps it that way if either ever changes.
  .use(demoPublic);

export type App = typeof app;

// Default export = the Elysia app itself, which Vercel's Elysia framework preset serves.
export default app;
