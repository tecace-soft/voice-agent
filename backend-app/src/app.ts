import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { env } from "./config/env.js";
import { health } from "./routes/health.js";
import { intake } from "./routes/intake.js";
import { prompt } from "./routes/prompt.js";
import { schedule } from "./routes/schedule.js";

// Compose the application from controllers. Exported WITHOUT `.listen()` so tests can
// call it directly (e.g. `app.handle(new Request(...))`) and so the entrypoint owns
// the server lifecycle. Add new controllers with another `.use(...)`.
// CORS lets the Vercel frontends call this API from the browser; with no configured
// origins it reflects any origin (dev), otherwise it restricts to the configured list.
export const app = new Elysia()
  .use(cors(env.corsOrigins.length ? { origin: env.corsOrigins } : {}))
  .get("/", () => ({ name: "backend-app", message: "Elysia is running" }))
  .use(health)
  .use(intake)
  .use(schedule)
  .use(prompt);

export type App = typeof app;

// Default export = the Elysia app itself, which Vercel's Elysia framework preset serves
// as the deployment (it wraps the app's fetch handler). Local dev still uses the named
// export via `src/index.ts` (app.listen), and tests use `app.handle(...)`.
export default app;
