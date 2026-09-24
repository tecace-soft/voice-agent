import { Elysia, t } from "elysia";
import { DEFAULT_BEHAVIOUR } from "./behaviourDefaults.js";
import { MAX_HOUSE_RULES, MAX_TRANSFER_TOPICS, resolveIdentity, spokenLine } from "./identityFields.js";
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
  saveHouseRules,
  saveStructured,
  saveTypedFields,
} from "../db/businessProfiles.js";
import { ExtractionError, MAX_SOURCE_CHARS } from "../tools/extractBusiness.js";
import { extractProfile } from "../tools/extractProfile.js";
import { normalizeProfile } from "../business/profileShape.js";
import { deriveFromProfile } from "../business/derive.js";
import { buildPrompts, resolvePrompts } from "../demo/prompt.js";
import type { BusinessProfile as StructuredProfile } from "../demo/types.js";
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

// Said by both tab endpoints when there is no profile row to edit. The agent answers neutrally
// without one, so a saved Knowledge or Prompt edit would be a setting that does nothing.
/**
 * The largest a structured profile may be, as JSON.
 *
 * Generous against the form — a spa with eighty services and twenty questions is nowhere near it —
 * and small enough that a body which is not an edit cannot be stored and re-read forever. The fact
 * block the agent is sent is capped separately and much lower (`factLimits.ts`); this is the cap on
 * what a customer may keep, not on what a caller may hear.
 */
const MAX_PROFILE_CHARS = 120_000;

const ADD_DETAILS_FIRST =
  "Add your business information first — until then the assistant answers neutrally.";

/**
 * The twelve voices, by id. `demo/types.ts` exports them as `LIVE_VOICE_OPTIONS` objects for the
 * picker; only the ids matter here, and validating a business's voice in its own route is what lets
 * this say "Unknown voice." rather than failing a schema.
 */
const VOICES = [
  "gleam", "meridian", "delta", "cinder", "quartz", "ripple",
  "vesper", "willow", "stone", "beacon", "bossa", "tempo",
];

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
          transferTopics: profile.transferTopics,
          houseRules: profile.houseRules,
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
      const [profile, number, storedHash] = await Promise.all([
        findProfile(target),
        findNumberForUser(target),
        currentHash(target),
      ]);
      // Their details were read by an older version of the reader — the facts on file are not what
      // the same description would produce today. It happens on every improvement to the extraction
      // (a raised cap, a new rule about addresses) and is invisible from the dashboard: the page
      // shows facts that look fine, and callers hear the gaps. Saying so is the whole fix.
      const factsStale = Boolean(profile && storedHash !== hashSource(profile.sourceText));
      // The standing behaviour travels with the profile so the page can show what the
      // assistant already does, instead of "nothing set" on a business that has simply not
      // added anything of their own.
      // A row written before the structured profile existed has none, and is NOT given a
      // reconstructed one. An earlier attempt assembled a profile out of the flat columns so the
      // tab would not be empty; saving it then derived those same columns back from the
      // reconstruction and wrote nulls over good values — the hours in particular, which cannot be
      // parsed back out of a sentence. Re-reading the description is the way in, and `factsStale`
      // is already true for every such row because the extractor version moved.
      const needsReread = Boolean(profile && !profile.profile);
      return {
        profile,
        number,
        maxSourceChars: MAX_SOURCE_CHARS,
        defaultBehaviour: DEFAULT_BEHAVIOUR,
        factsStale,
        needsReread,
      };
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
      const topics = spokenLine(body.transferTopics, MAX_TRANSFER_TOPICS, "What goes to a person");
      if (topics && typeof topics === "object") {
        return status(400, { error: "bad_transfer_topics", message: topics.tooLong });
      }
      const rules = spokenLine(body.houseRules, MAX_HOUSE_RULES, "How the assistant should behave");
      if (rules && typeof rules === "object") {
        return status(400, { error: "bad_house_rules", message: rules.tooLong });
      }
      const typed = { transferNumber, transferTopics: topics, houseRules: rules, ...identity };
      if (existing && existingHash === hashSource(sourceText)) {
        // The description is unchanged, so nothing is re-read — but the typed-in fields are not
        // part of that hash, and skipping the write entirely would silently discard an edit to any
        // of them.
        const typedChanged =
          (existing.transferNumber ?? null) !== transferNumber ||
          (existing.transferTopics ?? null) !== topics ||
          (existing.houseRules ?? null) !== rules ||
          (existing.agentName ?? null) !== identity.agentName ||
          (existing.greeting ?? null) !== identity.greeting;
        if (typedChanged) {
          return { profile: await saveTypedFields(target, typed), extracted: false };
        }
        return { profile: existing, extracted: false };
      }

      // ONE model call, and it produces the structured profile the customer edits. The four flat
      // values the phone agent reads are rendered from that rather than extracted separately: two
      // readings of the same text could disagree, and the one a customer can correct has to be the
      // one that reaches the call.
      let structured;
      let fields;
      try {
        const profile = await extractProfile(sourceText);
        fields = deriveFromProfile(profile);
        structured = {
          profile,
          // Through `resolvePrompts`, not `buildPrompts` — the demo's own rule, and the same one the
          // two tab endpoints follow: an untouched set is rebuilt from the new data, a hand-written
          // one is left alone. Re-reading a description is exactly when a customer who wrote their
          // own prompt would otherwise lose it, without asking for a rebuild and without being told.
          prompts: existing?.prompts
            ? resolvePrompts({
                current: existing.prompts,
                profile,
                agentName: identity.agentName ?? "",
                language: existing.language ?? undefined,
              })
            : buildPrompts(profile, identity.agentName ?? "", existing?.language ?? undefined),
          voice: existing?.voice ?? null,
          language: existing?.language ?? null,
        };
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
        profile: await saveProfile(target, sourceText, fields, typed, structured),
        extracted: true,
      };
    },
    {
      query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }),
      body: t.Object({
        sourceText: t.String({ minLength: 1, maxLength: MAX_SOURCE_CHARS }),
        transferNumber: t.Optional(t.String({ maxLength: 40 })),
        transferTopics: t.Optional(t.String({ maxLength: 2000 })),
        // How this business wants the assistant to behave, in their own words.
        houseRules: t.Optional(t.String({ maxLength: 4000 })),
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

  // What this business wants the assistant to do differently — its own box in the dashboard, so
  // its own endpoint. Saving it must not re-read the description (that costs a model call and can
  // reword every fact), and editing the description must not disturb it.
  .put(
    "/house-rules",
    async ({ body, headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const target = profileTargetFor(user, query.userId);

      const rules = spokenLine(body.houseRules, MAX_HOUSE_RULES, "How the assistant should behave");
      if (rules && typeof rules === "object") {
        return status(400, { error: "bad_house_rules", message: rules.tooLong });
      }

      const profile = await saveHouseRules(target, rules);
      if (!profile) {
        // Nothing to attach them to. Without a profile the agent answers neutrally and never reads
        // these, so saying so beats storing a setting that does nothing.
        return status(409, {
          error: "no_profile",
          message: "Add your business information first — until then the assistant answers neutrally.",
        });
      }
      return { profile };
    },
    {
      query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }),
      body: t.Object({ houseRules: t.Optional(t.String({ maxLength: 4000 })) }),
    },
  )

  // How the assistant introduces itself — its own section in the dashboard, so its own endpoint.
  /**
   * Save the Knowledge tab.
   *
   * The structured profile is the source of truth, so the four flat values the phone agent reads
   * are re-rendered here — correcting a closing time has to change what the agent says, not just
   * what the page shows. The prompts follow the same rule the demo uses: an untouched set is
   * rebuilt from the new data, a hand-edited one is left exactly as it is.
   *
   * `sourceText` is not touched. The description is what the customer wrote; editing the profile it
   * produced does not rewrite their words.
   */
  .put(
    "/knowledge",
    async ({ body, headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const target = profileTargetFor(user, query.userId);

      const existing = await findProfile(target);
      if (!existing) return status(409, { error: "no_profile", message: ADD_DETAILS_FIRST });

      // Shaped exactly as an extraction is. The tab's fields are free text — a closing time is a
      // text box — so "9:00 PM", a day called "Funday", a number where a string belongs and a
      // pasted instruction all arrive here from a browser, and none of them may be written as-is.
      //
      // It throws when nothing usable survives, which is the refusal that matters: a profile with
      // no name and no facts is not live, and `GET /business/config` would stop answering as this
      // business at all. Saving an emptied form must not be able to take a number off the air.
      // A profile is a form with a few dozen fields in it. Anything far past that is not an edit,
      // and `t.Unknown()` means the schema will not stop it — the body would be stored verbatim in
      // JSONB and read back on every page load forever.
      const size = JSON.stringify(body.profile ?? null).length;
      if (size > MAX_PROFILE_CHARS) {
        return status(413, {
          error: "profile_too_large",
          message: `That's more than we can store (${size.toLocaleString()} characters, limit ${MAX_PROFILE_CHARS.toLocaleString()}).`,
        });
      }

      let profile: StructuredProfile;
      try {
        profile = normalizeProfile(body.profile);
      } catch (err) {
        if (err instanceof ExtractionError) {
          return status(422, { error: "bad_profile", message: err.message });
        }
        throw err;
      }

      const prompts = resolvePrompts({
        current: existing.prompts ?? buildPrompts(profile, existing.agentName ?? "", existing.language ?? undefined),
        profile,
        agentName: existing.agentName ?? "",
        language: existing.language ?? undefined,
      });

      const saved = await saveStructured(
        target,
        { profile, prompts, voice: existing.voice, language: existing.language },
        deriveFromProfile(profile),
      );
      if (!saved) return status(409, { error: "no_profile", message: ADD_DETAILS_FIRST });
      return { profile: saved };
    },
    {
      query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }),
      // `t.Unknown()` for the same reason the demo's PATCH uses it: a stricter schema would 422 on
      // any field the editor adds, and the shaping is done by `normalize` below rather than by the
      // schema. The size cap is the real guard.
      body: t.Object({ profile: t.Unknown() }),
    },
  )

  /**
   * Save the Prompt tab: the three prompts, who answers, and in what language.
   *
   * A prompt that arrives changed is a hand edit and is frozen from then on; `rebuild: true` throws
   * the edits away and generates from the profile again. Both are `resolvePrompts`, which is the
   * demo's own function — the two tabs are not lookalikes, they are the same code.
   */
  .put(
    "/prompts",
    async ({ body, headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const target = profileTargetFor(user, query.userId);

      const existing = await findProfile(target);
      if (!existing?.profile) {
        return status(409, {
          error: "no_profile",
          message: "There's nothing to build a prompt from yet. Add your business details first.",
        });
      }
      const profile = existing.profile;

      const voice = typeof body.voice === "string" ? body.voice.trim() : existing.voice;
      if (voice && !VOICES.includes(voice)) {
        return status(400, { error: "bad_voice", message: "Unknown voice." });
      }
      const language =
        typeof body.language === "string" ? body.language.trim() || null : existing.language;

      // `submitted` is only a hand edit when there is something stored to compare it against.
      //
      // Synthesising `current` and comparing against that marked prompts as hand-edited when the
      // customer had changed nothing: the editor posts back the text it is showing, which was built
      // under the OLD language and agent name, while the comparison rebuilt it under the new ones.
      // Changing the language dropdown alone was enough to freeze the English prompt forever.
      const prompts = existing.prompts
        ? resolvePrompts({
            current: existing.prompts,
            submitted: body.prompts as never,
            profile,
            agentName: existing.agentName ?? "",
            language: language ?? undefined,
            regenerate: body.rebuild === true,
          })
        : buildPrompts(profile, existing.agentName ?? "", language ?? undefined);

      const saved = await saveStructured(
        target,
        { profile, prompts, voice: voice || null, language },
        // Re-rendered even though the profile did not change here: the flat columns must never be
        // able to drift from the profile they are derived from, whichever endpoint last wrote.
        deriveFromProfile(profile),
      );
      if (!saved) return status(409, { error: "no_profile", message: ADD_DETAILS_FIRST });
      return { profile: saved };
    },
    {
      query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }),
      body: t.Object({
        prompts: t.Optional(t.Unknown()),
        voice: t.Optional(t.String({ maxLength: 40 })),
        language: t.Optional(t.String({ maxLength: 16 })),
        rebuild: t.Optional(t.Boolean()),
      }),
    },
  )

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
