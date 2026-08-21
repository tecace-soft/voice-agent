import { app } from "./app.js";
import { env } from "./config/env.js";
import { ensureDbReady } from "./db/client.js";

// Entrypoint: ensure the schema exists, then start the HTTP server.
// `bun run src/index.ts` (or `bun run dev` to watch).
await ensureDbReady();

app.listen(env.port, (server) => {
  console.log(`🦊 transcribe-backend (Elysia) running at ${server.url} [${env.nodeEnv}]`);
});
