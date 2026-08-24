import { initDb, sql } from "../db/client.js";
import {
  bumpTokenVersion,
  countAdmins,
  deleteUser,
  findUserByEmail,
  isRole,
  listUsers,
  normalizeEmail,
  promoteByEmail,
  setRoleById,
  upsertUser,
  type Role,
} from "../db/users.js";
import { generatePassword, hashPassword } from "./password.js";

// Account management for the transcribe dashboard: `bun run auth <command>`.
// There is no sign-up route, so this is how people get in.
//
//   bun run auth create <email> "<name>" [password] [--admin]   create an account (or reset one)
//   bun run auth list                                 who has an account, and their role
//   bun run auth role <email> admin|user              promote or demote
//   bun run auth reset <email> [password]             set a new password, keeping the name + role
//   bun run auth revoke <email>                       sign the account out everywhere
//   bun run auth delete <email>                       remove the account
//
// Roles: `admin` manages accounts (the dashboard's Accounts page); `user` just reads the dashboard.
// New accounts are `user` unless you pass --admin.
//
// Omitting the password generates a strong one and prints it once — copy it then, it is not
// recoverable afterwards (only resettable).

const USAGE = `Usage:
  bun run auth create <email> "<name>" [password] [--admin]
  bun run auth list
  bun run auth role <email> admin|user
  bun run auth reset <email> [password]
  bun run auth revoke <email>
  bun run auth delete <email>`;

function fail(message: string): never {
  console.error(`❌ ${message}`);
  console.error(USAGE);
  process.exitCode = 1;
  throw new Error(message);
}

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US") : "never");

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const wantsAdmin = argv.includes("--admin");
  const [command, ...args] = argv.filter((a) => a !== "--admin");
  await initDb();

  switch (command) {
    case "create": {
      const [email, name, password] = args;
      if (!email || !name) fail("create needs an email and a name.");
      const existing = await findUserByEmail(email);
      const secret = password || generatePassword();
      const user = await upsertUser({
        email,
        name,
        passwordHash: hashPassword(secret),
        // Without --admin, keep an existing account's role and default a new one to `user`.
        role: wantsAdmin ? "admin" : existing ? existing.role : "user",
      });
      console.log(`✅ ${existing ? "updated" : "created"} ${user.name} <${user.email}> (${user.role})`);
      if (!password) console.log(`   password: ${secret}   (shown once — copy it now)`);
      if (existing) console.log("   existing sessions for this account were signed out.");
      break;
    }

    case "reset": {
      const [email, password] = args;
      if (!email) fail("reset needs an email.");
      const existing = await findUserByEmail(email);
      if (!existing) fail(`no account for ${normalizeEmail(email)}.`);
      const secret = password || generatePassword();
      await upsertUser({
        email,
        name: existing.name,
        role: existing.role,
        passwordHash: hashPassword(secret),
      });
      console.log(`✅ reset the password for ${existing.name} <${existing.email}>`);
      if (!password) console.log(`   password: ${secret}   (shown once — copy it now)`);
      console.log("   existing sessions for this account were signed out.");
      break;
    }

    case "role": {
      const [email, role] = args;
      if (!email || !role) fail('role needs an email and either "admin" or "user".');
      if (!isRole(role)) fail(`"${role}" is not a role — use "admin" or "user".`);
      const existing = await findUserByEmail(email);
      if (!existing) fail(`no account for ${normalizeEmail(email)}.`);
      if (existing.role === "admin" && role === "user" && (await countAdmins()) <= 1) {
        fail("that is the last admin — promote someone else first.");
      }
      const updated =
        role === "admin" ? await promoteByEmail(email) : await setRoleById(existing.id, role as Role);
      console.log(`✅ ${updated!.email} is now ${updated!.role}`);
      break;
    }

    case "revoke": {
      const [email] = args;
      if (!email) fail("revoke needs an email.");
      const user = await bumpTokenVersion(email);
      if (!user) fail(`no account for ${normalizeEmail(email)}.`);
      console.log(`✅ signed ${user.email} out of every device. Their password still works.`);
      break;
    }

    case "delete": {
      const [email] = args;
      if (!email) fail("delete needs an email.");
      const removed = await deleteUser(email);
      console.log(removed ? `✅ deleted ${normalizeEmail(email)}` : `nothing to delete for ${normalizeEmail(email)}`);
      break;
    }

    case "list": {
      const users = await listUsers();
      if (users.length === 0) {
        console.log('No accounts yet. Create one with: bun run auth create <email> "<name>"');
        break;
      }
      console.log(`${users.length} account(s):`);
      for (const u of users) {
        console.log(
          `  ${u.email.padEnd(32)} ${u.name.padEnd(24)} ${u.role.padEnd(6)} last sign-in: ${formatDate(u.lastLoginAt)}`,
        );
      }
      break;
    }

    default:
      fail(command ? `unknown command "${command}".` : "no command given.");
  }
}

try {
  await main();
} finally {
  await sql.end();
}
