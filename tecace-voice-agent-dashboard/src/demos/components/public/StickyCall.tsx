import { CallPanel } from "@/components/call/CallPanel";
import { VoiceOrb } from "@/components/call/VoiceOrb";
import { Logo } from "@/components/public/Logo";
import type { useLiveCall } from "@/hooks/useLiveCall";

type Props = {
  show: boolean;
  name: string;
  agentName: string;
  call: ReturnType<typeof useLiveCall>;
};

/**
 * The call button, kept within reach once the hero has scrolled away. It
 * drives the same call as the hero — pressing it here is pressing it there —
 * so a visitor who has read to the bottom does not have to climb back up.
 * Slides in from the top; when hidden it is inert so nothing focusable lurks
 * off screen.
 */
export function StickyCall({ show, name, agentName, call }: Props) {
  return (
    <div
      inert={!show}
      aria-hidden={!show}
      className={`bg-background/95 fixed inset-x-0 top-0 z-40 border-b backdrop-blur transition-transform duration-300 ease-out motion-reduce:transition-none ${
        show ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4">
        <Logo className="h-5" mark={false} />
        <VoiceOrb state={call.state} meters={call.meters} size={28} className="max-sm:hidden" />
        <span className="ta-label-1 text-muted-foreground min-w-0 truncate">
          {name}
          <span className="hidden sm:inline"> · {agentName}</span>
        </span>
        <CallPanel
          state={call.state}
          elapsedSec={call.elapsedSec}
          usageSec={call.usageSec}
          muted={call.muted}
          error={call.error}
          compact
          showStatus={false}
          errorSlot="none"
          className="ml-auto shrink-0"
          onDial={call.dial}
          onHangup={call.hangup}
          onToggleMute={call.toggleMute}
          onReset={call.reset}
        />
      </div>
    </div>
  );
}
