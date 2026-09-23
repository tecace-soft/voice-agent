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

// The voice agent's credential for reading which customer a dialled number belongs to. Separate
// from TRANSCRIBE_INGEST_KEY on purpose: the voice agent and the voicemail poller are different
// services on different machines, and one being rotated or compromised should not touch the other.
// Unset = the lookup is closed entirely, which fails safe (the agent answers neutrally).
const agentConfigKey = process.env.AGENT_CONFIG_KEY?.trim() ?? "";

// Reading a customer's pasted business description into speakable facts (src/tools/extractBusiness).
// Same provider the voicemail pipeline already uses, called over plain REST — one request, no SDK.
// Unset = business details can't be saved; anything already saved keeps working.
const geminiApiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
const businessExtractModel = process.env.BUSINESS_EXTRACT_MODEL?.trim() || "gemini-2.5-flash-lite";

// The Demo test call runs on OpenAI's live API, the same key and model openai-agent-app uses
// (its .env.example: OPENAI_API_KEY, OPENAI_LIVE_MODEL=gpt-live-1). Optional here on purpose: a
// deployment without it serves every other Demo route normally and refuses only the dial, with
// the message the promo used.
const openaiApiKey = process.env.OPENAI_API_KEY?.trim() || undefined;

const nodeEnv = process.env.NODE_ENV ?? "development";

// Monthly transcription allowance, above which the account is billed extra. 0 (the default) means
// no cap is tracked and the dashboard never mentions one — the app itself is unaffected either way,
// this is purely so nobody is surprised by a bill.
const monthlyCap = Number(process.env.TRANSCRIBE_MONTHLY_CAP ?? 0);
if (!Number.isFinite(monthlyCap) || monthlyCap < 0) {
  throw new Error("TRANSCRIBE_MONTHLY_CAP must be a non-negative number.");
}

// What each transcript beyond the allowance costs, in USD. Shown alongside the cap so the number
// people are approaching has a price attached rather than being an abstract limit. 0 = don't
// mention money at all. Update this if the rate changes — it is quoted verbatim to the customer.
const overageRate = Number(process.env.TRANSCRIBE_OVERAGE_RATE ?? 0.15);
if (!Number.isFinite(overageRate) || overageRate < 0) {
  throw new Error("TRANSCRIBE_OVERAGE_RATE must be a non-negative number of dollars.");
}

// How far through the allowance the warning appears. 0.8 = at 80%, which leaves a fifth of the
// month's headroom to react in. Below this the dashboard shows nothing about the cap at all:
// a limit displayed permanently is noise, and noise gets ignored on the day it matters.
const capWarnAt = Number(process.env.TRANSCRIBE_CAP_WARN_AT ?? 0.8);
if (!Number.isFinite(capWarnAt) || capWarnAt <= 0 || capWarnAt > 1) {
  throw new Error("TRANSCRIBE_CAP_WARN_AT must be a fraction between 0 and 1 (e.g. 0.8).");
}

// How long after a period ends its usage total stops changing. A call is only reported once it ends,
// so one that started just before the boundary may still be running; an hour is far longer than any
// real agent call, and the API tells callers the number it used.
const settleSeconds = Number(process.env.USAGE_SETTLE_SECONDS ?? 3600);
if (!Number.isFinite(settleSeconds) || settleSeconds < 0) {
  throw new Error("USAGE_SETTLE_SECONDS must be a non-negative number of seconds.");
}

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
  agentConfigKey,
  geminiApiKey,
  businessExtractModel,
  openaiApiKey,
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  openaiLiveModel: process.env.OPENAI_LIVE_MODEL || "gpt-live-1",
  openaiBackendModel: process.env.OPENAI_BACKEND_MODEL || "gpt-5.6-terra",
  callReviewModel: process.env.CALL_REVIEW_MODEL || "gpt-5.6-terra",
  // A browser that sends no timezone, or a value that is not one.
  defaultTimezone: process.env.DEFAULT_TIMEZONE || "America/Los_Angeles",
  monthlyCap,
  capWarnAt,
  overageRate,
  settleSeconds,
  authSecret: resolveAuthSecret(),
  authTokenTtlHours: ttlHours,
  seedAdminEmail,
  seedAdminPassword,
  seedAdminName,
} as const;

export type Env = typeof env;
