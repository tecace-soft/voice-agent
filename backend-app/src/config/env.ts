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

// --- Cal.com (meeting link only) -------------------------------------------------
// The backend owns availability + the booking; Cal.com is used ONLY to create the
// meeting (calendar invite + join link) when a booking is confirmed, and to cancel it
// when the booking is deleted — so a freed slot can be cleanly re-booked. Both optional:
// with no CAL_API_KEY the Cal.com step is skipped and bookings still work (just no link).
// --- Agent tools (Retell custom functions) ---------------------------------------
// The voice agent (Retell) calls the /agent/* tool endpoints as custom functions during
// a call. If this secret is set, those endpoints require a matching `x-agent-secret`
// header (configured on the Retell function). Unset = open (dev only) — set it in prod.
const agentToolsSecret = process.env.AGENT_TOOLS_SECRET?.trim() ?? "";

// --- Transcribe app (voicemail metrics ingest) -----------------------------------
// The transcribe-app POSTs a run summary to /transcribe/runs after each pass. When this key is
// set, that write endpoint requires a matching `x-transcribe-key` header; unset = open (dev only).
const transcribeIngestKey = process.env.TRANSCRIBE_INGEST_KEY?.trim() ?? "";

// --- Retell post-call webhook (retry / outcome handling) -------------------------
// Retell POSTs call_ended/call_analyzed to /retell/webhook. When a call didn't connect we
// schedule a retry (setting callback_after, which the poller honors) up to a cap, then mark
// the lead unreachable. These bound the automatic retries; keep maxAttempts in sync with the
// poller's MAX_CALL_ATTEMPTS.
const retellRetryDelaySeconds = Number(process.env.RETELL_RETRY_DELAY_SECONDS ?? 60);
if (!Number.isFinite(retellRetryDelaySeconds) || retellRetryDelaySeconds < 0) {
  throw new Error("RETELL_RETRY_DELAY_SECONDS must be a non-negative number.");
}
const retellMaxAttempts = Number(process.env.RETELL_MAX_ATTEMPTS ?? 3);
if (!Number.isInteger(retellMaxAttempts) || retellMaxAttempts <= 0) {
  throw new Error("RETELL_MAX_ATTEMPTS must be a positive integer.");
}

// --- Transactional email (SMTP) --------------------------------------------------
// Follow-up emails (e.g. to a lead we only reached by voicemail) go out over SMTP — reuse the
// same Gmail SMTP_* credentials the voice-agent app uses (App Password, not the login pw).
// Optional: with no SMTP_HOST/USERNAME/PASSWORD the email step is skipped and the rest of the
// flow still works. SMTP_FROM defaults to the username (Gmail requires From = authed account).
const smtpHost = process.env.SMTP_HOST?.trim() ?? "";
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
if (!Number.isInteger(smtpPort) || smtpPort <= 0) {
  throw new Error("SMTP_PORT must be a positive integer.");
}
const smtpUser = process.env.SMTP_USERNAME?.trim() ?? "";
const smtpPass = process.env.SMTP_PASSWORD?.trim() ?? "";
const smtpFrom = (process.env.SMTP_FROM ?? process.env.SMTP_USERNAME ?? "").trim();

const calApiKey = process.env.CAL_API_KEY?.trim() ?? "";
// The event type carrying the video/Teams config. CAL_EVENT_ID preferred; the older
// CAL_EVENT_TYPE_ID name is accepted as a fallback.
const calEventIdRaw = (process.env.CAL_EVENT_ID ?? process.env.CAL_EVENT_TYPE_ID ?? "").trim();
const calEventId = calEventIdRaw ? Number(calEventIdRaw) : 0;
if (calApiKey && (!Number.isInteger(calEventId) || calEventId <= 0)) {
  throw new Error("CAL_EVENT_ID must be a positive integer when CAL_API_KEY is set.");
}

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
  cal: {
    apiKey: calApiKey,
    eventId: calEventId,
    enabled: Boolean(calApiKey && calEventId),
  },
  email: {
    host: smtpHost,
    port: smtpPort,
    user: smtpUser,
    pass: smtpPass,
    from: smtpFrom,
    enabled: Boolean(smtpHost && smtpUser && smtpPass),
  },
  agentToolsSecret,
  transcribeIngestKey,
  retell: {
    retryDelaySeconds: retellRetryDelaySeconds,
    maxAttempts: retellMaxAttempts,
  },
} as const;

export type Env = typeof env;
export type ScheduleConfig = Env["schedule"];
