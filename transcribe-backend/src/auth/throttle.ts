// A small brake on password guessing: after several failures for the same email + client address,
// further attempts are refused for a while.
//
// Deliberately in-memory. On Vercel each serverless instance keeps its own counters, so this slows
// a naive attacker rather than stopping a distributed one — the real protection is scrypt hashing
// plus strong generated passwords. Swap in a shared store (Postgres/Redis) if this ever faces the
// open internet with weak passwords.
const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;

const attempts = new Map<string, { failures: number; firstAt: number }>();

function prune(now: number): void {
  for (const [key, entry] of attempts) {
    if (now - entry.firstAt > WINDOW_MS) attempts.delete(key);
  }
}

// Seconds the caller must wait, or 0 when they may try now.
export function retryAfter(key: string): number {
  const entry = attempts.get(key);
  if (!entry) return 0;
  const elapsed = Date.now() - entry.firstAt;
  if (elapsed > WINDOW_MS) {
    attempts.delete(key);
    return 0;
  }
  if (entry.failures < MAX_FAILURES) return 0;
  return Math.ceil((WINDOW_MS - elapsed) / 1000);
}

export function recordFailure(key: string): void {
  const now = Date.now();
  prune(now);
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) attempts.set(key, { failures: 1, firstAt: now });
  else entry.failures += 1;
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}
