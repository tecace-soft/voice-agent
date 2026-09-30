import { Elysia, t } from "elysia";
import { authenticateAdmin } from "../auth/guard.js";
import { getCustomer } from "../db/demoRead.js";
import { findProfile } from "../db/businessProfiles.js";
import {
  ACCOUNT_STATUSES,
  findUserByBusinessId,
  findUserById,
  setLifecycleById,
  toPublicUser,
} from "../db/users.js";
import { OnboardError, approveOnboarding } from "../business/onboard.js";
import { readinessFor } from "../db/readiness.js";
import { declineLive, markLive, MAX_ONBOARDING_NOTE } from "../db/onboarding.js";

// Where an account is in its life, and the one-way door between the demo and the product.
//
// Mounted at the same prefix as `auth.ts`'s account management, because to an admin this IS account
// management — the Accounts page is where all of it happens. It is a separate file because `auth.ts`
// is about sessions and passwords and has no business knowing what a demo record is.
//
// THREE SEPARATE DECISIONS, three endpoints, deliberately not one:
//   * linking an account to the demo record it came from,
//   * moving it along the lifecycle,
//   * copying the demo's work into the account.
// An admin links a prospect to their new account well before deciding the line goes live, and the
// copy is the one action that is not repeatable. Rolling them into one endpoint would mean every
// stage change carried the risk of overwriting a customer's own edits.

const NEEDS_ADMIN = "Only an admin can change a customer's stage.";

// Built from the one list rather than repeated as literals, so the stages this route accepts, the
// type, and the database's CHECK constraint cannot drift apart — there is only one place to add one.
const statusField = t.Union(ACCOUNT_STATUSES.map((stage) => t.Literal(stage)));

export const lifecycle = new Elysia({ prefix: "/auth/users" })
  // Point an account at the demo record it grew out of. This is only a pointer: it says where the
  // account's data may be copied FROM, once, and changes nothing that a caller would hear.
  .post(
    "/:id/business",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NEEDS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const target = await findUserById(params.id);
      if (!target) return status(404, { error: "not_found", message: "No such account." });

      if (body.businessId) {
        const demo = await getCustomer(body.businessId);
        if (!demo) {
          return status(404, {
            error: "no_demo",
            message: "There's no demo customer with that id.",
          });
        }
        // Checked before the write as well as caught after it: the index makes this impossible, but
        // an admin deserves to be told WHO has it rather than just that it failed.
        const owner = await findUserByBusinessId(body.businessId);
        if (owner && owner.id !== target.id) {
          return status(409, {
            error: "business_taken",
            message: `${demo.businessName} is already linked to ${owner.email}.`,
          });
        }
      }

      const user = await setLifecycleById(params.id, { businessId: body.businessId });
      if (!user) {
        return status(409, {
          error: "business_taken",
          message: "That demo customer is already linked to another account.",
        });
      }
      return { user: toPublicUser(user) };
    },
    {
      params: t.Object({ id: t.String() }),
      // Null unlinks. Explicit rather than optional, so "unlink" cannot be an omitted field.
      body: t.Object({ businessId: t.Union([t.String({ maxLength: 64 }), t.Null()]) }),
    },
  )

  // Move an account along the lifecycle. Only `demo` takes anything away (the dashboard shows that
  // account the Demos section and nothing else), so this is the one field that can lock somebody
  // out of their own data — hence admin-only and never inferred from anything else.
  .post(
    "/:id/status",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NEEDS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const target = await findUserById(params.id);
      if (!target) return status(404, { error: "not_found", message: "No such account." });
      // An admin is the person who sets everyone else's stage; putting one in the demo-only view
      // would hide the Accounts page from the only account that can undo it.
      if (body.status === "demo" && target.role === "admin") {
        return status(409, {
          error: "admin_demo",
          message: "An admin can't be put in the demo-only view — they'd lose the Accounts page.",
        });
      }
      // Pre-production is where the customer edits their OWN copy of the demo. Moving a demo-linked
      // account there without making that copy left them an empty Business section; the copy happens
      // on Approve (`business/onboard.ts`), which is the one way in.
      if (
        body.status === "pre-production" &&
        target.status !== "pre-production" &&
        target.businessId &&
        !(await findProfile(target.id))
      ) {
        return status(409, {
          error: "use_onboard",
          message: "Use Approve on the customer's demo to start onboarding — it copies the demo into their account.",
        });
      }
      // Production switches a phone line on, so it has its own door with its own checks.
      if (body.status === "production" && target.status !== "production") {
        return status(409, {
          error: "use_go_live",
          message: "Use Go live to move an account to production — it checks the line is ready first.",
        });
      }

      const user = await setLifecycleById(params.id, { status: body.status });
      if (!user) return status(404, { error: "not_found", message: "No such account." });
      return { user: toPublicUser(user) };
    },
    { params: t.Object({ id: t.String() }), body: t.Object({ status: statusField }) },
  )

  // Copy the linked demo into the account's own business profile, and move it out of the demo stage.
  //
  // THE ONE-WAY DOOR. After this the two records are unrelated: the customer edits theirs in the
  // Business tabs, the operator keeps showing the demo to whoever else, and neither reaches the
  // other. That is not enforced by a flag — it is that this is the only code that ever reads one and
  // writes the other, and it refuses to run twice.
  .post(
    "/:id/promote",
    async ({ headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NEEDS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const target = await findUserById(params.id);
      if (!target) return status(404, { error: "not_found", message: "No such account." });
      if (!target.businessId) {
        return status(409, {
          error: "not_linked",
          message: "Link this account to its demo customer first.",
        });
      }

      const demo = await getCustomer(target.businessId);
      if (!demo) {
        return status(409, {
          error: "no_demo",
          message: "The demo customer this account was linked to no longer exists.",
        });
      }

      // Refuses rather than overwrites. Once a customer has a profile it is theirs — it may be the
      // copy with a week of their corrections on top, and re-running the copy would silently undo
      // every one of them. There is no `force`: an admin who really wants the demo's version back
      // can delete the profile first, which at least looks like what it is.
      if (await findProfile(target.id)) {
        return status(409, {
          error: "already_promoted",
          message:
            "This account already has its own business information — copying the demo over it " +
            "would discard their edits.",
        });
      }

      // The same approval as "Approve" on the customer's demo (`business/onboard.ts`): the copy, the
      // move to `pre-production`, the request answered, the deal won, and the customer told.
      try {
        const approved = await approveOnboarding({ demoId: target.businessId, adminId: caller.user.id });
        return {
          user: toPublicUser(approved.user),
          profile: approved.profile,
          invite: approved.invite,
          emailed: approved.emailed,
        };
      } catch (err) {
        if (err instanceof OnboardError) return status(err.status, { error: err.code, message: err.message });
        throw err;
      }
    },
    { params: t.Object({ id: t.String() }) },
  )

  // Onboarding → production: switch the line on. The only way into production (`/status` refuses
  // it), and only when every required readiness item is ticked — the same list the customer and the
  // admin see (`business/readiness.ts`). A 409 names what is missing.
  .post(
    "/:id/go-live",
    async ({ headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NEEDS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const target = await findUserById(params.id);
      if (!target) return status(404, { error: "not_found", message: "No such account." });
      if (target.status !== "pre-production") {
        return status(409, {
          error: "not_onboarding",
          message: "Only an account that is being set up can go live.",
        });
      }

      const readiness = await readinessFor(target.id);
      if (!readiness.ready) {
        const unmet = readiness.items.filter((item) => item.required && !item.ok);
        return status(409, {
          error: "not_ready",
          message: `Not ready yet: ${unmet.map((item) => item.label.toLowerCase()).join("; ")}.`,
          unmet: unmet.map((item) => item.id),
          readiness,
        });
      }

      if (!(await markLive(target.id))) {
        return status(409, {
          error: "not_onboarding",
          message: "Only an account that is being set up can go live.",
        });
      }
      const user = await findUserById(target.id);
      return { user: user ? toPublicUser(user) : null, readiness };
    },
    { params: t.Object({ id: t.String() }) },
  )

  // The admin's "not yet" to a go-live request, with a note the customer reads on their settings.
  // Go live itself is the yes (it clears the request).
  .post(
    "/:id/decline-live",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NEEDS_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      const target = await findUserById(params.id);
      if (!target) return status(404, { error: "not_found", message: "No such account." });
      if (!(await declineLive(target.id, body?.note))) {
        return status(409, { error: "no_request", message: "There's no go-live request to answer." });
      }
      const user = await findUserById(target.id);
      return { user: user ? toPublicUser(user) : null };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(t.Object({ note: t.Optional(t.String({ maxLength: MAX_ONBOARDING_NOTE })) })),
    },
  );
