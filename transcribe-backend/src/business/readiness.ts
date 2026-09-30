import type { BusinessProfile } from "../db/businessProfiles.js";
import type { StoredCallSettings } from "../db/callSettings.js";
import { CallSettingsError, validateCallSettings } from "./callSettings.js";

// Is this business ready for its line to be switched on?
//
// One list, read by three places that must agree: the customer's checklist on the Business page, the
// admin's Go live panel, and Go live itself, which refuses unless every required item is ticked.
// The phone line only ever uses the PUBLISHED settings, so that is what is checked — a tidy draft
// that was never published is not what callers would get.
//
// Pure: the read for one account is `db/readiness.ts`.

export type ReadinessId =
  | "business_info"
  | "settings_published"
  | "number_assigned"
  | "published_matches_number"
  | "webhooks_configured"
  | "contact_number";

export interface ReadinessItem {
  id: ReadinessId;
  ok: boolean;
  /** A required item blocks Go live; the others are advice. */
  required: boolean;
  /**
   * Who ticks it: the customer from their settings, or an admin at Go live (the number, and Twilio
   * reaching it). The customer may request go live once their own required items are ticked.
   */
  owner: "customer" | "admin";
  label: string;
  detail?: string;
}

export interface Readiness {
  ready: boolean;
  /** Every required item the customer owns is ticked: they may request go live. */
  customerReady: boolean;
  items: ReadinessItem[];
}

export interface ReadinessInput {
  profile: Pick<BusinessProfile, "isLive" | "transferNumber"> & { profile?: { phone?: string } | null };
  agentNumber: string | null;
  settings: Pick<StoredCallSettings, "published" | "waterfallAllowed">;
  /**
   * How the assigned number stands with Twilio. `managed` = it is in the Twilio account (bought or
   * synced, so this backend can set its webhooks); null or omitted = registered by hand, and whether
   * Twilio sends its calls to the agent is something only the console can show.
   */
  number?: { managed: boolean; webhookState: "unknown" | "ok" | "stale" | "error"; webhookError?: string | null } | null;
  /** Whether this server holds Twilio credentials at all. Without them nothing here can be checked. */
  twilioConfigured?: boolean;
}

export function evaluateReadiness({ profile, agentNumber, settings, number, twilioConfigured }: ReadinessInput): Readiness {
  const published = settings.published;

  let matches = false;
  let matchDetail: string | undefined;
  if (published && agentNumber) {
    try {
      validateCallSettings(published, { agentNumber, waterfallAllowed: settings.waterfallAllowed });
      matches = true;
    } catch (err) {
      if (!(err instanceof CallSettingsError)) throw err;
      matchDetail = err.message;
    }
  }

  const transferNumbers = published?.transfer.scenarios.flatMap((scenario) => scenario.numbers) ?? [];
  const contact = Boolean(profile.transferNumber || profile.profile?.phone || transferNumbers.length);

  const items: ReadinessItem[] = [
    {
      id: "business_info",
      owner: "customer",
      ok: profile.isLive,
      required: true,
      label: "Business information is filled in",
    },
    {
      id: "settings_published",
      owner: "customer",
      ok: published !== null,
      required: true,
      label: "Call settings are published",
    },
    {
      id: "number_assigned",
      owner: "admin",
      ok: agentNumber !== null,
      required: true,
      label: "A phone number is assigned",
      ...(agentNumber ? { detail: agentNumber } : {}),
    },
    {
      id: "published_matches_number",
      owner: "admin",
      ok: matches,
      required: true,
      label: "Published settings work with that number",
      ...(matchDetail ? { detail: matchDetail } : {}),
    },
    // Only once there is a number to have webhooks: without one, "number_assigned" already says it all.
    ...(agentNumber ? [webhooksItem(number ?? null, Boolean(twilioConfigured))] : []),
    {
      id: "contact_number",
      owner: "customer",
      ok: contact,
      required: false,
      label: "A number to reach the business is on file",
    },
  ];

  const ticked = (item: ReadinessItem) => item.ok || !item.required;
  return {
    ready: items.every(ticked),
    customerReady: items.filter((item) => item.owner === "customer").every(ticked),
    items,
  };
}

// Does Twilio send this number's calls to the receptionist? Required only when this server can both
// know and fix the answer: a number in the Twilio account, on a server with Twilio credentials. A
// hand-registered number, or a server with no credentials, gets the same line as advice — refusing Go
// live over something nobody here can check would just be a locked door.
function webhooksItem(
  number: NonNullable<ReadinessInput["number"]> | null,
  twilioConfigured: boolean,
): ReadinessItem {
  const ok = number?.webhookState === "ok";
  const required = Boolean(number?.managed && twilioConfigured);
  // Read by the customer on their Business page as well as by the admin, so the words are theirs:
  // what happens to a call, and who does the fixing.
  let detail: string | undefined;
  if (!ok) {
    if (!number?.managed) detail = "The number was registered by hand — its webhooks are confirmed in the Twilio console.";
    else if (!twilioConfigured) detail = "Twilio isn't set up on this server, so this can't be checked.";
    else detail = number.webhookError || "Its webhooks need configuring — an administrator does this on the Agent numbers page.";
  }
  return {
    id: "webhooks_configured",
    owner: "admin",
    ok,
    required,
    label: "Calls to the number reach the receptionist",
    ...(detail ? { detail } : {}),
  };
}
