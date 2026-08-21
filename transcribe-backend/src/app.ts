import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { env } from "./config/env.js";
import { ensureDbReady } from "./db/client.js";
import { health } from "./routes/health.js";
import { transcribe } from "./routes/transcribe.js";

// Compose the application from controllers. Exported WITHOUT `.listen()` so tests can call it
// directly and so the entrypoint owns the server lifecycle. Add controllers with another `.use()`.
// CORS lets the transcribe dashboard call this API from the browser; with no configured origins it
// reflects any origin (dev), otherwise it restricts to the configured list.
export const app = new Elysia()
  .use(cors(env.corsOrigins.length ? { origin: env.corsOrigins } : {}))
  // Self-migrate on cold start: ensure the schema is ready before any handler runs a query.
  .onBeforeHandle({ as: "global" }, async () => {
    await ensureDbReady();
  })
  .get("/", () => ({ name: "transcribe-backend", message: "Elysia is running" }))
  .use(health)
  .use(transcribe);

export type App = typeof app;

// Default export = the Elysia app itself, which Vercel's Elysia framework preset serves.
export default app;
