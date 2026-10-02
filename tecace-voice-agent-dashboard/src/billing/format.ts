import { PLANS, type Plan } from "@/lib/pricing";
import type { Billing, PaymentMethod, PlanId } from "../api/types";

// Small shared helpers for the billing screens: the plan catalogue the pricing page already keeps,
// and the wording for a card and the dates the backend works out (see transcribe-backend
// `db/billing.ts` for the rule: nothing before Go live, the trial from that day, the first bill
// the day after it ends).

export function planById(id: PlanId | null | undefined): Plan | null {
  return id ? (PLANS.find((plan) => plan.id === id) ?? null) : null;
}

export const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;

export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

const BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
};

export function cardLabel(method: PaymentMethod): string {
  return `${BRANDS[method.brand] ?? "Card"} •••• ${method.last4}`;
}

export function cardExpiry(method: PaymentMethod): string {
  return `${String(method.expMonth).padStart(2, "0")}/${String(method.expYear).slice(-2)}`;
}

/** One sentence on where the money stands, for the Billing page and the Home cards. */
export function billingLine(billing: Billing): string {
  switch (billing.status) {
    case "none":
      return "No plan chosen yet.";
    case "not_live":
      return `Nothing is charged until your line is live. Your ${billing.trialDays}-day free trial starts that day.`;
    case "trial":
      return billing.trialEndsAt && billing.billingFrom
        ? `Free trial until ${longDate(billing.trialEndsAt)}. The first bill is on ${longDate(billing.billingFrom)}.`
        : "On your free trial.";
    case "active":
      return billing.billingFrom ? `Billing monthly since ${longDate(billing.billingFrom)}.` : "Billing monthly.";
  }
}
