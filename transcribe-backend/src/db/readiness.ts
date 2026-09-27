import { findNumberForUser } from "./agentNumbers.js";
import { findProfile } from "./businessProfiles.js";
import { findCallSettings } from "./callSettings.js";
import { evaluateReadiness, type Readiness } from "../business/readiness.js";

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
  });
}
