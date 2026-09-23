
import { Mic, MicOff, Phone, PhoneOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/analytics";
import type { CallState } from "@/lib/types";

type CallPanelProps = {
  state: CallState;
  elapsedSec: number;
  usageSec: number;
  muted: boolean;
  error: string | null;
  disabled?: boolean;
  compact?: boolean;
  /** The status line above the button. The demo hero shows the state in its frame instead. */
  showStatus?: boolean;
  /** Stretch the call button to its container below `md` — a thumb on a phone wants that, a desktop column does not. */
  fullWidth?: boolean;
  /** Where the error caption renders when the layout reserves a slot for it; default is under the button. */
  errorSlot?: "inline" | "none";
  className?: string;
  onDial: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  onReset: () => void;
};

/** One wording per state, shared with anything else that shows the call's state. */
export const STATUS_TEXT: Record<CallState, string> = {
  idle: "Ready to call",
  connecting: "Connecting",
  ringing: "Ringing",
  connected: "Connected",
  ending: "Hanging up",
  ended: "Call ended",
  error: "Call failed",
};

const IN_CALL = new Set<CallState>(["ringing", "connected", "ending"]);
const WAITING = new Set<CallState>(["connecting", "ringing"]);

/** The colour ladder for a call state, pulsing while the line is being set up. */
export function StatusDot({ state, className }: { state: CallState; className?: string }) {
  const colour =
    state === "connected"
      ? "bg-success"
      : state === "error"
        ? "bg-destructive"
        : IN_CALL.has(state) || state === "connecting"
          ? "bg-warning"
          : "bg-muted-foreground/40";
  return (
    <span
      className={`size-2 shrink-0 rounded-full transition-colors duration-200 ${colour} ${
        WAITING.has(state) ? "motion-safe:animate-pulse" : ""
      } ${className ?? ""}`}
      aria-hidden
    />
  );
}

export function CallPanel({
  state,
  elapsedSec,
  usageSec,
  muted,
  error,
  disabled,
  compact,
  showStatus = true,
  fullWidth = false,
  errorSlot = "inline",
  className,
  onDial,
  onHangup,
  onToggleMute,
  onReset,
}: CallPanelProps) {
  const inCall = IN_CALL.has(state);
  const busy = state === "connecting" || state === "ending";
  const waiting = WAITING.has(state);
  const duration = state === "ended" ? usageSec || elapsedSec : elapsedSec;
  const size = compact ? "h-12 px-6" : "h-16 px-10";
  const width = fullWidth ? "w-full md:w-auto" : "";

  return (
    <div className={`flex flex-col items-center gap-4 ${className ?? ""}`}>
      {showStatus ? (
        <div className="flex items-center gap-3">
          <StatusDot state={state} />
          <span className="ta-label-1 text-muted-foreground">
            {STATUS_TEXT[state]}
            {(state === "connected" || state === "ended") && duration > 0
              ? ` · ${formatDuration(duration)}`
              : ""}
          </span>
        </div>
      ) : null}

      <div className={`flex items-center gap-3 ${fullWidth ? "w-full md:w-auto" : ""}`}>
        {inCall ? (
          <Button
            variant="destructive"
            size="lg"
            className={`${size} ${width} transition-all motion-safe:active:scale-[0.98]`}
            onClick={onHangup}
            disabled={state === "ending"}
            aria-label="End the call"
          >
            <PhoneOff className="size-5" />
            End call
          </Button>
        ) : (
          // The soft ring behind the button runs only while the line is being
          // set up — a visible "something is happening" between press and voice.
          <span className={`relative inline-flex ${fullWidth ? "w-full md:w-auto" : ""}`}>
            {waiting ? (
              <span
                aria-hidden
                className="bg-primary/30 absolute inset-0 rounded-lg motion-safe:animate-ping motion-safe:[animation-duration:1.4s]"
              />
            ) : null}
            <Button
              size="lg"
              className={`${size} ${width} relative transition-all hover:bg-primary-strong motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98]`}
              onClick={state === "ended" || state === "error" ? onReset : onDial}
              disabled={disabled || busy}
              aria-label={state === "ended" || state === "error" ? "Start a new call" : "Call now"}
            >
              {state === "ended" || state === "error" ? (
                <>
                  <RotateCcw className="size-5" />
                  Call again
                </>
              ) : (
                <>
                  <Phone className="size-5" />
                  {busy ? "Calling" : "Call now"}
                </>
              )}
            </Button>
          </span>
        )}

        {inCall ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-12 shrink-0"
            onClick={onToggleMute}
            aria-label={muted ? "Unmute the microphone" : "Mute the microphone"}
          >
            {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </Button>
        ) : null}
      </div>

      {error && errorSlot === "inline" ? (
        <p className="ta-caption-1 max-w-sm text-center text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
