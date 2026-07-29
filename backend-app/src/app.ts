import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { env } from "./config/env";
import { health } from "./routes/health";
import { intake } from "./routes/intake";
import { schedule } from "./routes/schedule";

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
  .use(schedule);

export type App = typeof app;
