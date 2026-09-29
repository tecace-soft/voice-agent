import { sql } from "./client.js";
import type { Capabilities, TwilioNumber } from "../twilio/client.js";

// Which phone number belongs to which customer.
//
// The voice agent answers one number at a time and has to know whose business it is speaking for.
// Getting that wrong is not a cosmetic bug: it means telling a real caller one company's facts
// about another. So the "one number, one owner" rule is a UNIQUE constraint in the database rather
// than a check in a handler — application logic can be raced, forgotten, or bypassed by the next
// endpoint somebody adds, and a constraint cannot.
//
// One number per customer, and one customer per number — both are indexes, not conventions. The
// second direction is the dangerous one, but the first matters too: with a customer's details held
// once and used for their number, a second number would silently answer with the same details, and
// nothing in the UI would say so. Relax it when there is a reason to, deliberately.
//
// Assignment is an admin act: a customer editing their own business details is low risk, but
// claiming a phone line decides whose facts a stranger hears.
//
// Since the Twilio integration, a row also remembers what Twilio knows about the number — its SID,
// its capabilities, the webhooks it carries and whether they are the ones this server wants — so the
// dashboard can show and repair it. A row with no `twilioSid` was registered by hand and is opaque to
// this backend until a sync matches it. Released numbers keep their row (`releasedAt`) and drop out
// of every read but the admin's "include released" one.
//
// Nothing here touches the voicemail tables. This is a separate concern that happens to live in
// the same database because it is the same dashboard's users being assigned.

export type WebhookState = "unknown" | "ok" | "stale" | "error";

export interface AgentNumber {
  id: string;
  phoneE164: string;
  label: string | null;
  userId: string | null;
  // Snapshot of the assignee for display; null when the number is registered but unassigned.
  userEmail: string | null;
  userName: string | null;
  createdAt: string;
  updatedAt: string;
  // Twilio's view of the number; null across the board for one registered by hand.
  twilioSid: string | null;
  numberType: "local" | "tollfree" | null;
  capabilities: Capabilities | null;
  voiceUrl: string | null;
  voiceFallbackUrl: string | null;
  statusCallbackUrl: string | null;
  smsUrl: string | null;
  webhookState: WebhookState;
  webhookError: string | null;
  webhooksCheckedAt: string | null;
  syncedAt: string | null;
  purchasedAt: string | null;
  releasedAt: string | null;
}

// The normalizer lives in a pure module so code that must not open a database (validation,
// prompt building) can use the very same function. Re-exported here for existing importers.
import { toE164 } from "../business/phone.js";
import { inferNumberType } from "../twilio/webhooks.js";
export { toE164 };

const COLUMNS = sql`
  n.id,
  n.phone_e164          AS "phoneE164",
  n.label,
  n.user_id             AS "userId",
  u.email               AS "userEmail",
  u.name                AS "userName",
  n.created_at          AS "createdAt",
  n.updated_at          AS "updatedAt",
  n.twilio_sid          AS "twilioSid",
  n.number_type         AS "numberType",
  n.capabilities,
  n.voice_url           AS "voiceUrl",
  n.voice_fallback_url  AS "voiceFallbackUrl",
  n.status_callback_url AS "statusCallbackUrl",
  n.sms_url             AS "smsUrl",
  n.webhook_state       AS "webhookState",
  n.webhook_error       AS "webhookError",
  n.webhooks_checked_at AS "webhooksCheckedAt",
  n.synced_at           AS "syncedAt",
  n.purchased_at        AS "purchasedAt",
  n.released_at         AS "releasedAt"
`;

const FROM = sql`FROM agent_numbers n LEFT JOIN users u ON u.id = n.user_id`;

/** Every number we've registered, assigned or not. Admin view. Released ones only when asked. */
export async function listAgentNumbers(options: { includeReleased?: boolean } = {}): Promise<AgentNumber[]> {
  const scope = options.includeReleased ? sql`TRUE` : sql`n.released_at IS NULL`;
  return (await sql`
    SELECT ${COLUMNS} ${FROM} WHERE ${scope} ORDER BY n.phone_e164
  `) as unknown as AgentNumber[];
}

/** Register a number we own. Throws on a duplicate — the UNIQUE index is the enforcement. */
export async function createAgentNumber(input: {
  phone: string;
  label: string | null;
}): Promise<AgentNumber> {
  const phone = toE164(input.phone);
  const [row] = await sql`
    INSERT INTO agent_numbers (phone_e164, label) VALUES (${phone}, ${input.label})
    RETURNING id
  `;
  return (await findById((row as { id: string }).id))!;
}

/** Assign the number to a user, or clear it by passing null. */
export async function assignAgentNumber(
  id: string,
  userId: string | null,
): Promise<AgentNumber | null> {
  const [row] = await sql`
    UPDATE agent_numbers SET user_id = ${userId}, updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `;
  return row ? findById((row as { id: string }).id) : null;
}

export async function deleteAgentNumber(id: string): Promise<boolean> {
  const rows = await sql`DELETE FROM agent_numbers WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/** The number assigned to this user, or null. At most one, per agent_numbers_one_per_user. */
export async function findNumberForUser(userId: string): Promise<AgentNumber | null> {
  const [row] = await sql`
    SELECT ${COLUMNS} ${FROM} WHERE n.user_id = ${userId} AND n.released_at IS NULL
  `;
  return (row as AgentNumber | undefined) ?? null;
}

export async function findById(id: string): Promise<AgentNumber | null> {
  const [row] = await sql`SELECT ${COLUMNS} ${FROM} WHERE n.id = ${id}`;
  return (row as AgentNumber | undefined) ?? null;
}

/**
 * The agent's lookup: who does this dialled number belong to?
 *
 * Returns null both when the number is unknown and when it is registered but unassigned. The
 * caller cannot act differently on those two anyway — in both cases there is no business to speak
 * for — and collapsing them keeps the agent's decision binary.
 */
export async function findByPhone(phone: string): Promise<AgentNumber | null> {
  const normalized = toE164(phone);
  if (!normalized) return null;
  const [row] = await sql`
    SELECT ${COLUMNS} ${FROM}
    WHERE n.phone_e164 = ${normalized} AND n.user_id IS NOT NULL AND n.released_at IS NULL
  `;
  return (row as AgentNumber | undefined) ?? null;
}

/** The row a Buy click already produced, so a retry returns it instead of buying again. */
export async function findByPurchaseRequest(requestId: string): Promise<AgentNumber | null> {
  const [row] = await sql`SELECT ${COLUMNS} ${FROM} WHERE n.purchase_request_id = ${requestId}`;
  return (row as AgentNumber | undefined) ?? null;
}

// Twilio's default friendly name is the number itself, formatted; that is not a label anyone chose.
function labelFrom(twilio: TwilioNumber): string | null {
  const name = twilio.friendlyName.trim();
  if (!name) return null;
  return name.replace(/\D/g, "") === twilio.phoneNumber.replace(/\D/g, "") ? null : name;
}

/**
 * Write what Twilio says about a number onto its row, creating the row for a number we did not have.
 * Matched by phone number, so a number registered by hand picks up its SID on the first sync, and a
 * number bought again after a release reuses its old row (`released_at` cleared). An existing label
 * is kept; Twilio's friendly name only fills a blank.
 */
export async function recordTwilioNumber(
  twilio: TwilioNumber,
  webhookState: WebhookState,
): Promise<{ number: AgentNumber; inserted: boolean }> {
  const [row] = await sql`
    INSERT INTO agent_numbers (
      phone_e164, label, twilio_sid, number_type, capabilities,
      voice_url, voice_fallback_url, status_callback_url, sms_url,
      webhook_state, webhook_error, webhooks_checked_at, synced_at
    ) VALUES (
      ${twilio.phoneNumber}, ${labelFrom(twilio)}, ${twilio.sid}, ${inferNumberType(twilio.phoneNumber)},
      ${sql.json(twilio.capabilities)},
      ${twilio.voiceUrl}, ${twilio.voiceFallbackUrl}, ${twilio.statusCallback}, ${twilio.smsUrl},
      ${webhookState}, NULL, now(), now()
    )
    ON CONFLICT (phone_e164) DO UPDATE SET
      label               = COALESCE(agent_numbers.label, EXCLUDED.label),
      twilio_sid          = EXCLUDED.twilio_sid,
      number_type         = EXCLUDED.number_type,
      capabilities        = EXCLUDED.capabilities,
      voice_url           = EXCLUDED.voice_url,
      voice_fallback_url  = EXCLUDED.voice_fallback_url,
      status_callback_url = EXCLUDED.status_callback_url,
      sms_url             = EXCLUDED.sms_url,
      webhook_state       = EXCLUDED.webhook_state,
      webhook_error       = NULL,
      webhooks_checked_at = now(),
      synced_at           = now(),
      released_at         = NULL,
      released_by         = NULL,
      updated_at          = now()
    RETURNING id, (xmax = 0) AS inserted
  `;
  const { id, inserted } = row as { id: string; inserted: boolean };
  return { number: (await findById(id))!, inserted };
}

/** What a purchase adds on top of the Twilio record: when, which click, and the label the admin typed. */
export async function markPurchased(
  id: string,
  input: { requestId: string | null; label: string | null },
): Promise<AgentNumber | null> {
  const [row] = await sql`
    UPDATE agent_numbers
    SET purchased_at = now(),
        purchase_request_id = ${input.requestId},
        label = COALESCE(${input.label}, label),
        updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `;
  return row ? findById(id) : null;
}

/** The outcome of writing webhooks to Twilio: what it has now, or why it refused. */
export async function setWebhookState(
  id: string,
  state: WebhookState,
  error: string | null,
  urls?: Pick<TwilioNumber, "voiceUrl" | "voiceFallbackUrl" | "statusCallback" | "smsUrl">,
): Promise<AgentNumber | null> {
  const [row] = await sql`
    UPDATE agent_numbers
    SET webhook_state = ${state},
        webhook_error = ${error},
        webhooks_checked_at = now(),
        voice_url           = COALESCE(${urls?.voiceUrl ?? null}, voice_url),
        voice_fallback_url  = COALESCE(${urls?.voiceFallbackUrl ?? null}, voice_fallback_url),
        status_callback_url = COALESCE(${urls?.statusCallback ?? null}, status_callback_url),
        sms_url             = COALESCE(${urls?.smsUrl ?? null}, sms_url),
        updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `;
  return row ? findById(id) : null;
}

export async function markReleased(id: string, byUserId: string): Promise<AgentNumber | null> {
  const [row] = await sql`
    UPDATE agent_numbers
    SET released_at = now(), released_by = ${byUserId}, updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `;
  return row ? findById(id) : null;
}
