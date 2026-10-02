import type { CallTurn } from "../api/types";
import { Exchange } from "../demos/components/public/Exchange";

// A transcript read like a text-message thread: the demo's own chat bubble (`Exchange` — caller on
// the right in brand blue, the receptionist on the left in grey), so a real call reads exactly like
// the test call a customer had on their demo. The bubbles are promo markup (Tailwind), so they sit
// in a `.tw` island inside the legacy call row, as the sidebar's voice orb does.
//
// Static: no slide-in and no scroll-to-end — the call is over, and a long one is read from the top.

export function CallConversation({ turns, callerName }: { turns: CallTurn[]; callerName?: string }) {
  if (turns.length === 0) {
    return <p className="muted ta-caption-1">No conversation was captured for this call.</p>;
  }
  return (
    <div className="tw">
      <div
        className="flex max-h-[560px] flex-col gap-3 overflow-y-auto rounded-xl border p-4"
        aria-label="Call transcript"
      >
        {turns.map((turn, i) => (
          <Exchange
            key={i}
            speaker={turn.speaker === "caller" ? "caller" : "agent"}
            text={turn.text}
            callerLabel={callerName || "Caller"}
          />
        ))}
      </div>
    </div>
  );
}
