import { sql } from "./client.js";
import { TRIAL_DAYS, type PlanId, type StoredCard } from "../billing/plans.js";

// The customer's plan and card, and where they stand with the first bill. Everything about money
// is derived here from two facts — the row below and `users.live_at` — so the dashboard never has to
// do date arithmetic, and the rule has one home: nothing is charged before the line is live, the
// trial is TRIAL_DAYS from that day, and the first bill is the day after the trial.

export type BillingStatus =
  /** No plan chosen yet. */
  | "none"
  /** A plan and a card, but the line is not live: nothing is charged. */
  | "not_live"
  /** Live, inside the free trial. */
  | "trial"
  /** Live, past the trial: billing monthly. */
  | "active";

export interface BillingAccount {
  userId: string;
  plan: PlanId;
  paymentMethod: StoredCard | null;
  /** "test" until ax-billing (Stripe) is behind the form. */
  paymentMode: string;
  updatedAt: string;
}

export interface BillingView {
  plan: PlanId | null;
  paymentMethod: StoredCard | null;
  paymentMode: string;
  status: BillingStatus;
  trialDays: number;
  /** When the line went live, which is when the trial started. */
  liveAt: string | null;
  /** The last day of the trial; the first bill is the day after. */
  trialEndsAt: string | null;
  /** The first day that is billed. */
  billingFrom: string | null;
}

const COLUMNS = sql`
  user_id AS "userId", plan,
  payment_brand AS "paymentBrand", payment_last4 AS "paymentLast4",
  payment_exp_month AS "paymentExpMonth", payment_exp_year AS "paymentExpYear",
  payment_name AS "paymentName", payment_mode AS "paymentMode",
  updated_at AS "updatedAt"
`;

interface Row {
  userId: string;
  plan: PlanId;
  paymentBrand: string | null;
  paymentLast4: string | null;
  paymentExpMonth: number | null;
  paymentExpYear: number | null;
  paymentName: string | null;
  paymentMode: string;
  updatedAt: string;
}

function fromRow(row: Row): BillingAccount {
  const method: StoredCard | null =
    row.paymentBrand && row.paymentLast4 && row.paymentExpMonth && row.paymentExpYear
      ? {
          brand: row.paymentBrand,
          last4: row.paymentLast4,
          expMonth: Number(row.paymentExpMonth),
          expYear: Number(row.paymentExpYear),
          name: row.paymentName,
        }
      : null;
  return { userId: row.userId, plan: row.plan, paymentMethod: method, paymentMode: row.paymentMode, updatedAt: row.updatedAt };
}

export async function findBilling(userId: string): Promise<BillingAccount | null> {
  const [row] = await sql`SELECT ${COLUMNS} FROM billing_accounts WHERE user_id = ${userId}`;
  return row ? fromRow(row as Row) : null;
}

/** Choose or change the plan. Makes the row if there is none. */
export async function savePlan(userId: string, plan: PlanId): Promise<BillingAccount> {
  const [row] = await sql`
    INSERT INTO billing_accounts (user_id, plan)
    VALUES (${userId}, ${plan})
    ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, updated_at = now()
    RETURNING ${COLUMNS}
  `;
  return fromRow(row as Row);
}

/** Put a (mock) card on file. Needs a plan first: the row's plan is NOT NULL. */
export async function savePaymentMethod(userId: string, card: StoredCard): Promise<BillingAccount | null> {
  const [row] = await sql`
    UPDATE billing_accounts
       SET payment_brand = ${card.brand}, payment_last4 = ${card.last4},
           payment_exp_month = ${card.expMonth}, payment_exp_year = ${card.expYear},
           payment_name = ${card.name}, payment_mode = 'test', updated_at = now()
     WHERE user_id = ${userId}
    RETURNING ${COLUMNS}
  `;
  return row ? fromRow(row as Row) : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The dates and the status, from the row and the live date. Pure, so the route test can pin it. */
export function billingView(account: BillingAccount | null, liveAt: string | null, now = Date.now()): BillingView {
  const live = liveAt ? new Date(liveAt) : null;
  const trialEnd = live ? new Date(live.getTime() + TRIAL_DAYS * DAY_MS) : null;
  let status: BillingStatus = "none";
  if (account) status = !live ? "not_live" : now < trialEnd!.getTime() ? "trial" : "active";
  return {
    plan: account?.plan ?? null,
    paymentMethod: account?.paymentMethod ?? null,
    paymentMode: account?.paymentMode ?? "test",
    status,
    trialDays: TRIAL_DAYS,
    liveAt: live ? live.toISOString() : null,
    trialEndsAt: trialEnd ? new Date(trialEnd.getTime() - DAY_MS).toISOString() : null,
    billingFrom: trialEnd ? trialEnd.toISOString() : null,
  };
}
