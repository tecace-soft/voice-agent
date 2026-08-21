import { initDb, sql } from "./client.js";

// Standalone data-wipe entrypoint: `bun run db:clear`.
//
// Empties `voicemail_runs` (all reported run metrics) while keeping the table/schema in place.
// Use this before a customer handoff so the dashboard starts from zero with none of our test data.
//
// DESTRUCTIVE and irreversible — it deletes every row. It acts on whatever DATABASE_URL points at,
// so double-check you're pointed at the right database (e.g. run it with the production connection
// string only when you actually mean to wipe production).
await initDb(); // make sure the table exists before truncating
const rows = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM voicemail_runs`;
const count = rows[0]?.count ?? 0;
await sql`TRUNCATE TABLE voicemail_runs`;
console.log(`✅ cleared voicemail_runs — deleted ${count} run(s); the table is now empty`);
await sql.end();
