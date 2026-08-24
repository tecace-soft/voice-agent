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
