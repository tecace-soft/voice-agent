import { sql } from "./client.js";

// The two hand-offs around onboarding, stored on the account (see the phase-gates spec):
//
//   * a demo customer asks to be set up (`onboarding_requested_at` + their note), and an admin
//     either approves — `startOnboarding`, which clears the request — or declines with a note the
//     customer then sees;
//   * an onboarding customer whose part is done asks for their line (`live_requested_at` + note),
//     and an admin either switches it on — `markLive`, which clears the request — or says "not yet"
//     with a note;
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

/**
 * The onboarding customer's "my part is done, switch my line on". Same rules as the demo stage's
 * request: asking twice keeps the first time (the order admins answer in) and takes the newest note,
 * and asking clears a previous "not yet". False when the account is not being set up.
 */
export async function requestLive(userId: string, text?: string | null): Promise<boolean> {
  const rows = await sql`
    UPDATE users
       SET live_requested_at = coalesce(live_requested_at, now()),
           live_request_note = ${note(text)},
           live_declined_at = NULL,
           live_decline_note = NULL
     WHERE id = ${userId} AND status = 'pre-production'
     RETURNING id
  `;
  return rows.length > 0;
}

/** An admin's "not yet", with a note the customer sees. False when there is no open request. */
export async function declineLive(userId: string, text?: string | null): Promise<boolean> {
  const rows = await sql`
    UPDATE users
       SET live_requested_at = NULL,
           live_request_note = NULL,
           live_declined_at = now(),
           live_decline_note = ${note(text)}
     WHERE id = ${userId} AND status = 'pre-production' AND live_requested_at IS NOT NULL
     RETURNING id
  `;
  return rows.length > 0;
}

/** Where the account's go-live request stands, for the readiness body. */
export async function liveRequestFor(userId: string): Promise<{
  request: { requestedAt: string; note: string | null } | null;
  declined: { declinedAt: string; note: string | null } | null;
}> {
  const [row] = (await sql`
    SELECT live_requested_at AS "requestedAt", live_request_note AS "requestNote",
           live_declined_at AS "declinedAt", live_decline_note AS "declineNote"
      FROM users WHERE id = ${userId}
  `) as unknown as {
    requestedAt: Date | string | null;
    requestNote: string | null;
    declinedAt: Date | string | null;
    declineNote: string | null;
  }[];
  const iso = (v: Date | string) => new Date(v).toISOString();
  return {
    request: row?.requestedAt ? { requestedAt: iso(row.requestedAt), note: row.requestNote } : null,
    declined: row?.declinedAt ? { declinedAt: iso(row.declinedAt), note: row.declineNote } : null,
  };
}

/**
 * Go live: pre-production → production. False when the account was not in pre-production. It
 * answers any open go-live request (and a past "not yet") by moving the account on.
 */
export async function markLive(userId: string): Promise<boolean> {
  const rows = await sql`
    UPDATE users
       SET status = 'production', live_at = now(),
           live_requested_at = NULL, live_request_note = NULL,
           live_declined_at = NULL, live_decline_note = NULL
     WHERE id = ${userId} AND status = 'pre-production'
     RETURNING id
  `;
  return rows.length > 0;
}
