import { Elysia, t } from "elysia";
import { resolveIdentity } from "./identityFields.js";
import { authenticate, authenticateAdmin, UNAUTHORIZED } from "../auth/guard.js";
import { env } from "../config/env.js";
import { findUserById } from "../db/users.js";
import {
  currentHash,
  findLiveProfileByPhone,
  findProfile,
  hashSource,
  saveProfile,
  saveAgentIdentity,
  saveTypedFields,
} from "../db/businessProfiles.js";
import {
  ExtractionError,
  extractBusiness,
  MAX_SOURCE_CHARS,
  renderFacts,
} from "../tools/extractBusiness.js";
import {
  assignAgentNumber,
  createAgentNumber,
  deleteAgentNumber,
  findByPhone,
  findNumberForUser,
  listAgentNumbers,
  toE164,
} from "../db/agentNumbers.js";

// Which phone number the voice agent answers for which customer.
//
// Under /business, deliberately NOT /agent: backend-app already owns /agent/* for the agent's
// booking tools, and the same prefix meaning two different things across two services is the kind
// of thing that reads fine today and misroutes somebody in a year.
//
// Managing numbers is admin-only. The single read the agent makes is authenticated with its own
// shared key, since it has no session — see AGENT_CONFIG_KEY.

const NUMBERS_ARE_ADMIN = "Only an admin can manage the agent's phone numbers.";

// Whose profile is being read or written. A customer only ever gets their own; an admin may act on
// someone else's by naming them, which is what onboarding looks like. The parameter is a filter for
// an admin and never a way in for anyone else — the same rule as scopeFor in the transcribe routes.
function profileTargetFor(user: { id: string; role: string }, requested?: string): string {
  if (user.role !== "admin") return user.id;
  return requested?.trim() || user.id;
}

export const business = new Elysia({ prefix: "/business" })
  // The agent's lookup: whose business is this dialled number?
  //
  // Guarded by its own key rather than a session. When AGENT_CONFIG_KEY is unset the route is shut
  // entirely rather than left open — an unauthenticated caller could otherwise enumerate which
  // numbers we serve and who owns them, and failing closed here just means the agent falls back to
  // its neutral prompt, which is the safe outcome by design.
  .get(
    "/config",
    async ({ headers, query, status }) => {
      if (!env.agentConfigKey || headers["x-agent-key"] !== env.agentConfigKey) {
        return status(401, { error: "unauthorized" });
      }
      const number = await findByPhone(query.to);
      if (!number) {
        // Not an error. An unknown or unassigned number is a normal state — a line that rings
        // before an admin has assigned it — and the agent's correct response is the neutral
        // prompt, not a retry. `assigned:false` says so without making the agent read a status code.
        return { assigned: false, to: toE164(query.to), reason: "no_number" };
      }

      const profile = await findLiveProfileByPhone(number.phoneE164);
      if (!profile) {
        // Assigned, but there is nothing to say as them: no details saved, or too thin to speak
        // from. Same answer as an unassigned number, because the agent's response is the same —
        // `reason` exists only so the log says which, since the two need different fixing.
        return { assigned: false, to: number.phoneE164, reason: "no_business_details" };
      }

      return {
        assigned: true,
        to: number.phoneE164,
        user: { id: number.userId, email: number.userEmail, name: number.userName },
        // Nulls are sent as nulls, never filled in from this service's own defaults. A missing
        // value means the agent must not claim to know it — substituting TecAce's hours for a
        // customer who didn't give us theirs is the exact leak this whole mechanism prevents.
        business: {
          name: profile.businessName,
          // Null on both means the agent uses its own defaults. Sent as null rather than filled in
          // here so that decision lives in one place — the agent — instead of two.
          agentName: profile.agentName,
          greeting: profile.greeting,
          hoursText: profile.hoursText,
          openHour: profile.openHour,
          closeHour: profile.closeHour,
          website: profile.website,
          facts: profile.facts,
          // null means this customer has nobody to put callers through to, and the agent must not
          // offer to — a transfer it cannot perform is worse than never mentioning one.
          transferNumber: profile.transferNumber,
        },
      };
    },
    { query: t.Object({ to: t.String({ minLength: 1, maxLength: 40 }) }) },
  )

  // A customer's own business details, plus the number they're used for. Both together, because
  // the page needs to say "not in use yet" when someone has filled everything in but has no number
  // — a state that is otherwise silent and looks exactly like a bug.
  .get(
    "/profile",
    async ({ headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const target = profileTargetFor(user, query.userId);
      const [profile, number] = await Promise.all([
        findProfile(target),
        findNumberForUser(target),
      ]);
      return { profile, number, maxSourceChars: MAX_SOURCE_CHARS };
    },
    { query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }) },
  )

  // Save what they pasted. This is where the extraction happens — once, here, never on a call.
  .put(
    "/profile",
    async ({ body, headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const target = profileTargetFor(user, query.userId);
      const sourceText = body.sourceText.trim();

      // Where "put me through to a person" goes. Blank clears it, which is meaningful: with no
      // number the agent stops offering a transfer at all rather than promising one that fails.
      let transferNumber: string | null = null;
      if (body.transferNumber?.trim()) {
        transferNumber = toE164(body.transferNumber);
        if (!/^\+[1-9]\d{7,14}$/.test(transferNumber)) {
          return status(400, {
            error: "bad_transfer_number",
            message: `"${body.transferNumber}" isn't a phone number we can dial. Use the full number, e.g. +12065551234.`,
          });
        }
      }

      // Unchanged text must not be re-extracted. The model is not deterministic enough to guarantee
      // the same facts twice, so a save with no edits could otherwise quietly reword what the agent
      // says about a business that changed nothing.
      const [existingHash, existing] = await Promise.all([
        currentHash(target),
        findProfile(target),
      ]);

      // How the assistant introduces itself is edited in its OWN section, so this form does not
      // send it. Absent therefore means "leave it as it is" — reading it as blank would wipe a
      // customer's greeting every time they edited their description, silently and from a page
      // that never mentioned the greeting.
      const identity = resolveIdentity(body, existing);
      if ("tooLong" in identity) {
        return status(400, { error: identity.field, message: identity.tooLong });
      }
      const typed = { transferNumber, ...identity };
      if (existing && existingHash === hashSource(sourceText)) {
        // The description is unchanged, so nothing is re-read — but the typed-in fields are not
        // part of that hash, and skipping the write entirely would silently discard an edit to any
        // of them.
        const typedChanged =
          (existing.transferNumber ?? null) !== transferNumber ||
          (existing.agentName ?? null) !== identity.agentName ||
          (existing.greeting ?? null) !== identity.greeting;
        if (typedChanged) {
          return { profile: await saveTypedFields(target, typed), extracted: false };
        }
        return { profile: existing, extracted: false };
      }

      let fields;
      try {
        const extract = await extractBusiness(sourceText);
        fields = { ...extract, facts: renderFacts(extract) };
      } catch (err) {
        if (err instanceof ExtractionError) {
          // Nothing is written. Whatever was live stays live and stays being spoken to callers —
          // losing a working profile to a model outage would be worse than the save not taking.
          return status(422, {
            error: "extraction_failed",
            message: err.message,
            stillLive: Boolean(existing),
          });
        }
        throw err;
      }
      return {
        profile: await saveProfile(target, sourceText, fields, typed),
        extracted: true,
      };
    },
    {
      query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }),
      body: t.Object({
        sourceText: t.String({ minLength: 1, maxLength: MAX_SOURCE_CHARS }),
        transferNumber: t.Optional(t.String({ maxLength: 40 })),
        // Generous outer bounds; the real limits are MAX_* above, which reject with a message
        // saying what to do rather than a schema error saying only that it failed.
        agentName: t.Optional(t.String({ maxLength: 200 })),
        greeting: t.Optional(t.String({ maxLength: 1000 })),
      }),
    },
  )

  // Every number we've registered, with its assignee.
  .get("/numbers", async ({ headers, status }) => {
    const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
    if ("denied" in caller) return status(caller.denied, caller.body);
    return { numbers: await listAgentNumbers() };
  })

  // Register a number we own. Unassigned until an admin says whose it is.
  .post(
    "/numbers",
    async ({ body, headers, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const phone = toE164(body.phone);
      // A number that isn't E.164 would be stored but could never match a lookup, so it is
      // rejected here rather than sitting in the table looking correct and never working.
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        return status(400, {
          error: "bad_number",
          message: `"${body.phone}" isn't a phone number we can match. Use the full number, e.g. +12065551234.`,
        });
      }
      try {
        return status(201, { number: await createAgentNumber({ phone, label: body.label ?? null }) });
      } catch (err) {
        // 23505 = unique_violation. Surfacing it as a plain conflict is the point of the
        // constraint: the second person to claim a number is told, not silently allowed.
        if ((err as { code?: string }).code === "23505") {
          return status(409, {
            error: "already_registered",
            message: `${phone} is already registered.`,
          });
        }
        throw err;
      }
    },
    {
      body: t.Object({
        phone: t.String({ minLength: 1, maxLength: 40 }),
        label: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  )

  // Assign the number to a user, or pass userId: null to un-assign it.
  .post(
    "/numbers/:id/assign",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);
      // Numbers belong to CUSTOMERS. An admin is TecAce staff, not a business the agent answers
      // for — assigning one a line would mean the agent introducing itself as their "business",
      // which has no meaning and no details behind it. Checked here rather than only hidden in the
      // dropdown, because a hidden option is a UI convention and this is a rule.
      if (body.userId) {
        const target = await findUserById(body.userId);
        if (!target) {
          return status(404, { error: "not_found", message: "No such account." });
        }
        if (target.role === "admin") {
          return status(400, {
            error: "admin_cannot_hold_number",
            message: `${target.name} is an admin. Numbers are assigned to customer accounts — an admin has no business for the agent to answer as.`,
          });
        }
      }

      try {
        const number = await assignAgentNumber(params.id, body.userId ?? null);
        if (!number) return status(404, { error: "not_found", message: "No such number." });
        return { number };
      } catch (err) {
        // 23505 on the one-per-user index. Told, not silently swapped: moving a customer's line
        // out from under them is not something an admin should be able to do by accident.
        if ((err as { code?: string }).code === "23505") {
          return status(409, {
            error: "already_has_number",
            message: "That person already has a number. Un-assign it first.",
          });
        }
        throw err;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ userId: t.Union([t.String(), t.Null()]) }),
    },
  )

  .delete(
    "/numbers/:id",
    async ({ headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);
      const removed = await deleteAgentNumber(params.id);
      if (!removed) return status(404, { error: "not_found", message: "No such number." });
      return { status: "deleted" };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // How the assistant introduces itself — its own section in the dashboard, so its own endpoint.
  // Nothing here touches the description or anything derived from it, which is the point: editing
  // a greeting must never risk rewording what the agent says about the business.
  .put(
    "/identity",
    async ({ body, headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const target = profileTargetFor(user, query.userId);

      const identity = resolveIdentity(body, null);
      if ("tooLong" in identity) {
        return status(400, { error: identity.field, message: identity.tooLong });
      }

      const profile = await saveAgentIdentity(target, identity.agentName, identity.greeting);
      if (!profile) {
        // No profile row to attach it to. The agent answers neutrally without one and never reaches
        // this greeting, so saying so is more useful than storing a setting that does nothing.
        return status(409, {
          error: "no_profile",
          message: "Add your business information first — until then the assistant answers neutrally and won't use a greeting.",
        });
      }
      return { profile };
    },
    {
      query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }),
      body: t.Object({
        agentName: t.Optional(t.String({ maxLength: 200 })),
        greeting: t.Optional(t.String({ maxLength: 1000 })),
      }),
    },
  );
