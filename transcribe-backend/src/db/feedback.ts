import { sql } from "./client.js";

// What kind of note this is. Kept short and concrete — a long list of categories just makes people
// pick "other".
export type FeedbackCategory = "bug" | "idea" | "data" | "other";
export type FeedbackStatus = "open" | "resolved";

export const isCategory = (v: unknown): v is FeedbackCategory =>
  v === "bug" || v === "idea" || v === "data" || v === "other";
export const isStatus = (v: unknown): v is FeedbackStatus => v === "open" || v === "resolved";

// One submitted note. The author's name and email are copied in at submit time rather than joined
// from `users`, so the record still says who wrote it after that account is removed.
export interface FeedbackRecord {
  id: string;
  userId: string | null;
  authorName: string;
  authorEmail: string;
  category: FeedbackCategory;
  message: string;
  // A data URL of an image the author attached, or null. Rendered as-is in an <img>, so the route
  // that accepts it is responsible for proving it really is an image (see routes/feedback.ts).
  screenshot: string | null;
  status: FeedbackStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

const COLUMNS = sql`
  id,
  user_id      AS "userId",
  author_name  AS "authorName",
  author_email AS "authorEmail",
  category,
  message,
  screenshot,
  status,
  created_at   AS "createdAt",
  resolved_at  AS "resolvedAt",
  resolved_by  AS "resolvedBy"
`;

export async function insertFeedback(input: {
  userId: string;
  authorName: string;
  authorEmail: string;
  category: FeedbackCategory;
  message: string;
  screenshot: string | null;
}): Promise<FeedbackRecord> {
  const [row] = await sql`
    INSERT INTO feedback (user_id, author_name, author_email, category, message, screenshot)
    VALUES (
      ${input.userId},
      ${input.authorName},
      ${input.authorEmail},
      ${input.category},
      ${input.message.trim()},
      ${input.screenshot}
    )
    RETURNING ${COLUMNS}
  `;
  return row as FeedbackRecord;
}

// Everything anyone has sent, newest first — the admin view.
export async function listFeedback(): Promise<FeedbackRecord[]> {
  return (await sql`
    SELECT ${COLUMNS} FROM feedback ORDER BY created_at DESC
  `) as unknown as FeedbackRecord[];
}

// What one person has sent — so a `user` can see their own notes without seeing anyone else's.
export async function listFeedbackByUser(userId: string): Promise<FeedbackRecord[]> {
  return (await sql`
    SELECT ${COLUMNS} FROM feedback WHERE user_id = ${userId} ORDER BY created_at DESC
  `) as unknown as FeedbackRecord[];
}

export async function findFeedbackById(id: string): Promise<FeedbackRecord | null> {
  const [row] = await sql`SELECT ${COLUMNS} FROM feedback WHERE id = ${id}`;
  return (row as FeedbackRecord | undefined) ?? null;
}

// Mark resolved (recording who did it and when) or reopen.
export async function setFeedbackStatus(
  id: string,
  status: FeedbackStatus,
  resolvedBy: string,
): Promise<FeedbackRecord | null> {
  // Both values are passed as plain bind parameters (rather than an inline `now()` or a CASE over a
  // parameter) so Postgres infers their types from the target columns — no ambiguity to trip over.
  const resolvedAt = status === "resolved" ? new Date() : null;
  const [row] = await sql`
    UPDATE feedback
    SET status      = ${status},
        resolved_at = ${resolvedAt},
        resolved_by = ${status === "resolved" ? resolvedBy : null}
    WHERE id = ${id}
    RETURNING ${COLUMNS}
  `;
  return (row as FeedbackRecord | undefined) ?? null;
}

// How many notes are still open — the number the sidebar badges for admins.
export async function countOpenFeedback(): Promise<number> {
  const [row] = await sql`SELECT count(*)::int AS count FROM feedback WHERE status = 'open'`;
  return (row as { count: number }).count;
}
