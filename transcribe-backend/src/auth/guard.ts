import { bearerToken, readToken } from "./session.js";
import { findUserById, toPublicUser, type PublicUser } from "../db/users.js";

// Resolve the caller of a request from its `Authorization: Bearer <token>` header. Returns null for
// a missing, malformed, expired, or revoked token — callers turn that into one generic 401 rather
// than saying which part failed.
export async function authenticate(authorization: string | undefined): Promise<PublicUser | null> {
  const payload = readToken(bearerToken(authorization));
  if (!payload) return null;

  const user = await findUserById(payload.sub);
  // A token_version mismatch means the account's sessions were invalidated (password change or
  // `bun run auth revoke`) after this token was issued.
  if (!user || user.tokenVersion !== payload.ver) return null;
  return toPublicUser(user);
}

export const UNAUTHORIZED = { error: "unauthorized", message: "Sign in to continue." } as const;

interface Denial {
  denied: 401 | 403;
  body: { error: string; message: string };
}

// Resolve the caller and require the admin role. Returns either the user or a ready-made denial —
// the status to send and the body to send with it, so no route has to remember which is which.
// `forbiddenMessage` says what specifically needs an admin, since "you can't do that" is more
// useful when it names the thing.
//
// The role is read from the database on every request, so a demotion takes effect at once rather
// than lingering until that person's token expires.
export async function authenticateAdmin(
  authorization: string | undefined,
  forbiddenMessage = "This needs an admin account.",
): Promise<{ user: PublicUser } | Denial> {
  const user = await authenticate(authorization);
  if (!user) return { denied: 401, body: UNAUTHORIZED };
  if (user.role !== "admin") {
    return { denied: 403, body: { error: "forbidden", message: forbiddenMessage } };
  }
  return { user };
}

/**
 * Who may read the Demos data, and how much of it.
 *
 * Two kinds of caller, and the difference is the whole point:
 *
 *   * an **admin** works the pipeline — every prospect, the CRM, the analytics across all of them;
 *   * a **demo-stage customer** is one of those prospects, signed in to look at the receptionist we
 *     built for them. They get their own record and nothing else, not even the knowledge that
 *     another prospect exists.
 *
 * `demo` is the only stage that reaches this. A customer who has moved on to pre-production or
 * production configures their receptionist in the Business section, which is their own data in their
 * own table — giving them the demo record back would be handing them a copy that no longer matters
 * and that their edits would not reach. And an account with no `businessId` has no own record to
 * scope to, so there is nothing to allow.
 *
 * Every route decides for itself whether it is one of the shared ones. That is deliberate: this
 * returns the SCOPE, never permission for a particular action, so nothing here can quietly widen
 * when a route is added — a new route gets `authenticateAdmin` unless somebody writes otherwise.
 */
export type DemoAccess =
  | { scope: "all"; user: PublicUser }
  | { scope: "own"; user: PublicUser; businessId: string };

export async function authenticateDemo(
  authorization: string | undefined,
  forbiddenMessage = "This needs an admin account.",
): Promise<DemoAccess | Denial> {
  const user = await authenticate(authorization);
  if (!user) return { denied: 401, body: UNAUTHORIZED };
  if (user.role === "admin") return { scope: "all", user };
  if (user.status === "demo" && user.businessId) {
    return { scope: "own", user, businessId: user.businessId };
  }
  return { denied: 403, body: { error: "forbidden", message: forbiddenMessage } };
}

/**
 * Is this the record that caller is allowed to touch?
 *
 * Callers answer false with the route's own NOT FOUND, never a 403. A scoped reader asking about
 * somebody else's prospect must not be able to tell the difference between "not yours" and "does not
 * exist" — otherwise the refusal itself confirms which ids are real.
 */
export const ownsDemo = (access: DemoAccess, id: string): boolean =>
  access.scope === "all" || access.businessId === id;

