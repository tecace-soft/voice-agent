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
import { PromotionError, promoteToBusiness } from "../business/promote.js";

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

      let profile;
      try {
        profile = await promoteToBusiness(target.id, demo);
      } catch (err) {
        if (err instanceof PromotionError) {
          return status(422, { error: "thin_demo", message: err.message });
        }
        throw err;
      }

      // Out of the demo view and into the product, but NOT into production: the number still has to
      // be assigned and a transfer number typed in, neither of which a demo has. `pre-production`
      // is exactly that state — they can see and edit everything, and nothing is answering yet.
      const user = await setLifecycleById(target.id, { status: "pre-production" });
      return { user: toPublicUser(user!), profile };
    },
    { params: t.Object({ id: t.String() }) },
  );
