import { env } from "../config/env.js";
import { findNumberForUser } from "./agentNumbers.js";
import { findProfile } from "./businessProfiles.js";
import { findCallSettings } from "./callSettings.js";
import { evaluateReadiness, type Readiness } from "../business/readiness.js";
import { wantedWebhooks } from "../twilio/inventory.js";

/** The checklist for one account, read fresh. An account with no business details is not ready. */
export async function readinessFor(userId: string): Promise<Readiness> {
  const [profile, number, settings] = await Promise.all([
    findProfile(userId),
    findNumberForUser(userId),
    findCallSettings(userId),
  ]);
  return evaluateReadiness({
    profile: profile ?? { isLive: false, transferNumber: null, profile: null },
    agentNumber: number?.phoneE164 ?? null,
    settings,
    // Managed = in the Twilio account (bought or synced), so this server can set its webhooks.
    number: number
      ? { managed: Boolean(number.twilioSid), webhookState: number.webhookState, webhookError: number.webhookError }
      : null,
    // "Configured" means this server could actually fix the webhooks: credentials AND the two origins
    // they are built from. With only credentials, Configure would refuse, so the item must not block.
    twilioConfigured: env.twilio.enabled && wantedWebhooks() !== null,
  });
}
