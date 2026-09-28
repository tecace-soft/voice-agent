import { useEffect, useState } from "react";
import { Check, CircleAlert, Clock, Loader2, Phone, Sparkles, SquarePen } from "lucide-react";
import { Logo } from "@/components/public/Logo";
import { Button } from "@/components/ui/button";
import { CONTACT_URL } from "@/lib/links";
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

export function StartApp() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    void signupApi.state().then((res) => setPhase(res.ok && res.body.signup ? { kind: "form" } : { kind: "closed" }));
  }, []);

  return (
    <div className="tw">
      <div className="bg-background text-foreground min-h-dvh">
        <header className="border-b">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
            <Logo className="h-6" />
            <span className="flex-1" />
            <Button variant="ghost" size="sm" nativeButton={false} render={<a href="/" />}>
              Sign in
            </Button>
          </div>
        </header>
        <main className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-10 md:px-6 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-16 lg:py-16">
          <Pitch />
          <div className="rounded-2xl border p-5 md:p-6">
            {phase.kind === "loading" ? <div className="h-80" aria-busy="true" /> : null}
            {phase.kind === "closed" ? <Closed /> : null}
            {phase.kind === "form" ? (
              <SignupForm
                mode={{ kind: "start" }}
                intro={
                  <div className="mb-1 flex flex-col gap-1">
                    <h2 className="ta-headline-1">Create your receptionist</h2>
                    <p className="ta-body-2 text-muted-foreground">Free to try. No card needed.</p>
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
        </main>
      </div>
    </div>
  );
}

function Pitch() {
  const steps = [
    { icon: Sparkles, title: "We build it from your website", body: "Hours, services, the questions callers ask — researched in about two minutes." },
    { icon: Phone, title: "Call it from your browser", body: "Hear how it answers, puts callers through, texts links and books." },
    { icon: SquarePen, title: "Make it yours", body: "Once we've approved your setup, change anything and test it before your line goes live." },
  ];
  return (
    <section className="flex flex-col gap-6 lg:pt-6">
      <div className="flex flex-col gap-3">
        <span className="ta-caption-1 text-primary font-semibold">TecAce voice agent</span>
        <h1 className="ta-display-2 max-w-[18ch] text-balance">An AI receptionist for the calls you miss</h1>
        <p className="ta-body-1-reading text-muted-foreground max-w-[52ch]">
          It answers when you can't, from what it knows about your business: questions, transfers, links by text,
          bookings and messages.
        </p>
      </div>
      <ol className="flex flex-col gap-4">
        {steps.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="flex items-start gap-3">
            <span className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-full">
              <Icon className="size-4" aria-hidden />
            </span>
            <div>
              <p className="ta-label-1 font-semibold!">
                {i + 1}. {title}
              </p>
              <p className="ta-body-2 text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
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
