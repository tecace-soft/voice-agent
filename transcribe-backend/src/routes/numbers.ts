import { Elysia, t } from "elysia";
import { authenticateAdmin } from "../auth/guard.js";
import { assignAgentNumber, findById, findByPurchaseRequest, findNumberForUser } from "../db/agentNumbers.js";
import { findUserById } from "../db/users.js";
import { TwilioError } from "../twilio/client.js";
import {
  adoptFromInventory,
  buyNumber,
  ensureWebhooks,
  releaseNumber,
  syncInventory,
  twilioClient,
  wantedWebhooks,
} from "../twilio/inventory.js";
import { toE164 } from "../business/phone.js";

// The agent's numbers against Twilio: what the account owns, what it sells, buying, webhooks, release.
// Beside the register/assign/delete routes in business.ts, which predate Twilio being wired up and
// stay as they are: registering by hand is still how a number this account does not own gets in.
//
// Admin-only, all of it. A customer never sees Twilio; they see the number their administrator gave
// them.

const NUMBERS_ARE_ADMIN = "Only an admin can manage the agent's phone numbers.";

const TWILIO_NOT_CONFIGURED = {
  error: "twilio_not_configured",
  message: "Twilio isn't set up on this server. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET).",
} as const;

const WEBHOOKS_NOT_CONFIGURED = {
  error: "webhooks_not_configured",
  message: "Set AGENT_PUBLIC_URL and PUBLIC_BACKEND_URL so Twilio knows where to send calls.",
} as const;

const AREA_CODE = /^[2-9]\d{2}$/;
// The same shape the register route accepts: anything else could never match a dialled number.
const E164 = /^\+[1-9]\d{7,14}$/;

/** Twilio's refusal, as the dashboard should read it. */
function twilioRefusal(error: TwilioError): { status: 409 | 502; body: { error: string; message: string; code?: number | null } } {
  // 21422 / 21421: the number is no longer for sale — somebody else bought it between the search
  // and the click. 21452: nothing left in that area code. 404: the number is not in the account any
  // more, most likely released in the console.
  if (error.code === 21422 || error.code === 21421) {
    return { status: 409, body: { error: "number_taken", message: "That number was just taken. Search again." } };
  }
  if (error.code === 21452) {
    return { status: 409, body: { error: "no_numbers_in_area", message: "Twilio has no numbers left in that area code." } };
  }
  if (error.status === 404) {
    return { status: 409, body: { error: "not_in_twilio", message: "Twilio no longer has this number. Sync to see the account as it is." } };
  }
  return { status: 502, body: { error: "twilio_error", message: error.message, code: error.code } };
}

export const numbers = new Elysia({ prefix: "/business/numbers" })
  // Where this server points every managed number — shown on the Numbers page so an admin can see
  // what Configure will write before writing it.
  .get("/webhooks", async ({ headers, status }) => {
    const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
    if ("denied" in caller) return status(caller.denied, caller.body);
    // Two halves, told apart: credentials (sync needs only these) and the two origins the webhooks
    // are built from (buy, configure and assign need both). The page words its notice from them.
    const wanted = wantedWebhooks();
    const twilio = Boolean(twilioClient());
    return { configured: twilio && wanted !== null, twilio, webhooks: wanted !== null, ...(wanted ?? {}) };
  })

  // Bring the Twilio account's numbers into the table: new ones appear unassigned, numbers registered
  // by hand pick up their SID, and every row learns whether its webhooks are the ones we want.
  .post("/sync", async ({ headers, status }) => {
    const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
    if ("denied" in caller) return status(caller.denied, caller.body);
    const client = twilioClient();
    if (!client) return status(409, TWILIO_NOT_CONFIGURED);
    try {
      return await syncInventory(client);
    } catch (error) {
      if (!(error instanceof TwilioError)) throw error;
      const refusal = twilioRefusal(error);
      return status(refusal.status, refusal.body);
    }
  })

  // Numbers for sale, of one kind, optionally in one area code.
  .get(
    "/available",
    async ({ headers, query, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);
      if (query.type !== "local" && query.type !== "tollfree") {
        return status(400, { error: "bad_type", message: 'Type must be "local" or "tollfree".', field: "type" });
      }
      if (query.areaCode && !AREA_CODE.test(query.areaCode)) {
        return status(400, { error: "bad_area_code", message: "An area code is three digits, e.g. 206.", field: "areaCode" });
      }
      if (query.limit && !/^\d{1,2}$/.test(query.limit)) {
        return status(400, { error: "bad_limit", message: "Limit is a number up to 30.", field: "limit" });
      }
      const client = twilioClient();
      if (!client) return status(409, TWILIO_NOT_CONFIGURED);
      try {
        const found = await client.searchAvailable({
          type: query.type,
          areaCode: query.areaCode || undefined,
          contains: query.contains || undefined,
          limit: query.limit ? Number(query.limit) : undefined,
        });
        return { numbers: found.map((n) => ({ ...n, type: query.type })) };
      } catch (error) {
        if (!(error instanceof TwilioError)) throw error;
        const refusal = twilioRefusal(error);
        return status(refusal.status, refusal.body);
      }
    },
    {
      query: t.Object({
        type: t.Optional(t.String({ maxLength: 20 })),
        areaCode: t.Optional(t.String({ maxLength: 10 })),
        contains: t.Optional(t.String({ maxLength: 20 })),
        limit: t.Optional(t.String({ maxLength: 3 })),
      }),
    },
  )

  // Buy a number — an exact one from a search, or the next of a kind — with its webhooks in the same
  // request, and give it to a customer in the same breath when the Go live panel asks. Everything about
  // the assignee is checked BEFORE Twilio is called: a refusal after a purchase would leave a number
  // paid for and unassigned, which is exactly the state the panel exists to avoid.
  .post(
    "/buy",
    async ({ body, headers, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);
      const client = twilioClient();
      if (!client) return status(409, TWILIO_NOT_CONFIGURED);
      const wanted = wantedWebhooks();
      if (!wanted) return status(409, WEBHOOKS_NOT_CONFIGURED);

      // A click that already bought gets its number back, before anything else is judged — after a
      // buy-and-assign, the assignee DOES have a number, and that must not read as a refusal.
      const requestId = body.requestId?.trim() || null;
      if (requestId) {
        const already = await findByPurchaseRequest(requestId);
        if (already) return { number: already };
      }

      if (!body.phoneNumber && !body.type) {
        return status(400, { error: "bad_request", message: "Say which number to buy, or which kind." });
      }
      const phoneNumber = body.phoneNumber ? toE164(body.phoneNumber) : undefined;
      if (phoneNumber !== undefined && !E164.test(phoneNumber)) {
        return status(400, {
          error: "bad_number",
          message: `"${body.phoneNumber}" isn't a phone number Twilio sells. Pick one from the search.`,
          field: "phoneNumber",
        });
      }
      if (body.areaCode && !AREA_CODE.test(body.areaCode)) {
        return status(400, { error: "bad_area_code", message: "An area code is three digits, e.g. 206.", field: "areaCode" });
      }
      if (body.assignTo) {
        const target = await findUserById(body.assignTo);
        if (!target) return status(404, { error: "not_found", message: "No such account." });
        if (target.role === "admin") {
          return status(400, {
            error: "admin_cannot_hold_number",
            message: `${target.name} is an admin. Numbers are assigned to customer accounts — an admin has no business for the agent to answer as.`,
          });
        }
        if (await findNumberForUser(target.id)) {
          return status(409, { error: "already_has_number", message: "That person already has a number. Un-assign it first." });
        }
      }

      try {
        const outcome = await buyNumber(client, wanted, {
          phoneNumber,
          type: body.type,
          areaCode: body.areaCode || undefined,
          label: body.label?.trim() || null,
          requestId,
        });
        if (outcome.kind === "none_available") {
          return status(409, { error: "no_numbers_in_area", message: "Twilio has no numbers of that kind left there. Try another area code." });
        }
        let number = outcome.number;
        if (body.assignTo) number = (await assignAgentNumber(number.id, body.assignTo)) ?? number;
        return status(201, { number });
      } catch (error) {
        if (error instanceof TwilioError) {
          const refusal = twilioRefusal(error);
          return status(refusal.status, refusal.body);
        }
        // 23505 on the one-per-user index: the assignee got a number between our check and the
        // purchase. The number IS bought by now, so say where it went.
        if ((error as { code?: string }).code === "23505") {
          return status(409, {
            error: "already_has_number",
            message: "That person got a number in the meantime. The one just bought is in the pool, unassigned.",
          });
        }
        throw error;
      }
    },
    {
      body: t.Object({
        phoneNumber: t.Optional(t.String({ maxLength: 40 })),
        type: t.Optional(t.Union([t.Literal("local"), t.Literal("tollfree")])),
        areaCode: t.Optional(t.String({ maxLength: 10 })),
        label: t.Optional(t.String({ maxLength: 200 })),
        assignTo: t.Optional(t.Union([t.String(), t.Null()])),
        requestId: t.Optional(t.String({ maxLength: 100 })),
      }),
    },
  )

  // Write the wanted webhooks onto a number: repair one Twilio has drifted on, or adopt one registered
  // by hand that is in the account after all.
  .post(
    "/:id/configure",
    async ({ headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);
      const client = twilioClient();
      if (!client) return status(409, TWILIO_NOT_CONFIGURED);
      const wanted = wantedWebhooks();
      if (!wanted) return status(409, WEBHOOKS_NOT_CONFIGURED);

      let number = await findById(params.id);
      if (!number) return status(404, { error: "not_found", message: "No such number." });
      if (number.releasedAt) return status(409, { error: "released", message: "That number was released." });
      try {
        if (!number.twilioSid) {
          const adopted = await adoptFromInventory(client, number);
          if (!adopted) {
            return status(409, {
              error: "not_in_twilio",
              message: "This number isn't in the Twilio account. Sync, or register it there first.",
            });
          }
          number = adopted;
        }
        const result = await ensureWebhooks(client, wanted, number);
        if (result.error) {
          const refusal = twilioRefusal(result.error);
          return status(refusal.status, refusal.body);
        }
        return { number: result.number };
      } catch (error) {
        if (!(error instanceof TwilioError)) throw error;
        const refusal = twilioRefusal(error);
        return status(refusal.status, refusal.body);
      }
    },
    { params: t.Object({ id: t.String() }) },
  )

  // Let a number go at Twilio. The admin types the number back: this stops a phone line, and a wrong
  // row here is a customer whose callers get a disconnected tone.
  .post(
    "/:id/release",
    async ({ body, headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, NUMBERS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);
      const client = twilioClient();
      if (!client) return status(409, TWILIO_NOT_CONFIGURED);

      const number = await findById(params.id);
      if (!number) return status(404, { error: "not_found", message: "No such number." });
      if (number.releasedAt) return status(409, { error: "released", message: "That number was already released." });
      if (toE164(body.confirm) !== number.phoneE164) {
        return status(400, { error: "confirm_mismatch", message: "Type the number exactly to release it.", field: "confirm" });
      }
      if (number.userId) {
        return status(409, { error: "number_assigned", message: "That number is assigned. Un-assign it first." });
      }
      if (!number.twilioSid) {
        return status(409, {
          error: "not_in_twilio",
          message: "This number was registered by hand and isn't in the Twilio account — delete it from the list instead.",
        });
      }
      // Only what the dashboard bought, the dashboard lets go of. A number that came in through Sync
      // was bought in the Twilio console — perhaps for something this dashboard knows nothing about, a
      // messaging service or another app — and a release cannot be undone: Twilio puts the number back
      // on sale, and it is not ours to buy back. Those are released in the console, by whoever owns them.
      if (!number.purchasedAt) {
        return status(409, {
          error: "bought_elsewhere",
          message: "This number was bought in the Twilio console, not here. Release it there if it's really no longer needed.",
        });
      }
      try {
        return { number: await releaseNumber(client, number, caller.user.id) };
      } catch (error) {
        if (!(error instanceof TwilioError)) throw error;
        const refusal = twilioRefusal(error);
        return status(refusal.status, refusal.body);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ confirm: t.String({ maxLength: 40 }) }),
    },
  );
