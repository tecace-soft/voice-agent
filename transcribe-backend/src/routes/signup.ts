import { Elysia, t } from "elysia";
import { authenticate, UNAUTHORIZED } from "../auth/guard.js";
import { hashPassword } from "../auth/password.js";
import { createToken } from "../auth/session.js";
import { env } from "../config/env.js";
import { getCustomer } from "../db/demoRead.js";
import { createCustomer, failResearch, saveResearch } from "../db/demoWrite.js";
import { requestOnboarding, MAX_ONBOARDING_NOTE } from "../db/onboarding.js";
import {
  claimResearch,
  codeMatches,
  countOpenForCustomer,
  countRecentByIp,
  countResearchToday,
  createPending,
  findPending,
  findStartRequestForUser,
  hashIp,
  markVerified,
  MAX_CODE_ATTEMPTS,
  MAX_CODE_SENDS,
  recordWrongCode,
  RESEND_GAP_MS,
  saveOpenClaim,
  setCode,
  type SignupRequest,
} from "../db/signupRequests.js";
import { createDemoAccount, findUserByBusinessId, findUserByEmail, recordLogin, toPublicUser } from "../db/users.js";
import { isMapsUrl } from "../demo/maps.js";
import { researchBusiness } from "../demo/research.js";
import {
  adminNoticeMail,
  alreadyHaveAccountMail,
  codeMail,
  mailConfigured,
  sendMail,
} from "../email/mailer.js";
import { clientIp, rateLimited } from "./demoCommon.js";

// Signing up: the two ways a customer gets an account without an admin making it.
//
//   * CLAIM — a prospect on their demo's public page (`/c/<id>`) presses "Request setup". Their
//     sign-up IS the request: once the code is right the account exists, is linked to that demo, and
//     an admin sees the request. They are signed straight in, to their receptionist, read-only, until
//     the admin approves (`business/onboard.ts`).
//   * START — a stranger at `/start` gives their business's name and website or Maps link. Once the
//     code is right they get an account and a new demo, and the page asks for the research run
//     (`/signup/research`), which builds their receptionist while they watch.
//
// Nothing here writes a `users` row before the email is proven. The request (password already
// hashed) waits in `signup_requests` for its code, so a stranger typing someone else's address
// neither fills the Accounts list nor takes that address. Every answer about an address is the same
// whether it has an account or not; the owner of an address that already has one is emailed instead.
//
// With no email configured there are no codes. A claim is then saved as an open request for an
// admin, and the account is made when they approve it; a self-service sign-up is closed, because a
// research run is billable and nothing would stand between it and an unproven address.
//
// Dashboard-only (PORTING.md): the promo had no accounts.

const MIN_PASSWORD_LENGTH = 10;
const passwordField = t.String({ minLength: MIN_PASSWORD_LENGTH, maxLength: 512 });
const emailField = t.String({ minLength: 3, maxLength: 320, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" });
const nameField = t.String({ minLength: 1, maxLength: 120 });

/** Sign-ups one address may start in an hour, counted in the database so every instance agrees. */
const PER_IP_PER_HOUR = 5;
/** Open requests (made without email) one demo may collect. */
const OPEN_PER_DEMO = 5;
/** Research runs one address may start in a day. */
const RESEARCH_PER_IP_PER_DAY = 3;

const TOO_MANY = {
  error: "too_many_requests",
  message: "Too many sign-ups from here. Try again in an hour.",
} as const;

/** What a demo link has to be for its business to claim it: there, switched on, and researched. */
async function claimable(demoId: string) {
  const customer = await getCustomer(demoId);
  if (!customer || !customer.active || customer.status !== "ready") return null;
  return customer;
}

async function notifyAdmin(request: SignupRequest, business: string, verified: boolean): Promise<void> {
  if (!env.adminNotifyEmail) return;
  await sendMail(
    adminNoticeMail({
      to: env.adminNotifyEmail,
      kind: request.source === "start" ? "signup" : "request",
      name: request.name,
      email: request.email,
      business,
      note: request.note,
      verified,
    }),
  );
}

/** A code went out, or the owner of an existing account was told instead. Same answer either way. */
async function sendCodeOrNotice(email: string, make: () => Promise<{ code: string }>): Promise<void> {
  if (await findUserByEmail(email)) {
    await sendMail(alreadyHaveAccountMail(email));
    return;
  }
  const { code } = await make();
  await sendMail(codeMail(email, code, "signup"));
}

export const signup = new Elysia({ prefix: "/auth" })
  /**
   * "Request setup" from a demo's public page. 202 `{ next: "code" }` (a code is on its way) or
   * `{ next: "requested" }` (no email here: the request waits for an admin).
   */
  .post(
    "/signup/claim",
    async ({ body, headers, status }) => {
      const ip = clientIp(headers);
      const answer = { next: mailConfigured() ? "code" : "requested" } as const;
      // A field no person sees: a form filled in by a script fills it in too.
      if (body.website) return status(202, answer);
      if (rateLimited(`signup:${ip}`)) return status(429, TOO_MANY);

      const customer = await claimable(body.demoId);
      if (!customer) return status(404, { error: "not_found", message: "This demo isn't available." });
      const owner = await findUserByBusinessId(customer.id);
      if (owner) {
        return status(409, {
          error: owner.status === "demo" || owner.status === "unassigned" ? "claimed" : "onboarding",
          message: "This receptionist has already been claimed. Sign in to continue.",
        });
      }

      const ipHash = hashIp(ip);
      if ((await countRecentByIp(ipHash, 3_600_000)) >= PER_IP_PER_HOUR) return status(429, TOO_MANY);
      const passwordHash = hashPassword(body.password);

      if (!mailConfigured()) {
        if ((await countOpenForCustomer(customer.id)) >= OPEN_PER_DEMO) return status(429, TOO_MANY);
        const request = await saveOpenClaim({
          customerId: customer.id,
          name: body.name,
          email: body.email,
          phone: body.phone,
          note: body.note,
          passwordHash,
          ipHash,
        });
        await notifyAdmin(request, customer.businessName, false);
        return status(202, answer);
      }

      await sendCodeOrNotice(body.email, () =>
        createPending({
          source: "claim",
          customerId: customer.id,
          name: body.name,
          email: body.email,
          phone: body.phone,
          note: body.note,
          passwordHash,
          ipHash,
        }),
      );
      return status(202, answer);
    },
    {
      body: t.Object({
        demoId: t.String({ minLength: 1, maxLength: 64 }),
        name: nameField,
        email: emailField,
        password: passwordField,
        phone: t.Optional(t.String({ maxLength: 40 })),
        note: t.Optional(t.String({ maxLength: MAX_ONBOARDING_NOTE })),
        website: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  )

  /** Self-service sign-up at `/start`. 202 `{ next: "code" }`; 503 when this deployment has no email. */
  .post(
    "/signup/start",
    async ({ body, headers, status }) => {
      if (!mailConfigured()) {
        return status(503, {
          error: "signup_closed",
          message: "Sign-up isn't open here yet. Contact us and we'll set you up.",
        });
      }
      const ip = clientIp(headers);
      if (body.website) return status(202, { next: "code" });
      if (rateLimited(`signup:${ip}`)) return status(429, TOO_MANY);

      const businessName = body.business.businessName.trim();
      const websiteUrl = body.business.websiteUrl?.trim() || undefined;
      const mapsUrl = body.business.mapsUrl?.trim() || undefined;
      if (!businessName) return status(400, { error: "business_name", message: "Enter your business's name." });
      if (!websiteUrl && !mapsUrl) {
        return status(400, { error: "business_link", message: "Add your website or a Google Maps link, so we can learn about your business." });
      }
      if (websiteUrl && !/^https?:\/\/[^\s.]+\.[^\s]+/i.test(websiteUrl)) {
        return status(400, { error: "business_link", message: "The website must start with http:// or https://." });
      }
      if (mapsUrl && !isMapsUrl(mapsUrl)) {
        return status(400, { error: "business_link", message: "That doesn't look like a Google Maps link." });
      }

      const ipHash = hashIp(ip);
      if ((await countRecentByIp(ipHash, 3_600_000)) >= PER_IP_PER_HOUR) return status(429, TOO_MANY);

      await sendCodeOrNotice(body.email, () =>
        createPending({
          source: "start",
          customerId: null,
          name: body.name,
          email: body.email,
          business: { businessName, websiteUrl, mapsUrl },
          passwordHash: hashPassword(body.password),
          ipHash,
        }),
      );
      return status(202, { next: "code" });
    },
    {
      body: t.Object({
        name: nameField,
        email: emailField,
        password: passwordField,
        business: t.Object({
          businessName: t.String({ maxLength: 160 }),
          websiteUrl: t.Optional(t.String({ maxLength: 500 })),
          mapsUrl: t.Optional(t.String({ maxLength: 1000 })),
        }),
        website: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  )

  /**
   * The code from the email. Right: the account exists and the caller is signed in (the same body as
   * `/auth/login`, plus where to go next). Wrong or stale: one answer, so it can't be used to learn
   * which addresses are signing up.
   */
  .post(
    "/verify",
    async ({ body, status }) => {
      const pending = await findPending(body.email);
      const invalid = { error: "invalid_code", message: "That code isn't right. Check the email, or send a new code." };
      if (!pending) return status(400, invalid);
      if (pending.codeAttempts >= MAX_CODE_ATTEMPTS) {
        return status(429, { error: "too_many_attempts", message: "Too many wrong codes. Send a new code." });
      }
      if (!pending.codeExpiresAt || Date.parse(pending.codeExpiresAt) < Date.now()) {
        return status(400, { error: "code_expired", message: "That code has expired. Send a new code." });
      }
      if (!codeMatches(pending.id, body.code.trim(), pending.codeHash)) {
        await recordWrongCode(pending.id);
        return status(400, invalid);
      }

      // The demo this account belongs to: the one claimed, or a new one for a self-service sign-up.
      let customerId: string;
      let businessName: string;
      if (pending.source === "claim") {
        const customer = pending.customerId ? await getCustomer(pending.customerId) : null;
        if (!customer) return status(404, { error: "not_found", message: "This demo isn't available any more." });
        if (await findUserByBusinessId(customer.id)) {
          return status(409, { error: "claimed", message: "Someone else claimed this receptionist first. Contact us." });
        }
        customerId = customer.id;
        businessName = customer.businessName;
      } else {
        const business = pending.business!;
        const created = await createCustomer({
          businessName: business.businessName,
          websiteUrl: business.websiteUrl,
          mapsUrl: business.mapsUrl,
          contactName: pending.name,
          contactEmail: pending.email,
          label: "Signed up",
        });
        customerId = created.id;
        businessName = created.businessName;
      }

      const user = await createDemoAccount({
        email: pending.email,
        name: pending.name,
        passwordHash: pending.passwordHash,
        source: pending.source,
        verified: true,
        businessId: customerId,
      });
      if (user === "email_taken") {
        return status(409, { error: "email_taken", message: "This email already has an account. Sign in instead." });
      }
      if (user === "business_taken") {
        return status(409, { error: "claimed", message: "Someone else claimed this receptionist first. Contact us." });
      }
      await markVerified(pending.id, user.id);
      // A claim is a request to be set up; a self-service sign-up asks once they've seen their demo.
      if (pending.source === "claim") await requestOnboarding(user.id, pending.note);
      await notifyAdmin(pending, businessName, true);

      await recordLogin(user.id);
      const { token, expiresAt } = createToken(user.id, user.tokenVersion);
      return {
        token,
        expiresAt,
        user: toPublicUser({ ...user, lastLoginAt: new Date().toISOString() }),
        customerId,
        next: pending.source === "claim" ? "waiting" : "research",
      };
    },
    { body: t.Object({ email: emailField, code: t.String({ minLength: 1, maxLength: 12 }) }) },
  )

  /** Another code for a pending sign-up: a minute apart, five in all. 202 whether or not there is one. */
  .post(
    "/verify/resend",
    async ({ body, status }) => {
      const pending = await findPending(body.email);
      if (!pending) return status(202, { sent: true });
      if (pending.codeSentAt && Date.now() - Date.parse(pending.codeSentAt) < RESEND_GAP_MS) {
        const wait = Math.ceil((RESEND_GAP_MS - (Date.now() - Date.parse(pending.codeSentAt))) / 1000);
        return status(429, { error: "wait", message: `Wait ${wait} seconds before sending another code.`, retryAfter: wait });
      }
      if (pending.codeSends >= MAX_CODE_SENDS) {
        return status(429, { error: "too_many_codes", message: "That's a lot of codes. Sign up again in a while." });
      }
      const code = await setCode(pending.id);
      await sendMail(codeMail(pending.email, code, "signup"));
      return status(202, { sent: true });
    },
    { body: t.Object({ email: emailField }) },
  )

  /**
   * Build a self-service sign-up's receptionist: the one research run it gets, inside this request
   * (so a serverless host can't freeze it half way, the same reason the admin's re-research runs
   * inside its request). Signed in as that account. Queued for an admin, rather than run, past the
   * day's ceilings.
   */
  .post("/signup/research", async ({ headers, status }) => {
    const user = await authenticate(headers.authorization);
    if (!user) return status(401, UNAUTHORIZED);
    if (user.signupSource !== "start" || user.status !== "demo" || !user.businessId) {
      return status(403, { error: "forbidden", message: "Only a new sign-up's receptionist is built here." });
    }
    const request = await findStartRequestForUser(user.id);
    const customer = await getCustomer(user.businessId);
    if (!request || !customer) return status(404, { error: "not_found", message: "Nothing to build." });
    if (request.researchStartedAt || customer.status !== "researching") {
      return { status: customer.status, queued: false };
    }

    const overDay = (await countResearchToday()) >= env.signupResearchDailyCap;
    const overIp = (await countResearchToday(request.ipHash)) >= RESEARCH_PER_IP_PER_DAY;
    if (overDay || overIp) return status(202, { status: customer.status, queued: true });
    if (!(await claimResearch(request.id))) return { status: customer.status, queued: false };

    const business = request.business!;
    try {
      const result = await researchBusiness({
        businessName: business.businessName,
        websiteUrl: business.websiteUrl,
        mapsUrl: business.mapsUrl,
      });
      const saved = await saveResearch(customer.id, result);
      return { status: saved?.status ?? "ready", queued: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[signup] research failed", error);
      await failResearch(customer.id, message).catch(() => null);
      return status(502, { error: "research_failed", message: "We couldn't build it automatically. We'll finish it for you." });
    }
  });
