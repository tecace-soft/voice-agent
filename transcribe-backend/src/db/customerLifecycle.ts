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
  /** CUST-0001. Permanent: generated from a sequence, never written by anything. */
  customerCode: string;
  phase: CustomerPhase;
  /** The linked account's email, which is how the Business pages pick a customer. */
  accountEmail: string | null;
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
}

/** Every demo customer's code and phase, or just the one asked for. One query either way. */
export async function lifecycleByDemo(id?: string): Promise<Map<string, CustomerLifecycle>> {
  const rows = (await sql`
    SELECT d.id, d.customer_code AS "customerCode", u.status, u.email
      FROM demo_customers d
      LEFT JOIN users u ON u.business_id = d.id
     WHERE ${id === undefined ? sql`true` : sql`d.id = ${id}`}
  `) as unknown as Row[];
  return new Map(
    rows.map((row) => [
      row.id,
      { customerCode: row.customerCode, phase: phaseOf(row.status), accountEmail: row.email },
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
