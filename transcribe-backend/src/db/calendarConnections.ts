import { sql } from "./client.js";

// A business's calendar connection, and the bookings made through it. The credentials column is
// sealed by src/calendar/secrets.ts before it gets here and is only ever opened by
// src/calendar/service.ts; nothing in this file returns it to a route.

export type ConnectionRow = {
  userId: string;
  provider: string;
  account: string;
  secret: string;
  targetId: string | null;
  targetName: string | null;
  status: "ok" | "error";
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

function toRow(r: any): ConnectionRow {
  return {
    userId: r.user_id,
    provider: r.provider,
    account: r.account,
    secret: r.secret,
    targetId: r.target_id,
    targetName: r.target_name,
    status: r.status,
    lastError: r.last_error,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function findConnection(userId: string): Promise<ConnectionRow | null> {
  const [row] = await sql`SELECT * FROM calendar_connections WHERE user_id = ${userId}`;
  return row ? toRow(row) : null;
}

/** Connecting again replaces the old connection outright: one calendar per business. */
export async function saveConnection(input: {
  userId: string;
  provider: string;
  account: string;
  secret: string;
  targetId: string | null;
  targetName: string | null;
}): Promise<ConnectionRow> {
  const [row] = await sql`
    INSERT INTO calendar_connections (user_id, provider, account, secret, target_id, target_name, status, last_error, created_at, updated_at)
    VALUES (${input.userId}, ${input.provider}, ${input.account}, ${input.secret}, ${input.targetId}, ${input.targetName}, 'ok', NULL, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      provider = EXCLUDED.provider, account = EXCLUDED.account, secret = EXCLUDED.secret,
      target_id = EXCLUDED.target_id, target_name = EXCLUDED.target_name,
      status = 'ok', last_error = NULL, created_at = now(), updated_at = now()
    RETURNING *
  `;
  return toRow(row);
}

export async function updateSecret(userId: string, secret: string): Promise<void> {
  await sql`UPDATE calendar_connections SET secret = ${secret}, updated_at = now() WHERE user_id = ${userId}`;
}

export async function setTarget(userId: string, targetId: string, targetName: string): Promise<ConnectionRow | null> {
  const [row] = await sql`
    UPDATE calendar_connections SET target_id = ${targetId}, target_name = ${targetName}, updated_at = now()
    WHERE user_id = ${userId} RETURNING *
  `;
  return row ? toRow(row) : null;
}

export async function markStatus(userId: string, error: string | null): Promise<void> {
  await sql`
    UPDATE calendar_connections
    SET status = ${error ? "error" : "ok"}, last_error = ${error}, updated_at = now()
    WHERE user_id = ${userId}
  `;
}

export async function deleteConnection(userId: string): Promise<boolean> {
  const rows = await sql`DELETE FROM calendar_connections WHERE user_id = ${userId} RETURNING user_id`;
  return rows.length > 0;
}

export type BookingRow = {
  id: string;
  provider: string;
  start: string;
  end: string;
  callerName: string;
  callerPhone: string;
  reason: string;
  test: boolean;
  createdAt: string;
};

export async function recordBooking(input: {
  userId: string;
  provider: string;
  externalId: string;
  start: number;
  end: number;
  callerName: string;
  callerPhone: string;
  reason: string;
  test: boolean;
}): Promise<void> {
  await sql`
    INSERT INTO appointment_bookings (user_id, provider, external_id, start_at, end_at, caller_name, caller_phone, reason, test)
    VALUES (${input.userId}, ${input.provider}, ${input.externalId}, ${new Date(input.start)}, ${new Date(input.end)},
            ${input.callerName}, ${input.callerPhone}, ${input.reason}, ${input.test})
  `;
}

export async function recentBookings(userId: string, limit = 20): Promise<BookingRow[]> {
  const rows = await sql`
    SELECT id, provider, start_at, end_at, caller_name, caller_phone, reason, test, created_at
    FROM appointment_bookings WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows.map((r: any) => ({
    id: r.id,
    provider: r.provider,
    start: new Date(r.start_at).toISOString(),
    end: new Date(r.end_at).toISOString(),
    callerName: r.caller_name,
    callerPhone: r.caller_phone,
    reason: r.reason,
    test: r.test,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
