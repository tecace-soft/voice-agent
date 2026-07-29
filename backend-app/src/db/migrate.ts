import { initDb, sql } from "./client.js";

// Standalone migration entrypoint: `bun run db:migrate`.
// Idempotent — creates the schema if it is missing, then exits.
await initDb();
console.log("✅ database schema is up to date");
await sql.end();
