import { Elysia, t } from "elysia";
import { apiKeyPrefixOf, generateApiKey, hashApiKey } from "../auth/apiKey.js";
import { authenticateAdmin } from "../auth/guard.js";
import { createApiKey, deleteApiKey, findApiKey, listApiKeys, revokeApiKey } from "../db/apiKeys.js";
import { findUserById } from "../db/users.js";

// Issuing and withdrawing the keys other systems use to read this API. Admin-only: a key is access
// to a customer's usage data, so handing one out is an administrator's decision, not a customer's.
//
// The secret is returned exactly ONCE, by the create call. Nothing stores it, so a lost key is
// replaced rather than looked up — the same rule as a generated account password.

const KEYS_ARE_ADMIN = "Only an admin can manage API keys.";

export const apiKeys = new Elysia({ prefix: "/api-keys" })
  .get("/", async ({ headers, status }) => {
    const caller = await authenticateAdmin(headers.authorization, KEYS_ARE_ADMIN);
    if ("denied" in caller) return status(caller.denied, caller.body);
    return { keys: await listApiKeys() };
  })

  .post(
    "/",
    async ({ body, headers, status }) => {
      const caller = await authenticateAdmin(headers.authorization, KEYS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);

      // Scoped to one business, or to all of them. A key for a specific customer is checked here so
      // a typo becomes a message rather than a key that reads nothing and looks broken.
      const userId = body.userId?.trim() || null;
      if (userId) {
        const target = await findUserById(userId);
        if (!target) {
          return status(404, { error: "not_found", message: "No such customer account." });
        }
        if (target.role === "admin") {
          return status(422, {
            error: "admin_scope",
            message: "An admin account isn't a business. Pick a customer, or give the key every business.",
          });
        }
      }

      const secret = generateApiKey();
      const key = await createApiKey({
        name: body.name,
        keyHash: hashApiKey(secret),
        keyPrefix: apiKeyPrefixOf(secret),
        userId,
        createdBy: caller.user.email,
      });
      // The only time this value exists outside the caller's own config.
      return status(201, { key, secret });
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 80 }),
        // Omitted or blank = every business.
        userId: t.Optional(t.String({ maxLength: 64 })),
      }),
    },
  )

  // Stop a key working. The row stays, so who had access and when is still answerable afterwards.
  .post(
    "/:id/revoke",
    async ({ headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, KEYS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);
      const key = await revokeApiKey(params.id);
      if (!key) return status(404, { error: "not_found", message: "No such API key." });
      return { key };
    },
    { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  )

  // Remove the record entirely. Revoking is usually what you want; this is for a key created by
  // mistake, where there is no history worth keeping.
  .delete(
    "/:id",
    async ({ headers, params, status }) => {
      const caller = await authenticateAdmin(headers.authorization, KEYS_ARE_ADMIN);
      if ("denied" in caller) return status(caller.denied, caller.body);
      if (!(await findApiKey(params.id))) {
        return status(404, { error: "not_found", message: "No such API key." });
      }
      await deleteApiKey(params.id);
      return { status: "removed" };
    },
    { params: t.Object({ id: t.String({ maxLength: 64 }) }) },
  );
