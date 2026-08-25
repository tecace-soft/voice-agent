import { initDb, sql } from "./client.js";

// Standalone data-wipe entrypoint: `bun run db:clear [options]`.
//
//   (no options)          delete every reported run
//   --unattributed        delete only runs with no mailbox (the ones reported before the
//                         transcribe-app started sending the address it fetched from)
//   --mailbox <email>     delete only that mailbox's runs
//   --dry-run             show what would go, delete nothing
//
// DESTRUCTIVE and irreversible. It acts on whatever DATABASE_URL points at, so double-check you
// are pointed at the database you mean (run it with the production connection string only when you
// actually intend to wipe production).
//
// It only ever touches `voicemail_runs`. Dashboard accounts (`users`) and feedback (`feedback`) are
// left alone — clearing metrics should never cost anyone their login.

interface Group {
  mailboxEmail: string | null;
  runs: number;
  processed: number;
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const unattributedOnly = argv.includes("--unattributed");
const mailboxArg = argv.indexOf("--mailbox");
const mailbox = mailboxArg >= 0 ? argv[mailboxArg + 1]?.trim().toLowerCase() : undefined;

if (mailboxArg >= 0 && !mailbox) {
  console.error("❌ --mailbox needs an email address, e.g. --mailbox voicemail@tecace.com");
  process.exit(1);
}
if (unattributedOnly && mailbox) {
  console.error("❌ use either --unattributed or --mailbox, not both.");
  process.exit(1);
}

// The same three-way scope the dashboard reads with, so what you delete matches what you saw.
const scope = unattributedOnly
  ? sql`mailbox_email IS NULL`
  : mailbox
    ? sql`mailbox_email = ${mailbox}`
    : sql`TRUE`;

const describe = unattributedOnly
  ? "runs with no mailbox"
  : mailbox
    ? `runs for ${mailbox}`
    : "every run";

await initDb(); // make sure the table exists before touching it

// Always look at the target before deleting it: print the breakdown, so a wrong DATABASE_URL or a
// typo'd mailbox is obvious from the numbers rather than discovered afterwards.
const groups = (await sql`
  SELECT mailbox_email AS "mailboxEmail", count(*)::int AS runs, coalesce(sum(processed), 0)::int AS processed
  FROM voicemail_runs
  GROUP BY mailbox_email
  ORDER BY count(*) DESC
`) as unknown as Group[];

const targetRows = (await sql`
  SELECT count(*)::int AS runs, coalesce(sum(processed), 0)::int AS processed
  FROM voicemail_runs
  WHERE ${scope}
`) as unknown as { runs: number; processed: number }[];
const targeted = targetRows[0]?.runs ?? 0;
const targetedProcessed = targetRows[0]?.processed ?? 0;

console.log(`Database currently holds ${groups.reduce((n, g) => n + g.runs, 0)} run(s):`);
for (const g of groups) {
  console.log(
    `  ${(g.mailboxEmail ?? "(unattributed)").padEnd(32)} ${String(g.runs).padStart(6)} runs, ${g.processed} transcribed`,
  );
}
if (groups.length === 0) console.log("  (none)");

console.log(`\nTarget: ${describe} — ${targeted} run(s), ${targetedProcessed} transcribed.`);

if (dryRun) {
  console.log("🔎 --dry-run: nothing was deleted.");
  await sql.end();
  process.exit(0);
}
if (targeted === 0) {
  console.log("Nothing to delete.");
  await sql.end();
  process.exit(0);
}

const deleted = await sql`DELETE FROM voicemail_runs WHERE ${scope} RETURNING id`;
console.log(`✅ deleted ${deleted.length} run(s). Accounts and feedback were not touched.`);
await sql.end();
