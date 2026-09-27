import { useEffect } from "react";
import { MessageSquareText, PhoneForwarded, Smartphone } from "lucide-react";
import { CallPanel } from "@/components/call/CallPanel";
import { Transcript } from "@/components/call/Transcript";
import { VoiceOrb } from "@/components/call/VoiceOrb";
import { Button } from "@/components/ui/button";
import { useLiveCall } from "@/hooks/useLiveCall";
import type { CallSound } from "@/lib/types";
import { MODE_LABEL, type CallSettings } from "../callSettings";
import { ringingNumber, whisper } from "./simulate";
import { useCallSimulator } from "./useCallSimulator";

// A test call from the browser, with the phone line around it simulated.
//
// The receptionist is exactly what callers get — the session is composed by the backend from the
// same settings — but a transfer rings nobody and a link texts nobody. When the receptionist puts
// someone through, this panel shows who would be rung and what they would hear, and the person
// testing plays them: answer, decline, or let it ring out. Links arrive on a simulated phone, where
// they can reply YES or STOP. What happened is sent with the call's report.

type Props = {
  /** Which half of the API to dial through: the demo's or the business's test routes. */
  api: (path: string, init?: RequestInit) => Promise<Response>;
  /** The demo id, or the business's account id when an admin acts for it (sent as `customerId`). */
  customerId: string;
  settings: CallSettings;
  businessName: string;
  /** The number texts would come from, for the consent text's "questions" line. */
  businessPhone: string | null;
  callSound?: Partial<CallSound> | null;
  disabled?: boolean;
  /** Called a moment after a call ends, so the page can re-read its call list. */
  onEnded?: () => void;
};

export function TestCallPanel({ api, customerId, settings, businessName, businessPhone, callSound, disabled, onEnded }: Props) {
  const sim = useCallSimulator(settings, businessName, businessPhone);
  const call = useLiveCall(customerId, callSound, {
    api,
    isTest: true,
    onToolCall: sim.onToolCall,
    reportExtras: sim.reportExtras,
  });

  // A fresh simulated line for every call.
  useEffect(() => {
    if (call.state === "connecting") sim.reset();
  }, [call.state, sim.reset]);

  useEffect(() => {
    if (call.state !== "ended" || !onEnded) return;
    const timer = setTimeout(onEnded, 1200);
    return () => clearTimeout(timer);
  }, [call.state, onEnded]);

  const pending = sim.pending;
  const heard = pending ? whisper(pending, businessName) : "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-center">
        <VoiceOrb state={call.state} meters={call.meters} size={64} />
      </div>
      <CallPanel
        compact
        state={call.state}
        elapsedSec={call.elapsedSec}
        usageSec={call.usageSec}
        muted={call.muted}
        error={call.error}
        disabled={disabled}
        onDial={call.dial}
        onHangup={call.hangup}
        onToggleMute={call.toggleMute}
        onReset={call.reset}
      />

      {pending ? (
        <div className="border-primary/40 bg-primary/5 rounded-xl border p-3" role="status" aria-live="polite">
          <p className="ta-label-1 flex items-center gap-2">
            <PhoneForwarded className="size-4" />
            Transferring to {pending.scenario.name} · {MODE_LABEL[pending.scenario.mode]}
          </p>
          <p className="ta-caption-1 text-muted-foreground mt-1">
            Ringing {ringingNumber(pending)}
            {pending.scenario.mode === "waterfall"
              ? ` (${pending.index + 1} of ${pending.scenario.numbers.length})`
              : ""}
            . The caller hears hold music.
          </p>
          {heard ? <p className="ta-body-2 mt-2">They hear: “{heard}”</p> : null}
          <p className="ta-caption-1 text-muted-foreground mt-2">You're playing the phone being rung:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => sim.answer("accepted")}>
              {pending.scenario.mode === "cold" ? "Answer" : "Press 1 (take it)"}
            </Button>
            {pending.scenario.mode !== "cold" ? (
              <Button size="sm" variant="outline" onClick={() => sim.answer("declined")}>
                Press 2 (decline)
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => sim.answer("no_answer")}>
              Let it ring out
            </Button>
          </div>
        </div>
      ) : null}

      {sim.transferLog.length ? (
        <p className="ta-caption-1 text-muted-foreground">Transfer: {sim.transferLog.join(" → ")}</p>
      ) : null}

      {sim.texts.length ? (
        <div className="rounded-xl border p-3">
          <p className="ta-label-1 mb-2 flex items-center gap-2">
            <Smartphone className="size-4" />
            The caller's phone
          </p>
          <ul className="flex flex-col gap-2">
            {sim.texts.map((text, i) => (
              <li
                key={i}
                className={`ta-body-2 max-w-[85%] rounded-2xl px-3 py-2 break-words ${
                  text.from === "business" ? "bg-muted self-start" : "bg-primary text-primary-foreground self-end"
                }`}
              >
                {text.text}
              </li>
            ))}
          </ul>
          {!sim.textState.optedOut && (sim.textState.waiting.length > 0 || sim.textState.consented) ? (
            <div className="mt-3 flex gap-2">
              {sim.textState.waiting.length > 0 ? (
                <Button size="sm" onClick={() => sim.reply("YES")}>
                  Reply YES
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => sim.reply("STOP")}>
                Reply STOP
              </Button>
            </div>
          ) : null}
          {sim.textState.optedOut ? (
            <p className="ta-caption-1 text-muted-foreground mt-2">This number has opted out; it gets no more texts.</p>
          ) : null}
        </div>
      ) : null}

      {sim.messages.map((m, i) => (
        <div key={i} className="rounded-xl border p-3">
          <p className="ta-label-1 flex items-center gap-2">
            <MessageSquareText className="size-4" />
            Message taken{m.scenario ? ` · ${m.scenario}` : ""}
          </p>
          <p className="ta-body-2 mt-1">{m.message}</p>
          <p className="ta-caption-1 text-muted-foreground mt-1">
            {[m.callerName, m.callbackNumber, m.requestedTime].filter(Boolean).join(" · ") || "No name or number given"}
          </p>
        </div>
      ))}

      <div className="min-h-64 flex-1 overflow-y-auto rounded-lg border">
        <Transcript entries={call.transcript} thinking={call.thinking} emptyMessage="Call to hear how the receptionist answers." />
      </div>
    </div>
  );
}
