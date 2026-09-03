import { sql } from "./client.js";
import { toE164 } from "./agentNumbers.js";

// A call the voice agent answered, kept so the customer can read it back.
//
// This is the conversational counterpart to a transcribed voicemail, and it is deliberately shaped
// like one: who rang, on what number, when, what they wanted, and the words. A customer reading the
// two should not have to think about which pipeline produced which.
//
// It is BETTER source material than a voicemail, and the columns reflect that. The agent asks for a
// name, reads the callback number back to confirm it, and can clarify what someone actually wants —
// none of which a recording can do. So `callerName` and `callbackNumber` are what the caller
// confirmed, while `caller` is what the phone network said, and they are kept apart because they
// legitimately differ: the number you ring from is not always the number you want ringing back.
//
// Ownership comes from the number that was DIALLED, resolved through agent_numbers. The agent never
// sends a user id — it doesn't have one, and it shouldn't need to know our accounts exist.

export interface CallTurn {
  speaker: "agent" | "caller";
  text: string;
}

export interface InboundCall {
  id: string;
  userId: string | null;
  dialled: string;
  caller: string | null;
  callerName: string | null;
  callbackNumber: string | null;
  request: string | null;
  summary: string | null;
  outcome: string | null;
  callbackRequested: boolean;
  durationSeconds: number | null;
  turns: CallTurn[];
  startedAt: string;
  createdAt: string;
}

export interface InboundCallInput {
  dialled: string;
  caller?: string;
  forwardedFrom?: string;
  callerName?: string;
  callbackNumber?: string;
  request?: string;
  summary?: string;
  outcome?: string;
  callbackRequested?: boolean;
  durationSeconds?: number;
  turns: CallTurn[];
  startedAt?: string;
}

const COLUMNS = sql`
  id,
  user_id            AS "userId",
  dialled,
  caller,
  caller_name        AS "callerName",
  callback_number    AS "callbackNumber",
  request,
  summary,
  outcome,
  callback_requested AS "callbackRequested",
  duration_seconds   AS "durationSeconds",
  turns,
  started_at         AS "startedAt",
  created_at         AS "createdAt"
`;

/**
 * Guarantee `turns` is an array before it leaves this module.
 *
 * A jsonb column can come back parsed or as a string depending on the driver's type handling, and a
 * row written before the column existed has no value at all. The dashboard maps over this, so any
 * of those crashes the render and blanks the page — a whole view lost to one malformed row.
 */
function withTurns<T extends { turns: unknown }>(row: T): T {
  const raw = row.turns;
  if (Array.isArray(raw)) return row;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return { ...row, turns: Array.isArray(parsed) ? parsed : [] };
    } catch {
      return { ...row, turns: [] };
    }
  }
  return { ...row, turns: [] };
}

/**
 * Store one answered call, attributing it to whoever owns the number that was dialled.
 *
 * A call to a number nobody owns is stored with a null user rather than dropped. It means an admin
 * forgot to assign the line, not that the call didn't happen — and a customer ringing in deserves
 * better than their message being discarded because of our bookkeeping.
 */
export async function insertInboundCall(input: InboundCallInput): Promise<InboundCall> {
  const dialled = toE164(input.dialled);
  const caller = input.caller ? toE164(input.caller) : null;
  const forwarded = input.forwardedFrom ? toE164(input.forwardedFrom) : null;

  // A carrier that doesn't pass the original caller ID presents the FORWARDING line instead, so
  // caller == forwardedFrom means we were told the customer's own number, not the caller's.
  // Storing it would put the customer's own line in the "who rang" column of every record.
  const trustedCaller = caller && forwarded && caller === forwarded ? null : caller;

  const [row] = await sql`
    INSERT INTO inbound_calls (
      user_id, dialled, caller, caller_name, callback_number, request, summary, outcome,
      callback_requested, duration_seconds, turns, started_at
    ) VALUES (
      (SELECT user_id FROM agent_numbers WHERE phone_e164 = ${dialled}),
      ${dialled},
      ${trustedCaller},
      ${input.callerName ?? null},
      ${input.callbackNumber ? toE164(input.callbackNumber) : null},
      ${input.request ?? null},
      ${input.summary ?? null},
      ${input.outcome ?? null},
      ${input.callbackRequested ?? false},
      ${input.durationSeconds ?? null},
      ${JSON.stringify(input.turns ?? [])}::jsonb,
      ${input.startedAt ? new Date(input.startedAt) : new Date()}
    )
    RETURNING ${COLUMNS}
  `;
  return withTurns(row as InboundCall);
}

/** Calls for one customer, newest first. */
export async function listInboundCalls(userId: string, limit = 200): Promise<InboundCall[]> {
  const rows = (await sql`
    SELECT ${COLUMNS} FROM inbound_calls
    WHERE user_id = ${userId}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `) as unknown as InboundCall[];
  return rows.map(withTurns);
}

/** Every call, for an admin looking across customers. Includes unattributed ones. */
export async function listAllInboundCalls(limit = 200): Promise<InboundCall[]> {
  const rows = (await sql`
    SELECT ${COLUMNS} FROM inbound_calls
    ORDER BY started_at DESC
    LIMIT ${limit}
  `) as unknown as InboundCall[];
  return rows.map(withTurns);
}
