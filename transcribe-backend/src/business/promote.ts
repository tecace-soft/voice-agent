import type { BusinessProfile as StructuredProfile, CustomerPrompts } from "../demo/types.js";
import { deriveFromProfile } from "./derive.js";
import { normalizeProfile } from "./profileShape.js";
import { findProfile, saveProfile } from "../db/businessProfiles.js";
import type { BusinessProfile } from "../db/businessProfiles.js";
import { setLifecycleById, type UserRecord } from "../db/users.js";

// Moving a business out of the demo and into the product, once.
//
// THE WHOLE POINT IS THAT THIS RUNS ONCE. What a prospect tried is what their account starts from,
// and from that moment the two records have nothing to do with each other: the operator can keep
// working the demo — re-research it, rewrite its prompts, hand it to a colleague to show someone —
// and none of it reaches the customer's live receptionist. Equally, the customer correcting their
// closing time does not rewrite the demo somebody is still showing.
//
// That independence is structural rather than a rule anyone has to remember. The two live in
// different tables (`demo_customers` keyed by a nanoid, `business_profiles` keyed by `user_id`),
// they are written by different endpoints, and there is no read path that joins them. `users.
// business_id` records where an account came from; nothing reads it except this.
//
// So the copy is deliberately a copy, not a reference: the JSON goes through the database into a
// second row, and the derived columns are re-rendered from it here rather than carried across,
// because the demo never had them — it has no phone agent to answer.

export class PromotionError extends Error {}

/** What a demo record contributes to the business it becomes. */
export interface Promotable {
  profile: StructuredProfile;
  prompts: CustomerPrompts;
  agentName: string;
  /** Optional on a demo record, so both are widened here rather than at the call site. */
  voice?: string | null;
  language?: string | null;
  /** The research briefing, which becomes the description a later re-read would work from. */
  dossier: string;
}

/**
 * The description the business starts with.
 *
 * A prospect never wrote one — an operator gave a name and a model researched the rest — so the
 * briefing stands in for it. That matters beyond tidiness: `source_text` is what "Read my details
 * again" re-reads, and a business whose description was empty could never use it.
 */
export function descriptionFrom(demo: Promotable): string {
  const briefing = demo.dossier.trim();
  if (briefing) return briefing;
  // No briefing either. Something a person can edit beats an empty box they cannot save.
  return `${demo.profile.name}. Written up from the demo; replace this with your own description.`;
}

/**
 * Copy a demo record into a customer's own business profile.
 *
 * Refuses rather than half-copies. A promotion that produced a profile with no name and no facts
 * would hand the customer an account whose number is not live, and the demo it came from is not
 * something they can edit to fix it.
 */
export async function promoteToBusiness(
  userId: string,
  demo: Promotable,
): Promise<BusinessProfile> {
  let profile: StructuredProfile;
  try {
    // Through the same shaping as any other write. A demo profile was written by a model and by an
    // operator over however long the prospect was being worked, under whatever rules applied then.
    profile = normalizeProfile(demo.profile);
  } catch {
    throw new PromotionError(
      "There isn't enough in this demo to start an account from — it needs a business name and at least one thing a caller might ask about.",
    );
  }

  const sourceText = descriptionFrom(demo);
  return saveProfile(
    userId,
    sourceText,
    // Rendered here, not carried over: the demo has no `facts`, no `hoursText` and no open/close
    // hours, because nothing in a demo answers a phone.
    deriveFromProfile(profile),
    {
      // The typed-in settings a business has and a demo does not. Left unset rather than guessed:
      // a transfer number in particular decides whether the agent offers a person at all, and
      // inventing one would route a real caller somewhere nobody chose.
      transferNumber: null,
      agentName: demo.agentName.trim() || null,
      greeting: null,
      transferTopics: null,
      houseRules: null,
    },
    {
      profile,
      // The prospect's prompts travel as they stand, hand edits and all: what they heard on the
      // demo call is what their line should open with. `edited` comes with them, so a prompt
      // somebody wrote by hand stays frozen on the new side too.
      prompts: demo.prompts,
      voice: demo.voice ?? null,
      language: demo.language ?? null,
    },
  );
}

/**
 * Demo → onboarding for one account: its own business information, then the stage.
 *
 * The copy happens only when the account has no business information yet. One that already has some
 * keeps it — it is the customer's, possibly with their edits on top — and only the stage moves.
 * Callers that must refuse in that case (the admin's `/promote`) check before calling.
 *
 * `pre-production`, not `production`: the number still has to be assigned and a transfer number
 * typed in, neither of which a demo has. They can see and edit everything; nothing is answering yet.
 *
 * Throws PromotionError when a copy is needed and the demo is too thin to make one; the stage is not
 * touched in that case.
 */
export async function startOnboarding(
  userId: string,
  demo: Promotable,
): Promise<{ user: UserRecord; profile: BusinessProfile; copied: boolean }> {
  const existing = await findProfile(userId);
  const profile = existing ?? (await promoteToBusiness(userId, demo));
  const user = await setLifecycleById(userId, { status: "pre-production" });
  if (!user) throw new Error(`No account ${userId} to move to onboarding.`);
  return { user, profile, copied: !existing };
}

