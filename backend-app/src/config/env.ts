// Typed access to environment configuration.
// Bun automatically loads `.env` from the project root at startup — no dotenv needed.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and set a Postgres connection string.",
  );
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8000),
  databaseUrl,
} as const;

export type Env = typeof env;
