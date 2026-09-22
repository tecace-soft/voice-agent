/**
 * The one chat bubble on the site.
 *
 * The live transcript, the scenarios page and the sample calls all draw the
 * same thing: a small speaker label, then a bubble that sits right and blue
 * for the caller, left and grey for the receptionist. Keeping it here means
 * a padding or colour change lands in all three at once. It is purely
 * presentational — keys, the live region and the thinking dot stay with
 * whoever renders the list.
 */
type ExchangeProps = {
  speaker: "caller" | "agent";
  text: string;
  /** The receptionist's name; defaults to the label the admin viewers have always shown. */
  agentName?: string;
  /** What to call the other side; the live call says "You". */
  callerLabel?: string;
  /** Replaces the speaker label outright — the greeting bubble says what it is instead of who. */
  label?: string;
  size?: "body" | "caption";
  /** A line that has not been said yet — the greeting shown before a call starts. */
  muted?: boolean;
  /** Slide the bubble in as it appears; on for live fragments, off for static samples. */
  animate?: boolean;
  className?: string;
};

export function Exchange({
  speaker,
  text,
  agentName = "Receptionist",
  callerLabel = "Caller",
  label,
  size = "body",
  muted = false,
  animate = false,
  className,
}: ExchangeProps) {
  const caller = speaker === "caller";
  return (
    <div
      className={`flex flex-col gap-1 ${caller ? "items-end" : "items-start"} ${
        muted ? "opacity-60" : ""
      } ${
        animate
          ? "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"
          : ""
      } ${className ?? ""}`}
    >
      <span
        className={`${size === "body" ? "ta-caption-1" : "ta-caption-2"} text-muted-foreground px-1`}
      >
        {label ?? (caller ? callerLabel : agentName)}
      </span>
      <p
        className={`${
          size === "body"
            ? "ta-body-2 max-w-[85%] rounded-xl px-3 py-2"
            : "ta-caption-1 max-w-[92%] rounded-lg px-2.5 py-1.5"
        } ${caller ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}
      >
        {text.trim()}
      </p>
    </div>
  );
}
