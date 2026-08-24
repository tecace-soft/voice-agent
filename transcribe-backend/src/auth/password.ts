import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Password hashing with scrypt from node:crypto — deliberately dependency-free so it behaves
// identically under Bun (local) and the Node runtime (Vercel). Bun.password would not work in prod.
//
// Stored format: `scrypt$<N>$<r>$<p>$<salt-b64>$<hash-b64>`. The parameters travel with the hash,
// so raising the cost later still verifies passwords hashed with the old settings.
const N = 16384; // CPU/memory cost — ~16 MB per hash at r=8
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAX_MEM = 64 * 1024 * 1024; // node's 32 MB default is too tight for N=16384, r=8

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize("NFKC"), salt, KEY_LEN, { N, r: R, p: P, maxmem: MAX_MEM });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

// Constant-time verification. Returns false (never throws) on a malformed or unknown-scheme hash,
// so a corrupted row can't take the login route down.
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const expected = Buffer.from(hashB64!, "base64");
    const actual = scryptSync(password.normalize("NFKC"), Buffer.from(saltB64!, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEM,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// A readable random password for `bun run auth create` when no password is supplied.
export function generatePassword(): string {
  return randomBytes(12).toString("base64url");
}
