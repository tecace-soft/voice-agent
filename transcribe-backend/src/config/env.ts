// Typed access to environment configuration.
// Bun automatically loads `.env` from the project root at startup — no dotenv needed.

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

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8001),
  databaseUrl,
  corsOrigins,
  // Day boundaries for the "today"/daily stats follow this timezone.
  timezone: assertTimeZone(process.env.BUSINESS_TIMEZONE ?? "America/Los_Angeles"),
  transcribeIngestKey,
} as const;

export type Env = typeof env;
