import { sql } from "./client.js";

// What an account is allowed to do. `admin` additionally manages accounts (add / reset / sign out /
// remove / change roles); `user` signs in and reads the dashboard.
export type Role = "admin" | "user";

export const isRole = (value: unknown): value is Role => value === "admin" || value === "user";

/**
 * How far along a customer is.
 *
 * Named for the ACCOUNT, not the customer, because `demo/types.ts` already exports a
 * `CustomerStatus` and it means something else entirely — whether a prospect's research finished.
 * Two identically named unions in one backend is a mistake waiting for whichever file imports both.
 *
 * `demo` sees only the Demos section — they are a prospect trying a receptionist built for them, and
 * there is no business of theirs to configure yet. `pre-production` and `production` both see the
 * Business section; the difference is whether the line is live, not what they may edit.
 *
 * `unassigned` is the one that matters for safety: it means nobody has placed this account in the
 * lifecycle, and it gates NOTHING. Every account that existed before the lifecycle did has it, so
 * adding all of this took nothing away from anyone — including the live voicemail customer, whose
 * account has no business profile and never goes near any of it.
 */
export type AccountStatus = "unassigned" | "demo" | "pre-production" | "production";

export const ACCOUNT_STATUSES: AccountStatus[] = [
  "unassigned",
  "demo",
  "pre-production",
  "production",
];

export const isAccountStatus = (value: unknown): value is AccountStatus =>
  typeof value === "string" && (ACCOUNT_STATUSES as string[]).includes(value);

// A dashboard account. `passwordHash` and `tokenVersion` never leave the backend — routes return
// the `PublicUser` shape instead.
export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Which `demo_customers` record this account grew out of, if any. The promotion's one input. */
  businessId: string | null;
  status: AccountStatus;
  passwordHash: string;
  tokenVersion: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  businessId: string | null;
  status: AccountStatus;
  lastLoginAt: string | null;
}

export const toPublicUser = (u: UserRecord): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  businessId: u.businessId,
  status: u.status,
  lastLoginAt: u.lastLoginAt,
});

// Emails are stored lower-cased so sign-in is case-insensitive without needing the citext extension.
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const COLUMNS = sql`
  id,
  email,
  name,
  role,
  business_id    AS "businessId",
  status,
  password_hash  AS "passwordHash",
  token_version  AS "tokenVersion",
  created_at     AS "createdAt",
  last_login_at  AS "lastLoginAt"
`;

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const [row] = await sql`SELECT ${COLUMNS} FROM users WHERE email = ${normalizeEmail(email)}`;
  return (row as UserRecord | undefined) ?? null;
}

/**
 * Is this even shaped like an account id?
 *
 * `users.id` is a UUID column, and Postgres answers a comparison against something that is not one
 * by raising rather than by returning no rows. Every `/auth/users/:id` route takes its id from the
 * URL, so without this a mistyped link is a 500 where "no such account" is the truth — and a 500 is
 * the one answer that tells the dashboard to say the server is broken. Checked here, once, because
 * every route below would otherwise have to remember it.
 */
const isUserId = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim());

export async function findUserById(id: string): Promise<UserRecord | null> {
  if (!isUserId(id)) return null;
  const [row] = await sql`SELECT ${COLUMNS} FROM users WHERE id = ${id}`;
  return (row as UserRecord | undefined) ?? null;
}

export async function listUsers(): Promise<UserRecord[]> {
  return (await sql`SELECT ${COLUMNS} FROM users ORDER BY created_at`) as unknown as UserRecord[];
}

// Create an account, refusing to touch one that already exists — returns null on a duplicate email
// so the caller can say "that email is already in use" instead of silently resetting someone's
// password. (The CLI's `upsertUser` deliberately does the opposite.)
export async function createUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  role?: Role;
}): Promise<UserRecord | null> {
  const [row] = await sql`
    INSERT INTO users (email, name, role, password_hash)
    VALUES (${normalizeEmail(input.email)}, ${input.name.trim()}, ${input.role ?? "user"}, ${input.passwordHash})
    ON CONFLICT (email) DO NOTHING
    RETURNING ${COLUMNS}
  `;
  return (row as UserRecord | undefined) ?? null;
}

// Create the very first account. The `WHERE NOT EXISTS` makes this the one and only time the
// unauthenticated setup route can write a row: once any user exists it inserts nothing and returns
// null, and because the check and the insert are one statement, two simultaneous setup requests
// can't both win.
export async function createFirstUser(input: {
  email: string;
  name: string;
  passwordHash: string;
}): Promise<UserRecord | null> {
  const [row] = await sql`
    INSERT INTO users (email, name, role, password_hash)
    SELECT ${normalizeEmail(input.email)}, ${input.name.trim()}, 'admin', ${input.passwordHash}
    WHERE NOT EXISTS (SELECT 1 FROM users)
    RETURNING ${COLUMNS}
  `;
  return (row as UserRecord | undefined) ?? null;
}

// Create an account, or update the name + password of an existing one (what `auth create` does when
// the email is already taken). Changing the password bumps token_version, which signs out every
// session that account already had.
export async function upsertUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  role?: Role;
}): Promise<UserRecord> {
  const [row] = await sql`
    INSERT INTO users (email, name, role, password_hash)
    VALUES (${normalizeEmail(input.email)}, ${input.name.trim()}, ${input.role ?? "user"}, ${input.passwordHash})
    ON CONFLICT (email) DO UPDATE SET
      name          = EXCLUDED.name,
      password_hash = EXCLUDED.password_hash,
      -- an explicit role on the CLI wins; otherwise the existing one is kept
      role          = coalesce(${input.role ?? null}, users.role),
      token_version = users.token_version + 1
    RETURNING ${COLUMNS}
  `;
  return row as UserRecord;
}

// Invalidate every token an account currently holds (`bun run auth revoke`).
export async function bumpTokenVersion(email: string): Promise<UserRecord | null> {
  const [row] = await sql`
    UPDATE users SET token_version = token_version + 1
    WHERE email = ${normalizeEmail(email)}
    RETURNING ${COLUMNS}
  `;
  return (row as UserRecord | undefined) ?? null;
}

// Set a new password by id (the Accounts page's "reset"). Bumping token_version signs that account
// out everywhere, so an old session can't outlive the password it was created with.
export async function setPasswordById(id: string, passwordHash: string): Promise<UserRecord | null> {
  if (!isUserId(id)) return null;
  const [row] = await sql`
    UPDATE users
    SET password_hash = ${passwordHash}, token_version = token_version + 1
    WHERE id = ${id}
    RETURNING ${COLUMNS}
  `;
  return (row as UserRecord | undefined) ?? null;
}

export async function bumpTokenVersionById(id: string): Promise<UserRecord | null> {
  if (!isUserId(id)) return null;
  const [row] = await sql`
    UPDATE users SET token_version = token_version + 1 WHERE id = ${id} RETURNING ${COLUMNS}
  `;
  return (row as UserRecord | undefined) ?? null;
}

export async function deleteUserById(id: string): Promise<boolean> {
  if (!isUserId(id)) return false;
  const rows = await sql`DELETE FROM users WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function deleteUser(email: string): Promise<boolean> {
  const rows = await sql`DELETE FROM users WHERE email = ${normalizeEmail(email)} RETURNING id`;
  return rows.length > 0;
}

export async function recordLogin(id: string): Promise<void> {
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${id}`;
}

export async function countUsers(): Promise<number> {
  const [row] = await sql`SELECT count(*)::int AS count FROM users`;
  return (row as { count: number }).count;
}

// How many admins remain — the check behind "you can't remove or demote the last admin".
export async function countAdmins(): Promise<number> {
  const [row] = await sql`SELECT count(*)::int AS count FROM users WHERE role = 'admin'`;
  return (row as { count: number }).count;
}

// Promote or demote. Changing a role doesn't touch the password or the sessions: the guard reads
// the role from the database on every request, so a demotion takes effect immediately.
export async function setRoleById(id: string, role: Role): Promise<UserRecord | null> {
  if (!isUserId(id)) return null;
  const [row] = await sql`UPDATE users SET role = ${role} WHERE id = ${id} RETURNING ${COLUMNS}`;
  return (row as UserRecord | undefined) ?? null;
}

// Make an existing account an admin by email — the env-var seed's "promote me" path.
export async function promoteByEmail(email: string): Promise<UserRecord | null> {
  const [row] = await sql`
    UPDATE users SET role = 'admin' WHERE email = ${normalizeEmail(email)} RETURNING ${COLUMNS}
  `;
  return (row as UserRecord | undefined) ?? null;
}

// ---- where an account is in its life, and which demo record is its own ----

// Link an account to the demo record it grew out of, and/or move it along the lifecycle.
//
// Both fields are optional so the two decisions stay separable: an admin can link an account to a
// business long before deciding it is ready for production. `businessId` is only ever SET here, never
// cleared to null by accident — passing null explicitly unlinks, and `undefined` leaves it alone,
// which is the difference between "not mentioned" and "remove it".
//
// Returns null on a link that is already somebody else's. The unique index enforces one account per
// demo record; catching it here turns a 500 into something the Accounts page can explain.
export async function setLifecycleById(
  id: string,
  changes: { businessId?: string | null; status?: AccountStatus },
): Promise<UserRecord | null> {
  if (!isUserId(id)) return null;
  try {
    const [row] = await sql`
      UPDATE users SET
        business_id = ${changes.businessId === undefined ? sql`business_id` : changes.businessId},
        status      = ${changes.status === undefined ? sql`status` : changes.status}
      WHERE id = ${id}
      RETURNING ${COLUMNS}
    `;
    return (row as UserRecord | undefined) ?? null;
  } catch (err) {
    // 23505 is unique_violation: users_one_per_business. Anything else is not ours to swallow.
    if ((err as { code?: string })?.code === "23505") return null;
    throw err;
  }
}

// Which account, if any, already owns this demo record. Used to explain a refused link.
export async function findUserByBusinessId(businessId: string): Promise<UserRecord | null> {
  const [row] = await sql`SELECT ${COLUMNS} FROM users WHERE business_id = ${businessId}`;
  return (row as UserRecord | undefined) ?? null;
}
