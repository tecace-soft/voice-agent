import { sql } from "./client.js";

// Where a demo customer is in its life, read alongside the demo record rather than stored on it.
//
// The phase is not a second copy of anything: it is the stage of the account linked to the demo
// (`users.business_id`), renamed for the people reading the Customers list. A demo with no account,
// or whose account is still in the demo stage or unassigned, is in `demo`. Deriving it means the
// Accounts page and the Customers list cannot disagree — there is one field, `users.status`.
//
// Kept out of `demoRead.ts` on purpose: that file's shapes are the promo's, parsed field for field
// by the ported screens, and these are additions the routes merge in.

export type CustomerPhase = "demo" | "onboarding" | "production";

export interface CustomerLifecycle {
  /** HADE-0001. Permanent: set by a trigger when the row is inserted, never changed after. */
  customerCode: string;
  phase: CustomerPhase;
  /** The linked account's email, which is how the Business pages pick a customer. */
  accountEmail: string | null;
  /**
   * An open "set this up for me", while still in the demo. From the linked account, or — on a
   * deployment with no email — from a request made on the public page, which has no account yet and
   * says who made it (`requestId`, `name`, `email`, `phone`; `openCount` when several are waiting).
   */
  request: {
    requestedAt: string;
    note: string | null;
    requestId?: string;
    name?: string;
    email?: string;
    phone?: string | null;
    openCount?: number;
  } | null;
  /** Who the linked account is and how it came to be, for the admin deciding on a request. */
  account: { name: string; email: string; verified: boolean; source: string } | null;
  /** The admin's last "not yet", shown to the customer until they ask again. */
  declined: { declinedAt: string; note: string | null } | null;
  /** When the line was switched on (Go live). */
  liveAt: string | null;
}

export function phaseOf(accountStatus: string | null | undefined): CustomerPhase {
  if (accountStatus === "pre-production") return "onboarding";
  if (accountStatus === "production") return "production";
  return "demo";
}

interface Row {
  id: string;
  customerCode: string;
  status: string | null;
  email: string | null;
  accountName: string | null;
  verifiedAt: Date | string | null;
  source: string | null;
  openId: string | null;
  openName: string | null;
  openEmail: string | null;
  openPhone: string | null;
  openNote: string | null;
  openAt: Date | string | null;
  openCount: number | null;
  requestedAt: Date | string | null;
  requestNote: string | null;
  declinedAt: Date | string | null;
  declineNote: string | null;
  liveAt: Date | string | null;
}

const iso = (value: Date | string | null): string | null =>
  value == null ? null : new Date(value).toISOString();

/** Every demo customer's code and phase, or just the one asked for. One query either way. */
export async function lifecycleByDemo(id?: string): Promise<Map<string, CustomerLifecycle>> {
  const rows = (await sql`
    SELECT d.id, d.customer_code AS "customerCode", u.status, u.email,
           u.name AS "accountName", u.email_verified_at AS "verifiedAt", u.signup_source AS source,
           u.onboarding_requested_at AS "requestedAt", u.onboarding_request_note AS "requestNote",
           u.onboarding_declined_at AS "declinedAt", u.onboarding_decline_note AS "declineNote",
           u.live_at AS "liveAt",
           r.id AS "openId", r.name AS "openName", r.email AS "openEmail", r.phone AS "openPhone",
           r.note AS "openNote", r.created_at AS "openAt", r.open_count AS "openCount"
      FROM demo_customers d
      LEFT JOIN users u ON u.business_id = d.id
      LEFT JOIN LATERAL (
        SELECT s.id, s.name, s.email, s.phone, s.note, s.created_at,
               (SELECT count(*)::int FROM signup_requests c WHERE c.customer_id = d.id AND c.status = 'open') AS open_count
          FROM signup_requests s
         WHERE s.customer_id = d.id AND s.status = 'open'
         ORDER BY s.created_at DESC LIMIT 1
      ) r ON true
     WHERE ${id === undefined ? sql`true` : sql`d.id = ${id}`}
  `) as unknown as Row[];
  return new Map(
    rows.map((row) => [
      row.id,
      {
        customerCode: row.customerCode,
        phase: phaseOf(row.status),
        accountEmail: row.email,
        request: row.requestedAt
          ? { requestedAt: iso(row.requestedAt)!, note: row.requestNote }
          : row.openId && row.openAt
            ? {
                requestedAt: iso(row.openAt)!,
                note: row.openNote,
                requestId: row.openId,
                name: row.openName ?? undefined,
                email: row.openEmail ?? undefined,
                phone: row.openPhone,
                openCount: row.openCount ?? 1,
              }
            : null,
        account: row.email
          ? {
              name: row.accountName ?? row.email,
              email: row.email,
              verified: Boolean(row.verifiedAt),
              source: row.source ?? "admin",
            }
          : null,
        declined: row.declinedAt
          ? { declinedAt: iso(row.declinedAt)!, note: row.declineNote }
          : null,
        liveAt: iso(row.liveAt),
      },
    ]),
  );
}

/** A record with its lifecycle merged in. Unknown ids pass through unchanged. */
export function withLifecycle<T extends { id: string }>(
  record: T,
  lifecycle: Map<string, CustomerLifecycle>,
): T & Partial<CustomerLifecycle> {
  const found = lifecycle.get(record.id);
  return found ? { ...record, ...found } : record;
}

/**
 * Where a demo stands for its public page's "Request setup": nobody has asked (`available`), someone
 * has — a linked account, or a request waiting for an admin (`requested`) — or it is already being set
 * up or live (`onboarding`). Says nothing about who.
 */
export type SetupState = "available" | "requested" | "onboarding";

export async function setupStateOf(demoId: string): Promise<SetupState> {
  const found = (await lifecycleByDemo(demoId)).get(demoId);
  if (!found) return "available";
  if (found.phase !== "demo") return "onboarding";
  return found.account || found.request ? "requested" : "available";
}
