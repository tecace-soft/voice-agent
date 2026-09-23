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
//
// Checked here rather than left to postgres.js: given an https:// URL it would take the host at
// face value and sit there trying to open a Postgres connection to port 5432 of a web server,
// failing eventually with a timeout that says nothing about the real mistake. The deployed
// backend's address and the database's connection string are easy to confuse.
const configured = process.env.DATABASE_URL;
if (configured && !/^postgres(ql)?:\/\//i.test(configured)) {
  console.error(`\n❌ DATABASE_URL is not a Postgres connection string:\n   ${configured}\n`);
  console.error("   It must start with postgres:// or postgresql:// — this is the database itself,");
  console.error("   not the URL of the deployed backend that talks to it. On Vercel, copy it from");
  console.error("   the project's Settings → Environment Variables → DATABASE_URL, or run");
  console.error("   `vercel env pull .env` in this directory. Use the POOLED host (it contains");
  console.error("   \"-pooler\") and keep ?sslmode=require.");
  process.exit(2);
}
//
// config/env.ts throws at module scope when DATABASE_URL is unset, and the raw throw here is a
// stack trace pointing into env.ts — which tells someone running an import script nothing about
// what to do next. The file has already parsed cleanly at this point, so the only thing missing
// is the connection string; say that, and say both ways to supply it.
let initDb: typeof import("./client.js").initDb;
let sql: typeof import("./client.js").sql;
let importDump: typeof import("./demoImport.js").importDump;
try {
  ({ initDb, sql } = await import("./client.js"));
  ({ importDump } = await import("./demoImport.js"));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("DATABASE_URL")) throw error;
  const flag = dryRun ? " --dry-run" : "";
  console.error("\n❌ DATABASE_URL is not set — the file is fine, but there is no database to import into.\n");
  console.error("   Local:       cp .env.example .env    # then set DATABASE_URL and re-run");
  console.error(`   Production:  DATABASE_URL="<connection string>" bun run demo:import ${path}${flag}`);
  process.exit(2);
}

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
