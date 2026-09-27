import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BusinessKnowledge } from "@/components/public/BusinessKnowledge";
import { PromptView } from "@/components/public/PromptView";
import { ContactButtons } from "@/components/public/ContactButtons";
import { Logo } from "@/components/public/Logo";
import { LanguageNote } from "@/components/public/LanguageNote";
import { SchedulePanel } from "@/components/public/SchedulePanel";
import { StickyCall } from "@/components/public/StickyCall";
import { SourcesPanel } from "@/components/research/SourcesPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { compactHours, type PublicCapabilities } from "../../public/capabilities";
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
};

export function PublicDemoScreen({
  customerId,
  name,
  category,
  agentName,
  language,
  callSound,
  voiceLabel,
  profile,
  prompts,
  dossier,
  sources,
  researchedAt,
  demo,
  demoUrl,
  capabilities,
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

  const askForChange = useCallback(() => {
    toast("Editing is off while this is a demo.", {
      description: `Tell us what to change and ${agentName} answers that way on the next call.`,
      action: {
        label: "Talk to us",
        onClick: () => window.open(CONTACT_URL, "_blank", "noreferrer"),
      },
    });
  }, [agentName]);

  // The knowledge panel's message is about editing, which is not what someone
  // clicking a calendar tile is asking for.
  const askAboutSchedule = useCallback(() => {
    toast(capabilities.appointments ? "Book on the call instead." : "The demo does not take bookings.", {
      description: capabilities.appointments
        ? `Ask ${agentName} for a ${capabilities.appointments.title.toLowerCase()} on the call: it offers times from the demo calendar. On your real line it writes into the calendar you already use.`
        : `On your real line, ${agentName} writes the booking into the calendar you already use.`,
      action: {
        label: "Talk to us",
        onClick: () => window.open(CONTACT_URL, "_blank", "noreferrer"),
      },
    });
  }, [agentName, capabilities.appointments]);

  const exhausted = allowance.exhausted;
  const questions = suggestedQuestions({ faqs: profile.faqs });
  const knows = { table: "the menu", pickup: "what's in stock", "service visit": "the work you do" }[businessNouns(category).booking as string] ?? "the services";
  const can = [
    capabilities.transfers.length ? `put you through to ${capabilities.transfers[0]!.name.toLowerCase()}` : "",
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
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
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
          <Button size="sm" className="h-8 px-3" nativeButton={false} render={<a href={CONTACT_URL} target="_blank" rel="noreferrer" />}>
            Talk to us
          </Button>
        </div>
      </header>

      <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-12 px-4 py-8 md:px-6 md:py-10">
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
            Dashboard-only (PORTING.md): what the receptionist knows, at a glance, with the whole
            profile, the mock-up schedule and the prompt one click further down. The promo showed
            the full profile open, which made the page five screens long.
          */}
          <section aria-labelledby="knows-title" className="flex flex-col gap-5 border-t pt-8">
            <h2 id="knows-title" className="ta-headline-1">What {agentName} knows</h2>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <p className="ta-caption-1 text-muted-foreground">Hours</p>
                <p className="ta-body-2">{compactHours(profile.hours)}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="ta-caption-1 text-muted-foreground">Knows about</p>
                <ul className="flex flex-wrap gap-1.5">
                  {[...new Set([...profile.services.map((sv) => sv.name), ...profile.highlights])].slice(0, 8).map((item) => (
                    <li key={item} className="ta-caption-1 rounded-full border px-2.5 py-1">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="ta-caption-1 text-muted-foreground">
                  Questions callers ask{profile.faqs.length ? ` · ${profile.faqs.length}` : ""}
                </p>
                <ul className="ta-body-2 flex flex-col gap-1">
                  {profile.faqs.slice(0, 4).map((faq) => (
                    <li key={faq.q}>{faq.q}</li>
                  ))}
                </ul>
              </div>
            </div>
            <details className="group rounded-2xl border">
              <summary className="ta-label-1 flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-semibold!">
                Everything {agentName} knows, and how it was built
                <span className="ta-caption-1 text-muted-foreground font-medium group-open:hidden">
                  Profile, schedule and prompt from {sources.length} sources
                </span>
              </summary>
              <div className="border-t">
          <Card id="built" className="rounded-none border-0 shadow-none">
            <CardHeader>
              <CardTitle className="ta-headline-2">How it was built</CardTitle>
              <p className="ta-caption-1 text-muted-foreground">
                Nobody typed any of this in. We researched {name} from public sources,
                turned what we found into a profile, and generated the instructions the
                receptionist runs on. Everything here is yours to correct before launch.
              </p>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="knowledge">
                <TabsList variant="line" className="w-full justify-start">
                  <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
                  <TabsTrigger value="schedule">
                    Schedule
                    <span className="ta-caption-2 text-muted-foreground ml-1.5">
                      (Mockup)
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="prompt">Prompt</TabsTrigger>
                </TabsList>

                {/*
                  Sources used to be a tab of its own, which gave the working-out
                  the same weight as the answer. It reads better as the reference
                  at the foot of the knowledge it produced.
                */}
                <TabsContent value="knowledge" className="space-y-8 pt-4">
                  <BusinessKnowledge profile={profile} onEditAttempt={askForChange} />
                  <div className="border-t pt-6">
                    <SourcesPanel
                      dossier={dossier}
                      sources={sources}
                      researchedAt={researchedAt}
                      compact
                    />
                  </div>
                </TabsContent>

                <TabsContent value="schedule" className="pt-4">
                  <SchedulePanel
                    profile={profile}
                    agentName={agentName}
                    onLocked={askAboutSchedule}
                  />
                </TabsContent>

                <TabsContent value="prompt" className="pt-4">
                  <PromptView
                    prompts={prompts}
                    voiceLabel={voiceLabel}
                    agentName={agentName}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
              </div>
            </details>
          </section>

          <Card className="rounded-xl border shadow-none">
            <CardContent className="space-y-3 p-4 text-center md:p-6">
              <p className="ta-headline-2">Want this answering your real calls?</p>
              <p className="ta-body-2-reading text-muted-foreground">
                Same receptionist, your number, your hours, your booking rules — and
                the knowledge above becomes yours to edit. The reservations,
                confirmation calls, voicemail and transfers are the same system,
                turned on.
              </p>
              <div className="flex justify-center">
                <ContactButtons mailto={mailto} customerId={customerId} />
              </div>
            </CardContent>
          </Card>

          <footer className="flex flex-col items-center gap-1 pb-4">
            <p className="ta-caption-1 text-muted-foreground text-center">
              A TecAce demo. The business shown here has not endorsed it.
            </p>
            <p className="ta-caption-2 text-muted-foreground max-w-md text-center">
              So we can see how the demo went, this page counts visits and keeps
              what was said on the call. Nothing is shared outside TecAce.
            </p>
            <VersionBadge />
          </footer>
        </div>
      </main>
    </>
  );
}
