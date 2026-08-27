import { IconAlert } from "../icons";

// How close this month's usage is to the billing allowance.
//
// It only renders once usage passes the warn threshold. A limit shown permanently is furniture —
// it gets read once and then never seen again, which is precisely the wrong behavior for the thing
// that should catch someone's eye in the last week of a heavy month. Below the threshold this
// returns null and the card looks exactly as it always did.
//
// Deliberately quiet even when it does appear: a thin bar and one line of text inside the existing
// card, not a banner across the page. Nothing here blocks or changes what the app does — going over
// costs money, it doesn't stop the transcription.

export interface Cap {
  limit: number;
  warnAt: number;
  /** Dollars per transcript past the limit. 0 = say nothing about money. */
  overageRate: number;
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Whether the cap is worth mentioning at all — exported so the card can adjust its own tone. */
export function capState(used: number, cap: Cap | undefined): "hidden" | "near" | "over" {
  if (!cap || cap.limit <= 0) return "hidden";
  if (used >= cap.limit) return "over";
  return used >= cap.limit * cap.warnAt ? "near" : "hidden";
}

export function CapMeter({ used, cap }: { used: number; cap: Cap | undefined }) {
  const state = capState(used, cap);
  if (state === "hidden" || !cap) return null;

  const pct = Math.min(100, (used / cap.limit) * 100);
  const left = cap.limit - used;
  const over = Math.max(0, used - cap.limit);
  // The rate is quoted straight from the backend rather than assumed here, so a price change is a
  // config change. When it is 0 the sentences fall back to naming the limit without a cost.
  const priced = cap.overageRate > 0;

  return (
    <div className={`cap-meter cap-${state}`}>
      <div className="cap-track" role="presentation">
        {/* The fill is capped at 100% so an overage doesn't render a bar wider than its track. */}
        <div className="cap-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="cap-note ta-caption-1">
        <IconAlert size={12} />
        {state === "over" ? (
          <>
            <strong>{used.toLocaleString()}</strong> of {cap.limit.toLocaleString()} this month —{" "}
            {over === 0 ? "at the limit" : `${over.toLocaleString()} over`}.
            {priced && <> Extra transcripts are {money.format(cap.overageRate)} each.</>}
          </>
        ) : (
          <>
            <strong>{used.toLocaleString()}</strong> of {cap.limit.toLocaleString()} this month —{" "}
            {left.toLocaleString()} left.
            {priced && <> After that, transcripts are {money.format(cap.overageRate)} each.</>}
          </>
        )}
      </p>
    </div>
  );
}
