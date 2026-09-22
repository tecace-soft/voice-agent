
import { useEffect, useRef } from "react";
import { Exchange } from "@/components/public/Exchange";
import { scrollToEnd } from "@/lib/scroll";
import type { TranscriptEntry } from "@/lib/types";

type TranscriptProps = {
  entries: TranscriptEntry[];
  thinking?: boolean;
  emptyMessage?: string;
  /** Shown as a faded first bubble before anything has been said: the line the receptionist opens with. */
  greeting?: string | null;
  /** Label under the greeting bubble; only rendered with one. */
  greetingLabel?: string;
  /** The receptionist's name for the speaker labels; the admin viewers keep the default. */
  agentName?: string;
  className?: string;
};

export function Transcript({
  entries,
  thinking,
  emptyMessage = "The transcript appears here once the call starts.",
  greeting,
  greetingLabel,
  agentName,
  className,
}: TranscriptProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  // Scroll the box this transcript lives in, and only that box. Anything
  // that reaches for the document would drag the page around on every
  // fragment when the transcript sits in a cropped frame or below the fold.
  useEffect(() => {
    scrollToEnd(endRef.current);
  }, [entries, thinking]);

  if (!entries.length && !thinking) {
    if (greeting) {
      return (
        <div className={`flex flex-col gap-2 p-4 ${className ?? ""}`}>
          <Exchange
            speaker="agent"
            text={greeting}
            agentName={agentName}
            label={greetingLabel}
            muted
            animate
            className="motion-safe:delay-500 motion-safe:fill-mode-both motion-safe:duration-500"
          />
        </div>
      );
    }
    return (
      <div className={`flex h-full items-center justify-center p-6 ${className ?? ""}`}>
        <p className="ta-body-2 text-center text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-3 p-4 ${className ?? ""}`}
      aria-live="polite"
      aria-label="Call transcript"
    >
      {entries.map((entry) => (
        <Exchange
          key={entry.id}
          speaker={entry.speaker === "caller" ? "caller" : "agent"}
          text={entry.text}
          agentName={agentName}
          callerLabel="You"
          animate
        />
      ))}

      {thinking ? (
        <div className="flex items-center gap-2 px-1">
          <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" aria-hidden />
          <span className="ta-caption-1 text-muted-foreground">
            {agentName ?? "Receptionist"} is checking
          </span>
        </div>
      ) : null}

      <div ref={endRef} />
    </div>
  );
}
