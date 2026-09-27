import { env } from "../config/env.js";
import { CalendarError, call, failed } from "./types.js";

// Google and Microsoft: the two calendars that sign in with OAuth. The business clicks Connect,
// approves on the provider's own page, and comes back connected — no password ever reaches us. What
// we keep is the refresh token, sealed (secrets.ts), and a short-lived access token beside it.
//
// Both need an app registered with the provider (config/env.ts). Without one the provider shows as
// "needs setup" rather than failing on click.

export type OAuthProvider = "google-calendar" | "outlook";

export type OAuthTokens = {
  refreshToken: string;
  accessToken?: string;
  /** Epoch ms. */
  expiresAt?: number;
};

type Spec = {
  label: string;
  authorize: string;
  token: string;
  scopes: string[];
  clientId: () => string;
  clientSecret: () => string;
  extra: Record<string, string>;
};

const SPECS: Record<OAuthProvider, Spec> = {
  "google-calendar": {
    label: "Google",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    // Read the calendar list and free/busy; write only events. `email` names the account on screen.
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    clientId: () => env.googleClientId,
    clientSecret: () => env.googleClientSecret,
    // offline + consent: without both, a second connect returns no refresh token.
    extra: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  outlook: {
    label: "Microsoft",
    authorize: `https://login.microsoftonline.com/${env.microsoftTenant}/oauth2/v2.0/authorize`,
    token: `https://login.microsoftonline.com/${env.microsoftTenant}/oauth2/v2.0/token`,
    scopes: ["offline_access", "User.Read", "Calendars.ReadWrite"],
    clientId: () => env.microsoftClientId,
    clientSecret: () => env.microsoftClientSecret,
    extra: { prompt: "select_account" },
  },
};

export function oauthConfigured(provider: OAuthProvider): boolean {
  const spec = SPECS[provider];
  return Boolean(spec.clientId() && spec.clientSecret());
}

export function redirectUri(provider: OAuthProvider, origin: string): string {
  const base = env.publicBackendUrl || origin.replace(/\/$/, "");
  return `${base}/calendar/oauth/${provider === "google-calendar" ? "google" : "microsoft"}/callback`;
}

export function authorizeUrl(provider: OAuthProvider, state: string, redirect: string): string {
  const spec = SPECS[provider];
  const params = new URLSearchParams({
    client_id: spec.clientId(),
    redirect_uri: redirect,
    response_type: "code",
    scope: spec.scopes.join(" "),
    state,
    ...spec.extra,
  });
  return `${spec.authorize}?${params}`;
}

async function tokenRequest(provider: OAuthProvider, body: Record<string, string>): Promise<any> {
  const spec = SPECS[provider];
  const res = await call(spec.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: spec.clientId(), client_secret: spec.clientSecret(), ...body }),
  });
  const data = res.json();
  if (!res.ok || !data?.access_token) {
    // invalid_grant is a revoked or expired refresh token: the business has to sign in again.
    if (data?.error === "invalid_grant" || res.status === 400 || res.status === 401) {
      throw new CalendarError("auth", `${spec.label} signed this connection out. Reconnect it.`);
    }
    throw failed(spec.label, res.status, data?.error_description);
  }
  return data;
}

/** Trade the code from the callback for tokens. */
export async function exchangeCode(provider: OAuthProvider, code: string, redirect: string): Promise<OAuthTokens> {
  const data = await tokenRequest(provider, { grant_type: "authorization_code", code, redirect_uri: redirect });
  if (!data.refresh_token) {
    throw new CalendarError(
      "auth",
      `${SPECS[provider].label} didn't allow offline access. Try connecting again and approve every permission.`,
    );
  }
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in ?? 3000) * 1000,
  };
}

/**
 * A valid access token, refreshed when it is within a minute of expiring. `save` is called with the
 * new tokens — Microsoft rotates the refresh token on every use, so not saving it would sign the
 * business out on the next refresh.
 */
export async function accessToken(
  provider: OAuthProvider,
  tokens: OAuthTokens,
  save: (next: OAuthTokens) => Promise<void>,
): Promise<string> {
  if (tokens.accessToken && (tokens.expiresAt ?? 0) > Date.now() + 60_000) return tokens.accessToken;
  const data = await tokenRequest(provider, { grant_type: "refresh_token", refresh_token: tokens.refreshToken });
  const next: OAuthTokens = {
    refreshToken: data.refresh_token || tokens.refreshToken,
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in ?? 3000) * 1000,
  };
  await save(next);
  Object.assign(tokens, next);
  return next.accessToken!;
}
