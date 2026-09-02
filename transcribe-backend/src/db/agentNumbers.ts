import { sql } from "./client.js";

// Which phone number belongs to which customer.
//
// The voice agent answers one number at a time and has to know whose business it is speaking for.
// Getting that wrong is not a cosmetic bug: it means telling a real caller one company's facts
// about another. So the "one number, one owner" rule is a UNIQUE constraint in the database rather
// than a check in a handler — application logic can be raced, forgotten, or bypassed by the next
// endpoint somebody adds, and a constraint cannot.
//
// A user MAY hold several numbers (a business with more than one line). Only the reverse is
// forbidden. Assignment is an admin act: a customer editing their own business details is low
// risk, but claiming a phone line decides whose facts a stranger hears.
//
// Nothing here touches the voicemail tables. This is a separate concern that happens to live in
// the same database because it is the same dashboard's users being assigned.

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
}

/**
 * Best-effort E.164, matching openai-agent-app's `to_e164` exactly.
 *
 * This is the ONLY normalizer in this system by design. The agent sends Twilio's raw `To` and the
 * backend normalizes it, so the string that looks a number up is produced by the same code that
 * wrote it. Two implementations of "nearly E.164" drift on some edge case and then a lookup misses
 * silently — which, here, means falling back to the neutral prompt for a customer who is correctly
 * configured.
 */
export function toE164(input: string, defaultCountryCode = "1"): string {
  const s = (input ?? "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return "+" + s.slice(1).replace(/\D/g, "");
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : s;
}

const COLUMNS = sql`
  n.id,
  n.phone_e164 AS "phoneE164",
  n.label,
  n.user_id    AS "userId",
  u.email      AS "userEmail",
  u.name       AS "userName",
  n.created_at AS "createdAt",
  n.updated_at AS "updatedAt"
`;

const FROM = sql`FROM agent_numbers n LEFT JOIN users u ON u.id = n.user_id`;

/** Every number we've registered, assigned or not. Admin view. */
export async function listAgentNumbers(): Promise<AgentNumber[]> {
  return (await sql`
    SELECT ${COLUMNS} ${FROM} ORDER BY n.phone_e164
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
    SELECT ${COLUMNS} ${FROM} WHERE n.phone_e164 = ${normalized} AND n.user_id IS NOT NULL
  `;
  return (row as AgentNumber | undefined) ?? null;
}
