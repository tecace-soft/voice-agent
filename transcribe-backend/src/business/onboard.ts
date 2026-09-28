import type { Customer } from "../demo/types.js";
import { getCustomer } from "../db/demoRead.js";
import { patchCustomer } from "../db/demoWrite.js";
import { clearOnboardingRequest } from "../db/onboarding.js";
import {
  createDemoAccount,
  findUserByBusinessId,
  findUserByEmail,
  findUserById,
  setLifecycleById,
  type UserRecord,
} from "../db/users.js";
import { decideRequest, findRequest, listOpen, type SignupRequest } from "../db/signupRequests.js";
import { generatePassword, hashPassword } from "../auth/password.js";
import { issueLink } from "../auth/linkTokens.js";
import { approvedMail, dashboardLink, inviteMail, sendMail } from "../email/mailer.js";
import type { BusinessProfile } from "../db/businessProfiles.js";
import { PromotionError, startOnboarding } from "./promote.js";

// Approving a customer out of the demo — the ONE way it happens.
//
// There used to be three doors with three behaviours: `/auth/users/:id/status` moved the stage and
// copied nothing, `/auth/users/:id/promote` refused an account that already had business information,
// and `/demo/customers/:id/onboard` kept it. They now all come here (`/status` refuses a move to
// pre-production that skips the copy), so an approval always means the same thing:
//
//   1. decide WHICH account — the one linked to the demo; else the person behind an open request made
//      without email (their existing account, or a new one with the password they chose); else an
//      email the admin typed in (a new account that needs an invite link);
//   2. copy the demo into that account and move it to pre-production (`startOnboarding`);
//   3. answer the request, mark the deal won;
//   4. hand the customer a way in: an invite link when they have no password of their own, and an
//      email saying they can edit now.

export class OnboardError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Approval {
  customer: Customer;
  user: UserRecord;
  profile: BusinessProfile;
  copied: boolean;
  /** Only when the account has no password of its own: the link to choose one. */
  invite: { token: string; link: string | null; expiresAt: string } | null;
  /** Whether the customer was emailed (the invite, or "you can edit now"). */
  emailed: boolean;
}

const PAST_DEMO = "This customer is already past the demo.";

function usable(account: UserRecord, demoId: string): void {
  if (account.role === "admin") {
    throw new OnboardError(409, "admin_account", `${account.email} is an admin account, not a customer's.`);
  }
  if (account.businessId && account.businessId !== demoId) {
    throw new OnboardError(409, "linked_elsewhere", `${account.email} is already linked to another demo.`);
  }
  if (account.status === "pre-production" || account.status === "production") {
    throw new OnboardError(409, "past_demo", PAST_DEMO);
  }
}

async function link(account: UserRecord, demoId: string): Promise<UserRecord> {
  if (account.businessId === demoId) return account;
  const linked = await setLifecycleById(account.id, { businessId: demoId });
  if (!linked) throw new OnboardError(409, "business_taken", "That demo is already linked to another account.");
  return linked;
}

/**
 * Find or make the account an approval moves. Says whether that account still needs an invite link
 * (it was made here with a password nobody knows, or an admin made it and it has never signed in).
 */
async function resolveAccount(
  demo: Customer,
  opts: { requestId?: string; email?: string; name?: string; adminId: string },
): Promise<{ account: UserRecord; needsInvite: boolean; request: SignupRequest | null }> {
  const linked = await findUserByBusinessId(demo.id);
  if (linked) {
    usable(linked, demo.id);
    return { account: linked, needsInvite: linked.signupSource === "admin" && !linked.lastLoginAt, request: null };
  }

  // An open request made without email: the person already chose a password.
  let request: SignupRequest | null = null;
  if (opts.requestId) {
    request = await findRequest(opts.requestId);
    if (!request || request.customerId !== demo.id || request.status !== "open") {
      throw new OnboardError(409, "request_gone", "That request is no longer open.");
    }
  } else if (!opts.email) {
    request = (await listOpen(demo.id))[0] ?? null;
  }

  if (request) {
    const existing = await findUserByEmail(request.email);
    if (existing) {
      usable(existing, demo.id);
      // Their own account, their own password: nothing to invite them to.
      return { account: await link(existing, demo.id), needsInvite: false, request };
    }
    const made = await createDemoAccount({
      email: request.email,
      name: request.name,
      passwordHash: request.passwordHash,
      source: "claim",
      verified: false,
      businessId: demo.id,
    });
    if (made === "business_taken") throw new OnboardError(409, "business_taken", "That demo is already linked to another account.");
    if (made === "email_taken") throw new OnboardError(409, "email_taken", "That email has an account now; try again.");
    return { account: made, needsInvite: false, request };
  }

  const email = opts.email?.trim().toLowerCase();
  if (!email) {
    throw new OnboardError(
      409,
      "no_account",
      "Nobody has asked for this one yet. Enter the customer's email to make their account.",
    );
  }
  const existing = await findUserByEmail(email);
  if (existing) {
    usable(existing, demo.id);
    return { account: await link(existing, demo.id), needsInvite: !existing.lastLoginAt, request: null };
  }
  const made = await createDemoAccount({
    email,
    name: opts.name?.trim() || demo.contactName?.trim() || demo.businessName,
    passwordHash: hashPassword(generatePassword()),
    source: "admin",
    verified: false,
    businessId: demo.id,
  });
  if (typeof made === "string") throw new OnboardError(409, made, "Couldn't make that account; try again.");
  return { account: made, needsInvite: true, request: null };
}

export async function approveOnboarding(opts: {
  demoId: string;
  adminId: string;
  requestId?: string;
  email?: string;
  name?: string;
}): Promise<Approval> {
  const demo = await getCustomer(opts.demoId);
  if (!demo) throw new OnboardError(404, "no_demo", "Customer not found.");

  const { account, needsInvite, request } = await resolveAccount(demo, opts);

  let moved;
  try {
    moved = await startOnboarding(account.id, demo);
  } catch (err) {
    if (err instanceof PromotionError) throw new OnboardError(422, "thin_demo", err.message);
    throw err;
  }
  await clearOnboardingRequest(account.id);

  // Answer every open request on this demo: the one approved, and any others (a colleague asking
  // too) as settled by it.
  if (request) await decideRequest(request.id, { status: "approved", by: opts.adminId, userId: account.id });
  for (const other of await listOpen(demo.id)) {
    await decideRequest(other.id, {
      status: "declined",
      by: opts.adminId,
      note: "Another request for this receptionist was approved.",
    });
  }

  // Best effort: the account has moved, which is what matters. The board can be dragged by hand.
  let customer: Customer = demo;
  if (demo.stage !== "won") customer = (await patchCustomer(demo.id, { stage: "won" }).catch(() => null)) ?? demo;

  let invite: Approval["invite"] = null;
  let emailed = false;
  if (needsInvite) {
    const issued = await issueLink(account.id, "invite", opts.adminId);
    const url = dashboardLink(`/#/welcome?token=${issued.token}`);
    invite = { token: issued.token, link: url, expiresAt: issued.expiresAt };
    if (url) emailed = await sendMail(inviteMail(account.email, account.name, url));
  } else {
    emailed = await sendMail(approvedMail(account.email, account.name));
  }

  const user = (await findUserById(account.id)) ?? moved.user;
  return { customer, user, profile: moved.profile, copied: moved.copied, invite, emailed };
}
