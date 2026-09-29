import type { ReactNode } from "react";
import { quotedGreeting } from "@/lib/prompt";
import { suggestedQuestions } from "@/lib/proof";
import { customerLink } from "@/lib/share";
import type { BusinessProfile as DemoBusinessProfile, CallSound, Customer, CustomerPrompts } from "@/lib/types";
import type { SessionPreview } from "../api/types";
import { SectionIntro, type SettingsSection } from "./SettingsShell";
import type { CallSettingsBinding } from "./sections/shared";
import { DemoAppointmentsSection } from "./sections/appointments/AppointmentsRules";
import { TransferCallsSection } from "./sections/TransferCallsSection";
import { TextLinkSection } from "./sections/TextLinkSection";
import { TakeMessageSection } from "./sections/TakeMessageSection";
import { ForwardingSection } from "./sections/ForwardingSection";
import { LaunchGuide } from "./sections/LaunchGuide";
import type { SectionId } from "../routing";
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
  /** In Launch instructions' Next step card (the public page's Request setup). */
  launchExtra?: ReactNode;
  /** Opens another section (Launch instructions points at Call forwarding and Test & improve). */
  onOpenSection?: (id: SectionId) => void;
};

/** Where a demo's "Go to billing" leads: the dashboard's billing page (a placeholder for now). */
export const BILLING_HREF = "#/billing";

export function buildDemoSections(ctx: DemoSectionsContext): SettingsSection[] {
  const { draft, setDraft, binding, audience } = ctx;
  const operator = audience === "operator";
  const businessName = draft.profile.name || draft.businessName;
  const setProfile = (profile: DemoBusinessProfile) => setDraft((current) => ({ ...current, profile }));
  // Only the operator can rebuild, so only the operator is told. Typing into a prompt counts: the
  // top Save would freeze it.
  const promptsFrozen = operator && Boolean(draft.prompts.edited);
  const pageSaveNote = operator ? (
    <p className="ta-caption-1 text-muted-foreground mt-6">Press Save in the bar above to keep changes here.</p>
  ) : null;

  return [
    {
      id: "business-info",
      render: () => (
        <BusinessInfoSection profile={draft.profile} onChange={setProfile} footer={pageSaveNote} promptsFrozen={promptsFrozen} />
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
      render: () => (
        <FaqsSection profile={draft.profile} onChange={setProfile} footer={pageSaveNote} promptsFrozen={promptsFrozen} />
      ),
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
          promptsFrozen={promptsFrozen}
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
    {
      id: "launch",
      guide: audience === "public",
      render: () => (
        <LaunchGuide
          phase="demo"
          audience={audience}
          agentName={draft.agentName}
          agentNumber={null}
          questions={suggestedQuestions({ faqs: draft.profile.faqs ?? [] }, undefined, 3)}
          // A prospect on the public page has no account to bill yet: Request setup comes first.
          billingHref={audience === "public" ? undefined : BILLING_HREF}
          demoPageHref={audience === "owner" ? customerLink(draft.id) : undefined}
          nextStep={ctx.launchExtra}
          onOpenSection={ctx.onOpenSection}
        />
      ),
    },
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
