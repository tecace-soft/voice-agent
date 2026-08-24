import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

// Stateless session tokens: `<base64url(payload)>.<base64url(HMAC-SHA256)>`.
//
// Why not a server-side session table: the backend runs as serverless functions on Vercel, where a
// signed token means a login needs no extra round trip to Postgres on every request. The trade-off
// is that a token can't be individually revoked before it expires — `token_version` covers the case
// that matters (a password reset, or `bun run auth revoke`, invalidates every token that user holds).

export interface SessionPayload {
  sub: string; // user id
  ver: number; // user's token_version at sign time — bumping it invalidates old tokens
  iat: number; // issued at (epoch seconds)
  exp: number; // expires at (epoch seconds)
}

const b64url = (buf: Buffer) => buf.toString("base64url");

function signature(body: string): Buffer {
  return createHmac("sha256", env.authSecret).update(body).digest();
}

export function createToken(userId: string, tokenVersion: number): { token: string; expiresAt: string } {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: userId,
    ver: tokenVersion,
    iat: now,
    exp: now + env.authTokenTtlHours * 3600,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return {
    token: `${body}.${b64url(signature(body))}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

// Verify the signature and the expiry. Returns null for anything that doesn't check out — the
// caller turns that into a 401 without leaking which part failed.
export function readToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = signature(body);
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Pull the token out of an `Authorization: Bearer <token>` header.
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}
