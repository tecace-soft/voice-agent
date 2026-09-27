import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { Check, Info, Mic, MicOff, Phone, PhoneOff, RotateCcw } from "lucide-react";
import { StatusDot } from "@/components/call/CallPanel";
import { Transcript } from "@/components/call/Transcript";
import { VoiceOrb } from "@/components/call/VoiceOrb";
import { Button } from "@/components/ui/button";
import { useLiveCall, type UseLiveCall } from "@/hooks/useLiveCall";
import { formatDuration, type DemoAllowance } from "@/lib/analytics";
import { CONTACT_URL } from "@/lib/links";
import { publicFetch } from "@/publicApi";
import type { CallSound } from "@/lib/types";
import { BookingCard, MessageCard, TextsPhone, TransferCard } from "../settings/simulator/cards";
import { useCallSimulator, type BookingToolRunner } from "../settings/simulator/useCallSimulator";
import { doneKinds, settingsFromCapabilities, summaryLines, tryCards, type PublicCapabilities, type TryCard } from "./capabilities";

// The call at the top of the demo page (`/c/<id>`), laid out call first: the call, what to try
// saying, and — as it happens — what the receptionist did, then a summary when it ends.
//
// The call runs the same simulation as the operator's test console (src/settings/simulator/): the
// backend composes the public session with the demo's transfers, links, message scenarios and
// bookings (demoPublic.ts), and the tools it calls are played out here, on the prospect's screen.
// Nothing really rings, sends or saves; every card says so. Bookings are checked against the demo
// calendar (`POST /demo/public/tool`).

const TOOL_TIME_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
})();

const IN_CALL = new Set(["ringing", "connected", "ending"]);

export type DemoCallState = {
  call: UseLiveCall;
  sim: ReturnType<typeof useCallSimulator>;
};

/** The call and its simulation, wired together. */
export function useDemoCall(customerId: string, callSound: CallSound, capabilities: PublicCapabilities, businessName: string): DemoCallState {
  const settings = useMemo(() => settingsFromCapabilities(capabilities), [capabilities]);
  const callRef = useRef<UseLiveCall | null>(null);
  const bookingTool: BookingToolRunner = useCallback(
    async (name, args) => {
      const callId = callRef.current?.callIdNow();
      const response = await publicFetch("/tool", {
        method: "POST",
        body: JSON.stringify({ customerId, callId, name, args, timeZone: TOOL_TIME_ZONE }),
      });
      if (!response.ok) throw new Error(`tool ${response.status}`);
      return (await response.json()) as Record<string, unknown>;
    },
    [customerId],
  );
  const sim = useCallSimulator(settings, businessName, null, capabilities.appointments ? bookingTool : undefined);
  const call = useLiveCall(customerId, callSound, { api: publicFetch, onToolCall: sim.onToolCall });
  callRef.current = call;
  return { call, sim };
}

type Props = {
  state: DemoCallState;
  name: string;
  agentName: string;
  capabilities: PublicCapabilities;
  questions: string[];
  allowance: DemoAllowance;
  remaining: number;
  /** Wraps the call card so the page can tell when it has scrolled away. */
  callRef: RefObject<HTMLDivElement | null>;
  /** The lede under the headline: languages, what it knows. */
  lede: string;
};

export function DemoCall({ state, name, agentName, capabilities, questions, allowance, remaining, callRef, lede }: Props) {
  const { call, sim } = state;
  const cards = useMemo(() => tryCards(capabilities, questions), [capabilities, questions]);
  const done = doneKinds(sim.events);
  const live = IN_CALL.has(call.state) || call.state === "connecting";
  const ended = call.state === "ended";
  const hadAction = Boolean(sim.pending || sim.texts.length || sim.messages.length || sim.bookings.length);
  const showFeed = live || (ended && hadAction);
  const minutes = Math.round(allowance.allowedSec / 60);
  const exhausted = allowance.exhausted;
  const summary = ended ? summaryLines(sim.events, call.transcript.some((t) => t.speaker === "caller")) : [];

  return (
    <section aria-labelledby="hero-title" className="flex flex-col gap-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_32rem] lg:gap-10">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2.5">
            <p className="ta-caption-1 text-muted-foreground">AI receptionist · built from {name}'s public information</p>
            <h1 id="hero-title" className="ta-title-1 text-balance">
              Call {name}'s new <span className="text-primary">receptionist</span>
            </h1>
            <p className="ta-body-1-reading text-muted-foreground max-w-[56ch]">{lede}</p>
          </div>

          {exhausted ? (
            <div className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-2xl border p-5">
              <p className="ta-label-1 font-semibold!">
                {call.usageSec ? `That is the ${minutes} minutes this demo comes with.` : `This demo's ${minutes} minutes have been used.`}
              </p>
              <p className="ta-caption-1 text-muted-foreground">We can open it back up, or talk about putting {agentName} on your real line.</p>
              <div>
                <Button nativeButton={false} render={<a href={CONTACT_URL} target="_blank" rel="noreferrer" />}>
                  Talk to us
                </Button>
              </div>
            </div>
          ) : (
            <div ref={callRef} className="flex flex-col gap-3.5 rounded-2xl border p-5">
              <div className="flex flex-wrap items-center gap-4">
                <VoiceOrb state={call.state} meters={call.meters} size={64} />
                <div className="min-w-0 flex-1">
                  <p className="ta-headline-2 truncate">{agentName}</p>
                  <p className="ta-caption-1 text-muted-foreground flex items-center gap-1.5">
                    {call.state === "idle" ? (
                      "Answers in your language"
                    ) : (
                      <>
                        <StatusDot state={call.state} />
                        {call.state === "connected"
                          ? call.thinking
                            ? "Thinking"
                            : "Listening"
                          : call.state === "ended"
                            ? "Call ended"
                            : call.state === "error"
                              ? "Call failed"
                              : call.state === "ending"
                                ? "Hanging up"
                                : "Connecting"}
                        {(call.state === "connected" || call.state === "ended") && (call.usageSec || call.elapsedSec)
                          ? ` · ${formatDuration(call.state === "ended" ? call.usageSec || call.elapsedSec : call.elapsedSec)}`
                          : ""}
                      </>
                    )}
                  </p>
                </div>
                {IN_CALL.has(call.state) ? (
                  <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
                    <Button variant="outline" size="icon-lg" onClick={call.toggleMute} aria-label={call.muted ? "Unmute the microphone" : "Mute the microphone"}>
                      {call.muted ? <MicOff /> : <Mic />}
                    </Button>
                    <Button variant="destructive" size="lg" onClick={call.hangup} disabled={call.state === "ending"} aria-label="End the call">
                      <PhoneOff className="size-4" />
                      End
                    </Button>
                  </div>
                ) : call.state === "ended" || call.state === "error" ? (
                  <Button size="lg" variant="outline" className="max-sm:w-full" onClick={call.reset} aria-label="Start a new call">
                    <RotateCcw className="size-4" />
                    Call again
                  </Button>
                ) : (
                  <Button size="lg" className="h-12 px-6 max-sm:w-full" onClick={call.dial} disabled={call.state === "connecting"} aria-label={`Call ${agentName}`}>
                    <Phone className="size-4" />
                    {call.state === "connecting" ? "Calling" : `Call ${agentName}`}
                  </Button>
                )}
              </div>
              {call.error ? (
                <p className="ta-caption-1 text-destructive" role="alert">
                  {call.error}
                </p>
              ) : null}
              {call.state === "idle" ? (
                <p className="ta-caption-1 text-muted-foreground">
                  Uses your microphone. It's a demo: nothing is booked, sent or passed on.
                </p>
              ) : (
                <RecentTurns call={call} />
              )}
              {call.endedBy ? (
                <p className="ta-caption-1 text-muted-foreground">
                  {call.endedBy === "time_limit" ? "The call ended at the demo's time limit." : "The call ended after a minute with nobody on the line."}
                </p>
              ) : null}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {exhausted ? null : (
              <p className="ta-caption-1 text-muted-foreground">
                <span className="tabular-nums">{formatDuration(remaining)}</span> of demo time left, of {minutes} minutes.
              </p>
            )}
            <p className="ta-caption-1 text-muted-foreground flex items-start gap-1.5">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>A demo built for {name} from public research. Not their phone line; nobody there set this up.</span>
            </p>
          </div>
        </div>

        <TrySaying cards={cards} done={done} />
      </div>

      {showFeed ? (
        <div className="flex flex-col gap-3.5 border-t pt-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="ta-headline-2">What {agentName} did on this call</h2>
            <p className="ta-caption-1 text-muted-foreground">Shown here for the demo. Nothing was really sent.</p>
          </div>
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sim.pending ? <TransferCard pending={sim.pending} businessName={name} onAnswer={sim.answer} audience="prospect" /> : null}
            <TextsPhone texts={sim.texts} textState={sim.textState} onReply={sim.reply} audience="prospect" />
            {sim.messages.map((m, i) => (
              <MessageCard key={`m${i}`} message={m} audience="prospect" />
            ))}
            {sim.bookings.map((b, i) => (
              <BookingCard key={`b${i}`} booking={b} audience="prospect" />
            ))}
            {sim.transferLog.length && !sim.pending ? (
              <div className="flex flex-col gap-1.5 rounded-2xl border p-3.5">
                <p className="ta-label-1 font-semibold!">Transfer</p>
                <p className="ta-caption-1 text-muted-foreground">{sim.transferLog.join(" → ")}</p>
              </div>
            ) : null}
            {live ? (
              <div className="ta-caption-1 text-muted-foreground flex min-h-28 items-center justify-center rounded-2xl border border-dashed p-4 text-center">
                Transfers, texts, bookings and messages show up here as they happen.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {ended && summary.length ? (
        <div className="border-primary/30 bg-primary/5 grid gap-5 rounded-2xl border p-5 md:grid-cols-[1fr_auto] md:items-center md:p-6">
          <div className="flex flex-col gap-3">
            <p className="ta-headline-1">That was {agentName}. Every call like this, answered for {name}.</p>
            <ul className="flex flex-col gap-2" aria-label="What happened on the call">
              {summary.map((line) => (
                <li key={line} className="ta-body-2 flex items-start gap-2.5">
                  <span className="bg-success/15 text-success mt-0.5 grid size-5 shrink-0 place-items-center rounded-full">
                    <Check className="size-3" />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <Button size="lg" className="h-12 px-6" nativeButton={false} render={<a href={CONTACT_URL} target="_blank" rel="noreferrer" />}>
            Get this for {name}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** The last few turns, with the rest a click away: the actions are the point, not the log. */
function RecentTurns({ call }: { call: UseLiveCall }) {
  const [all, setAll] = useState(false);
  const entries = all ? call.transcript : call.transcript.slice(-3);
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <Transcript entries={entries} thinking={call.thinking} emptyMessage="Say hello, then ask something a customer would." />
      {call.transcript.length > 3 ? (
        <button type="button" onClick={() => setAll((a) => !a)} className="ta-caption-1 text-primary self-start hover:underline">
          {all ? "Show the last few" : `Show the whole conversation (${call.transcript.length})`}
        </button>
      ) : null}
    </div>
  );
}

function TrySaying({ cards, done }: { cards: TryCard[]; done: Set<string> }) {
  if (!cards.length) return null;
  const tone: Record<TryCard["kind"], string> = {
    transfer: "bg-warning/15 text-warning",
    link: "bg-primary/10 text-primary",
    booking: "bg-success/15 text-success",
    message: "bg-muted text-muted-foreground",
    question: "bg-muted text-muted-foreground",
  };
  return (
    <div className="flex flex-col gap-3">
      <h2 className="ta-label-1 font-semibold!">Try saying</h2>
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Things to try on the call">
        {cards.map((card) => {
          const ticked = card.kind !== "question" && done.has(card.kind);
          return (
            <li
              key={card.say}
              className={`relative flex flex-col gap-2 rounded-2xl border p-4 transition-colors duration-150 ${ticked ? "border-primary/30 bg-primary/5" : ""}`}
            >
              <span
                className={`absolute top-3 right-3 grid size-5.5 place-items-center rounded-full border-[1.5px] ${ticked ? "bg-primary border-primary text-white" : "border-border"}`}
                aria-label={ticked ? "Done on this call" : undefined}
              >
                {ticked ? <Check className="size-3" /> : null}
              </span>
              <span className={`ta-caption-2 self-start rounded-full px-2 py-0.5 font-semibold ${tone[card.kind]}`}>{card.tag}</span>
              <p className="ta-body-2 pr-6 font-semibold!">“{card.say}”</p>
              <p className="ta-caption-1 text-muted-foreground">{card.detail}</p>
            </li>
          );
        })}
      </ul>
      <p className="ta-caption-1 text-muted-foreground">Or ask anything a customer would. It answers from what it knows about the business.</p>
    </div>
  );
}
