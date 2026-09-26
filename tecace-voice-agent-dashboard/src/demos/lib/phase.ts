import type { CustomerPhase } from "@/lib/types";

// Dashboard-only (see PORTING.md): how a customer's lifecycle phase reads on screen. The phase
// comes from the backend, derived from the linked account's stage; a customer without one (an
// older backend) reads as demo.

export const PHASE_LABELS: Record<CustomerPhase, string> = {
  demo: "Demo",
  onboarding: "Onboarding",
  production: "Production",
};

export const PHASE_KIND = {
  demo: "neutral",
  onboarding: "active",
  production: "positive",
} as const satisfies Record<CustomerPhase, string>;

export const phaseOf = (customer: { phase?: CustomerPhase }): CustomerPhase =>
  customer.phase ?? "demo";
