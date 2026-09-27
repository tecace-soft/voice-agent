import { CalendarDays } from "lucide-react";
import { INTEGRATIONS, type Integration } from "@/lib/integrations";

// How each calendar and booking tool is presented and connected in the Appointments section: its
// name and mark, the fields a business types in, and where to find them. Whether one can be
// connected at all comes from the backend (`GET /business/calendar`), which knows what this server
// is configured for; this file only knows how to ask for it.
//
// The marks reuse the public demo page's integration data (src/demos/lib/integrations.ts), so a
// business sees the same logo on its demo and in its settings.

export type CredentialField = {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "email";
  placeholder?: string;
  hint?: string;
};

export type ProviderUi = {
  id: string;
  name: string;
  group: "calendar" | "booking" | "tables";
  /** One line under the name in the connect dialog. */
  blurb: string;
  fields?: CredentialField[];
  /** Where the key or password is found, in the order the business clicks through. */
  steps?: string[];
  link?: { href: string; label: string };
  /** Something to know before connecting: a plan requirement, what email a booking uses. */
  note?: string;
};

export const PROVIDERS_UI: ProviderUi[] = [
  {
    id: "google-calendar",
    name: "Google Calendar",
    group: "calendar",
    blurb: "Sign in with Google. Works with Gmail and Google Workspace calendars.",
  },
  {
    id: "outlook",
    name: "Microsoft Outlook",
    group: "calendar",
    blurb: "Sign in with Microsoft. Works with Microsoft 365 and Outlook.com calendars.",
  },
  {
    id: "apple-calendar",
    name: "Apple Calendar",
    group: "calendar",
    blurb: "Your iCloud calendar, with your Apple ID and an app-specific password.",
    fields: [
      { key: "username", label: "Apple ID email", type: "email", placeholder: "you@icloud.com" },
      {
        key: "password",
        label: "App-specific password",
        type: "password",
        placeholder: "xxxx-xxxx-xxxx-xxxx",
        hint: "Not your Apple ID password. Apple only lets other apps in with an app-specific one.",
      },
    ],
    steps: [
      "Sign in at account.apple.com.",
      "Open Sign-In and Security, then App-Specific Passwords.",
      "Create one called Receptionist and paste it here.",
    ],
    link: { href: "https://account.apple.com/account/manage", label: "Open Apple Account" },
    note: "App-specific passwords need two-factor authentication on the Apple ID. Changing your Apple ID password signs this connection out.",
  },
  {
    id: "caldav",
    name: "Other calendar (CalDAV)",
    group: "calendar",
    blurb: "Fastmail, Nextcloud, Zoho Calendar, Synology and most other calendars that support CalDAV.",
    fields: [
      { key: "server", label: "CalDAV server address", type: "url", placeholder: "https://caldav.fastmail.com" },
      { key: "username", label: "User name", type: "text" },
      {
        key: "password",
        label: "Password",
        type: "password",
        hint: "If your provider offers app passwords, use one of those.",
      },
    ],
    steps: ["Find the CalDAV address in your calendar provider's help pages or settings.", "Sign in with the same account you use there."],
  },
  {
    id: "cal-com",
    name: "Cal.com",
    group: "booking",
    blurb: "Books into one of your Cal.com event types, with its own availability and emails.",
    fields: [{ key: "apiKey", label: "API key", type: "password", placeholder: "cal_live_…" }],
    steps: ["In Cal.com, open Settings, then Developer, then API keys.", "Add a key that doesn't expire and paste it here."],
    link: { href: "https://app.cal.com/settings/developer/api-keys", label: "Open Cal.com API keys" },
    note: "Cal.com needs an email for every booking. Unless the caller gives one, the confirmation goes to the account email.",
  },
  {
    id: "calendly",
    name: "Calendly",
    group: "booking",
    blurb: "Books into one of your Calendly event types, with its own availability and emails.",
    fields: [{ key: "token", label: "Personal access token", type: "password" }],
    steps: [
      "In Calendly, open Integrations & apps, then API and webhooks.",
      "Generate a personal access token and paste it here.",
    ],
    link: { href: "https://calendly.com/integrations/api_webhooks", label: "Open Calendly API settings" },
    note: "Calendly only takes bookings through its API on a paid plan. The confirmation goes to the account email unless the caller gives one.",
  },
  {
    id: "squarespace",
    name: "Squarespace Scheduling",
    group: "booking",
    blurb: "Squarespace Scheduling or Acuity Scheduling — the same keys work for both.",
    fields: [
      { key: "userId", label: "User ID", type: "text" },
      { key: "apiKey", label: "API key", type: "password" },
    ],
    steps: ["Open Integrations, then API.", "Select View credentials and copy the User ID and API key."],
    link: { href: "https://secure.acuityscheduling.com/app.php?key=api&action=settings", label: "Open API credentials" },
    note: "API access is part of Squarespace Scheduling's higher plans.",
  },
  { id: "square", name: "Square Appointments", group: "booking", blurb: "" },
  { id: "zoho", name: "Zoho Bookings", group: "booking", blurb: "" },
  { id: "hubspot", name: "HubSpot Meetings", group: "booking", blurb: "" },
  { id: "opentable", name: "OpenTable", group: "tables", blurb: "" },
  { id: "resy", name: "Resy", group: "tables", blurb: "" },
  { id: "tock", name: "Tock", group: "tables", blurb: "" },
  { id: "sevenrooms", name: "SevenRooms", group: "tables", blurb: "" },
  { id: "yelp-guest-manager", name: "Yelp Guest Manager", group: "tables", blurb: "" },
  { id: "toast-tables", name: "Toast Tables", group: "tables", blurb: "" },
  { id: "eat-app", name: "Eat App", group: "tables", blurb: "" },
  { id: "reserve-with-google", name: "Reserve with Google", group: "tables", blurb: "" },
];

export const PROVIDER_GROUPS: { id: ProviderUi["group"]; title: string; blurb: string }[] = [
  { id: "calendar", title: "Calendars", blurb: "The assistant checks when you're free and writes the booking into your calendar." },
  { id: "booking", title: "Booking tools", blurb: "Keep your booking tool. The assistant books through it, so its emails and reminders keep working." },
  {
    id: "tables",
    title: "Reservation systems",
    blurb: "These only open booking to approved partners. We're working on it — until then the assistant takes the reservation as a message.",
  },
];

export function providerUi(id: string): ProviderUi | undefined {
  return PROVIDERS_UI.find((p) => p.id === id);
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
      <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

function Monogram({ integration }: { integration: Integration }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <rect width="24" height="24" rx="6" fill={integration.hex} />
      <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">
        {integration.name.charAt(0)}
      </text>
    </svg>
  );
}

/** The provider's mark, as the public demo page draws it. A generic calendar for CalDAV. */
export function ProviderMark({ id }: { id: string }) {
  const integration = INTEGRATIONS.find((i) => i.id === id);
  if (!integration) return <CalendarDays className="text-muted-foreground size-5" aria-hidden />;
  if (integration.path === "microsoft") return <MicrosoftMark />;
  if (integration.path === "monogram") return <Monogram integration={integration} />;
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path d={integration.path} fill={integration.hex} />
    </svg>
  );
}
