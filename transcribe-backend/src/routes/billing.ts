import { Elysia, t } from "elysia";
import { authenticate, UNAUTHORIZED } from "../auth/guard.js";
import { CardError, checkCard, isPlanId, PLAN_IDS } from "../billing/plans.js";
import { billingView, findBilling, savePaymentMethod, savePlan } from "../db/billing.js";
import { findUserById } from "../db/users.js";

// Billing, for the Billing page and the request-setup flow. Every signed-in account reads its own;
// an admin may name another with `?userId=`, the same rule as `/business/*`. The card is a MOCK
// (see `billing/plans.ts`): checked like a card form checks it, stored as a receipt would print it.

const cardBody = t.Object({
  number: t.String({ minLength: 12, maxLength: 23 }),
  expMonth: t.Integer({ minimum: 1, maximum: 12 }),
  expYear: t.Integer({ minimum: 0, maximum: 2100 }),
  cvc: t.String({ minLength: 3, maxLength: 4 }),
  name: t.Optional(t.String({ maxLength: 120 })),
});

/** Whose billing: the caller's own, or the account an admin names. */
async function target(user: { id: string; role: string; liveAt: string | null }, requested?: string) {
  const id = user.role === "admin" && requested?.trim() ? requested.trim() : user.id;
  if (id === user.id) return { id, liveAt: user.liveAt };
  const found = await findUserById(id);
  return found ? { id: found.id, liveAt: found.liveAt } : null;
}

export const billing = new Elysia({ prefix: "/billing" })
  .get(
    "/",
    async ({ headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const who = await target(user, query.userId);
      if (!who) return status(404, { error: "not_found", message: "No such account." });
      return { billing: billingView(await findBilling(who.id), who.liveAt), plans: PLAN_IDS };
    },
    { query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }) },
  )

  .put(
    "/plan",
    async ({ body, headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const who = await target(user, query.userId);
      if (!who) return status(404, { error: "not_found", message: "No such account." });
      if (!isPlanId(body.plan)) return status(422, { error: "unknown_plan", message: "Pick one of the three plans." });
      const saved = await savePlan(who.id, body.plan);
      return { billing: billingView(saved, who.liveAt) };
    },
    {
      query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }),
      body: t.Object({ plan: t.String({ maxLength: 20 }) }),
    },
  )

  .put(
    "/payment-method",
    async ({ body, headers, query, status }) => {
      const user = await authenticate(headers.authorization);
      if (!user) return status(401, UNAUTHORIZED);
      const who = await target(user, query.userId);
      if (!who) return status(404, { error: "not_found", message: "No such account." });
      let card;
      try {
        card = checkCard(body);
      } catch (err) {
        if (err instanceof CardError) return status(422, { error: "bad_card", field: err.field, message: err.message });
        throw err;
      }
      const saved = await savePaymentMethod(who.id, card);
      if (!saved) return status(409, { error: "no_plan", message: "Choose a plan before adding a card." });
      return { billing: billingView(saved, who.liveAt) };
    },
    {
      query: t.Object({ userId: t.Optional(t.String({ maxLength: 64 })) }),
      body: cardBody,
    },
  );

export { cardBody };
