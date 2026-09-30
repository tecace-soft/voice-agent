import { sql } from "./client.js";
import { jsonb } from "./jsonb.js";
import {
  pendingTopics,
  type SetupInputItem,
  type SetupMessage,
  type SetupSession,
  type SetupTopic,
  type TopicStatus,
} from "../setup/types.js";

// The guided setup interview's conversations (src/setup). A row holds the chat, never a setting:
// every write the consultant makes goes into the call-settings draft through the same checks as the
// settings screen, so deleting a row (Reset) loses a conversation and nothing the phone line uses.

export interface SetupSessionRow {
  id: string;
  userId: string;
  status: "active" | "finished";
  model: string;
  items: SetupInputItem[];
  messages: SetupMessage[];
  topics: Record<SetupTopic, TopicStatus>;
  turnCount: number;
  busyUntil: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

const iso = (value: Date | string | null): string | null => (value == null ? null : new Date(value).toISOString());

function toRow(r: any): SetupSessionRow {
  return {
    id: r.id,
    userId: r.user_id,
    status: r.status,
    model: r.model,
    items: Array.isArray(r.items) ? r.items : [],
    messages: Array.isArray(r.messages) ? r.messages : [],
    // Over the defaults, so a row written before a topic existed still reads as that topic pending.
    topics: { ...pendingTopics(), ...(r.topics && typeof r.topics === "object" ? r.topics : {}) },
    turnCount: r.turn_count,
    busyUntil: iso(r.busy_until),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    finishedAt: iso(r.finished_at),
  };
}

/** What the dashboard is sent: the chat as the customer saw it, never the model's own transcript. */
export function toPublicSession(row: SetupSessionRow, maxTurns: number): SetupSession {
  return {
    id: row.id,
    status: row.status,
    topics: row.topics,
    turnCount: row.turnCount,
    maxTurns,
    messages: row.messages,
    startedAt: row.createdAt,
    ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}),
  };
}

export async function findActiveSetupSession(userId: string): Promise<SetupSessionRow | null> {
  const [row] = await sql`
    SELECT * FROM business_setup_sessions WHERE user_id = ${userId} AND status = 'active'
  `;
  return row ? toRow(row) : null;
}

export async function findLatestSetupSession(userId: string): Promise<SetupSessionRow | null> {
  const [row] = await sql`
    SELECT * FROM business_setup_sessions WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1
  `;
  return row ? toRow(row) : null;
}

/** Creates the active session, or returns the one that won the race (23505 on the partial index → re-find). */
export async function createSetupSession(userId: string, model: string): Promise<SetupSessionRow> {
  try {
    const [row] = await sql`
      INSERT INTO business_setup_sessions (user_id, model) VALUES (${userId}, ${model}) RETURNING *
    `;
    return toRow(row);
  } catch (err) {
    // 23505 is unique_violation: two tabs opened the interview at once and the other one got there
    // first. Its session is the one to continue. Anything else is not ours to swallow.
    if ((err as { code?: string })?.code === "23505") {
      const existing = await findActiveSetupSession(userId);
      if (existing) return existing;
    }
    throw err;
  }
}

/** True if this call took the turn. */
export async function claimSetupTurn(id: string, ttlSeconds: number): Promise<boolean> {
  const rows = await sql`
    UPDATE business_setup_sessions SET busy_until = now() + make_interval(secs => ${ttlSeconds})
    WHERE id = ${id} AND status = 'active' AND (busy_until IS NULL OR busy_until < now())
    RETURNING id
  `;
  return rows.length > 0;
}

/** Hands the turn back without saving, when it failed before there was anything to save. */
export async function releaseSetupTurn(id: string): Promise<void> {
  await sql`UPDATE business_setup_sessions SET busy_until = NULL WHERE id = ${id}`;
}

/** Saves a finished turn and releases it in the same write. */
export async function saveSetupTurn(
  id: string,
  patch: {
    items: SetupInputItem[];
    messages: SetupMessage[];
    topics: Record<SetupTopic, TopicStatus>;
    turnCount: number;
    finished: boolean;
  },
): Promise<SetupSessionRow> {
  const [row] = await sql`
    UPDATE business_setup_sessions SET
      items = ${jsonb(patch.items)},
      messages = ${jsonb(patch.messages)},
      topics = ${jsonb(patch.topics)},
      turn_count = ${patch.turnCount},
      busy_until = NULL,
      updated_at = now(),
      status = CASE WHEN ${patch.finished} THEN 'finished' ELSE status END,
      finished_at = CASE WHEN ${patch.finished} THEN now() ELSE finished_at END
    WHERE id = ${id}
    RETURNING *
  `;
  return toRow(row);
}

/** Reset: every session this account has, active or finished. Returns rows deleted. */
export async function deleteSetupSessions(userId: string): Promise<number> {
  const rows = await sql`DELETE FROM business_setup_sessions WHERE user_id = ${userId} RETURNING id`;
  return rows.length;
}

/**
 * User messages this account sent since `since`, across sessions — the daily cap. Counted from the
 * messages' own times rather than turn_count, which is per session and spans days.
 */
export async function countSetupTurnsSince(userId: string, since: Date): Promise<number> {
  const [row] = await sql`
    SELECT count(*)::int AS n
    FROM business_setup_sessions s, jsonb_array_elements(s.messages) m
    WHERE s.user_id = ${userId} AND m->>'role' = 'user' AND (m->>'at')::timestamptz >= ${since}
  `;
  return Number(row?.n ?? 0);
}
