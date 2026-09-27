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
  | "contact_number";

export interface ReadinessItem {
  id: ReadinessId;
  ok: boolean;
  /** A required item blocks Go live; the others are advice. */
  required: boolean;
  label: string;
  detail?: string;
}

export interface Readiness {
  ready: boolean;
  items: ReadinessItem[];
}

export interface ReadinessInput {
  profile: Pick<BusinessProfile, "isLive" | "transferNumber"> & { profile?: { phone?: string } | null };
  agentNumber: string | null;
  settings: Pick<StoredCallSettings, "published" | "waterfallAllowed">;
}

export function evaluateReadiness({ profile, agentNumber, settings }: ReadinessInput): Readiness {
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
      ok: profile.isLive,
      required: true,
      label: "Business information is filled in",
    },
    {
      id: "settings_published",
      ok: published !== null,
      required: true,
      label: "Call settings are published",
    },
    {
      id: "number_assigned",
      ok: agentNumber !== null,
      required: true,
      label: "A phone number is assigned",
      ...(agentNumber ? { detail: agentNumber } : {}),
    },
    {
      id: "published_matches_number",
      ok: matches,
      required: true,
      label: "Published settings work with that number",
      ...(matchDetail ? { detail: matchDetail } : {}),
    },
    {
      id: "contact_number",
      ok: contact,
      required: false,
      label: "A number to reach the business is on file",
    },
  ];

  return { ready: items.every((item) => item.ok || !item.required), items };
}
