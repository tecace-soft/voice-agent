import { env } from "../config/env.js";
import { createUser, findUserByEmail, promoteByEmail } from "../db/users.js";
import { hashPassword } from "./password.js";

// Optional bootstrap admin from the environment (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD), so an
// admin account can exist before anyone opens the dashboard — useful on Vercel, where there is no
// shell to run `bun run auth create` in.
//
// Deliberately conservative:
//   - It never changes the password of an account that already exists. Otherwise leaving the vars
//     in place would reset that password on every deploy, and anyone who could read the project's
//     environment would have a standing backdoor.
//   - It only ever grants admin, never removes it.
//   - With no SEED_ADMIN_EMAIL set it does nothing at all.
// Once the account exists you can delete both variables; nothing depends on them afterwards.

let seeded: Promise<void> | null = null;

export function ensureSeedAdmin(): Promise<void> {
  if (!seeded) {
    seeded = applySeed().catch((err) => {
      seeded = null; // let the next request retry rather than caching the failure
      throw err;
    });
  }
  return seeded;
}

async function applySeed(): Promise<void> {
  const email = env.seedAdminEmail;
  if (!email) return;

  const existing = await findUserByEmail(email);
  if (existing) {
    if (existing.role !== "admin") {
      await promoteByEmail(email);
      console.log(`🔑 SEED_ADMIN_EMAIL: promoted ${email} to admin.`);
    }
    return;
  }

  if (!env.seedAdminPassword) {
    console.warn(
      `⚠️  SEED_ADMIN_EMAIL is set to ${email} but there is no account for it and no ` +
        "SEED_ADMIN_PASSWORD to create one with. Set the password variable, or create the account " +
        "from the dashboard's setup screen.",
    );
    return;
  }

  const created = await createUser({
    email,
    name: env.seedAdminName,
    role: "admin",
    passwordHash: hashPassword(env.seedAdminPassword),
  });
  if (created) {
    console.log(`🔑 SEED_ADMIN_EMAIL: created admin account ${email}. Change this password after signing in.`);
  }
}
