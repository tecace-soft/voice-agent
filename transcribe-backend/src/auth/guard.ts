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
export const FORBIDDEN = {
  error: "forbidden",
  message: "Only an admin can manage accounts.",
} as const;

// Resolve the caller and require the admin role. Returns the user, or the reason they can't act —
// the role is read from the database on every request, so a demotion takes effect at once rather
// than lingering until that person's token expires.
export async function authenticateAdmin(
  authorization: string | undefined,
): Promise<{ user: PublicUser } | { denied: 401 | 403 }> {
  const user = await authenticate(authorization);
  if (!user) return { denied: 401 };
  if (user.role !== "admin") return { denied: 403 };
  return { user };
}
