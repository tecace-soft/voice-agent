import { Check } from "lucide-react";
import { cn } from "cn";
import { PLANS, callsFor } from "@/lib/pricing";
import type { PlanId } from "../api/types";
import { dollars } from "./format";

// The three plans as a radio group of cards. The same numbers the pricing page shows (`lib/pricing`),
// so a customer who read it there sees the same thing here.

export function PlanPicker({
  value,
  onChange,
  disabled,
}: {
  value: PlanId | null;
  onChange: (plan: PlanId) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Plan" className="grid gap-3 sm:grid-cols-3">
      {PLANS.map((plan) => {
        const selected = plan.id === value;
        return (
          <button
            key={plan.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(plan.id)}
            className={cn(
              "flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors duration-150",
              selected ? "border-primary bg-primary/5" : "hover:bg-accent",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="ta-headline-2">{plan.name}</span>
              {selected ? (
                <span className="bg-primary text-primary-foreground grid size-5 place-items-center rounded-full">
                  <Check className="size-3" aria-hidden />
                </span>
              ) : plan.recommended ? (
                <span className="ta-caption-2 bg-primary/10 text-primary rounded-full px-2 py-0.5 font-semibold">
                  Recommended
                </span>
              ) : null}
            </span>
            <span className="flex items-baseline gap-1">
              <span className="ta-title-3 tabular-nums">{dollars(plan.monthly)}</span>
              <span className="ta-caption-1 text-muted-foreground">/month</span>
            </span>
            <span className="ta-caption-1 text-muted-foreground">
              {plan.includedMinutes.toLocaleString("en-US")} minutes, about {callsFor(plan.includedMinutes).toLocaleString("en-US")} calls
            </span>
            <span className="ta-caption-1 text-muted-foreground">{plan.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}
