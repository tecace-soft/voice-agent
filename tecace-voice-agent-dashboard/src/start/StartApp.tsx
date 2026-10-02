import { useEffect, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  Clock,
  CreditCard,
  Globe,
  Loader2,
  Pause,
  Phone,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
} from "lucide-react";
import { Logo } from "@/components/public/Logo";
import { Button } from "@/components/ui/button";
import { CONTACT_URL } from "@/lib/links";
import { TRIAL_DAYS } from "@/lib/pricing";
import { SignupForm } from "../signup/SignupForm";
import { openDashboard, signupApi, type SignedIn } from "../signup/api";

// Self-service sign-up, at /start: a business that found us gives its name and website (or Maps
// link), proves its email with a code, and watches its receptionist being built. It lands in the
// dashboard on its demo, read-only, with "Request setup" — the same place a prospect who claimed a
// demo link lands — and an admin approves it before anything becomes editable.
//
// A second entry document like `/c/<id>` (start.html → src/start/main.tsx): a stranger does not
// download the dashboard. With no email configured on the backend, sign-up is closed and this page
// says how to reach us instead.

type Phase =
  | { kind: "loading" }
  | { kind: "closed" }
  | { kind: "form" }
  | { kind: "building"; signedIn: SignedIn }
  | { kind: "built"; outcome: "ready" | "queued" | "failed" };

const BUILD_STEPS = [
  "Reading your website and public listings",
  "Writing down your hours, services and what callers ask",
  "Setting up your receptionist's voice and greeting",
];

/** A recorded call for the page to play. Drop the file into `public/` and the card appears. */
const SAMPLE_CALL_URL = "/sample-call.mp3";

export function StartApp() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    void signupApi.state().then((res) => setPhase(res.ok && res.body.signup ? { kind: "form" } : { kind: "closed" }));
  }, []);

  return (
    <div className="tw">
      <div className="bg-background text-foreground flex min-h-dvh flex-col">
        <header className="border-b">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 md:px-6">
            <a href="/start" aria-label="TecAce home">
              <Logo className="h-6" />
            </a>
            <nav className="ta-label-1 text-muted-foreground hidden flex-1 justify-center gap-8 md:flex">
              <a className="hover:text-foreground transition-colors" href="#how-it-works">
                How it works
              </a>
              <a className="hover:text-foreground transition-colors" href={CONTACT_URL} target="_blank" rel="noreferrer">
                Contact
              </a>
            </nav>
            <span className="flex-1 md:hidden" />
            <Button variant="ghost" size="sm" nativeButton={false} render={<a href="/" />}>
              Sign in
            </Button>
          </div>
        </header>

        {/* Mobile reads hero, form, then the how-it-works; from lg the form sits beside both. */}
        <main className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 py-10 md:px-6 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-x-16 lg:gap-y-10 lg:py-10">
          <Hero />
          <div className="flex flex-col gap-4 lg:row-span-2">
            <div className="bg-card rounded-[16px] border p-5 md:p-6">
              {phase.kind === "loading" ? <FormSkeleton /> : null}
              {phase.kind === "closed" ? <Closed /> : null}
              {phase.kind === "form" ? (
                <SignupForm
                  mode={{ kind: "start" }}
                  intro={
                    <div className="mb-1 flex flex-col gap-1">
                      <h2 className="ta-heading-1">Create your receptionist</h2>
                      <p className="ta-body-2 text-muted-foreground">Free for {TRIAL_DAYS} days. No card needed.</p>
                    </div>
                  }
                  onSignedIn={(signedIn) => setPhase({ kind: "building", signedIn })}
                />
              ) : null}
              {phase.kind === "building" ? (
                <Building signedIn={phase.signedIn} onDone={(outcome) => setPhase({ kind: "built", outcome })} />
              ) : null}
              {phase.kind === "built" ? <Built outcome={phase.outcome} /> : null}
            </div>
            <Assurances />
          </div>
          <HowItWorks />
        </main>

        <footer className="border-t">
          <div className="ta-caption-1 text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 md:flex-row md:items-center md:justify-between md:px-6">
            <span>© {new Date().getFullYear()} TecAce</span>
            <div className="flex gap-6">
              <a className="hover:text-foreground transition-colors" href={CONTACT_URL} target="_blank" rel="noreferrer">
                Contact us
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="flex flex-col gap-5 lg:pt-4">
      <span className="ta-caption-1 bg-primary/10 text-primary w-fit rounded-full px-3 py-1 font-semibold">
        TecAce voice agent
      </span>
      <h1 className="ta-display-2 text-balance lg:text-[48px]! lg:leading-[60px]!">
        An AI receptionist for <span className="text-primary">the calls you miss</span>
      </h1>
      <p className="ta-body-1-reading text-muted-foreground max-w-[54ch]">
        It answers when you can't, from what it knows about your business: questions, transfers, links by text,
        bookings and messages.
      </p>
    </section>
  );
}

const STEPS = [
  {
    icon: Globe,
    title: "We build it from your website",
    body: "Your hours, services and the questions callers ask, researched in about two minutes.",
  },
  {
    icon: Phone,
    title: "Call it from your browser",
    body: "Hear how it answers, puts callers through, texts links and books.",
  },
  {
    icon: SlidersHorizontal,
    title: "Make it yours",
    body: "Once we've approved your setup, change anything and test it before your line goes live.",
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="flex scroll-mt-20 flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="flex items-start gap-4 rounded-[16px] border p-4 md:p-5">
            <span className="bg-primary/10 text-primary grid size-11 shrink-0 place-items-center rounded-[12px]">
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="ta-caption-2 bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-semibold">
                  Step {i + 1}
                </span>
                <span className="ta-headline-1">{title}</span>
              </p>
              <p className="ta-body-2-reading text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <SampleCall />
    </section>
  );
}

/**
 * Plays SAMPLE_CALL_URL, and shows nothing until that file exists. A missing file on Vercel answers
 * with index.html and a 200, so "exists" means the server says it is audio.
 */
function SampleCall() {
  const [available, setAvailable] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ at: 0, length: 0 });
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(SAMPLE_CALL_URL, { method: "HEAD" })
      .then((res) => {
        if (!cancelled && res.ok && (res.headers.get("content-type") ?? "").startsWith("audio/")) setAvailable(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };
  const progress = time.length > 0 ? (time.at / time.length) * 100 : 0;

  return (
    <div className="flex items-center gap-4 rounded-[16px] border p-4 md:p-5">
      <Button size="icon-lg" className="size-12 shrink-0 rounded-full" onClick={toggle} aria-label={playing ? "Pause the sample call" : "Play the sample call"}>
        {playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="ta-headline-2">Hear a sample call</p>
          <p className="ta-caption-1 text-muted-foreground">A caller asking about a weekend appointment.</p>
        </div>
        <div className="bg-muted h-1 overflow-hidden rounded-full" aria-hidden>
          <div className="bg-primary h-full transition-[width] duration-150 ease-linear" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <span className="ta-caption-1 text-muted-foreground shrink-0 tabular-nums">{clock(time.length - time.at)}</span>
      <audio
        ref={audio}
        src={SAMPLE_CALL_URL}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setTime({ at: 0, length: e.currentTarget.duration || 0 })}
        onTimeUpdate={(e) => setTime({ at: e.currentTarget.currentTime, length: e.currentTarget.duration || 0 })}
      />
    </div>
  );
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Only what is true of every sign-up: no card, built in minutes, and a person approves it. */
function Assurances() {
  const items = [
    { icon: CreditCard, label: "No card needed" },
    { icon: Timer, label: "Built in about 2 minutes" },
    { icon: ShieldCheck, label: "Reviewed before it goes live" },
  ];
  return (
    <ul className="ta-caption-1 text-muted-foreground grid grid-cols-3 gap-2 text-center">
      {items.map(({ icon: Icon, label }) => (
        <li key={label} className="flex flex-col items-center gap-1.5">
          <Icon className="text-primary size-4" aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="bg-muted h-7 w-2/3 rounded-md" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="bg-muted h-4 w-1/3 rounded-md" />
          <div className="bg-muted h-11 rounded-[12px]" />
        </div>
      ))}
      <div className="bg-muted h-11 rounded-[12px]" />
    </div>
  );
}

function Closed() {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="ta-headline-1">Let's set you up together</h2>
      <p className="ta-body-2 text-muted-foreground">
        Sign-up isn't open here yet. Tell us about your business and we'll build your receptionist and send you a demo.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button nativeButton={false} render={<a href={CONTACT_URL} target="_blank" rel="noreferrer" />}>
          Contact us
        </Button>
        <Button variant="outline" nativeButton={false} render={<a href="/" />}>
          Sign in
        </Button>
      </div>
    </div>
  );
}

function Building({ signedIn, onDone }: { signedIn: SignedIn; onDone: (outcome: "ready" | "queued" | "failed") => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, BUILD_STEPS.length - 1)), 25_000);
    let cancelled = false;
    void signupApi.research(signedIn.token).then((res) => {
      if (cancelled) return;
      if (res.ok && res.body.queued) onDone("queued");
      else if (res.ok && res.body.status === "ready") onDone("ready");
      else onDone("failed");
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // One run per sign-up; the backend refuses a second anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-5" aria-live="polite">
      <div>
        <h2 className="ta-headline-1">Building your receptionist</h2>
        <p className="ta-body-2 text-muted-foreground">This takes a minute or two. Keep this page open.</p>
      </div>
      <ol className="flex flex-col gap-3">
        {BUILD_STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-3">
            {i < step ? (
              <span className="bg-success/15 text-success grid size-6 place-items-center rounded-full">
                <Check className="size-3.5" />
              </span>
            ) : i === step ? (
              <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
            ) : (
              <span className="border-border size-6 rounded-full border" aria-hidden />
            )}
            <span className={`ta-body-2 ${i > step ? "text-muted-foreground" : ""}`}>{label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Built({ outcome }: { outcome: "ready" | "queued" | "failed" }) {
  const copy = {
    ready: {
      icon: <Check className="size-5" />,
      tone: "bg-success/15 text-success",
      title: "Your receptionist is ready",
      body: "Call it, look through what it knows, and press Request setup when you'd like it on your real line.",
    },
    queued: {
      icon: <Clock className="size-5" />,
      tone: "bg-primary/10 text-primary",
      title: "We'll finish it for you",
      body: "A lot of businesses signed up today, so we'll build yours shortly. Sign in any time to see it.",
    },
    failed: {
      icon: <CircleAlert className="size-5" />,
      tone: "bg-warning/15 text-warning",
      title: "We'll finish it for you",
      body: "We couldn't build it automatically this time. Your account is ready; we'll finish your receptionist, usually within a day.",
    },
  }[outcome];
  return (
    <div className="flex flex-col gap-4">
      <span className={`grid size-10 place-items-center rounded-full ${copy.tone}`}>{copy.icon}</span>
      <div>
        <h2 className="ta-headline-1">{copy.title}</h2>
        <p className="ta-body-2 text-muted-foreground">{copy.body}</p>
      </div>
      <Button size="lg" className="h-11" onClick={openDashboard}>
        Go to my receptionist
      </Button>
    </div>
  );
}
