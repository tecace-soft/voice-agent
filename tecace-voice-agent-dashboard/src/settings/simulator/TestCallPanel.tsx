import { useEffect, useState, type ReactNode } from "react";
import { CalendarCheck, MessageSquareText, Mic, MicOff, Phone, PhoneForwarded, PhoneOff, RotateCcw, Smartphone } from "lucide-react";
import { STATUS_TEXT, StatusDot } from "@/components/call/CallPanel";
import { Transcript } from "@/components/call/Transcript";
import { VoiceOrb } from "@/components/call/VoiceOrb";
import { Button } from "@/components/ui/button";
import { useLiveCall } from "@/hooks/useLiveCall";
import { formatDuration } from "@/lib/analytics";
import type { CallSound, CallState } from "@/lib/types";
import { MODE_LABEL, type CallSettings } from "../callSettings";
import { eventLine } from "./eventLabels";
import { ringingNumber, whisper } from "./simulate";
import { useCallSimulator, type BookingToolRunner } from "./useCallSimulator";

// A test call from the browser, with the phone line around it simulated — the settings studio's
// console.
//
// The receptionist is exactly what callers get — the session is composed by the backend from the
// same settings — but a transfer rings nobody and a link texts nobody. When the receptionist puts
// someone through, a card pinned under the call says who would be rung and what they would hear, and
// the person testing plays them: answer, decline, or let it ring out. Links arrive on "the caller's
// phone" under the conversation, where they can reply YES or STOP. Everything that happened is in Events, and is sent with the
// call's report.
//
// Laid out like a voice-agent builder's test panel, and drawn edge to edge in the studio's console
// (SettingsShell `asideBare`): tabs for the call, an example call and the events; the call is one
// compact row and then the conversation, which scrolls in its own space instead of pushing the page.
// Texts and transfer cards appear in the conversation where they happen; a line at the foot says
// what test calls cost.

type Props = {
  /** Which half of the API to dial through: the demo's or the business's test routes. */
  api: (path: string, init?: RequestInit) => Promise<Response>;
  /** The demo id, or the business's account id when an admin acts for it (sent as `customerId`). */
  customerId: string;
  settings: CallSettings;
  businessName: string;
  /** The number texts would come from, for the consent text's "questions" line. */
  businessPhone: string | null;
  /** Who answers, for the call row. */
  agentName?: string;
  callSound?: Partial<CallSound> | null;
  disabled?: boolean;
  /** Called a moment after a call ends, so the page can re-read its call list. */
  onEnded?: () => void;
  /** A business's real calendar, for check_availability / book_appointment. A demo has none. */
  bookingTool?: BookingToolRunner;
  /** The Example call tab: a scripted call built from the settings, for before the first test call. */
  example?: ReactNode;
  /** The console's last line: test minutes, "Phone line simulated". */
  footer?: ReactNode;
  /** Above the call row: the month's minutes being used up. */
  notice?: ReactNode;
};

type Tab = "call" | "example" | "events";
const IN_CALL = new Set<CallState>(["ringing", "connected", "ending"]);

export function TestCallPanel({
  api,
  customerId,
  settings,
  businessName,
  businessPhone,
  agentName,
  callSound,
  disabled,
  onEnded,
  bookingTool,
  example,
  footer,
  notice,
}: Props) {
  const sim = useCallSimulator(settings, businessName, businessPhone, bookingTool);
  const call = useLiveCall(customerId, callSound, {
    api,
    isTest: true,
    onToolCall: sim.onToolCall,
    reportExtras: sim.reportExtras,
  });
  const [tab, setTab] = useState<Tab>("call");

  // A fresh simulated line for every call, and the call in view while it happens.
  useEffect(() => {
    if (call.state === "connecting") {
      sim.reset();
      setTab("call");
    }
  }, [call.state, sim.reset]);

  // A transfer to answer, a text to reply to or a booking made needs the call in view.
  const pendingId = sim.pending ? `${sim.pending.scenario.id}:${sim.pending.index}` : "";
  useEffect(() => {
    if (pendingId || sim.texts.length || sim.bookings.length) setTab("call");
  }, [pendingId, sim.texts.length, sim.bookings.length]);

  useEffect(() => {
    if (call.state !== "ended" || !onEnded) return;
    const timer = setTimeout(onEnded, 1200);
    return () => clearTimeout(timer);
  }, [call.state, onEnded]);

  const pending = sim.pending;
  const heard = pending ? whisper(pending, businessName) : "";
  const inCall = IN_CALL.has(call.state);
  const busy = call.state === "connecting" || call.state === "ending";
  const over = call.state === "ended" || call.state === "error";
  const duration = call.state === "ended" ? call.usageSec || call.elapsedSec : call.elapsedSec;
  const events = sim.events.map(eventLine).filter((line): line is string => Boolean(line));
  const eventCount = events.length + sim.messages.length;

  const tabs: [Tab, string, number][] = [
    ["call", "Test call", 0],
    ...(example ? ([["example", "Example call", 0]] as [Tab, string, number][]) : []),
    ["events", "Events", eventCount],
  ];

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <div className="flex h-11 shrink-0 items-end gap-4 border-b px-4" role="group" aria-label="Test console">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`ta-label-1 -mb-px border-b-2 pb-2.5 transition-colors ${
              tab === id ? "border-foreground text-foreground" : "text-muted-foreground hover:text-foreground border-transparent"
            }`}
          >
            {label}
            {count ? <span className="ta-caption-2 text-muted-foreground ml-1">{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "call" ? (
        <>
          {notice}
          <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
            <VoiceOrb state={call.state} meters={call.meters} size={40} />
            <div className="min-w-0 flex-1">
              <p className="ta-label-1 truncate">
                {agentName ? `${agentName} · ` : ""}
                {businessName || "Your receptionist"}
              </p>
              <p className="ta-caption-1 text-muted-foreground flex items-center gap-1.5">
                <StatusDot state={call.state} />
                {STATUS_TEXT[call.state]}
                {(call.state === "connected" || call.state === "ended") && duration > 0
                  ? ` · ${formatDuration(duration)}`
                  : ""}
              </p>
            </div>
            {inCall ? (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={call.toggleMute}
                  aria-label={call.muted ? "Unmute the microphone" : "Mute the microphone"}
                >
                  {call.muted ? <MicOff /> : <Mic />}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={call.hangup}
                  disabled={call.state === "ending"}
                  aria-label="End the call"
                >
                  <PhoneOff className="size-4" />
                  End
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={over ? call.reset : call.dial}
                disabled={disabled || busy}
                aria-label={over ? "Start a new call" : "Call now"}
              >
                {over ? <RotateCcw className="size-4" /> : <Phone className="size-4" />}
                {over ? "Call again" : busy ? "Calling" : "Call"}
              </Button>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3.5">
            {call.error ? (
              <p className="ta-caption-1 text-destructive" role="alert">
                {call.error}
              </p>
            ) : null}

            <Transcript
              entries={call.transcript}
              thinking={call.thinking}
              emptyMessage="Call, then talk as a caller would. Try asking for a person, or for directions."
            />

            {pending ? (
              <div className="border-warning/50 bg-warning/10 rounded-xl border p-3" role="status" aria-live="polite">
                <p className="ta-label-1 text-warning flex items-center gap-2">
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

            {/* A test booking is real — it is in the calendar now — so it stays in view like a transfer. */}
            {sim.bookings.map((b, i) => (
              <div key={`booking-${i}`} className="border-primary/30 bg-primary/10 rounded-xl border p-3" role="status">
                <p className="ta-label-1 flex items-center gap-2">
                  <CalendarCheck className="size-4" />
                  Booked · {b.when}
                </p>
                <p className="ta-caption-1 text-muted-foreground mt-1">
                  {[b.callerName, b.reason].filter(Boolean).join(" · ") || "No name given"} · in your calendar, marked [Test]
                </p>
              </div>
            ))}

            {/* Links the receptionist texted, on the caller's phone — reply YES or STOP here. */}
            {sim.texts.length ? (
              <div className="border-t pt-3" aria-label="Texts">
                <p className="ta-caption-1 text-muted-foreground mb-2 flex items-center gap-2">
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

            {example && !inCall && !busy && call.transcript.length === 0 ? (
              <button
                type="button"
                onClick={() => setTab("example")}
                className="ta-caption-1 text-primary self-center hover:underline"
              >
                Not sure what to try? See an example call
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {tab === "example" ? <div className="min-h-0 flex-1 overflow-y-auto p-4">{example}</div> : null}

      {tab === "events" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {events.length || sim.messages.length || sim.transferLog.length ? (
            <ul className="flex flex-col gap-2">
              {events.map((line, i) => (
                <li key={`e${i}`} className="ta-caption-1 border-l-2 pl-3">
                  {line}
                </li>
              ))}
              {sim.transferLog.length ? (
                <li className="ta-caption-1 text-muted-foreground border-l-2 pl-3">
                  Transfer: {sim.transferLog.join(" → ")}
                </li>
              ) : null}
              {sim.messages.map((m, i) => (
                <li key={`m${i}`} className="rounded-xl border p-3">
                  <p className="ta-label-1 flex items-center gap-2">
                    <MessageSquareText className="size-4" />
                    Message taken{m.scenario ? ` · ${m.scenario}` : ""}
                  </p>
                  <p className="ta-body-2 mt-1">{m.message}</p>
                  <p className="ta-caption-1 text-muted-foreground mt-1">
                    {[m.callerName, m.callbackNumber, m.requestedTime].filter(Boolean).join(" · ") ||
                      "No name or number given"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ta-caption-1 text-muted-foreground py-6 text-center">
              Transfers, texts, bookings and messages from the call are listed here.
            </p>
          )}
        </div>
      ) : null}

      {footer ? (
        <div className="ta-caption-1 text-muted-foreground flex shrink-0 items-center gap-3.5 border-t px-4 py-2.5">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
