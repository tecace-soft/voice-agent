import type {
  AccountStatus,
  AgentNumber,
  AvailableNumber,
  NumberSync,
  NumberWebhooks,
  ApiKey,
  CallMinutes,
  CreatedApiKey,
  InboundCall,
  BusinessProfile,
  BusinessProfileResponse,
  CustomerPrompts,
  DemoBusinessProfile,
  PollerHeartbeat,
  SessionPreview,
  SetupStateResponse,
  SetupTurnResponse,
  TestCallsResponse,
  TestUsage,
  TranscribeFailure,
  AuthUser,
  MailboxScope,
  MailboxSummary,
  CreatedAccount,
  Feedback,
  FeedbackCategory,
  FeedbackStatus,
  LoginResponse,
  Role,
  TranscribeAnalytics,
  TranscribeStats,
} from "./types";
import type { CallSettings, StoredCallSettings } from "../settings/callSettings";
import { readStoredToken, storeToken } from "../session/token";

// Single place that talks to the backend API. Base URL comes from BACKEND_URL (set in .env locally
// and in the Vercel project for production), injected by vite.config.ts as __BACKEND_URL__ — see
// the comment there for why it isn't a VITE_ name.
const BASE_URL: string = __BACKEND_URL__;

// The session token's storage is `session/token.ts`, shared with the public sign-up pages.
let token: string | null = readStoredToken();

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  token = next;
  storeToken(next);
}

// Called when the backend rejects our token mid-session (expired, or revoked from the CLI) so the
// app can drop straight back to the sign-in screen instead of showing a stale error.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export class BackendError extends Error {
  status: number;
  /** Which input the backend refused, when it says (call settings do): "transfer.scenarios[0].name". */
  field?: string;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.name = "BackendError";
    this.status = status;
    this.field = field;
  }
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; anonymous?: boolean } = {},
): Promise<T> {
  if (!BASE_URL) {
    throw new BackendError("Backend URL is not configured (set BACKEND_URL).", 0);
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (token && !options.anonymous) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new BackendError("Couldn't reach the server.", 0);
  }

  const text = await res.text();
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    let field: string | undefined;
    try {
      const body = JSON.parse(text);
      if (body?.message) message = body.message;
      if (typeof body?.field === "string") field = body.field;
    } catch {
      /* keep the default */
    }
    // A rejected token on a normal call means the session is over — but a 401 from the login
    // route is just a wrong password, and must not be treated as a session ending.
    if (res.status === 401 && !options.anonymous) {
      setToken(null);
      onUnauthorized?.();
    }
    throw new BackendError(message, res.status, field);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

const get = <T>(path: string): Promise<T> => request<T>("GET", path);

// ---- auth ----

// Exchange credentials for a session token, and remember it.
export async function login(email: string, password: string): Promise<LoginResponse> {
  const result = await request<LoginResponse>("POST", "/auth/login", {
    body: { email, password },
    anonymous: true,
  });
  setToken(result.token);
  return result;
}

// Who the stored token belongs to — used on boot to restore the session.
export async function fetchMe(): Promise<AuthUser> {
  return (await get<{ user: AuthUser }>("/auth/me")).user;
}

// Tokens are stateless, so signing out is discarding ours; we still tell the backend, and we drop
// the token even if that call fails.
export async function logout(): Promise<void> {
  try {
    await request("POST", "/auth/logout", {});
  } catch {
    /* signing out locally is what matters */
  } finally {
    setToken(null);
  }
}

// ---- first-run setup ----

// Whether this deployment still has no accounts at all. Answered without a session, because the
// dashboard has to ask it before it can know which form to show.
// `mail`: this deployment can send email (Forgot password shows). `signup`: /start is open.
export function getSetupState(): Promise<{ needsSetup: boolean; mail?: boolean; signup?: boolean }> {
  return request<{ needsSetup: boolean; mail?: boolean; signup?: boolean }>("GET", "/auth/setup-state", { anonymous: true });
}

// A reset link by email. Always answers the same, whether the address has an account or not.
export function forgotPassword(email: string): Promise<{ sent: boolean }> {
  return request<{ sent: boolean }>("POST", "/auth/forgot", { body: { email }, anonymous: true });
}

// Whose invite or reset link this is, before they choose a password.
export function inspectLink(token: string): Promise<{ purpose: "invite" | "reset"; name: string; email: string }> {
  return request("POST", "/auth/tokens/inspect", { body: { token }, anonymous: true });
}

// Use an invite or reset link: set the password and sign in.
export async function acceptLink(token: string, password: string): Promise<LoginResponse> {
  const result = await request<LoginResponse>("POST", "/auth/tokens/accept", { body: { token, password }, anonymous: true });
  setToken(result.token);
  return result;
}

// Change your own password; other sessions are signed out, this one gets a fresh token.
export async function changeMyPassword(current: string, password: string): Promise<LoginResponse> {
  const result = await request<LoginResponse>("POST", "/auth/me/password", { body: { current, password } });
  setToken(result.token);
  return result;
}

// Admin: a one-time sign-in link for an account (choose a password). Emailed too when mail is set up.
export function inviteAccount(id: string): Promise<{ token: string; link: string | null; expiresAt: string; emailed: boolean }> {
  return request("POST", `/auth/users/${id}/invite`, {});
}

// Admin: setup requests waiting for an answer, for the sidebar badge.
export async function countSetupRequests(): Promise<number> {
  return (await get<{ requests: unknown[] }>("/demo/setup-requests")).requests.length;
}

// Create the very first account and sign straight in. The backend closes this route as soon as any
// account exists.
export async function setupFirstAccount(
  name: string,
  email: string,
  password: string,
): Promise<LoginResponse> {
  const result = await request<LoginResponse>("POST", "/auth/setup", {
    body: { name, email, password },
    anonymous: true,
  });
  setToken(result.token);
  return result;
}

// ---- accounts (signed in) ----

export async function listAccounts(): Promise<AuthUser[]> {
  return (await get<{ users: AuthUser[] }>("/auth/users")).users;
}

// Omit the password to have the backend generate one — it comes back once, in the response.
export function createAccount(
  name: string,
  email: string,
  role: Role,
  password?: string,
): Promise<CreatedAccount> {
  return request<CreatedAccount>("POST", "/auth/users", {
    body: { name, email, role, password: password ?? "" },
  });
}

// Promote to admin or demote to user.
export function setAccountRole(id: string, role: Role): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>("POST", `/auth/users/${id}/role`, { body: { role } });
}

export function resetAccountPassword(id: string, password?: string): Promise<CreatedAccount> {
  return request<CreatedAccount>("POST", `/auth/users/${id}/password`, { body: { password: password ?? "" } });
}

export function revokeAccountSessions(id: string): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>("POST", `/auth/users/${id}/revoke`, { body: {} });
}

export function removeAccount(id: string): Promise<void> {
  return request<void>("DELETE", `/auth/users/${id}`);
}

// ---- the customer lifecycle (admins only) ----
//
// Three calls because they are three decisions. Linking an account to the Demos customer it came
// from says where its data may be copied from; the stage says what the account sees; and the copy is
// the one action that cannot be repeated — after it, the two records are unrelated, so an edit in
// the Demos section never reaches the customer's live receptionist and vice versa.

/** Point an account at the Demos customer it grew out of. `null` unlinks. */
export function setAccountBusiness(id: string, businessId: string | null): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>("POST", `/auth/users/${id}/business`, { body: { businessId } });
}

export function setAccountStatus(id: string, status: AccountStatus): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>("POST", `/auth/users/${id}/status`, { body: { status } });
}

/**
 * Copy the linked demo's knowledge and prompts into the account's own Business information, once,
 * and move it out of the demo stage. Refuses if they already have their own — overwriting it would
 * discard whatever the customer has corrected since.
 */
export function promoteAccount(id: string): Promise<{ user: AuthUser; profile: unknown }> {
  return request<{ user: AuthUser; profile: unknown }>("POST", `/auth/users/${id}/promote`, { body: {} });
}

/** One line of the Go live checklist (transcribe-backend `business/readiness.ts`). */
export type ReadinessItem = {
  id: string;
  ok: boolean;
  /** A required item blocks Go live; the others are advice. */
  required: boolean;
  label: string;
  detail?: string;
};
export type Readiness = { status: AccountStatus; ready: boolean; items: ReadinessItem[] };

/** Is the line ready to be switched on? Your own, or (admin) another account's by id. */
export function getReadiness(userId?: string): Promise<Readiness> {
  return get<Readiness>(`/business/readiness${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`);
}

/**
 * Onboarding → production: switch the account's phone line on. The only way into production; the
 * backend refuses (409, naming what is missing) until every required readiness item is ticked.
 */
export function goLiveAccount(id: string): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>("POST", `/auth/users/${id}/go-live`, { body: {} });
}

// ---- feedback ----

// Send a note. The backend takes the author from the session, so there's nothing to pass but the
// note itself. `screenshot` is a data URL the client has already downscaled (see screenshot.ts);
// it is left out of the body entirely when there isn't one, rather than sent as null.
export function sendFeedback(
  category: FeedbackCategory,
  message: string,
  screenshot?: string | null,
): Promise<{ feedback: Feedback }> {
  return request<{ feedback: Feedback }>("POST", "/feedback", {
    body: screenshot ? { category, message, screenshot } : { category, message },
  });
}

// Your own notes.
export async function listMyFeedback(): Promise<Feedback[]> {
  return (await get<{ feedback: Feedback[] }>("/feedback/mine")).feedback;
}

// Everything anyone has sent (admins only), with the open count.
export function listAllFeedback(): Promise<{ feedback: Feedback[]; open: number }> {
  return get<{ feedback: Feedback[]; open: number }>("/feedback");
}

// Just the open count, for the sidebar badge (admins only).
export async function countOpenFeedback(): Promise<number> {
  return (await get<{ open: number }>("/feedback/open-count")).open;
}

export function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<{ feedback: Feedback }> {
  return request<{ feedback: Feedback }>("POST", `/feedback/${id}/status`, { body: { status } });
}

// ---- data ----

// The backend pins a non-admin to their own mailbox regardless of what is sent, so this parameter
// only ever narrows an admin's view. `null` asks for the runs reported before mailboxes existed.
function mailboxQuery(mailbox: MailboxScope): string {
  if (mailbox === undefined) return "";
  return `?mailbox=${encodeURIComponent(mailbox === null ? "unattributed" : mailbox)}`;
}

// Voicemail transcription stats (requires a signed-in session).
export function getTranscribeStats(mailbox?: MailboxScope): Promise<TranscribeStats> {
  return get<TranscribeStats>(`/transcribe/stats${mailboxQuery(mailbox)}`);
}

// Which mailboxes have reported runs (admins only).
export async function listMailboxes(): Promise<MailboxSummary[]> {
  return (await get<{ mailboxes: MailboxSummary[] }>("/transcribe/mailboxes")).mailboxes;
}

// The deeper cut behind the Analytics view — all-time totals, 90 days of daily figures, hour and
// weekday patterns, and how regularly the app has been running.
export function getTranscribeAnalytics(mailbox?: MailboxScope): Promise<TranscribeAnalytics> {
  return get<TranscribeAnalytics>(`/transcribe/analytics${mailboxQuery(mailbox)}`);
}

// ---- failures ----

// Why voicemails failed, newest first, with how many nobody has looked at yet.
export function listFailures(
  mailbox?: MailboxScope,
): Promise<{ failures: TranscribeFailure[]; unacknowledged: number }> {
  return get<{ failures: TranscribeFailure[]; unacknowledged: number }>(
    `/transcribe/failures${mailboxQuery(mailbox)}`,
  );
}

// "I've seen these." Clears the badge for the scope being viewed; the entries stay in the list.
export function acknowledgeFailures(mailbox?: MailboxScope): Promise<{ cleared: number }> {
  return request<{ cleared: number }>("POST", `/transcribe/failures/acknowledge${mailboxQuery(mailbox)}`);
}

// Just the badge number, without pulling the whole list.
export async function countUnseenFailures(mailbox?: MailboxScope): Promise<number> {
  return (await get<{ unacknowledged: number }>(`/transcribe/failures/count${mailboxQuery(mailbox)}`))
    .unacknowledged;
}

// ---- poller liveness ----

export function listPollers(
  mailbox?: MailboxScope,
): Promise<{ pollers: PollerHeartbeat[]; offline: number }> {
  return get<{ pollers: PollerHeartbeat[]; offline: number }>(
    `/transcribe/heartbeats${mailboxQuery(mailbox)}`,
  );
}

// ---- the voice agent's phone numbers (admin) ----

/** Released numbers stay out unless asked for: they are history, not a pool. */
export async function listAgentNumbers(options: { includeReleased?: boolean } = {}): Promise<AgentNumber[]> {
  const query = options.includeReleased ? "?includeReleased=1" : "";
  return (await get<{ numbers: AgentNumber[] }>(`/business/numbers${query}`)).numbers;
}

// The Twilio side. Every one of these answers 409 `twilio_not_configured` on a backend without Twilio
// credentials, with a message the page shows as it is.

export function getNumberWebhooks(): Promise<NumberWebhooks> {
  return get<NumberWebhooks>("/business/numbers/webhooks");
}

/** Bring the Twilio account's numbers into the list; hand-registered ones pick up their SID. */
export function syncAgentNumbers(): Promise<NumberSync> {
  return request<NumberSync>("POST", "/business/numbers/sync", { body: {} });
}

export async function searchAvailableNumbers(query: {
  type: "local" | "tollfree";
  areaCode?: string;
}): Promise<AvailableNumber[]> {
  const params = new URLSearchParams({ type: query.type });
  if (query.areaCode) params.set("areaCode", query.areaCode);
  return (await get<{ numbers: AvailableNumber[] }>(`/business/numbers/available?${params}`)).numbers;
}

/**
 * Buy a number — an exact one from a search, or the next of a kind — with its webhooks set in the same
 * request, and optionally assign it in the same breath. `requestId` makes a double-click buy once.
 */
export function buyAgentNumber(input: {
  phoneNumber?: string;
  type?: "local" | "tollfree";
  areaCode?: string;
  label?: string;
  assignTo?: string;
  requestId: string;
}): Promise<{ number: AgentNumber }> {
  return request<{ number: AgentNumber }>("POST", "/business/numbers/buy", { body: input });
}

/** Write the wanted webhooks onto the number at Twilio (repair, or adopt a hand-registered one). */
export function configureAgentNumber(id: string): Promise<{ number: AgentNumber }> {
  return request<{ number: AgentNumber }>("POST", `/business/numbers/${id}/configure`, { body: {} });
}

/** Let the number go at Twilio. `confirm` is the number typed back by the admin. */
export function releaseAgentNumber(id: string, confirm: string): Promise<{ number: AgentNumber }> {
  return request<{ number: AgentNumber }>("POST", `/business/numbers/${id}/release`, { body: { confirm } });
}

export function registerAgentNumber(phone: string, label: string): Promise<{ number: AgentNumber }> {
  return request<{ number: AgentNumber }>("POST", "/business/numbers", {
    body: label.trim() ? { phone, label: label.trim() } : { phone },
  });
}

/** `userId: null` un-assigns, leaving the number registered but unowned. */
export function assignAgentNumber(id: string, userId: string | null): Promise<{ number: AgentNumber }> {
  return request<{ number: AgentNumber }>("POST", `/business/numbers/${id}/assign`, {
    body: { userId },
  });
}

export function deleteAgentNumber(id: string): Promise<{ status: string }> {
  return request<{ status: string }>("DELETE", `/business/numbers/${id}`);
}

// ---- a customer's business details ----

/** Their own details, plus the number they're used for. Admins may pass a userId to act for someone. */
export function getBusinessProfile(userId?: string): Promise<BusinessProfileResponse> {
  return get<BusinessProfileResponse>(`/business/profile${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`);
}

/**
 * Save the pasted text. The backend re-reads it into facts unless it is unchanged.
 *
 * A 422 means the text couldn't be read into anything usable — nothing was written, and whatever
 * was live before is still live. The message says what to do about it.
 */
/** The business's own instructions to the assistant. Its own endpoint, like the greeting. */
export function saveHouseRules(
  houseRules: string,
  userId?: string,
): Promise<{ profile: BusinessProfile }> {
  return request<{ profile: BusinessProfile }>(
    "PUT",
    `/business/house-rules${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`,
    { body: { houseRules } },
  );
}

export function saveBusinessProfile(
  sourceText: string,
  transferNumber: string,
  transferTopics: string,
  userId?: string,
): Promise<{ profile: BusinessProfile; extracted: boolean }> {
  return request<{ profile: BusinessProfile; extracted: boolean }>(
    "PUT",
    `/business/profile${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`,
    // agentName/greeting/houseRules are deliberately NOT sent: each belongs to its own section, and
    // the backend leaves absent fields alone rather than clearing them.
    { body: { sourceText, transferNumber, transferTopics } },
  );
}

/**
 * Save the Knowledge tab — the structured profile a customer edits.
 *
 * The backend re-renders everything the phone agent reads from this, so a corrected closing time
 * changes what the agent says and not just what the page shows. It leaves the description alone:
 * editing the profile that was read out of it does not rewrite what the customer wrote.
 */
export function saveBusinessKnowledge(
  profile: DemoBusinessProfile,
  userId?: string,
): Promise<{ profile: BusinessProfile }> {
  return request<{ profile: BusinessProfile }>(
    "PUT",
    `/business/knowledge${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`,
    { body: { profile } },
  );
}

/**
 * Save the Prompt tab.
 *
 * `rebuild` throws hand edits away and generates from the profile again; without it, a prompt that
 * arrives changed is a hand edit and is frozen from then on. That rule is the backend's — and it is
 * the demo's own `resolvePrompts`, so both tabs behave identically because they are the same code.
 */
export function saveBusinessPrompts(
  input: { prompts?: CustomerPrompts; voice?: string; language?: string; rebuild?: boolean },
  userId?: string,
): Promise<{ profile: BusinessProfile }> {
  return request<{ profile: BusinessProfile }>(
    "PUT",
    `/business/prompts${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`,
    { body: input },
  );
}

/** How the assistant introduces itself. Its own endpoint — it never touches the description. */
export function saveAgentIdentity(
  agentName: string,
  greeting: string,
  userId?: string,
): Promise<{ profile: BusinessProfile }> {
  return request<{ profile: BusinessProfile }>(
    "PUT",
    `/business/identity${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`,
    { body: { agentName, greeting } },
  );
}

// ---- call settings: transfers, text-a-link, message scenarios ----

const asUser = (userId?: string) => (userId ? `?userId=${encodeURIComponent(userId)}` : "");

/** The draft the settings screens edit, the published copy callers get, and whether they differ. */
export function getCallSettings(userId?: string): Promise<StoredCallSettings> {
  return get<StoredCallSettings>(`/business/call-settings${asUser(userId)}`);
}

/** Save the draft. A refusal is a BackendError whose `field` names the input to fix. */
export function saveCallSettingsDraft(draft: CallSettings, userId?: string): Promise<StoredCallSettings> {
  return request<StoredCallSettings>("PUT", `/business/call-settings${asUser(userId)}`, { body: { draft } });
}

/** Make the draft what callers get. */
export function publishCallSettings(userId?: string): Promise<StoredCallSettings> {
  return request<StoredCallSettings>("POST", `/business/call-settings/publish${asUser(userId)}`);
}

/** Admin only: turn waterfall transfers on or off for an account. */
export function setWaterfallAllowed(userId: string, allowed: boolean): Promise<StoredCallSettings> {
  return request<StoredCallSettings>("PUT", `/business/call-settings/waterfall${asUser(userId)}`, {
    body: { allowed },
  });
}

// ---- guided setup: the consultant that fills the call-settings draft by interview ----

/** The interview so far, the draft it writes into, and whether this account may use it. */
export function getSetup(userId?: string): Promise<SetupStateResponse> {
  return get<SetupStateResponse>(`/business/setup${asUser(userId)}`);
}
/** One turn. "" starts a session (the consultant's opening); the answer carries the updated draft. */
export function sendSetupTurn(message: string, userId?: string): Promise<SetupTurnResponse> {
  return request<SetupTurnResponse>("POST", `/business/setup/turn${asUser(userId)}`, { body: { message } });
}
/** End the interview. The draft keeps whatever the consultant already wrote. */
export function resetSetup(userId?: string): Promise<{ session: null }> {
  return request<{ session: null }>("POST", `/business/setup/reset${asUser(userId)}`, { body: {} });
}

/**
 * The business's in-app test-call routes, as a raw fetch — the shape the shared call hook dials
 * through (`useLiveCall` reads the responses itself). `/session` and `/calls/:id` under
 * `/business/test`, with the signed-in token.
 */
export function businessTestFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(`${BASE_URL}/business/test${path}`, { ...init, headers });
}

/** Recent test calls and this month's allowance. */
export function getTestCalls(userId?: string): Promise<TestCallsResponse> {
  return get<TestCallsResponse>(`/business/test/calls${asUser(userId)}`);
}

/** Admin only: one account's monthly test seconds, or null for the default. */
export function setTestSecondsCap(userId: string, seconds: number | null): Promise<{ usage: TestUsage }> {
  return request<{ usage: TestUsage }>("PUT", `/business/test/cap${asUser(userId)}`, { body: { seconds } });
}

/** Exactly what a call is told, for the Custom training preview. */
export function getSessionPreview(
  which: "draft" | "published",
  userId?: string,
): Promise<SessionPreview> {
  const q = new URLSearchParams({ settings: which, ...(userId ? { userId } : {}) });
  return get<SessionPreview>(`/business/session-preview?${q.toString()}`);
}

// ---- calls the agent answered ----

/**
 * A customer's calls, or — for an admin — one customer's, or everyone's when no id is given.
 * "unassigned" (admin) = calls on numbers nobody owns.
 */
export async function listInboundCalls(userId?: string): Promise<InboundCall[]> {
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return (await get<{ calls: InboundCall[] }>(`/calls${q}`)).calls;
}

/** Permanently remove one call. A customer may only delete their own; an admin, any. */
export function deleteInboundCall(id: string): Promise<{ status: string }> {
  return request<{ status: string }>("DELETE", `/calls/${encodeURIComponent(id)}`);
}

// ---- talk time ----

/**
 * Minutes the agent spent on calls, per business, this month and last. A customer always gets their
 * own business, whatever is asked for; an admin gets every business, or one account's, or
 * "unassigned".
 */
export function listCallMinutes(userId?: string): Promise<{ timezone: string; minutes: CallMinutes[] }> {
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return get<{ timezone: string; minutes: CallMinutes[] }>(`/usage/minutes${q}`);
}

// ---- API keys other systems read the usage endpoint with (admins only) ----

export async function listApiKeys(): Promise<ApiKey[]> {
  return (await get<{ keys: ApiKey[] }>("/api-keys")).keys;
}

/** A key reads every business. The secret comes back once, here. */
export function createApiKey(name: string): Promise<CreatedApiKey> {
  return request<CreatedApiKey>("POST", "/api-keys", { body: { name } });
}

export function revokeApiKey(id: string): Promise<{ key: ApiKey }> {
  return request<{ key: ApiKey }>("POST", `/api-keys/${encodeURIComponent(id)}/revoke`, { body: {} });
}

export function deleteApiKey(id: string): Promise<{ status: string }> {
  return request<{ status: string }>("DELETE", `/api-keys/${encodeURIComponent(id)}`);
}

// ---- calendar: the Appointments section (transcribe-backend src/routes/calendar.ts) ----

export type CalendarProviderStatus = "ready" | "needs_setup" | "soon";
export type CalendarProvider = {
  id: string;
  kind: "calendar" | "booking";
  method: "oauth" | "caldav" | "apikey" | null;
  status: CalendarProviderStatus;
};
export type CalendarConnection = {
  provider: string;
  providerName: string;
  account: string;
  targetId: string | null;
  targetName: string | null;
  status: "ok" | "error";
  lastError: string | null;
  connectedAt: string;
};
export type CalendarTarget = { id: string; name: string; primary?: boolean; durationMinutes?: number };
export type CalendarBooking = {
  id: string;
  provider: string;
  start: string;
  end: string;
  callerName: string;
  callerPhone: string;
  reason: string;
  test: boolean;
  createdAt: string;
};
export type CalendarOverview = {
  providers: CalendarProvider[];
  connection: CalendarConnection | null;
  bookings: CalendarBooking[];
};
export type CalendarOpening = { start: string; spoken: string };

export function getCalendar(userId?: string): Promise<CalendarOverview> {
  return get<CalendarOverview>(`/business/calendar${asUser(userId)}`);
}

/** Connect with typed credentials. A refusal is a BackendError with the provider's reason. */
export function connectCalendar(
  provider: string,
  credentials: Record<string, string>,
  userId?: string,
): Promise<{ connection: CalendarConnection; targets: CalendarTarget[] }> {
  return request("POST", `/business/calendar/connect${asUser(userId)}`, { body: { provider, credentials } });
}

/** The provider's sign-in page; the browser goes there and comes back to `returnTo`. */
export function startCalendarOAuth(provider: string, returnTo: string, userId?: string): Promise<{ url: string }> {
  return request("POST", `/business/calendar/oauth/start${asUser(userId)}`, { body: { provider, returnTo } });
}

export function getCalendarTargets(userId?: string): Promise<{ targets: CalendarTarget[] }> {
  return get(`/business/calendar/targets${asUser(userId)}`);
}

export function setCalendarTarget(targetId: string, userId?: string): Promise<{ connection: CalendarConnection }> {
  return request("PUT", `/business/calendar/target${asUser(userId)}`, { body: { targetId } });
}

export function disconnectCalendar(userId?: string): Promise<{ connection: null }> {
  return request("DELETE", `/business/calendar${asUser(userId)}`);
}

export function checkCalendarOpenings(
  ask: { date?: string; partOfDay?: string },
  userId?: string,
): Promise<{ timeZone: string; openings: CalendarOpening[]; nearest?: CalendarOpening[] }> {
  return request("POST", `/business/calendar/availability${asUser(userId)}`, { body: ask });
}

/** An in-app test call's check_availability / book_appointment. Books for real, titled "[Test]". */
export function runCalendarTool(
  name: string,
  args: Record<string, unknown>,
  userId?: string,
  callerNumber?: string,
): Promise<Record<string, unknown>> {
  return request("POST", `/business/calendar/tool${asUser(userId)}`, { body: { name, args, callerNumber } });
}
