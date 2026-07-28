// Typed access to environment configuration.
// Bun automatically loads `.env` from the project root at startup — no dotenv needed.

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8000),
} as const;

export type Env = typeof env;
