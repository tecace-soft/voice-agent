import { useEffect, useRef, type ReactNode } from "react";
import { demoFetch } from "@/api";
import { readJson } from "@/lib/http";
import { quotedGreeting } from "@/lib/prompt";
import type { BusinessProfile as DemoBusinessProfile, CallSound, Customer, CustomerPrompts } from "@/lib/types";
import type { SessionPreview } from "../api/types";
import type { SectionId } from "../routing";
import { withDefaults, type CallSettings } from "./callSettings";
import { AppointmentsSection } from "./sections/AppointmentsSection";
import { SettingsShell, SectionIntro, type Phase, type SettingsSection } from "./SettingsShell";
import { makeUpdater, type CallSettingsBinding } from "./sections/shared";
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

// A demo's receptionist settings: the same shell and sections as a business, over a demo record.
//
// The difference is who saves. Knowledge, the persona and the prompts are part of the record the
// page's own Save button PATCHes, exactly as the Knowledge and Prompt tabs did. Transfers, links and
// message scenarios save the moment a dialog is saved, straight into `callSettings` — there is no
// draft on a demo, because a demo has no phone line for a half-finished scenario to reach. They are
// the operator's to set up (the demo's own customer cannot send them; the backend refuses), and they
// become the business's draft at onboarding.
//
// The demo's own customer sees every section, read-only: what their receptionist knows and does, and
// — where nothing is set up yet — examples of what it could do. It's the screen they'll run after
// onboarding, so nothing about it is new to them when they get there.

type Props = {
  customerId: string;
  draft: Customer;
  /** Always a change to the CURRENT record: a save that lands later must not undo newer typing. */
  setDraft: (change: (current: Customer) => Customer) => void;
  /** The page's Save, for fields that must be written at once (a language rebuilds the greeting). */
  save: (partial?: Partial<Customer>) => Promise<void>;
  onRebuild: () => void;
  rebuilding: boolean;
  operator: boolean;
  section: SectionId | undefined;
  onSection: (section: SectionId) => void;
  /** The console beside the settings: the operator's test call, or the customer's example call. */
  aside?: ReactNode;
  asideTitle?: string;
  asideBadge?: string;
  /** The console draws its own tabs and padding (the operator's test call). */
  asideBare?: boolean;
  /** The right of the settings bar (Save, or the preview's note). */
  toolbar?: (section: SectionId) => ReactNode;
  phase?: Phase;
  /** Across the top of the settings, under the bar. */
  notice?: ReactNode;
};

/** A PATCH whose refusal keeps the backend's `field`, so the form can point at the input. */
async function patchCallSettings(customerId: string, callSettings: CallSettings): Promise<Customer> {
  const response = await demoFetch(`/customers/${customerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callSettings }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; field?: string };
    throw Object.assign(new Error(body.error || `Couldn't save (${response.status}).`), { field: body.field });
  }
  return (await readJson<{ customer: Customer }>(response)).customer;
}

export function DemoSettings(props: Props) {
  const { draft, setDraft, operator } = props;
  const settings = withDefaults(draft.callSettings);
  const businessName = draft.profile.name || draft.businessName;

  // Applied to the latest settings and saved one at a time — see makeUpdater.
  const latest = useRef(settings);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const idRef = useRef(props.customerId);
  idRef.current = props.customerId;
  useEffect(() => {
    latest.current = withDefaults(draft.callSettings);
  }, [draft.callSettings]);
  const update = useRef(
    makeUpdater(
      latest,
      async (next) => {
        const customer = await patchCallSettings(idRef.current, next);
        setDraft((current) => ({ ...current, callSettings: customer.callSettings }));
        return withDefaults(customer.callSettings);
      },
      queue,
    ),
  );

  const binding: CallSettingsBinding = {
    value: settings,
    mode: "demo",
    businessName,
    agentNumber: null,
    // Waterfall is always available on a demo: the operator is showing what the product can do.
    waterfallAllowed: true,
    update: update.current,
    readOnly: !operator,
  };

  const setProfile = (profile: DemoBusinessProfile) => setDraft((current) => ({ ...current, profile }));
  const pageSaveNote = operator ? (
    <p className="ta-caption-1 text-muted-foreground mt-6">Press Save in the bar above to keep changes here.</p>
  ) : null;

  const sections: SettingsSection[] = [
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
            if (languageChanged) void props.save({ language: next.language });
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
    { id: "appointments", render: () => <AppointmentsSection binding={binding} /> },
    { id: "text-link", render: () => <TextLinkSection binding={binding} /> },
    { id: "transfers", render: () => <TransferCallsSection binding={binding} /> },
    {
      id: "custom-training",
      render: () => (
        <CustomTrainingSection
          standard={[]}
          prompts={draft.prompts}
          onPromptsChange={(prompts: CustomerPrompts) => setDraft((current) => ({ ...current, prompts }))}
          onRebuild={props.onRebuild}
          rebuilding={props.rebuilding}
          promptsFooter={<span className="ta-caption-1 text-muted-foreground">Save at the top of the page keeps prompt edits.</span>}
          loadPreview={
            operator
              ? async () =>
                  readJson<SessionPreview>(await demoFetch(`/customers/${props.customerId}/session-preview`))
              : undefined
          }
          // A demo has no phone line, so nothing published to compare with.
          previewTabs={false}
        />
      ),
    },
    {
      id: "test",
      render: () =>
        operator ? (
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
        ),
    },
    { id: "launch", render: () => <Journey operator={operator} /> },
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

  return (
    <SettingsShell
      sections={sections}
      active={props.section}
      onSelect={props.onSection}
      aside={props.aside}
      asideTitle={props.asideTitle}
      asideBadge={props.asideBadge}
      asideBare={props.asideBare}
      toolbar={props.toolbar}
      phase={props.phase ?? "demo"}
      readOnly={!operator}
      notice={props.notice}
    />
  );
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

/** Demo › onboarding › live, spelled out, for a demo's launch section. */
function Journey({ operator }: { operator: boolean }) {
  return (
    <div>
      <SectionIntro>
        {operator
          ? "A demo has no phone line. When this business starts onboarding, everything set up here — including transfers, links and message scenarios — carries over, and this is where they switch their line on."
          : "Your receptionist is in its demo. Here's the way to a live line; everything you see in these settings comes with you."}
      </SectionIntro>
      <ol className="grid gap-3 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className={`rounded-xl border p-4 ${i === 0 ? "border-primary bg-primary/5" : ""}`}>
            <p className="ta-caption-1 text-muted-foreground">Step {i + 1}</p>
            <p className="ta-headline-2 mt-1">
              {step.title}
              {i === 0 ? <span className="ta-caption-2 text-primary ml-2">{operator ? "Now" : "You're here"}</span> : null}
            </p>
            <p className="ta-caption-1 text-muted-foreground mt-2">{step.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
