import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  PLANS,
  callsFor,
  cheapestPlan,
  formatDollars,
  monthlyCost,
} from "@/lib/pricing";

const MAX_MINUTES = 3000;
const STEP = 50;

/**
 * The question every included-minutes price list raises: which one is mine?
 * Drag to a month's worth of calls and each plan shows its bill, overage
 * included. The arithmetic is lib/pricing.ts; nothing here is sent anywhere.
 */
export function PlanEstimator() {
  const [minutes, setMinutes] = useState(600);
  const sliderId = useId();
  const best = cheapestPlan(minutes);

  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="space-y-6 p-4 md:p-6">
        <div className="space-y-2">
          <h2 className="ta-heading-2">Which plan fits your phone?</h2>
          <p className="ta-body-2-reading text-muted-foreground">
            Drag to the minutes your calls add up to in a month. Not sure? Count
            the calls you get and double it — a typical call runs about two minutes.
          </p>
        </div>

        <div className="space-y-3">
          <label htmlFor={sliderId} className="flex flex-wrap items-baseline gap-x-3">
            <span className="ta-title-3 tabular-nums">
              {minutes.toLocaleString("en-US")}
              {minutes === MAX_MINUTES ? "+" : ""} minutes
            </span>
            <span className="ta-body-2 text-muted-foreground tabular-nums">
              about {callsFor(minutes).toLocaleString("en-US")} calls a month
            </span>
          </label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={MAX_MINUTES}
            step={STEP}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
            className="accent-primary h-6 w-full cursor-pointer"
          />
        </div>

        <ul className="grid gap-3 md:grid-cols-3" aria-live="polite">
          {PLANS.map((plan) => {
            const cost = monthlyCost(plan, minutes);
            const extra = Math.max(0, minutes - plan.includedMinutes);
            const isBest = plan.id === best.id;
            return (
              <li
                key={plan.id}
                className={`space-y-1 rounded-xl border p-4 transition-colors duration-150 ${
                  isBest ? "border-primary bg-primary/5" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="ta-label-1">{plan.name}</span>
                  {isBest ? <Badge>Lowest bill</Badge> : null}
                </div>
                <p className="ta-title-3 tabular-nums">
                  {formatDollars(cost)}
                  <span className="ta-body-2 text-muted-foreground"> /month</span>
                </p>
                <p className="ta-caption-1 text-muted-foreground tabular-nums">
                  {extra > 0
                    ? `${formatDollars(plan.monthly)} + ${extra.toLocaleString("en-US")} extra minutes`
                    : "All inside the included minutes"}
                </p>
              </li>
            );
          })}
        </ul>

        {minutes >= MAX_MINUTES ? (
          <p className="ta-caption-1 text-muted-foreground">
            At this volume a Custom plan with unlimited minutes is usually the better
            deal. Ask us for a quote.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
