import { Elysia, t } from "elysia";
import { authenticate, authenticateAdmin, UNAUTHORIZED } from "../auth/guard.js";
import { generatePassword, hashPassword, verifyPassword } from "../auth/password.js";
import { createToken } from "../auth/session.js";
import { clearFailures, recordFailure, retryAfter } from "../auth/throttle.js";
import {
  bumpTokenVersionById,
  countAdmins,
  countUsers,
  createFirstUser,
  createUser,
  deleteUserById,
  findUserByEmail,
  findUserById,
  listUsers,
  recordLogin,
  setPasswordById,
  setRoleById,
  toPublicUser,
} from "../db/users.js";

// Sign-in and account management for the transcribe dashboard.
//
// There is no open sign-up. Accounts come from exactly three places:
//   1. `POST /auth/setup`  — the first account only, and only while the users table is empty. That
//      account is an admin, since somebody has to be able to add everyone else.
//   2. `POST /auth/users`  — an ADMIN adding a user (the dashboard's Accounts page).
//   3. `bun run auth create` / the SEED_ADMIN_* env vars — the CLI and boot-time seed, for when
//      nobody can get in.
//
// Roles: `admin` manages accounts, `user` signs in and reads the dashboard. Every route below that
// touches an account requires an admin, so hiding the Accounts page from a `user` in the dashboard
// is a convenience, not the actual protection.

// Long enough that someone can't pick something guessable; generated passwords are longer still.
const MIN_PASSWORD_LENGTH = 10;
const passwordField = t.String({ minLength: MIN_PASSWORD_LENGTH, maxLength: 512 });
// An omitted password means "generate one"; the empty string means the same, since that is what an
// untouched form field sends.
const optionalPasswordField = t.Optional(t.Union([passwordField, t.Literal("")]));
const emailField = t.String({ minLength: 3, maxLength: 320 });
const roleField = t.Union([t.Literal("admin"), t.Literal("user")]);
const nameField = t.String({ minLength: 1, maxLength: 120 });

const weakPassword = {
  error: "weak_password",
  message: `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`,
} as const;

export const auth = new Elysia({ prefix: "/auth" })
  // Does this deployment still need its first account? The dashboard asks before showing a form, so
  // it knows whether to offer "create the first account" or "sign in". Public by necessity — it says
  // nothing beyond whether anyone has signed up yet.
  .get("/setup-state", async () => ({ needsSetup: (await countUsers()) === 0 }))

  // Create the first account and sign it straight in. Closed for good once any account exists — the
  // insert itself carries the "no users yet" condition, so two simultaneous requests can't both win.
  .post(
    "/setup",
    async ({ body, status }) => {
      const user = await createFirstUser({
        email: body.email,
        name: body.name,
        passwordHash: hashPassword(body.password),
      });
      if (!user) {
        return status(403, {
          error: "setup_complete",
          message: "This dashboard already has accounts. Ask a teammate to add you.",
        });
      }
      await recordLogin(user.id);
      const { token, expiresAt } = createToken(user.id, user.tokenVersion);
      return status(201, { token, expiresAt, user: toPublicUser(user) });
    },
    { body: t.Object({ email: emailField, name: nameField, password: passwordField }) },
  )

  // Exchange an email + password for a session token. Every failure answers the same way, whether
  // the email is unknown or the password is wrong, so the response can't be used to enumerate
  // accounts.
  .post(
    "/login",
    async ({ body, headers, status, server, request }) => {
      const email = body.email.trim().toLowerCase();
      // Behind Vercel the socket address is the proxy's, so prefer the forwarded client address.
      const client =
        headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        server?.requestIP(request)?.address ||
        "unknown";
      const key = `${email}|${client}`;

      const wait = retryAfter(key);
      if (wait > 0) {
        return status(429, {
          error: "too_many_attempts",
          message: `Too many sign-in attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`,
        });
      }

      const user = await findUserByEmail(email);
      if (!user || !verifyPassword(body.password, user.passwordHash)) {
        recordFailure(key);
        return status(401, { error: "invalid_credentials", message: "Incorrect email or password." });
      }

      clearFailures(key);
      await recordLogin(user.id);
      const { token, expiresAt } = createToken(user.id, user.tokenVersion);
      return { token, expiresAt, user: toPublicUser({ ...user, lastLoginAt: new Date().toISOString() }) };
    },
    {
      body: t.Object({
        email: emailField,
        password: t.String({ minLength: 1, maxLength: 512 }),
      }),
    },
  )

  // Who the current token belongs to — the dashboard calls this on load to restore the session and
  // to fill the sidebar's account block.
  .get("/me", async ({ headers, status }) => {
    const user = await authenticate(headers.authorization);
    if (!user) return status(401, UNAUTHORIZED);
    return { user };
  })

  // Tokens are stateless, so signing out is the client discarding its token; this endpoint exists so
  // the dashboard has something to call (and so logout can grow server-side behaviour later).
  // To invalidate tokens a user still holds — a lost laptop — use "Sign out everywhere" below.
  .post("/logout", () => ({ status: "signed_out" }))

  // ---- account management (admins only) ----

  .get("/users", async ({ headers, status }) => {
    const caller = await authenticateAdmin(headers.authorization, "Only an admin can manage accounts.");
    if ("denied" in caller) return status(caller.denied, caller.body);
    return { users: (await listUsers()).map(toPublicUser) };
  })

  // Add a user. With no password given, one is generated and returned ONCE so whoever adds them
  // can pass it on — from here it is only a hash, which can be reset but never read back.
  .post(
    "/users",
    async ({ body, headers, status }) => {
      const caller = await authenticateAdmin(headers.authorization, "Only an admin can manage accounts.");
      if ("denied" in caller) return status(caller.denied, caller.body);

      const password = body.password || generatePassword();
      if (password.length < MIN_PASSWORD_LENGTH) return status(422, weakPassword);

      const user = await createUser({
        email: body.email,
        name: body.name,
        role: body.role ?? "user",
        passwordHash: hashPassword(password),
      });
      if (!user) {
        return status(409, { error: "email_taken", message: "That email already has an account." });
      }
      return status(201, { user: toPublicUser(user), password: body.password ? null : password });
    },
    {
      body: t.Object({
        email: emailField,
        name: nameField,
        password: optionalPasswordField,
        role: t.Optional(roleField),
      }),
    },
  )

  // Reset an account's password (your own included). Signs that account out everywhere, so a
  // session can't outlive the password it was created with.
  .post(
    "/users/:id/password",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, "Only an admin can manage accounts.");
      if ("denied" in caller) return status(caller.denied, caller.body);

      const password = body.password || generatePassword();
      if (password.length < MIN_PASSWORD_LENGTH) return status(422, weakPassword);

      const user = await setPasswordById(params.id, hashPassword(password));
      if (!user) return status(404, { error: "not_found", message: "No such account." });
      return { user: toPublicUser(user), password: body.password ? null : password };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ password: optionalPasswordField }),
    },
  )

  // Invalidate every token an account holds, leaving its password alone.
  .post(
    "/users/:id/revoke",
    async ({ headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, "Only an admin can manage accounts.");
      if ("denied" in caller) return status(caller.denied, caller.body);
      const user = await bumpTokenVersionById(params.id);
      if (!user) return status(404, { error: "not_found", message: "No such account." });
      return { user: toPublicUser(user) };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // Remove an account. Not your own — that is what signing out is for — and not the last one, which
  // would lock everybody out and force a trip to the CLI.
  .delete(
    "/users/:id",
    async ({ headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, "Only an admin can manage accounts.");
      if ("denied" in caller) return status(caller.denied, caller.body);
      if (caller.user.id === params.id) {
        return status(409, { error: "self_delete", message: "You can't remove your own account." });
      }
      const target = await findUserById(params.id);
      if (!target) return status(404, { error: "not_found", message: "No such account." });
      if ((await countUsers()) <= 1) {
        return status(409, {
          error: "last_account",
          message: "This is the last account — removing it would lock everyone out.",
        });
      }
      if (target.role === "admin" && (await countAdmins()) <= 1) {
        return status(409, {
          error: "last_admin",
          message: "This is the last admin — promote someone else first.",
        });
      }
      await deleteUserById(params.id);
      return { status: "removed" };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // Promote to admin or demote to user. The guard reads the role from the database on every
  // request, so a demotion applies immediately rather than when that person's token expires.
  .post(
    "/users/:id/role",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, "Only an admin can manage accounts.");
      if ("denied" in caller) return status(caller.denied, caller.body);

      const target = await findUserById(params.id);
      if (!target) return status(404, { error: "not_found", message: "No such account." });
      // Demoting the only admin would leave nobody able to manage accounts — including whoever
      // just did it.
      if (target.role === "admin" && body.role === "user" && (await countAdmins()) <= 1) {
        return status(409, {
          error: "last_admin",
          message: "This is the last admin — promote someone else first.",
        });
      }
      const user = await setRoleById(params.id, body.role);
      return { user: toPublicUser(user!) };
    },
    { params: t.Object({ id: t.String() }), body: t.Object({ role: roleField }) },
  );
