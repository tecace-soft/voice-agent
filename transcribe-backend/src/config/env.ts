// Typed access to environment configuration.
// Bun automatically loads `.env` from the project root at startup — no dotenv needed.
import { randomBytes } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and set a Postgres connection string.",
  );
}

// Validate the timezone by asking Intl to use it (throws on an unknown zone).
function assertTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`BUSINESS_TIMEZONE "${tz}" is not a valid IANA timezone.`);
  }
}

// Allowed CORS origins for browser calls (the transcribe dashboard). Comma-separated; unset =>
// allow any origin (fine for local/dev; set explicit origins in production).
const corsOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Shared secret for the write endpoint. When set, POST /transcribe/runs requires a matching
// `x-transcribe-key` header (the transcribe-app sends it). Unset = open (dev only).
const transcribeIngestKey = process.env.TRANSCRIBE_INGEST_KEY?.trim() ?? "";

const nodeEnv = process.env.NODE_ENV ?? "development";

// Secret that signs dashboard session tokens. Required in production — without it nobody could be
// kept signed in across deploys, and a predictable secret would let anyone mint a valid token.
// In development an ephemeral one is generated so `bun run dev` works with no setup; it changes on
// every restart, which signs everyone out (the warning says so).
function resolveAuthSecret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) {
    if (configured.length < 32 && nodeEnv === "production") {
      throw new Error("AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32");
    }
    return configured;
  }
  if (nodeEnv === "production") {
    throw new Error(
      "AUTH_SECRET is not set. Dashboard sign-in needs it. Generate one with: openssl rand -hex 32",
    );
  }
  console.warn(
    "⚠️  AUTH_SECRET is not set — using a random per-process secret. Sessions won't survive a restart.",
  );
  return randomBytes(32).toString("hex");
}

// How long a session token stays valid. Default 7 days: long enough that the team isn't retyping a
// password daily, short enough that a leaked token isn't useful forever.
const ttlHours = Number(process.env.AUTH_TOKEN_TTL_HOURS ?? 168);
if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
  throw new Error("AUTH_TOKEN_TTL_HOURS must be a positive number of hours.");
}

// Optional bootstrap admin, applied on the first request after a deploy. Lets an account exist
// before anyone opens the dashboard, without shell access to the database. Idempotent, and it never
// overwrites the password of an account that already exists — see src/auth/seed.ts.
const seedAdminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD ?? "";
const seedAdminName = process.env.SEED_ADMIN_NAME?.trim() || seedAdminEmail.split("@")[0] || "Admin";

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 8001),
  databaseUrl,
  corsOrigins,
  // Day boundaries for the "today"/daily stats follow this timezone.
  timezone: assertTimeZone(process.env.BUSINESS_TIMEZONE ?? "America/Los_Angeles"),
  transcribeIngestKey,
  authSecret: resolveAuthSecret(),
  authTokenTtlHours: ttlHours,
  seedAdminEmail,
  seedAdminPassword,
  seedAdminName,
} as const;

export type Env = typeof env;
