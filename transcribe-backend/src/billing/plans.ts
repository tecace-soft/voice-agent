// The plans a customer can be on, and the card check the mock payment step does.
//
// Prices live with the dashboard's pricing page (`tecace-voice-agent-dashboard/src/demos/lib/pricing.ts`);
// this file only knows the ids, so the backend can refuse a plan that does not exist. The trial
// length is here because the backend works out the dates.

export const PLAN_IDS = ["solo", "standard", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const isPlanId = (value: unknown): value is PlanId =>
  typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);

/** New customers get this long, from the day their line goes live, before the first bill. */
export const TRIAL_DAYS = 14;

export interface CardInput {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  name?: string;
}

export interface StoredCard {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  name: string | null;
}

export class CardError extends Error {
  constructor(
    readonly field: "number" | "expiry" | "cvc",
    message: string,
  ) {
    super(message);
  }
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function brandOf(digits: string): string {
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^6(?:011|5)/.test(digits)) return "discover";
  return "card";
}

/**
 * The mock payment step: the same checks a card form does before it talks to a processor, so the
 * dashboard's form behaves as it will once Stripe is behind it. Keeps only what a receipt prints.
 */
export function checkCard(input: CardInput, now = new Date()): StoredCard {
  const digits = input.number.replace(/[\s-]/g, "");
  if (!/^\d{12,19}$/.test(digits) || !luhn(digits)) {
    throw new CardError("number", "That card number doesn't look right.");
  }
  const year = input.expYear < 100 ? 2000 + input.expYear : input.expYear;
  if (
    !Number.isInteger(input.expMonth) ||
    input.expMonth < 1 ||
    input.expMonth > 12 ||
    !Number.isInteger(year) ||
    year < now.getFullYear() ||
    (year === now.getFullYear() && input.expMonth < now.getMonth() + 1)
  ) {
    throw new CardError("expiry", "That expiry date has passed.");
  }
  const brand = brandOf(digits);
  if (!/^\d{3,4}$/.test(input.cvc) || (brand === "amex" ? input.cvc.length !== 4 : input.cvc.length !== 3)) {
    throw new CardError("cvc", "The security code is 3 digits (4 on American Express).");
  }
  return {
    brand,
    last4: digits.slice(-4),
    expMonth: input.expMonth,
    expYear: year,
    name: input.name?.trim() || null,
  };
}
