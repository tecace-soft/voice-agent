import { sql } from "./client.js";

// The two hand-offs around onboarding, stored on the account (see the phase-gates spec):
//
//   * a demo customer asks to be set up (`onboarding_requested_at` + their note), and an admin
//     either approves — `startOnboarding`, which clears the request — or declines with a note the
//     customer then sees;
//   * an admin switches the line on (`live_at`), which is also the move to `production`.
//
// Each write names the stage it expects in its WHERE, so two admins pressing at once cannot both
// win, and a request cannot land on an account that has already moved on.

export const MAX_ONBOARDING_NOTE = 1000;

const note = (text: string | undefined | null): string | null => {
  const trimmed = text?.trim().slice(0, MAX_ONBOARDING_NOTE);
  return trimmed ? trimmed : null;
};

/**
 * The customer's "set this up for me". Asking twice keeps the first time they asked (the queue is
 * ordered by it) and takes the newest note. Clears a previous decline. False when the account is
 * not in the demo stage.
 */
export async function requestOnboarding(userId: string, text?: string | null): Promise<boolean> {
  const rows = await sql`
    UPDATE users
       SET onboarding_requested_at = coalesce(onboarding_requested_at, now()),
           onboarding_request_note = ${note(text)},
           onboarding_declined_at = NULL,
           onboarding_decline_note = NULL
     WHERE id = ${userId} AND status = 'demo'
     RETURNING id
  `;
  return rows.length > 0;
}

/** An admin's "not yet". False when there is no open request to decline. */
export async function declineOnboarding(userId: string, text?: string | null): Promise<boolean> {
  const rows = await sql`
    UPDATE users
       SET onboarding_requested_at = NULL,
           onboarding_request_note = NULL,
           onboarding_declined_at = now(),
           onboarding_decline_note = ${note(text)}
     WHERE id = ${userId} AND status = 'demo' AND onboarding_requested_at IS NOT NULL
     RETURNING id
  `;
  return rows.length > 0;
}

/** Approved: the request has been answered by moving the account on. */
export async function clearOnboardingRequest(userId: string): Promise<void> {
  await sql`
    UPDATE users
       SET onboarding_requested_at = NULL, onboarding_request_note = NULL,
           onboarding_declined_at = NULL, onboarding_decline_note = NULL
     WHERE id = ${userId}
  `;
}

/** Go live: pre-production → production. False when the account was not in pre-production. */
export async function markLive(userId: string): Promise<boolean> {
  const rows = await sql`
    UPDATE users SET status = 'production', live_at = now()
     WHERE id = ${userId} AND status = 'pre-production'
     RETURNING id
  `;
  return rows.length > 0;
}
