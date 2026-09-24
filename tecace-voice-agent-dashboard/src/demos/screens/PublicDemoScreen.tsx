import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { BusinessKnowledge } from "@/components/public/BusinessKnowledge";
import { PromptView } from "@/components/public/PromptView";
import { ContactButtons } from "@/components/public/ContactButtons";
import { Hero } from "@/components/public/Hero";
import { Logo } from "@/components/public/Logo";
import { LanguageNote } from "@/components/public/LanguageNote";
import { SchedulePanel } from "@/components/public/SchedulePanel";
import { ScenarioTeaser } from "@/components/public/ScenarioTeaser";
import { StickyCall } from "@/components/public/StickyCall";
import { SourcesPanel } from "@/components/research/SourcesPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VersionBadge } from "@/components/VersionBadge";
import { useInView } from "@/hooks/useInView";
import { useLiveCall } from "@/hooks/useLiveCall";
import { publicFetch } from "@/publicApi";
import { visitorId } from "@/lib/visitor";
import type { DemoAllowance } from "@/lib/analytics";
import { CONTACT_URL, mailtoFor } from "@/lib/links";
import { SCENARIO_COUNT } from "@/lib/use-cases";
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
}: PublicDemoScreenProps) {
  const call = useLiveCall(customerId, callSound, { api: publicFetch });
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
    toast("The demo does not take bookings.", {
      description: `On your real line, ${agentName} writes the booking into the calendar you already use.`,
      action: {
        label: "Talk to us",
        onClick: () => window.open(CONTACT_URL, "_blank", "noreferrer"),
      },
    });
  }, [agentName]);

  const exhausted = allowance.exhausted;
  const remaining = Math.max(0, allowance.remainingSec - (call.usageSec || 0));

  return (
    <>
      <StickyCall
        show={!callInView && !exhausted}
        name={name}
        agentName={agentName}
        call={call}
      />

      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-10 px-4 py-6 md:py-8">
        <header className="flex items-center justify-between gap-4">
          <Logo className="h-6" />
          <a
            href={`/c/${customerId}/scenarios`}
            className="ta-label-1 text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            See all {SCENARIO_COUNT} scenarios
            <ArrowRight className="size-4" aria-hidden />
          </a>
        </header>

        <Hero
          name={name}
          category={category}
          agentName={agentName}
          faqs={profile.faqs}
          sources={sources}
          greeting={prompts.greeting}
          call={call}
          allowance={allowance}
          remaining={remaining}
          mailto={mailto}
          customerId={customerId}
          callRef={callRef}
        />

        {/*
          Everything below the hero is as it was; it narrows back to the
          reading column. Parked while the copy is reworked: HowItWorks,
          MissedCalls and GoLive still live in components/public/ and go back
          in here when their content is settled.
        */}
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <LanguageNote agentName={agentName} language={language} />

          <ScenarioTeaser
            customerId={customerId}
            category={category}
            count={SCENARIO_COUNT}
          />

          <Card id="built" className="rounded-xl border shadow-none">
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
