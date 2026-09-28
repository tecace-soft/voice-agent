import { useEffect, useRef, type ReactNode } from "react";
import { demoFetch } from "@/api";
import { readJson } from "@/lib/http";
import type { Customer } from "@/lib/types";
import type { SessionPreview } from "../api/types";
import type { SectionId } from "../routing";
import { withDefaults, type CallSettings } from "./callSettings";
import { buildDemoSections } from "./demoSections";
import { SettingsShell, type Phase } from "./SettingsShell";
import { makeUpdater, type CallSettingsBinding } from "./sections/shared";

// A demo's receptionist settings: the same shell and sections as a business, over a demo record.
// The sections themselves are `demoSections.tsx`'s, shared with the public demo page; this file is
// the operator's saving around them.
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

  const sections = buildDemoSections({
    audience: operator ? "operator" : "owner",
    draft,
    binding,
    setDraft,
    save: props.save,
    onRebuild: props.onRebuild,
    rebuilding: props.rebuilding,
    loadPreview: operator
      ? async () => readJson<SessionPreview>(await demoFetch(`/customers/${props.customerId}/session-preview`))
      : undefined,
  });

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
