import { oauthConfigured } from "./oauth.js";
import type { ProviderId, ProviderKind } from "./types.js";

// Which calendars and booking tools a business can connect today, and how.
//
// The Appointments screen draws every product the public demo page names, so a business sees the
// one it runs even when we cannot connect it yet. What is connectable is decided here, once, from
// what is implemented and what is configured on this server:
//
//   * ready        — connect now. OAuth ones only when the app is registered (config/env.ts).
//   * needs_setup  — implemented, but this server has no OAuth app for it. An admin can fix that.
//   * soon         — no public API a small business can connect to on its own. The restaurant
//                    systems (OpenTable, Resy, Tock, SevenRooms, Toast, Yelp, Eat App, Reserve with
//                    Google) only open booking to approved partners; Square, Zoho and HubSpot have
//                    APIs, but each needs its own OAuth app and review first.

export type ConnectMethod = "oauth" | "caldav" | "apikey";
export type ProviderStatus = "ready" | "needs_setup" | "soon";

export type CatalogEntry = {
  id: string;
  kind: ProviderKind;
  method: ConnectMethod | null;
  status: ProviderStatus;
};

const IMPLEMENTED: { id: ProviderId; kind: ProviderKind; method: ConnectMethod }[] = [
  { id: "google-calendar", kind: "calendar", method: "oauth" },
  { id: "outlook", kind: "calendar", method: "oauth" },
  { id: "apple-calendar", kind: "calendar", method: "caldav" },
  { id: "caldav", kind: "calendar", method: "caldav" },
  { id: "cal-com", kind: "booking", method: "apikey" },
  { id: "calendly", kind: "booking", method: "apikey" },
  { id: "squarespace", kind: "booking", method: "apikey" },
];

const COMING: { id: string; kind: ProviderKind }[] = [
  { id: "square", kind: "booking" },
  { id: "zoho", kind: "booking" },
  { id: "hubspot", kind: "booking" },
  { id: "opentable", kind: "booking" },
  { id: "resy", kind: "booking" },
  { id: "tock", kind: "booking" },
  { id: "sevenrooms", kind: "booking" },
  { id: "yelp-guest-manager", kind: "booking" },
  { id: "toast-tables", kind: "booking" },
  { id: "eat-app", kind: "booking" },
  { id: "reserve-with-google", kind: "booking" },
];

export function isProvider(id: string): id is ProviderId {
  return IMPLEMENTED.some((p) => p.id === id);
}

export function providerKind(id: ProviderId): ProviderKind {
  return IMPLEMENTED.find((p) => p.id === id)!.kind;
}

export function catalog(): CatalogEntry[] {
  return [
    ...IMPLEMENTED.map((p) => ({
      ...p,
      status: (p.method === "oauth" && !oauthConfigured(p.id as "google-calendar" | "outlook")
        ? "needs_setup"
        : "ready") as ProviderStatus,
    })),
    ...COMING.map((p) => ({ ...p, method: null, status: "soon" as const })),
  ];
}

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  "google-calendar": "Google Calendar",
  outlook: "Outlook",
  "apple-calendar": "Apple Calendar",
  caldav: "CalDAV calendar",
  "cal-com": "Cal.com",
  calendly: "Calendly",
  squarespace: "Squarespace Scheduling",
};
