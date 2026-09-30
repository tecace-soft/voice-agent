import { useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  CircleCheck,
  Copy,
  CreditCard,
  FlaskConical,
  Info,
  PhoneCall,
  PhoneForwarded,
  PhoneMissed,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Readiness, ReadinessItem } from "../../api/types";
import type { SectionId } from "../../routing";
import { displayPhone } from "../callSettings";
import { SectionIntro, type Phase } from "../SettingsShell";

// Launch instructions: where this receptionist is on the way to answering real calls, and what to do
// next. One page for every reader — the operator building a demo, the demo's owner, the public demo
// page, and a business in onboarding or live — so the four cards read the same everywhere and only
// what's true for the stage changes:
//
//   1. Where you are: Demo › Onboarding › Live, what each stage lets you do, and what moves you on.
//   2. Start answering your calls: the stage's limit, the receptionist's own number, how calls reach it.
//   3. Placing test calls: how to call it at this stage, and things to ask.
//   4. Next step: billing (demo), what's left before go live (onboarding).
//
// Callers never dial the receptionist's number directly: the business forwards its own line to it
// (missed calls or every call), so there is no "use the number as your business line" option here.

export type LaunchAudience = "operator" | "owner" | "public" | "business";

type Props = {
  phase: Phase;
  audience: LaunchAudience;
  /** What the receptionist calls itself; empty reads "your receptionist". */
  agentName: string;
  agentNumber: string | null;
  /** Things to ask on a test call, from the business's own FAQs. */
  questions: string[];
  /** Onboarding: the Go live checklist (`GET /business/readiness`), split into your part and ours. */
  readiness?: Readiness | null;
  /** Onboarding: Request go live, under the checklist (RequestGoLive). */
  requestSlot?: ReactNode;
  /** Demo: where "Go to billing" leads. Absent on the public page (no account to bill yet). */
  billingHref?: string;
  /** The owner's demo page (`/c/<id>`), where they call it from the browser. */
  demoPageHref?: string;
  /** The public page's Request setup, in the Next step card. */
  nextStep?: ReactNode;
  /** Opens another section of these settings (Call forwarding, Test & improve). */
  onOpenSection?: (id: SectionId) => void;
};

type Stage = { id: Phase; label: string; can: string[]; next?: string };

const STAGES: Stage[] = [
  {
    id: "demo",
    label: "Demo",
    can: ["Call it from your browser on your demo page", "See every setting, read-only", "Not on your phone line yet"],
    next: "Moves on once billing is set up and we approve your setup",
  },
  {
    id: "onboarding",
    label: "Onboarding",
    can: ["Change every setting", "Test calls in the app, with your draft", "Publish what callers will get"],
    next: "Moves on when you request go live and we switch your line on",
  },
  {
    id: "live",
    label: "Live",
    can: ["Your own receptionist number", "Answers the calls you forward to it", "Keep tuning: change, test, publish"],
  },
];

const INTRO: Record<LaunchAudience, string> = {
  operator:
    "What this business sees on its way to a live line. A demo has no phone line; when it starts onboarding, everything set up here carries over.",
  owner: "Where your receptionist is on the way to answering your real calls, and what comes next.",
  public: "This receptionist is a demo. Here's how it becomes the one answering your real calls.",
  business: "Where your receptionist is on the way to answering your real calls, and what comes next.",
};

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function LaunchGuide(props: Props) {
  const name = props.agentName.trim() || "your receptionist";
  const at = STAGES.findIndex((s) => s.id === props.phase);
  const next = props.phase === "live" ? null : <NextStep {...props} />;

  return (
    <div>
      <SectionIntro>{INTRO[props.audience]}</SectionIntro>
      <div className="space-y-4">
        <Card icon={Rocket} title={props.audience === "operator" ? "Where this business is" : "Where you are"}>
          <ol className="grid gap-3 p-4 md:grid-cols-3" aria-label="Stages">
            {STAGES.map((stage, i) => {
              const current = i === at;
              return (
                <li
                  key={stage.id}
                  aria-current={current ? "step" : undefined}
                  className={`rounded-xl border p-4 ${current ? "border-primary bg-primary/5" : ""}`}
                >
                  <p className="flex items-center gap-2">
                    <span className="ta-headline-2">{stage.label}</span>
                    {current ? (
                      <span className="ta-caption-2 bg-primary text-primary-foreground rounded-full px-2 py-0.5">
                        {props.audience === "operator" ? "Now" : "You're here"}
                      </span>
                    ) : i < at ? (
                      <span className="ta-caption-2 text-success flex items-center gap-1">
                        <Check className="size-3" aria-hidden />
                        Done
                      </span>
                    ) : null}
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {stage.can.map((line) => (
                      <li key={line} className="ta-caption-1 flex gap-2">
                        <span
                          className={`mt-[7px] size-1 shrink-0 rounded-full ${current ? "bg-primary" : "bg-muted-foreground/50"}`}
                          aria-hidden
                        />
                        <span className={current ? "" : "text-muted-foreground"}>{line}</span>
                      </li>
                    ))}
                  </ul>
                  {stage.next ? <p className="ta-caption-2 text-muted-foreground mt-3 border-t pt-3">{stage.next}</p> : null}
                </li>
              );
            })}
          </ol>
        </Card>

        <Card icon={PhoneCall} title={`Have ${name} start answering your calls`}>
          <Banner phase={props.phase} name={name} number={props.agentNumber} />
          <div className="space-y-4 p-4">
            <NumberRow name={name} number={props.agentNumber} phase={props.phase} />
            <div>
              <p className="ta-label-1">How your calls reach {name}</p>
              <p className="ta-caption-1 text-muted-foreground mt-1">
                Callers keep dialling the number they know. You forward it to {name}'s number, from your phone or your
                carrier.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <ForwardOption
                  icon={PhoneMissed}
                  title="Missed calls"
                  badge="Most businesses"
                  body={`You answer first; ${name} picks up when you're busy or don't answer.`}
                  onOpen={props.onOpenSection ? () => props.onOpenSection?.("forwarding") : undefined}
                />
                <ForwardOption
                  icon={PhoneForwarded}
                  title="Every call"
                  body={`${cap(name)} answers every call first, and puts callers through to you when they need a person.`}
                  onOpen={props.onOpenSection ? () => props.onOpenSection?.("forwarding") : undefined}
                />
              </div>
            </div>
            {props.onOpenSection ? (
              <Button variant="outline" onClick={() => props.onOpenSection?.("forwarding")}>
                Set up call forwarding
              </Button>
            ) : null}
          </div>
        </Card>

        <Card icon={FlaskConical} title="Placing test calls">
          <p className="bg-muted/40 ta-caption-1 text-muted-foreground flex gap-2 border-b px-4 py-3">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{testLine(props, name)}</span>
          </p>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <div className="bg-primary/5 flex flex-col items-center justify-center gap-3 rounded-xl border p-5 text-center">
              <TestAction {...props} name={name} />
            </div>
            <div className="rounded-xl border">
              <p className="ta-label-1 text-primary border-b px-4 py-3">Try asking {name}…</p>
              <ul className="divide-y">
                {props.questions.slice(0, 3).map((q) => (
                  <li key={q} className="flex items-center gap-3 px-4 py-3">
                    <span
                      className="ta-caption-2 bg-primary/10 text-primary inline-flex size-6 shrink-0 items-center justify-center rounded-full font-semibold"
                      aria-hidden
                    >
                      Q
                    </span>
                    <span className="ta-body-2">{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>

        {next}
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, children }: { icon: typeof Rocket; title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border">
      <h3 className="ta-headline-2 flex items-center gap-3 border-b px-4 py-3">
        <span className="bg-primary/10 text-primary inline-flex size-8 shrink-0 items-center justify-center rounded-full" aria-hidden>
          <Icon className="size-4" />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** The stage's limit on real calls, under the card's title. */
function Banner({ phase, name, number }: { phase: Phase; name: string; number: string | null }) {
  if (phase === "live") {
    return (
      <p className="bg-success/10 ta-caption-1 flex items-center gap-2 border-b px-4 py-3" role="status">
        <CircleCheck className="text-success size-4 shrink-0" aria-hidden />
        <span>
          <b className="font-semibold">Live.</b> {cap(name)} answers the calls you forward to{" "}
          {number ? displayPhone(number) : "its number"}.
        </span>
      </p>
    );
  }
  return (
    <p className="bg-warning/10 ta-caption-1 flex items-center gap-2 border-b px-4 py-3" role="status">
      <Info className="text-warning size-4 shrink-0" aria-hidden />
      {phase === "demo" ? (
        <span>
          <b className="font-semibold">Demo only.</b> {cap(name)} answers calls from your demo page in the browser, not
          your phone line. Your own number comes with onboarding.
        </span>
      ) : (
        <span>
          <b className="font-semibold">Test calls only.</b> Your line stays off until go live. Test from the app in the
          meantime.
        </span>
      )}
    </p>
  );
}

function NumberRow({ name, number, phase }: { name: string; number: string | null; phase: Phase }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-primary/5 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3">
      <p className="ta-label-1 text-primary">{cap(name)}'s number</p>
      {number ? (
        <div className="bg-background flex items-center gap-3 rounded-full border py-1.5 pr-1.5 pl-4">
          <span className="ta-headline-2 tabular-nums">{displayPhone(number)}</span>
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            onClick={() => {
              void navigator.clipboard?.writeText(number).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : (
        <p className="ta-caption-1 text-muted-foreground">
          {phase === "demo" ? "You get your own number during onboarding." : "We assign it before your line goes live."}
        </p>
      )}
    </div>
  );
}

function ForwardOption({
  icon: Icon,
  title,
  badge,
  body,
  onOpen,
}: {
  icon: typeof Rocket;
  title: string;
  badge?: string;
  body: string;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <span className="flex items-center gap-2">
        <span className="bg-muted text-muted-foreground inline-flex size-8 items-center justify-center rounded-lg" aria-hidden>
          <Icon className="size-4" />
        </span>
        <span className="ta-label-1">{title}</span>
        {badge ? <span className="ta-caption-2 bg-primary/10 text-primary rounded-full px-2 py-0.5">{badge}</span> : null}
      </span>
      <span className="ta-caption-1 text-muted-foreground mt-2 block">{body}</span>
    </>
  );
  const box = "block w-full rounded-xl border p-4 text-left";
  return onOpen ? (
    <button type="button" className={`${box} hover:border-primary transition-colors`} onClick={onOpen}>
      {inner}
    </button>
  ) : (
    <div className={box}>{inner}</div>
  );
}

function testLine(props: Props, name: string): string {
  if (props.phase === "live") {
    return `Call ${name}'s number from any phone to hear what your callers hear; it's a real call and counts toward your minutes. To try a change before callers get it, use Test & improve: it calls with your draft.`;
  }
  if (props.phase === "onboarding") {
    return `Your phone line stays off until go live. Call ${name} from the browser in Test & improve: test calls use your draft, so you can try a change before you publish it. Test minutes are limited each month.`;
  }
  if (props.audience === "operator") {
    return "Use the Test call panel beside these settings. It calls this demo with its current settings, and nothing is dialled; there's nothing to publish on a demo.";
  }
  if (props.audience === "public") {
    return `Talk to ${name} from your browser with the call button on this page. Bookings go into a demo calendar, and nothing reaches your phone line.`;
  }
  return `Call ${name} from your browser on your demo page. Bookings go into a demo calendar, and nothing reaches your phone line. After onboarding you test here in the app instead.`;
}

/** The left half of Placing test calls: the way to call at this stage. */
function TestAction(props: Props & { name: string }) {
  const { phase, audience, name } = props;
  if (phase === "live" && props.agentNumber) {
    return (
      <>
        <p className="ta-label-1 text-primary">{cap(name)}'s number</p>
        <a
          href={`tel:${props.agentNumber}`}
          className="bg-background flex items-center gap-3 rounded-full border py-1.5 pr-4 pl-1.5 hover:border-primary"
        >
          <span className="bg-primary/10 text-primary ta-label-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5">
            <PhoneCall className="size-4" aria-hidden />
            Call
          </span>
          <span className="ta-headline-2 tabular-nums">{displayPhone(props.agentNumber)}</span>
        </a>
      </>
    );
  }
  if (phase === "demo" && audience === "owner" && props.demoPageHref) {
    return (
      <>
        <p className="ta-label-1 text-primary">Your demo page</p>
        <Button nativeButton={false} render={<a href={props.demoPageHref} target="_blank" rel="noreferrer" />}>
          <PhoneCall className="size-4" aria-hidden />
          Call from your browser
        </Button>
      </>
    );
  }
  if (phase === "demo") {
    return (
      <>
        <PhoneCall className="text-primary size-6" aria-hidden />
        <p className="ta-caption-1 text-muted-foreground max-w-[32ch]">
          {audience === "operator" ? "The Test call panel is beside these settings." : "The call button is at the top of this page."}
        </p>
      </>
    );
  }
  return (
    <>
      <p className="ta-label-1 text-primary">Test & improve</p>
      {props.onOpenSection ? (
        <Button onClick={() => props.onOpenSection?.("test")}>
          <PhoneCall className="size-4" aria-hidden />
          Place a test call
        </Button>
      ) : null}
    </>
  );
}

// What the business does about each of its own items, and where. The admin's items (the number, and
// Twilio reaching it) are done at Go live, so they read as ours, never as something the business failed.
const CUSTOMER_HINT: Partial<Record<string, { hint: string; section: SectionId }>> = {
  business_info: { hint: "At least your business name and what you do.", section: "business-info" },
  settings_published: {
    hint: "Publish from Transfer calls, Text a link or Take a message — callers get what's published.",
    section: "transfers",
  },
  contact_number: {
    hint: "Recommended: a phone number on your business information, or a transfer number.",
    section: "business-info",
  },
};

function CheckRow({ item, ours, onOpen }: { item: ReadinessItem; ours: boolean; onOpen?: (id: SectionId) => void }) {
  const fix = ours ? undefined : CUSTOMER_HINT[item.id];
  const hint = item.ok ? null : ours ? (item.detail ?? "We do this when you request go live.") : fix?.hint;
  return (
    <li className="flex items-start gap-3">
      <span
        className={`ta-caption-2 mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full ${
          item.ok ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}
        aria-hidden
      >
        {item.ok ? <Check className="size-3" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="ta-label-1 block">
          {item.label}
          {!item.required && !item.ok ? <span className="text-muted-foreground font-normal"> (recommended)</span> : null}
        </span>
        {hint ? <span className="ta-caption-1 text-muted-foreground">{hint}</span> : null}
      </span>
      {!item.ok && fix && onOpen ? (
        <Button variant="ghost" size="sm" onClick={() => onOpen(fix.section)}>
          Open
        </Button>
      ) : null}
    </li>
  );
}

/** What moves this receptionist on: billing from a demo, your part and ours in onboarding. */
function NextStep(props: Props) {
  if (props.phase === "onboarding") {
    const items = props.readiness?.items ?? [];
    if (!items.length) return null;
    // An older backend sends no owner: the number and Twilio are ours, the rest theirs.
    const ownerOf = (item: ReadinessItem) =>
      item.owner ?? (["number_assigned", "published_matches_number", "webhooks_configured"].includes(item.id) ? "admin" : "customer");
    const yours = items.filter((item) => ownerOf(item) === "customer");
    const ours = items.filter((item) => ownerOf(item) === "admin");
    return (
      <Card icon={CircleCheck} title="Before your line goes live">
        <div className="grid gap-5 p-4 md:grid-cols-2">
          <div>
            <p className="ta-label-1 text-primary mb-3">Your part</p>
            <ul className="space-y-3">
              {yours.map((item) => (
                <CheckRow key={item.id} item={item} ours={false} onOpen={props.onOpenSection} />
              ))}
            </ul>
          </div>
          <div>
            <p className="ta-label-1 text-muted-foreground mb-3">Our part, when you request go live</p>
            <ul className="space-y-3">
              {ours.map((item) => (
                <CheckRow key={item.id} item={item} ours />
              ))}
            </ul>
          </div>
        </div>
        {props.requestSlot ? <div className="border-t p-4">{props.requestSlot}</div> : null}
      </Card>
    );
  }
  return (
    <Card icon={CreditCard} title={props.audience === "public" ? "Next step: request setup" : "Next step: set up billing"}>
      <div className="flex flex-wrap items-center gap-4 p-4">
        <p className="ta-body-2 text-muted-foreground min-w-0 flex-1 basis-[36ch]">
          {props.audience === "public"
            ? "Request setup, then set up billing. Onboarding starts once billing is in place and we've approved your setup; then everything here is yours to change and test, and you get your own number."
            : "Onboarding starts once billing is in place and we've approved your setup. Then everything here is yours to change and test, and you get your own number."}
        </p>
        {props.billingHref ? (
          <Button nativeButton={false} render={<a href={props.billingHref} />}>
            Go to billing
            <ArrowUpRight className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>
      {props.nextStep ? <div className="border-t p-4">{props.nextStep}</div> : null}
    </Card>
  );
}
