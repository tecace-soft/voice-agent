import { app } from "./app";
import { env } from "./config/env";

// Entrypoint: start the HTTP server. `bun run src/index.ts` (or `bun run dev` to watch).
app.listen(env.port, (server) => {
  console.log(`🦊 backend-app (Elysia) running at ${server.url} [${env.nodeEnv}]`);
});
