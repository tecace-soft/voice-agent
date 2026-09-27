import { useEffect, useRef, type ReactNode } from "react";
import { demoFetch } from "@/api";
import { readJson } from "@/lib/http";
import { quotedGreeting } from "@/lib/prompt";
import type { BusinessProfile as DemoBusinessProfile, CallSound, Customer, CustomerPrompts } from "@/lib/types";
import type { SessionPreview } from "../api/types";
import type { SectionId } from "../routing";
import { withDefaults, type CallSettings } from "./callSettings";
import { SettingsShell, SectionIntro, type SettingsSection } from "./SettingsShell";
import { makeUpdater, type CallSettingsBinding } from "./sections/shared";
import { TransferCallsSection } from "./sections/TransferCallsSection";
import { TextLinkSection } from "./sections/TextLinkSection";
import { TakeMessageSection } from "./sections/TakeMessageSection";
import {
  AgentProfileSection,
  AppointmentsSection,
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
  /** The test call, shown in the Test section. */
  testCall?: ReactNode;
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
  };

  const setProfile = (profile: DemoBusinessProfile) => setDraft((current) => ({ ...current, profile }));
  const pageSaveNote = (
    <p className="ta-caption-1 text-muted-foreground mt-6">Use Save at the top of the page to keep changes here.</p>
  );

  const operatorOnly = (render: () => ReactNode) => () =>
    operator ? (
      render()
    ) : (
      <SectionIntro>Your TecAce team sets this up with you. It's ready to use once you go live.</SectionIntro>
    );

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
    ...(operator
      ? ([
          { id: "take-message", render: operatorOnly(() => <TakeMessageSection binding={binding} />) },
          { id: "appointments", badge: "Soon", render: () => <AppointmentsSection /> },
          { id: "text-link", render: operatorOnly(() => <TextLinkSection binding={binding} />) },
          { id: "transfers", render: operatorOnly(() => <TransferCallsSection binding={binding} />) },
        ] as SettingsSection[])
      : []),
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
    ...(operator
      ? ([
          {
            id: "test",
            render: () => (
              <TestSection>
                <p className="ta-body-2 text-muted-foreground">
                  Use the Test call panel beside these settings. It dials this demo with its current transfers,
                  links and message scenarios, and lets you play the phone being rung and the caller's texts.
                </p>
              </TestSection>
            ),
          },
        ] as SettingsSection[])
      : []),
    {
      id: "launch",
      render: () => (
        <div>
          <SectionIntro>
            A demo has no phone line. When this business starts onboarding, everything set up here — including
            transfers, links and message scenarios — carries over, and this is where they switch their line on.
          </SectionIntro>
        </div>
      ),
    },
  ];

  return <SettingsShell sections={sections} active={props.section} onSelect={props.onSection} narrow />;
}
