import { dueFollowUps, isResearchStalled } from "@/lib/analytics";
import { phaseOf } from "@/lib/phase";
import type { CustomerWithStats } from "@/lib/types";
import type { STATUS_STYLES } from "@/components/admin/shared";
import type { ProspectTab } from "../../routing";

// Dashboard-only (see PORTING.md): the one line the Prospects list shows per row instead of a
// Status, a Phase and a Live column. It answers "what happens next, and is it on me?". The rules
// are ordered by urgency: something waiting on us wins over something waiting on them.

export type NextStep = {
  label: string;
  kind: keyof typeof STATUS_STYLES;
  /** True when the next move is ours: approve, follow up, fix a failed research. */
  needsYou: boolean;
  /** Where on the prospect's page the step is done, when there is one place. */
  tab?: ProspectTab;
};

function shortDate(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
}

export function nextStep(customer: CustomerWithStats, now = Date.now()): NextStep {
  const phase = phaseOf(customer);
  if (phase === "production") return { label: "Live", kind: "positive", needsYou: false };
  if (phase === "onboarding") {
    return { label: "Onboarding, go live from Accounts", kind: "active", needsYou: false };
  }
  if (customer.request) {
    return { label: "Approve setup request", kind: "caution", needsYou: true, tab: "overview" };
  }
  if (customer.followUpAt && dueFollowUps([customer], now).length > 0) {
    return { label: `Follow up, due ${shortDate(customer.followUpAt)}`, kind: "caution", needsYou: true };
  }
  if (customer.status === "error") {
    return { label: "Research failed, run it again", kind: "negative", needsYou: true, tab: "research" };
  }
  if (customer.status === "researching") {
    return isResearchStalled(customer, now)
      ? { label: "Research stalled, run it again", kind: "negative", needsYou: true, tab: "research" }
      : { label: "Researching", kind: "neutral", needsYou: false, tab: "research" };
  }
  if (!customer.researchedAt) {
    return { label: "Research the business", kind: "neutral", needsYou: true, tab: "research" };
  }
  if (customer.followUpAt) {
    return { label: `Follow up on ${shortDate(customer.followUpAt)}`, kind: "neutral", needsYou: false };
  }
  if (customer.stage === "lost") return { label: "Lost", kind: "negative", needsYou: false };
  if (!customer.active) return { label: "Demo link paused", kind: "neutral", needsYou: false, tab: "email" };
  if (customer.stats.views === 0) {
    return { label: "Send the demo link", kind: "active", needsYou: true, tab: "email" };
  }
  return { label: "Waiting on them", kind: "neutral", needsYou: false };
}

export function needsYou(customers: CustomerWithStats[], now = Date.now()): CustomerWithStats[] {
  return customers.filter((customer) => nextStep(customer, now).needsYou);
}
