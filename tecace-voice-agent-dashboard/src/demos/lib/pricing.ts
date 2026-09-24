/**
 * The price list, and the arithmetic the pricing page does with it. Three
 * numbers per plan are public — the monthly price, the minutes it includes,
 * and what a minute costs past them. Margins and the effective rate stay in
 * the spreadsheet they came from.
 *
 * Pure and clock-free: a client component imports this for the estimator.
 */

export type PlanId = "solo" | "standard" | "business";

export type Plan = {
  id: PlanId;
  name: string;
  /** Who it is for, in one line. */
  blurb: string;
  /** Dollars a month. */
  monthly: number;
  /** Minutes of answered calls the monthly price covers. */
  includedMinutes: number;
  /** Dollars per minute past the included ones. */
  overagePerMinute: number;
  /** The one the page leads with. */
  recommended?: boolean;
};

export const PLANS: readonly Plan[] = [
  {
    id: "solo",
    name: "Solo",
    blurb: "For an owner who is also the one answering the phone.",
    monthly: 99,
    includedMinutes: 500,
    overagePerMinute: 0.4,
  },
  {
    id: "standard",
    name: "Standard",
    blurb: "For a front desk that is busy most of the day.",
    monthly: 199,
    includedMinutes: 1000,
    overagePerMinute: 0.3,
    recommended: true,
  },
  {
    id: "business",
    name: "Business",
    blurb: "For a phone that does not stop ringing.",
    monthly: 299,
    includedMinutes: 2000,
    overagePerMinute: 0.25,
  },
];

/** New customers get this long on any plan before the first bill. */
export const TRIAL_DAYS = 14;

/**
 * What the page assumes a call lasts when it turns minutes into calls. A
 * receptionist call — hours, a booking, a message — runs about this long; it
 * is an illustration, and the page says "about" wherever it uses it.
 */
export const TYPICAL_CALL_MINUTES = 2;

/** Roughly how many calls a month of minutes covers. */
export function callsFor(minutes: number): number {
  return Math.round(minutes / TYPICAL_CALL_MINUTES);
}

/** The month's bill on a plan at a given usage, in dollars. */
export function monthlyCost(plan: Plan, minutes: number): number {
  const used = Math.max(0, Number.isFinite(minutes) ? minutes : 0);
  const extra = Math.max(0, used - plan.includedMinutes);
  // Cents, so 0.3 * 3 is not 0.8999….
  return Math.round((plan.monthly + extra * plan.overagePerMinute) * 100) / 100;
}

/**
 * The cheapest plan at a given usage. A tie goes to the larger plan: the same
 * money with more headroom is the better answer.
 */
export function cheapestPlan(minutes: number): Plan {
  return PLANS.reduce((best, plan) =>
    monthlyCost(plan, minutes) <= monthlyCost(best, minutes) ? plan : best,
  );
}

/** "$199", or "$214.50" when there are cents to show. */
export function formatDollars(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Overage is quoted to the cent, always: "$0.30", not "$0.3". */
export function formatRate(perMinute: number): string {
  return `$${perMinute.toFixed(2)}`;
}
