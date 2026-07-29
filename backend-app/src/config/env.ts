// Typed access to environment configuration.
// Bun automatically loads `.env` from the project root at startup — no dotenv needed.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and set a Postgres connection string.",
  );
}

// --- Schedule / booking config ---------------------------------------------------
// The bookable slot grid: business hours in a given timezone, divided into fixed slots.

// "HH:MM" -> minutes since midnight.
function parseTimeOfDay(value: string, name: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  const hours = match ? Number(match[1]) : NaN;
  const minutes = match ? Number(match[2]) : NaN;
  if (!match || hours > 23 || minutes > 59) {
    throw new Error(`${name} must be "HH:MM" (00:00–23:59), got "${value}".`);
  }
  return hours * 60 + minutes;
}

// Validate the timezone by asking Intl to use it (throws on an unknown zone).
function assertTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`SCHEDULE_TIMEZONE "${tz}" is not a valid IANA timezone.`);
  }
}

const startMinutes = parseTimeOfDay(
  process.env.SCHEDULE_START ?? "09:00",
  "SCHEDULE_START",
);
const endMinutes = parseTimeOfDay(
  process.env.SCHEDULE_END ?? "17:00",
  "SCHEDULE_END",
);
if (endMinutes <= startMinutes) {
  throw new Error("SCHEDULE_END must be later than SCHEDULE_START.");
}

const slotMinutes = Number(process.env.SCHEDULE_SLOT_MINUTES ?? 30);
if (!Number.isInteger(slotMinutes) || slotMinutes <= 0) {
  throw new Error("SCHEDULE_SLOT_MINUTES must be a positive integer.");
}

// ISO weekdays that are bookable: 1=Mon … 7=Sun. Default Mon–Fri.
const workdays = (process.env.SCHEDULE_WORKDAYS ?? "1,2,3,4,5")
  .split(",")
  .map((d) => Number(d.trim()))
  .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
if (workdays.length === 0) {
  throw new Error("SCHEDULE_WORKDAYS must list ISO weekdays 1–7 (e.g. 1,2,3,4,5).");
}

// Allowed CORS origins for browser calls (the Vercel frontends). Comma-separated list,
// e.g. "https://form.example.com,https://admin.example.com". Unset => allow any origin
// (fine for local/dev; set explicit origins in production).
const corsOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8000),
  databaseUrl,
  corsOrigins,
  schedule: {
    timezone: assertTimeZone(process.env.SCHEDULE_TIMEZONE ?? "UTC"),
    workdays,
    startMinutes,
    endMinutes,
    slotMinutes,
  },
} as const;

export type Env = typeof env;
export type ScheduleConfig = Env["schedule"];
