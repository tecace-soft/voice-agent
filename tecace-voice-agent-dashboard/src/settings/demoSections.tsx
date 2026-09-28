import type { ReactNode } from "react";
import { quotedGreeting } from "@/lib/prompt";
import type { BusinessProfile as DemoBusinessProfile, CallSound, Customer, CustomerPrompts } from "@/lib/types";
import type { SessionPreview } from "../api/types";
import { SectionIntro, type SettingsSection } from "./SettingsShell";
import type { CallSettingsBinding } from "./sections/shared";
import { DemoAppointmentsSection } from "./sections/appointments/AppointmentsRules";
import { TransferCallsSection } from "./sections/TransferCallsSection";
import { TextLinkSection } from "./sections/TextLinkSection";
import { TakeMessageSection } from "./sections/TakeMessageSection";
import { ForwardingSection } from "./sections/ForwardingSection";
import {
  AgentProfileSection,
  BusinessInfoSection,
  CustomTrainingSection,
  FaqsSection,
  TestSection,
} from "./sections/ProfileSections";

// A demo's receptionist settings, as the list of sections the studio shows — for three readers:
//
//   * the OPERATOR, who builds the demo (DemoSettings, editable, saved to the demo record);
//   * the demo's OWNER, signed in to look at the receptionist we built for them (read-only);
//   * the PUBLIC demo page (`/c/<id>`), where anyone with the link sees what it knows and does,
//     read-only, and that it can all be changed once it's set up (PublicSettings).
//
// Nothing here talks to a server. Saving is the caller's (`setDraft`, `save`, the binding's
// `update`), and so is anything that reads more (`loadPreview`), so the public page can build its
// screen from this file without reaching the dashboard's API client (tests/public-entry.test.ts).

export type DemoAudience = "operator" | "owner" | "public";

export type DemoSectionsContext = {
  audience: DemoAudience;
  draft: Customer;
  binding: CallSettingsBinding;
  /** Always a change to the CURRENT record: a save that lands later must not undo newer typing. */
  setDraft: (change: (current: Customer) => Customer) => void;
  /** The page's Save, for fields that must be written at once (a language rebuilds the greeting). */
  save?: (partial?: Partial<Customer>) => Promise<void>;
  onRebuild?: () => void;
  rebuilding?: boolean;
  /** The operator's "what the call is told" preview. */
  loadPreview?: () => Promise<SessionPreview>;
  /** The Test & improve section's body, where the audience has its own (the public page's call). */
  test?: ReactNode;
  /** Under the Demo › Onboarding › Live steps (the public page's Request setup). */
  launchExtra?: ReactNode;
};

export function buildDemoSections(ctx: DemoSectionsContext): SettingsSection[] {
  const { draft, setDraft, binding, audience } = ctx;
  const operator = audience === "operator";
  const businessName = draft.profile.name || draft.businessName;
  const setProfile = (profile: DemoBusinessProfile) => setDraft((current) => ({ ...current, profile }));
  const pageSaveNote = operator ? (
    <p className="ta-caption-1 text-muted-foreground mt-6">Press Save in the bar above to keep changes here.</p>
  ) : null;

  return [
    {
      id: "business-info",
      render: () => (
        <BusinessInfoSection profile={draft.profile} onChange={setProfile} agentName={draft.agentName} footer={pageSaveNote} />
      ),
    },
    {
      id: "agent-profile",
      render: () => (
        <AgentProfileSection
          value={{ agentName: draft.agentName, voice: draft.voice, language: draft.language ?? "", greeting: null }}
          onChange={(next) => {
            const languageChanged = next.language !== (draft.language ?? "");
            setDraft((current) => ({ ...current, agentName: next.agentName, voice: next.voice, language: next.language }));
            // The greeting is written in the language, so the prompts have to be rebuilt for the change
            // to reach the call — saved straight away, as the Prompt tab did.
            if (languageChanged) void ctx.save?.({ language: next.language });
          }}
          businessName={businessName}
          greetingLine={quotedGreeting(draft.prompts.greeting) ?? undefined}
          // The demo's browser-side phone line and room sound — for the test call and the public page.
          callSound={draft.callSound}
          onCallSoundChange={(callSound: CallSound) => setDraft((current) => ({ ...current, callSound }))}
          footer={pageSaveNote}
        />
      ),
    },
    {
      id: "faqs",
      render: () => <FaqsSection profile={draft.profile} onChange={setProfile} footer={pageSaveNote} />,
    },
    { id: "take-message", render: () => <TakeMessageSection binding={binding} /> },
    {
      id: "appointments",
      render: () => (
        <DemoAppointmentsSection
          binding={binding}
          notice={
            audience === "public"
              ? "On this demo, bookings go into a demo calendar and nothing is saved. Once it's set up, connect your own calendar here in a few clicks — Google, Outlook, iCloud or a booking tool."
              : undefined
          }
        />
      ),
    },
    { id: "text-link", render: () => <TextLinkSection binding={binding} /> },
    { id: "transfers", render: () => <TransferCallsSection binding={binding} /> },
    {
      id: "custom-training",
      render: () => (
        <CustomTrainingSection
          standard={[]}
          prompts={draft.prompts}
          onPromptsChange={(prompts: CustomerPrompts) => setDraft((current) => ({ ...current, prompts }))}
          onRebuild={ctx.onRebuild ?? (() => {})}
          rebuilding={Boolean(ctx.rebuilding)}
          promptsFooter={
            operator ? <span className="ta-caption-1 text-muted-foreground">Save at the top of the page keeps prompt edits.</span> : undefined
          }
          loadPreview={operator ? ctx.loadPreview : undefined}
          // A demo has no phone line, so nothing published to compare with.
          previewTabs={false}
        />
      ),
    },
    {
      id: "test",
      guide: audience === "public",
      render: () =>
        ctx.test ??
        (operator ? (
          <TestSection>
            <p className="ta-body-2 text-muted-foreground">
              Use the Test call panel beside these settings. It dials this demo with its current transfers, links
              and message scenarios, and lets you play the phone being rung and the caller's texts. Change
              something, then call again: there's nothing to publish on a demo.
            </p>
          </TestSection>
        ) : (
          <div>
            <SectionIntro>
              Hear your receptionist for yourself: open your demo page from the panel beside these settings and
              call it from your browser. After onboarding, you test here instead, with your own changes, before
              callers get them.
            </SectionIntro>
          </div>
        )),
    },
    { id: "launch", guide: audience === "public", render: () => <Journey audience={audience} extra={ctx.launchExtra} /> },
    {
      id: "forwarding",
      guide: true,
      render: () => (
        <ForwardingSection
          agentNumber={null}
          notice={
            operator
              ? "A demo has no phone line. This is the guide the business follows once it goes live, with its number filled in."
              : "Your receptionist gets its own number when you go live, and the codes below fill in with it."
          }
        />
      ),
    },
  ];
}

const STEPS: { title: string; body: string }[] = [
  {
    title: "Demo",
    body: "Try the receptionist we built from your business, and see everything it can do.",
  },
  {
    title: "Onboarding",
    body: "Check what it knows, set up transfers, links and messages, and test calls in the app before callers get them.",
  },
  {
    title: "Live",
    body: "We give your receptionist a phone number. You forward your calls to it, and it answers the ones you miss.",
  },
];

const JOURNEY_INTRO: Record<DemoAudience, string> = {
  operator:
    "A demo has no phone line. When this business starts onboarding, everything set up here — including transfers, links and message scenarios — carries over, and this is where they switch their line on.",
  owner:
    "Your receptionist is in its demo. Here's the way to a live line; everything you see in these settings comes with you.",
  public:
    "This receptionist is a demo. Request setup and, once we've approved it, everything you see here is yours to change and test before your phone line goes live.",
};

/** Demo › onboarding › live, spelled out, for a demo's launch section. */
function Journey({ audience, extra }: { audience: DemoAudience; extra?: ReactNode }) {
  return (
    <div>
      <SectionIntro>{JOURNEY_INTRO[audience]}</SectionIntro>
      <ol className="grid gap-3 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className={`rounded-xl border p-4 ${i === 0 ? "border-primary bg-primary/5" : ""}`}>
            <p className="ta-caption-1 text-muted-foreground">Step {i + 1}</p>
            <p className="ta-headline-2 mt-1">
              {step.title}
              {i === 0 ? (
                <span className="ta-caption-2 text-primary ml-2">{audience === "operator" ? "Now" : audience === "owner" ? "You're here" : "Now"}</span>
              ) : null}
            </p>
            <p className="ta-caption-1 text-muted-foreground mt-2">{step.body}</p>
          </li>
        ))}
      </ol>
      {extra ? <div className="mt-6">{extra}</div> : null}
    </div>
  );
}
