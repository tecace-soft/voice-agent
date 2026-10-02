import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowUp, Lock } from "lucide-react";
import { ContactButtons } from "@/components/public/ContactButtons";
import { Logo } from "@/components/public/Logo";
import { LanguageNote } from "@/components/public/LanguageNote";
import { StickyCall } from "@/components/public/StickyCall";
import { SourcesPanel } from "@/components/research/SourcesPanel";
import { VersionBadge } from "@/components/VersionBadge";
import { useInView } from "@/hooks/useInView";
import { publicFetch } from "@/publicApi";
import { visitorId } from "@/lib/visitor";
import type { DemoAllowance } from "@/lib/analytics";
import { CONTACT_URL, mailtoFor } from "@/lib/links";
import { suggestedQuestions } from "@/lib/proof";
import { businessNouns } from "@/lib/use-cases";
import { Button } from "@/components/ui/button";
import { DemoCall, useDemoCall } from "../../public/DemoCall";
import { type PublicCapabilities, type SetupState } from "../../public/capabilities";
import { RequestSetupButton, RequestSetupDialog } from "../../public/RequestSetup";

// The settings studio is the biggest thing on the page and sits below the call, so it loads after it.
const PublicSettings = lazy(() => import("../../settings/PublicSettings").then((m) => ({ default: m.PublicSettings })));
import type {
  BusinessProfile,
  CallSound,
  CustomerPrompts,
  ResearchSource,
} from "@/lib/types";

type PublicDemoScreenProps = {
  customerId: string;
  callSound: CallSound;
  name: string;
  category?: string;
  address?: string;
  phone?: string;
  agentName: string;
  language?: string;
  voiceLabel: string;
  profile: BusinessProfile;
  prompts: Pick<CustomerPrompts, "live" | "backend" | "greeting">;
  dossier: string;
  sources: ResearchSource[];
  researchedAt?: string;
  demo: DemoAllowance;
  demoUrl: string;
  /** Dashboard-only: what the operator set up for calls, played out on the page's call. */
  capabilities: PublicCapabilities;
  /** Dashboard-only: the raw voice id, for the settings view's agent section. */
  voice: string;
  /** Dashboard-only: whether Request setup is open, asked for, or past. */
  setup: SetupState;
};

export function PublicDemoScreen({
  customerId,
  name,
  category,
  agentName,
  language,
  callSound,
  profile,
  prompts,
  dossier,
  sources,
  researchedAt,
  demo,
  demoUrl,
  capabilities,
  voice,
  setup,
}: PublicDemoScreenProps) {
  // Dashboard-only (PORTING.md): the call is played out with the demo's call settings — transfers,
  // texts, messages and demo-calendar bookings appear on the page as the receptionist does them.
  const demoCall = useDemoCall(customerId, callSound, capabilities, name);
  const call = demoCall.call;
  const tracked = useRef(false);
  const [allowance, setAllowance] = useState(demo);
  // The sticky bar appears once the hero's call button has scrolled under
  // the bar's own height, and goes when it comes back.
  const [callRef, callInView] = useInView<HTMLDivElement>({ rootMargin: "-56px 0px 0px 0px" });

  // Built from the link the server knows. Reading window.location here would
  // render empty on the server and hydration would keep the empty href.
  const mailto = mailtoFor(name, demoUrl);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    // The promo's `POST /api/track`, same body plus the visitor id: it set that cookie in
    // middleware and read it server-side, and there is no middleware here, so the browser carries
    // it. Fired and forgotten — a counter must never be able to stop a demo opening.
    void publicFetch("/track", {
      method: "POST",
      body: JSON.stringify({ customerId, event: "page_view", visitorId: visitorId() }),
    }).catch(() => undefined);
  }, [customerId]);

  // The server owns the running total, so ask it again once a call is over
  // rather than guessing from the local timer. A refusal counts too: the
  // session route says no when the minutes are gone, and the hero has to
  // flip to the exhausted layout rather than offer "Call again" with a red
  // caption under it.
  useEffect(() => {
    if (call.state !== "ended" && call.state !== "error") return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await publicFetch(`/customers/${customerId}`, { cache: "no-store" });
        if (!response.ok) return;
        // The promo had a route of its own for this that answered `{ demo }`; here it is the same
        // read the page was built from, and the allowance is one field of it.
        const data = (await response.json()) as { customer?: { demo?: DemoAllowance } };
        const next = data.customer?.demo;
        if (!cancelled && next) setAllowance(next);
      } catch {
        // The number on screen stays as it was; the next call is the check.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [call.state, customerId]);

  const [requestOpen, setRequestOpen] = useState(false);
  const openRequest = () => setRequestOpen(true);
  const toCall = () => {
    callRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const exhausted = allowance.exhausted;
  const questions = suggestedQuestions({ faqs: profile.faqs });
  const knows = { table: "the menu", pickup: "what's in stock", "service visit": "the work you do" }[businessNouns(category).booking as string] ?? "the services";
  const can = [
    capabilities.transfers.length ? "put you through to the right person" : "",
    capabilities.links.length ? "text you a link" : "",
    capabilities.appointments ? `book a ${capabilities.appointments.title.toLowerCase()}` : "",
    "take a message",
  ].filter(Boolean);
  const lede = `${agentName} knows the hours, ${knows} and where to park, from ${sources.length || "several"} public sources, and can ${
    can.length > 1 ? `${can.slice(0, -1).join(", ")} or ${can[can.length - 1]}` : can[0]
  }.`;
  const remaining = Math.max(0, allowance.remainingSec - (call.usageSec || 0));

  return (
    <>
      <StickyCall
        show={!callInView && !exhausted}
        name={name}
        agentName={agentName}
        call={call}
      />

      {/*
        Dashboard-only (PORTING.md): one bar across the top — who made it, whose demo it is, the time
        left and the one way to reach us — and the call first. The promo's header link to the nine
        scenarios and its teaser card are gone (the scenarios page redirects here).
      */}
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
          <Logo className="h-6" />
          <span className="bg-border hidden h-5 w-px sm:block" aria-hidden />
          <span className="ta-label-1 hidden truncate font-semibold! sm:inline">{name}</span>
          <span className="ta-caption-2 bg-primary/10 text-primary rounded-full px-2 py-0.5 font-semibold">Demo</span>
          <span className="flex-1" />
          {exhausted ? null : (
            <span className="ta-caption-1 text-muted-foreground hidden md:inline">
              {Math.max(0, Math.floor(remaining / 60))} of {Math.round(allowance.allowedSec / 60)} demo minutes left
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="hidden h-8 px-3 sm:inline-flex"
            nativeButton={false}
            render={<a href={CONTACT_URL} target="_blank" rel="noreferrer" />}
          >
            Talk to us
          </Button>
          <RequestSetupButton setup={setup} onOpen={openRequest} size="sm" className="h-8 px-3" />
        </div>
      </header>

      <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-12 px-4 py-10 md:px-6 lg:py-12">
        <DemoCall
          state={demoCall}
          name={name}
          agentName={agentName}
          capabilities={capabilities}
          questions={questions}
          allowance={allowance}
          remaining={remaining}
          callRef={callRef}
          lede={lede}
          cta={(size) => (
            <RequestSetupButton setup={setup} onOpen={openRequest} size={size} className={size === "lg" ? "h-12 px-6" : undefined} />
          )}
        />

        {/*
          Everything below the hero is as it was; it narrows back to the
          reading column. Parked while the copy is reworked: HowItWorks,
          MissedCalls and GoLive still live in components/public/ and go back
          in here when their content is settled.
        */}
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <LanguageNote agentName={agentName} language={language} />

          {/*
            Dashboard-only (PORTING.md): how the receptionist is set up — the operator's settings
            studio, read-only, with every section it was built from and a mark that each can be
            changed after setup. It replaced the promo's Knowledge / Schedule / Prompt card.
          */}
          <section aria-labelledby="setup-title" className="flex flex-col gap-5 border-t pt-8">
            <div className="flex flex-col gap-2">
              <h2 id="setup-title" className="ta-heading-1">
                How {agentName} is set up
              </h2>
              <p className="ta-body-2-reading text-muted-foreground max-w-[68ch]">
                Everything {agentName} runs on: what it knows about {name}, how it answers, who it puts callers through
                to, what it texts and how it books. We built it from public sources. Once it's set up for you, all of it
                is yours to change and test before your line goes live.
              </p>
            </div>
            <Suspense fallback={<div className="bg-muted/40 h-[560px] animate-pulse rounded-[16px] border" aria-busy="true" />}>
              <PublicSettings
                customerId={customerId}
                businessName={name}
                agentName={agentName}
                voice={voice}
                language={language}
                callSound={callSound}
                profile={profile}
                prompts={prompts}
                capabilities={capabilities}
                notice={
                  <div className="bg-primary/5 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 md:px-5">
                    <Lock className="text-primary size-4 shrink-0" aria-hidden />
                    <p className="ta-caption-1 text-foreground min-w-0 flex-1">
                      <span className="font-semibold">A read-only preview.</span> Once it's set up, you edit all of this
                      yourself and try each change with a test call.
                    </p>
                    <RequestSetupButton setup={setup} onOpen={openRequest} size="sm" className="h-8 px-3" />
                  </div>
                }
                test={
                  <div className="flex flex-col items-start gap-4">
                    <p className="ta-body-2 text-muted-foreground max-w-[62ch]">
                      Call {agentName} from the top of this page: ask what callers ask, and try a transfer, a text or a
                      booking. Once it's set up, you test here instead — change something, call again, and callers only
                      get it when you publish.
                    </p>
                    <Button variant="outline" onClick={toCall}>
                      <ArrowUp className="size-4" /> Go to the call
                    </Button>
                  </div>
                }
                launchExtra={
                  <div className="bg-muted/40 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
                    <p className="ta-body-2 min-w-0 flex-1">Ready for your real calls? Request setup to start onboarding.</p>
                    <RequestSetupButton setup={setup} onOpen={openRequest} />
                  </div>
                }
              />
            </Suspense>
            {sources.length ? (
              <details className="group rounded-[16px] border">
                <summary className="ta-label-1 flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold!">
                  Where this came from
                  <span className="ta-caption-1 text-muted-foreground font-medium">{sources.length} public sources</span>
                </summary>
                <div className="border-t px-5 py-4">
                  <SourcesPanel dossier={dossier} sources={sources} researchedAt={researchedAt} compact />
                </div>
              </details>
            ) : null}
          </section>

          {/* Outlined like /start's cards: the kit's Card draws a ring, so it is a plain box here. */}
          <div className="bg-primary/5 border-primary/30 rounded-[16px] border">
            <div className="flex flex-col items-center gap-3 p-5 text-center md:p-8">
              <p className="ta-heading-1">Want this answering your real calls?</p>
              <p className="ta-body-2-reading text-muted-foreground max-w-[60ch]">
                Same receptionist, your number, your hours, your booking rules. Request setup and, once we've approved it,
                everything above is yours to edit and test. We switch your line on when you're ready.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <RequestSetupButton setup={setup} onOpen={openRequest} size="lg" className="h-11 px-6" />
                <ContactButtons mailto={mailto} customerId={customerId} talk={false} />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Full width with a hairline, like /start's. */}
      <footer className="border-t">
        <div className="ta-caption-1 text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 md:flex-row md:items-start md:justify-between md:gap-8 md:px-6">
          <div className="flex flex-col gap-1">
            <p>A TecAce demo. The business shown here has not endorsed it.</p>
            <p className="ta-caption-2 max-w-md">
              So we can see how the demo went, this page counts visits and keeps
              what was said on the call. Nothing is shared outside TecAce.
            </p>
          </div>
          <div className="flex items-center gap-6">
            <a className="hover:text-foreground transition-colors" href={CONTACT_URL} target="_blank" rel="noreferrer">
              Contact us
            </a>
            <span>© {new Date().getFullYear()} TecAce</span>
            <VersionBadge />
          </div>
        </div>
      </footer>
      <RequestSetupDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        demoId={customerId}
        businessName={name}
        agentName={agentName}
      />
    </>
  );
}
