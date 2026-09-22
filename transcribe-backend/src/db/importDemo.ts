import { parseDump } from "../demo/dump.js";

// Load the promo's Redis export into the demo_* tables:
//   bun run demo:import path/to/redis-full-dump-2026-09-22.json
// Idempotent: every write is an upsert, so a run that failed halfway can simply be run again.
//
// `./client.js` and `./demoImport.js` are imported further down, dynamically, on purpose. Both
// reach `config/env.ts`, which throws at module scope when DATABASE_URL is unset — and a static
// import is hoisted above everything here, so on a checkout with no .env this script answered
// `bun run demo:import` with a Postgres configuration stack trace instead of its usage line. The
// argument checks cost nothing and need no database, so they go first.

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const path = args.find((arg) => !arg.startsWith("--"));
if (!path) {
  console.error("usage: bun run demo:import <path-to-redis-full-dump.json> [--dry-run]");
  process.exit(2);
}

const file = Bun.file(path);
if (!(await file.exists())) {
  console.error(`❌ no such file: ${path}`);
  process.exit(2);
}

let parsed;
try {
  parsed = parseDump(await file.json());
} catch (error) {
  // A wrong file must fail loudly. Importing zero rows and reporting success is the failure mode
  // this check exists to prevent.
  console.error(`❌ ${(error as Error).message}`);
  process.exit(1);
}

console.log(
  `read ${path}: ${parsed.customers.length} customers, ${parsed.calls.length} calls, ` +
    `${parsed.events.length} events, ${parsed.notes.length} notes`,
);

// Everything above this line is cheap and offline. Only now do we need a database.
const { initDb, sql } = await import("./client.js");
const { importDump } = await import("./demoImport.js");

await initDb(); // idempotent; makes the tables exist before the first write
const counts = await importDump(parsed, { dryRun });

console.log(dryRun ? "would insert:" : "inserted:");
console.log(`  customers ${counts.customers} of ${parsed.customers.length}`);
console.log(`  calls     ${counts.calls} of ${parsed.calls.length}`);
console.log(`  events    ${counts.events} of ${parsed.events.length}`);
console.log(`  notes     ${counts.notes} of ${parsed.notes.length}`);
console.log("(a row already present is updated in place, not counted as inserted)");
if (dryRun) {
  console.log("\n🔎 dry run — the transaction was rolled back, nothing was written.");
}
await sql.end();
