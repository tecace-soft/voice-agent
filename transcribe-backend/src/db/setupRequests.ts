import { sql } from "./client.js";

// Every setup request waiting for an admin, from both places one can live:
//
//   * on a signed-in customer's account (`users.onboarding_requested_at`) — they pressed Request
//     setup in the dashboard, or claimed their demo with a verified email;
//   * as an `open` row in `signup_requests` — a claim from a public page on a deployment with no
//     email, so there is no account until an admin approves it.
//
// One list for the sidebar badge and the Customers filter, oldest first (the order they asked in).

export interface SetupRequest {
  /** The account's id, or the request row's. */
  id: string;
  kind: "account" | "request";
  customerId: string;
  businessName: string;
  name: string;
  email: string;
  phone: string | null;
  note: string | null;
  requestedAt: string;
  verified: boolean;
  source: "admin" | "claim" | "start";
}

const iso = (v: unknown): string => new Date(v as string).toISOString();

export async function openSetupRequests(): Promise<SetupRequest[]> {
  const accounts = (await sql`
    SELECT u.id, u.business_id AS "customerId", d.business_name AS "businessName", u.name, u.email,
           u.onboarding_request_note AS note, u.onboarding_requested_at AS "requestedAt",
           u.email_verified_at AS "verifiedAt", u.signup_source AS source
      FROM users u JOIN demo_customers d ON d.id = u.business_id
     WHERE u.status = 'demo' AND u.onboarding_requested_at IS NOT NULL
  `) as unknown as Record<string, unknown>[];
  const requests = (await sql`
    SELECT r.id, r.customer_id AS "customerId", d.business_name AS "businessName", r.name, r.email,
           r.phone, r.note, r.created_at AS "requestedAt"
      FROM signup_requests r JOIN demo_customers d ON d.id = r.customer_id
     WHERE r.status = 'open'
  `) as unknown as Record<string, unknown>[];
  return [
    ...accounts.map(
      (r): SetupRequest => ({
        id: r.id as string,
        kind: "account",
        customerId: r.customerId as string,
        businessName: r.businessName as string,
        name: r.name as string,
        email: r.email as string,
        phone: null,
        note: (r.note as string | null) ?? null,
        requestedAt: iso(r.requestedAt),
        verified: Boolean(r.verifiedAt),
        source: (r.source as SetupRequest["source"]) ?? "admin",
      }),
    ),
    ...requests.map(
      (r): SetupRequest => ({
        id: r.id as string,
        kind: "request",
        customerId: r.customerId as string,
        businessName: r.businessName as string,
        name: r.name as string,
        email: r.email as string,
        phone: (r.phone as string | null) ?? null,
        note: (r.note as string | null) ?? null,
        requestedAt: iso(r.requestedAt),
        verified: false,
        source: "claim",
      }),
    ),
  ].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}
