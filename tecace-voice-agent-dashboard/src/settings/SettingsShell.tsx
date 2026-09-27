import type { ReactNode } from "react";
import {
  Building2,
  CalendarDays,
  FlaskConical,
  FolderOpen,
  MessageSquareText,
  PhoneForwarded,
  Rocket,
  Smartphone,
  Smile,
  CircleHelp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SectionId } from "../routing";

// The receptionist's settings, as one left-hand menu and the section it opens.
//
// Laid out after the settings of hosted receptionist products (HeyRosie's admin settings was the
// reference): one thing per menu item, in the order a new business sets them up, ending with how to
// switch the line on. The same shell serves a real business (`BusinessSettings`) and a demo
// (`ProspectScreen`); what differs is only who saves and where, which the containers own.
//
// Rendered inside `.tw`: these are the Tailwind/shadcn screens (see src/styles/index.css).

export const SECTION_META: Record<SectionId, { label: string; icon: typeof Building2 }> = {
  "business-info": { label: "Business information", icon: Building2 },
  "agent-profile": { label: "Agent profile", icon: Smile },
  faqs: { label: "FAQs", icon: CircleHelp },
  "take-message": { label: "Take a message", icon: MessageSquareText },
  appointments: { label: "Appointments", icon: CalendarDays },
  "text-link": { label: "Text a link", icon: Smartphone },
  transfers: { label: "Transfer calls", icon: PhoneForwarded },
  "custom-training": { label: "Custom training", icon: FolderOpen },
  test: { label: "Test & improve", icon: FlaskConical },
  launch: { label: "Launch instructions", icon: Rocket },
};

export type SettingsSection = {
  id: SectionId;
  /** A small marker after the label: "Soon", "Unpublished". */
  badge?: string;
  render: () => ReactNode;
};

type Props = {
  sections: SettingsSection[];
  active: SectionId | undefined;
  onSelect: (id: SectionId) => void;
  /** Shown beside the section on wide screens and below it on narrow ones: the test call. */
  aside?: ReactNode;
  /**
   * Inside a card that already shares the row with something else (a demo's page), the side menu
   * only fits on extra-wide screens; below that the picker is used.
   */
  narrow?: boolean;
};

export function SettingsShell({ sections, active, onSelect, aside, narrow = false }: Props) {
  const current = sections.find((s) => s.id === active) ?? sections[0];
  if (!current) return null;
  const meta = SECTION_META[current.id];

  return (
    <div className={narrow ? "flex flex-col gap-4 2xl:flex-row 2xl:items-start" : "flex flex-col gap-4 lg:flex-row lg:items-start"}>
      <nav aria-label="Receptionist settings" className={narrow ? "hidden w-56 shrink-0 2xl:block" : "hidden w-60 shrink-0 lg:block"}>
        <ul className="flex flex-col gap-1">
          {sections.map((section) => {
            const { label, icon: Icon } = SECTION_META[section.id];
            const selected = section.id === current.id;
            return (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => onSelect(section.id)}
                  aria-current={selected ? "page" : undefined}
                  className={`ta-label-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    selected
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1">{label}</span>
                  {section.badge ? (
                    <span className="ta-caption-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                      {section.badge}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Narrow screens: the menu becomes a picker above the section. */}
      <div className={narrow ? "2xl:hidden" : "lg:hidden"}>
        <Select value={current.id} onValueChange={(value) => value && onSelect(value as SectionId)}>
          <SelectTrigger aria-label="Settings section" className="w-full">
            <SelectValue>{meta.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sections.map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {SECTION_META[section.id].label}
                {section.badge ? ` · ${section.badge}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section aria-labelledby="settings-section-title" className="min-w-0 flex-1 rounded-2xl border p-4 md:p-6">
        <h2 id="settings-section-title" className="ta-headline-1 mb-4">
          {meta.label}
        </h2>
        {current.render()}
      </section>

      {aside ? <aside className="w-full shrink-0 lg:w-80">{aside}</aside> : null}
    </div>
  );
}

/** The line under a section title that says what the section is for. */
export function SectionIntro({ children }: { children: ReactNode }) {
  return <p className="ta-body-2 text-muted-foreground mb-6 max-w-2xl">{children}</p>;
}

/** A save row for the sections that save themselves (a business). */
export function SaveRow({
  onSave,
  saving,
  saved,
  disabled,
  note,
}: {
  onSave: () => void;
  saving: boolean;
  saved?: string | null;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Button onClick={onSave} disabled={disabled || saving}>
        {saving ? "Saving" : "Save"}
      </Button>
      {saved ? <span className="ta-caption-1 text-muted-foreground">{saved}</span> : null}
      {note ? <span className="ta-caption-1 text-muted-foreground">{note}</span> : null}
    </div>
  );
}
