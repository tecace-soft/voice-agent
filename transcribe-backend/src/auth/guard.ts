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
