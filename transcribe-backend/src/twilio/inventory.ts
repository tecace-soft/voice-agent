import { env } from "../config/env.js";
import {
  listAgentNumbers,
  markPurchased,
  markReleased,
  recordTwilioNumber,
  setWebhookState,
  type AgentNumber,
  type WebhookState,
} from "../db/agentNumbers.js";
import { createTwilioClient, TwilioError, type TwilioClient, type TwilioNumber } from "./client.js";
import { webhookStateOf, webhookUrlsFor, type WebhookSet } from "./webhooks.js";

// The account's numbers, kept in step with our table: what Twilio owns, what it sells, buying, pointing
// a number's webhooks at the agent and this backend, and letting a number go. The routes stay thin;
// everything that decides something is here, and everything that talks to Twilio goes through the
// client so the route tests can fake it at `fetch`.

/** Twilio, or null when this server has no credentials — every caller turns that into one 409. */
export function twilioClient(): TwilioClient | null {
  if (!env.twilio.enabled) return null;
  const { accountSid, authToken, apiKeySid, apiKeySecret } = env.twilio;
  return createTwilioClient({ accountSid, authToken, apiKeySid, apiKeySecret });
}

/** The webhooks every managed number should carry, or null while an origin is unset. */
export function wantedWebhooks(): WebhookSet | null {
  return webhookUrlsFor({ agentPublicUrl: env.twilio.agentPublicUrl, publicBackendUrl: env.publicBackendUrl });
}

function stateOf(twilio: TwilioNumber, wanted: WebhookSet | null): WebhookState {
  return wanted ? webhookStateOf(twilio, wanted) : "unknown";
}

export interface SyncResult {
  numbers: AgentNumber[];
  added: number;
  updated: number;
  /** Registered here, not in the Twilio account: released elsewhere, or never this account's. */
  missing: string[];
  twilioCount: number;
}

/**
 * Bring the account's inventory into the table, matching numbers registered by hand by their phone.
 * A managed number the account no longer has (released in the console, behind our back) is marked in
 * error rather than left reading "configured": readiness would otherwise let a business go live on a
 * line that does not exist.
 */
export async function syncInventory(client: TwilioClient): Promise<SyncResult> {
  const inventory = await client.listIncomingNumbers();
  const wanted = wantedWebhooks();
  let added = 0;
  let updated = 0;
  for (const twilio of inventory) {
    const { inserted } = await recordTwilioNumber(twilio, stateOf(twilio, wanted));
    if (inserted) added += 1;
    else updated += 1;
  }
  const owned = new Set(inventory.map((n) => n.phoneNumber));
  const gone = (await listAgentNumbers()).filter((n) => n.twilioSid && !owned.has(n.phoneE164) && n.webhookState !== "error");
  for (const number of gone) {
    await setWebhookState(number.id, "error", "Twilio no longer has this number — released in the console? Release it here too, or Delete it.");
  }
  const numbers = await listAgentNumbers();
  const missing = numbers.filter((n) => !owned.has(n.phoneE164)).map((n) => n.phoneE164);
  return { numbers, added, updated, missing, twilioCount: inventory.length };
}

export type BuyRequest = {
  phoneNumber?: string;
  type?: "local" | "tollfree";
  areaCode?: string;
  label: string | null;
  requestId: string | null;
};

export type BuyOutcome = { kind: "bought"; number: AgentNumber } | { kind: "none_available" };

/**
 * Buy a number with its webhooks in the same request, so a number never exists at Twilio without them.
 * An exact number comes from a search the admin just did; otherwise the next one of that kind (and
 * area code) is looked up first, because Twilio's purchase-by-area-code has no toll-free form. The
 * caller has already checked who it is for, and answered a replayed `requestId` before getting here.
 */
export async function buyNumber(client: TwilioClient, wanted: WebhookSet, input: BuyRequest): Promise<BuyOutcome> {
  let phoneNumber = input.phoneNumber ?? null;
  if (!phoneNumber) {
    const [found] = await client.searchAvailable({ type: input.type ?? "local", areaCode: input.areaCode, limit: 1 });
    if (!found) return { kind: "none_available" };
    phoneNumber = found.phoneNumber;
  }

  const bought = await client.buyNumber({
    phoneNumber,
    ...(input.label ? { friendlyName: input.label } : {}),
    ...wanted,
  });
  const { number } = await recordTwilioNumber(bought, stateOf(bought, wanted));
  const purchased = await markPurchased(number.id, { requestId: input.requestId, label: input.label });
  return { kind: "bought", number: purchased ?? number };
}

/**
 * Write the wanted webhooks onto a managed number. Never throws: Twilio's refusal is recorded on the
 * row (`webhookState: "error"`) and returned, and the caller decides whether that fails its request —
 * Configure does, Assign does not.
 */
export async function ensureWebhooks(
  client: TwilioClient,
  wanted: WebhookSet,
  number: AgentNumber,
): Promise<{ number: AgentNumber; error: TwilioError | null }> {
  if (!number.twilioSid) return { number, error: null };
  try {
    const twilio = await client.updateNumber(number.twilioSid, wanted);
    const saved = await setWebhookState(number.id, webhookStateOf(twilio, wanted), null, twilio);
    return { number: saved ?? number, error: null };
  } catch (error) {
    if (!(error instanceof TwilioError)) throw error;
    const saved = await setWebhookState(number.id, "error", error.message);
    return { number: saved ?? number, error };
  }
}

/** Find a hand-registered number in the account, so Configure can adopt it. Null when Twilio lacks it. */
export async function adoptFromInventory(client: TwilioClient, number: AgentNumber): Promise<AgentNumber | null> {
  const inventory = await client.listIncomingNumbers();
  const twilio = inventory.find((n) => n.phoneNumber === number.phoneE164);
  if (!twilio) return null;
  return (await recordTwilioNumber(twilio, stateOf(twilio, wantedWebhooks()))).number;
}

/** Release at Twilio (already gone counts), then mark the row. */
export async function releaseNumber(client: TwilioClient, number: AgentNumber, byUserId: string): Promise<AgentNumber> {
  await client.releaseNumber(number.twilioSid!);
  return (await markReleased(number.id, byUserId)) ?? number;
}
