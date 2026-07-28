import { app } from "./app";
import { env } from "./config/env";
import { initDb } from "./db/client";

// Entrypoint: ensure the schema exists, then start the HTTP server.
// `bun run src/index.ts` (or `bun run dev` to watch).
await initDb();

app.listen(env.port, (server) => {
  console.log(`🦊 backend-app (Elysia) running at ${server.url} [${env.nodeEnv}]`);
});
