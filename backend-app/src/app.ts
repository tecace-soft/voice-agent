import { Elysia } from "elysia";
import { health } from "./routes/health";
import { intake } from "./routes/intake";
import { schedule } from "./routes/schedule";

// Compose the application from controllers. Exported WITHOUT `.listen()` so tests can
// call it directly (e.g. `app.handle(new Request(...))`) and so the entrypoint owns
// the server lifecycle. Add new controllers with another `.use(...)`.
export const app = new Elysia()
  .get("/", () => ({ name: "backend-app", message: "Elysia is running" }))
  .use(health)
  .use(intake)
  .use(schedule);

export type App = typeof app;
