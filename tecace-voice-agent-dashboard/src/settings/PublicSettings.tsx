import { useMemo, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import type { BusinessProfile, CallSound, Customer, CustomerPrompts } from "@/lib/types";
import type { SectionId } from "../routing";
import { settingsFromCapabilities, type PublicCapabilities } from "../public/capabilities";
import { buildDemoSections } from "./demoSections";
import { SettingsShell } from "./SettingsShell";
import type { CallSettingsBinding } from "./sections/shared";

// The receptionist's settings on the public demo page (`/c/<id>`): the same studio the operator
// builds it in and the customer later runs it from, read-only, framed in the page.
//
// It is what makes "this can all be changed" something a prospect can see: every section they'll
// edit after setup — business information, the agent, FAQs, messages, transfers, links, bookings,
// the prompt — with what this demo was built with filled in, and an "Editable after setup" mark on
// each. Built from the public read alone (`GET /demo/public/customers/:id`): no staff numbers (the
// transfers show "Front desk's phone" where the operator sees a number) and nothing that saves.

export type PublicSettingsProps = {
  customerId: string;
  businessName: string;
  agentName: string;
  voice: string;
  language?: string;
  callSound: CallSound;
  profile: BusinessProfile;
  prompts: Pick<CustomerPrompts, "live" | "backend" | "greeting">;
  capabilities: PublicCapabilities;
  /** The Test & improve section: points back at the page's own call. */
  test: ReactNode;
  /** In Launch instructions' Next step card: the Request setup button. */
  launchExtra: ReactNode;
  /** Across the top: what this is, and the way to change it. */
  notice: ReactNode;
};

const refuse = async () => {
  throw new Error("This is a demo. Request setup to change it.");
};

export function PublicSettings(props: PublicSettingsProps) {
  const [section, setSection] = useState<SectionId>("business-info");
  const settings = useMemo(() => settingsFromCapabilities(props.capabilities), [props.capabilities]);

  // The demo record as the sections read it. Only the fields they touch are real; the rest of
  // `Customer` is the operator's and is not on the public read.
  const draft = {
    id: props.customerId,
    businessName: props.businessName,
    agentName: props.agentName,
    voice: props.voice,
    language: props.language,
    callSound: props.callSound,
    profile: props.profile,
    prompts: { ...props.prompts, edited: false },
    callSettings: settings,
  } as unknown as Customer;

  const binding: CallSettingsBinding = {
    value: settings,
    mode: "demo",
    businessName: props.profile.name || props.businessName,
    agentNumber: null,
    waterfallAllowed: true,
    update: refuse,
    readOnly: true,
  };

  const sections = buildDemoSections({
    audience: "public",
    draft,
    binding,
    setDraft: () => {},
    test: props.test,
    launchExtra: props.launchExtra,
    onOpenSection: setSection,
  });

  return (
    <SettingsShell
      sections={sections}
      active={section}
      onSelect={setSection}
      phase="demo"
      readOnly
      height="embedded"
      notice={props.notice}
      sectionBadge={
        <span className="ta-caption-2 bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium tracking-normal">
          <Lock className="size-3" aria-hidden />
          Editable after setup
        </span>
      }
    />
  );
}
