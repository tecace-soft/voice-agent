import type { RefObject } from "react";
import { AudioLines, Info } from "lucide-react";
import { CallPanel, STATUS_TEXT } from "@/components/call/CallPanel";
import { Transcript } from "@/components/call/Transcript";
import { VoiceOrb } from "@/components/call/VoiceOrb";
import { ContactButtons } from "@/components/public/ContactButtons";
import type { useLiveCall } from "@/hooks/useLiveCall";
import { formatDuration, type DemoAllowance } from "@/lib/analytics";
import { headline, suggestedQuestions } from "@/lib/proof";
import { quotedGreeting } from "@/lib/prompt";
import type { BusinessFaq, ResearchSource } from "@/lib/types";
import { businessNouns } from "@/lib/use-cases";

type Call = ReturnType<typeof useLiveCall>;

type HeroProps = {
  name: string;
  category?: string;
  agentName: string;
  faqs: BusinessFaq[];
  sources: ResearchSource[];
  greeting: string;
  call: Call;
  allowance: DemoAllowance;
  /** Seconds of demo time left once the current call is counted. */
  remaining: number;
  mailto: string;
  customerId: string;
  /** Wraps the call button so the page can tell when it has scrolled away. */
  callRef: RefObject<HTMLDivElement | null>;
};

const HEADLINE = "Every call to {name}, answered.";
const HEADLINE_FALLBACK = "Every call, answered.";

/**
 * Entrance: each row fades up from 60 %, staggered, once, and only when
 * motion is welcome. Written out in full — Tailwind only emits classes it
 * can read verbatim from source, so no template-built delays.
 */
const RISE_BASE =
  "motion-safe:animate-in motion-safe:fade-in-60 motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:duration-500 motion-safe:ease-out";
const RISE = [
  RISE_BASE,
  `${RISE_BASE} motion-safe:delay-75`,
  `${RISE_BASE} motion-safe:delay-150`,
  `${RISE_BASE} motion-safe:delay-200`,
  `${RISE_BASE} motion-safe:delay-300`,
] as const;
const rise = (step: 0 | 1 | 2 | 3 | 4) => RISE[step];

/** What the receptionist knows, in the vocabulary of this kind of business. */
function knowsClause(category?: string): string {
  switch (businessNouns(category).booking) {
    case "table":
      return "what is on the menu";
    case "pickup":
      return "what is in stock";
    case "service visit":
      return "the work you do";
    default:
      return "the services";
  }
}

function Headline({ text, size }: { text: string; size: "display" | "title" }) {
  // The last word is the page's one typographic accent.
  const cut = text.lastIndexOf(" ");
  const head = cut === -1 ? "" : text.slice(0, cut + 1);
  const tail = cut === -1 ? text : text.slice(cut + 1);
  return (
    <h1
      id="hero-title"
      className={`${size === "display" ? "ta-display-3" : "ta-title-1"} text-balance`}
    >
      {head}
      <span className="text-primary">{tail}</span>
    </h1>
  );
}

function TryAsking({ questions }: { questions: string[] }) {
  return (
    <div className="space-y-2">
      <ul aria-label="Things to ask" className="flex flex-wrap gap-2">
        {questions.map((question) => (
          <li
            key={question}
            className="ta-label-1 border-primary/40 text-primary rounded-full border px-3 py-1.5"
          >
            {question}
          </li>
        ))}
      </ul>
      <p className="ta-caption-1 text-muted-foreground flex items-center gap-1.5">
        <AudioLines className="size-4" aria-hidden />
        Say it out loud — it answers.
      </p>
    </div>
  );
}

export function Hero({
  name,
  category,
  agentName,
  faqs,
  sources,
  greeting,
  call,
  allowance,
  remaining,
  mailto,
  customerId,
  callRef,
}: HeroProps) {
  const title = headline({ template: HEADLINE, name, fallback: HEADLINE_FALLBACK });
  const questions = suggestedQuestions({ faqs });
  const opening = quotedGreeting(greeting);
  const minutes = Math.round(allowance.allowedSec / 60);
  const exhausted = allowance.exhausted;
  // Used up before this visitor ever pressed the button, or by them just now.
  const exhaustedOnArrival = exhausted && !call.usageSec;
  const ended = call.state === "ended";
  const failed = call.state === "error";
  const sourcesClause = sources.length > 0 ? `, from ${sources.length} public sources` : "";

  return (
    <section
      aria-labelledby="hero-title"
      className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:gap-12"
    >
      <div className="flex flex-col gap-5">
        <div className={rise(0)}>
          <Headline text={title.text} size={title.size} />
        </div>

        <p className={`ta-body-1-reading text-muted-foreground max-w-prose ${rise(1)}`}>
          {title.nameInSubtitle ? `This is ${name}. ` : ""}
          {agentName} already knows the hours, {knowsClause(category)} and where to
          park{sourcesClause}. Call and check.
        </p>

        {exhausted ? (
          <div
            className={`border-primary/30 bg-primary/5 space-y-3 rounded-xl border p-4 ${rise(2)}`}
          >
            <p className="ta-label-1">
              {exhaustedOnArrival
                ? `This demo's ${minutes} minutes have been used — ask us for more.`
                : `That is the ${minutes} minutes this demo comes with.`}
            </p>
            <p className="ta-caption-1 text-muted-foreground">
              We will open it back up — or skip ahead and talk about putting{" "}
              {agentName} on your real line.
            </p>
            <ContactButtons mailto={mailto} customerId={customerId} />
          </div>
        ) : (
          <>
            <div ref={callRef} className={`flex flex-col gap-3 ${rise(2)}`}>
              <CallPanel
                state={call.state}
                elapsedSec={call.elapsedSec}
                usageSec={call.usageSec}
                muted={call.muted}
                error={call.error}
                showStatus={false}
                errorSlot="none"
                fullWidth
                className="items-stretch md:items-start"
                onDial={call.dial}
                onHangup={call.hangup}
                onToggleMute={call.toggleMute}
                onReset={call.reset}
              />
              {/* Reserved so the chips never jump when a refusal arrives. */}
              <p
                className="ta-caption-1 text-destructive min-h-5"
                role={call.error ? "alert" : undefined}
              >
                {call.error ?? ""}
              </p>
            </div>

            <div className={rise(3)}>
              {ended ? (
                <div className="border-primary/30 bg-primary/5 space-y-3 rounded-xl border p-4">
                  {call.endedBy ? (
                    <p className="ta-caption-1 text-muted-foreground">
                      {call.endedBy === "time_limit"
                        ? "The call ended at the demo's time limit."
                        : "The call ended after a minute with nobody on the line."}
                    </p>
                  ) : null}
                  <p className="ta-label-1">That was {agentName}. Want it on your line?</p>
                  <ContactButtons mailto={mailto} customerId={customerId} />
                </div>
              ) : failed ? null : (
                <TryAsking questions={questions} />
              )}
            </div>
          </>
        )}

        <div className={`space-y-1.5 ${rise(4)}`}>
          {exhausted ? null : (
            <p className="ta-caption-1 text-muted-foreground">
              <span className="tabular-nums">{formatDuration(remaining)}</span> of demo
              time left, of {minutes} minutes. Need more? Just ask us.
            </p>
          )}
          <p className="ta-caption-1 text-muted-foreground flex items-start gap-1.5">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              A demo built for {name} from public research. Not their phone line —
              nobody there set this up.
            </span>
          </p>
        </div>
      </div>

      {/*
        The frame is four rem taller than the hero and clipped at its foot on
        wide screens, so the conversation reads as continuing below the fold.
        Below lg it is a plain box under the button.
      */}
      <div className="lg:relative lg:h-full lg:overflow-hidden">
        <div
          className={`bg-card flex h-80 flex-col overflow-hidden rounded-[2rem] border lg:absolute lg:inset-x-0 lg:top-0 lg:h-[calc(100%+4rem)] lg:rounded-b-none lg:border-b-0 motion-safe:animate-in motion-safe:fade-in-60 motion-safe:slide-in-from-right-4 motion-safe:fill-mode-both motion-safe:duration-500 motion-safe:ease-out motion-safe:delay-150`}
        >
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <VoiceOrb state={call.state} meters={call.meters} size={48} />
            <span className="ta-label-1 truncate">
              {agentName} ·{" "}
              {exhausted
                ? "Demo time used"
                : `${STATUS_TEXT[call.state]}${
                    ended && call.usageSec ? ` · ${formatDuration(call.usageSec)}` : ""
                  }`}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-4 lg:pb-20">
            <Transcript
              entries={call.transcript}
              thinking={call.thinking}
              agentName={agentName}
              greeting={opening}
              greetingLabel={`How ${agentName} opens the call`}
              emptyMessage="Press call — the conversation appears here."
            />
          </div>
        </div>
      </div>
    </section>
  );
}
