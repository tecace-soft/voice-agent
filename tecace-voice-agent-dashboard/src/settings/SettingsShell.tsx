import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Building2,
  CalendarDays,
  Check,
  FlaskConical,
  FolderOpen,
  MessageSquareText,
  MessagesSquare,
  PanelRightClose,
  PanelRightOpen,
  PhoneForwarded,
  PhoneIncoming,
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
import { TopbarEnd, useHasTopbar, useStudioChrome } from "../chrome";
import type { AutosaveView } from "./useAutosave";
import type { SectionId } from "../routing";

// The receptionist's settings as a studio: a grouped menu, the open section, and the test console
// beside it, each scrolling on its own, under one bar that says where things stand (draft, unsaved,
// preview) and holds the button that acts on it.
//
// Laid out after voice-agent builders (Retell, ElevenLabs) and Vercel's project settings: tuning is
// "change something, call, change again", so the call stays on screen while you edit. The same shell
// serves a demo (the operator, and read-only for the demo's own customer), a business in onboarding
// and a live one — so the screen a customer first sees in their demo is the one they later run.
//
// It takes the whole screen (the B2 layout): no card around it, panes divided by hairlines, the app
// sidebar folded to an icon rail and the bar's controls in the app's own top bar (src/chrome.tsx).
// Where the studio is, Demo › Onboarding › Live sits at the foot of the menu.
//
// Wide screens (≥1280px) show the console as a resizable pane; between 1024 and 1280 it slides over
// the section from the bar's Test call button; below 1024 the menu becomes a picker and the console
// sits under the section. The console is never unmounted while hidden, so hiding it can't drop a call.
//
// Rendered inside `.tw`: these are the Tailwind/shadcn screens (see src/styles/index.css).

export const SECTION_META: Record<SectionId, { label: string; icon: typeof Building2 }> = {
  "business-info": { label: "Business information", icon: Building2 },
  "guided-setup": { label: "Guided setup", icon: MessagesSquare },
  "agent-profile": { label: "Agent profile", icon: Smile },
  faqs: { label: "FAQs", icon: CircleHelp },
  "take-message": { label: "Take a message", icon: MessageSquareText },
  appointments: { label: "Appointments", icon: CalendarDays },
  "text-link": { label: "Text a link", icon: Smartphone },
  transfers: { label: "Transfer calls", icon: PhoneForwarded },
  "custom-training": { label: "Custom training", icon: FolderOpen },
  test: { label: "Test & improve", icon: FlaskConical },
  launch: { label: "Launch instructions", icon: Rocket },
  forwarding: { label: "Call forwarding", icon: PhoneIncoming },
};

/** The menu's groups, in the order a new business works through them. */
export const SECTION_GROUPS: { label: string; ids: SectionId[] }[] = [
  { label: "Start here", ids: ["guided-setup"] },
  { label: "Business", ids: ["business-info", "agent-profile", "faqs"] },
  { label: "Calls", ids: ["take-message", "transfers", "text-link", "appointments"] },
  { label: "Tuning", ids: ["custom-training", "test"] },
  { label: "Go live", ids: ["launch", "forwarding"] },
];

export type SettingsSection = {
  id: SectionId;
  /** A small marker after the label: "Soon", "Draft". */
  badge?: string;
  /** Not a setting but a guide (call forwarding): stays usable when the screen is read-only. */
  guide?: boolean;
  render: () => ReactNode;
};

export type Phase = "demo" | "onboarding" | "live";

type Props = {
  sections: SettingsSection[];
  active: SectionId | undefined;
  onSelect: (id: SectionId) => void;
  /** The console: a live test call, or an example call where there is none. */
  aside?: ReactNode;
  asideTitle?: string;
  /** A marker beside the console's title: "Uses draft", "Example". */
  asideBadge?: string;
  /** The console draws its own header (tabs) and padding: the test call. */
  asideBare?: boolean;
  /** The right of the bar, for the open section: Save, Publish, a status. */
  toolbar?: (section: SectionId) => ReactNode;
  /** Where this receptionist is on the way to a live line. */
  phase?: Phase;
  /** Everything shown, nothing editable: a demo's own customer. */
  readOnly?: boolean;
  /** A line under the bar, across the whole shell. */
  notice?: ReactNode;
  /**
   * `screen` (the dashboard): the studio fills the screen under the app's top bar. `embedded` (the
   * public demo page): a framed block in the page, at most 760px tall, scrolling inside.
   */
  height?: "screen" | "embedded";
  /** Beside every section title: the public page's "Editable after setup". */
  sectionBadge?: ReactNode;
};

const WIDTH_KEY = "settings-console-width";
const MIN_W = 300;
const MAX_W = 560;
const DEFAULT_W = 380;

function storedWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n >= MIN_W && n <= MAX_W ? n : DEFAULT_W;
  } catch {
    return DEFAULT_W;
  }
}

const PHASE_NOTE: Record<Phase, string> = {
  demo: "Everything here carries over to onboarding.",
  onboarding: "Test in the app. The phone line stays off until go live.",
  live: "Answering real calls with what's published.",
};

export function SettingsShell({
  sections,
  active,
  onSelect,
  aside,
  asideTitle = "Test call",
  asideBadge,
  asideBare = false,
  toolbar,
  phase,
  readOnly = false,
  notice,
  height = "screen",
  sectionBadge,
}: Props) {
  const embedded = height === "embedded";
  const current = sections.find((s) => s.id === active) ?? sections[0];
  const [open, setOpen] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia("(min-width: 1280px)").matches,
  );
  const [width, setWidth] = useState(storedWidth);
  const main = useRef<HTMLDivElement | null>(null);
  // In the dashboard the studio has the whole screen: the sidebar folds to a rail and the bar's
  // controls join the app's top bar (src/chrome.tsx). Elsewhere (tests) it keeps a bar of its own.
  useStudioChrome(!embedded);
  const inTopbar = useHasTopbar();

  // A new section starts at its top, not wherever the last one was scrolled to.
  useEffect(() => {
    main.current?.scrollTo?.({ top: 0 });
  }, [current?.id]);

  if (!current) return null;
  const meta = SECTION_META[current.id];
  const available = new Set(sections.map((s) => s.id));
  const groups = SECTION_GROUPS.map((g) => ({ ...g, ids: g.ids.filter((id) => available.has(id)) })).filter(
    (g) => g.ids.length,
  );
  const byId = new Map(sections.map((s) => [s.id, s]));

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    const handle = event.currentTarget;
    const x0 = event.clientX;
    const w0 = width;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => setWidth(Math.max(MIN_W, Math.min(MAX_W, w0 - (e.clientX - x0))));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(w));
        } catch {
          /* a remembered width is a nicety */
        }
        return w;
      });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }

  const panelLabel = open ? "Hide panel" : asideTitle;
  const controls = (
    <>
      {toolbar ? toolbar(current.id) : null}
      {aside ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden lg:inline-flex"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={panelLabel}
          title={panelLabel}
        >
          {open ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
        </Button>
      ) : null}
    </>
  );

  return (
    <div
      className={
        embedded
          ? "settings-studio bg-background flex flex-col overflow-hidden rounded-2xl border lg:h-[min(760px,80dvh)]"
          : "settings-studio flex flex-col lg:h-[calc(100dvh-var(--topbar-h,56px)-var(--studio-above,0px))] lg:min-h-[560px]"
      }
    >
      {!toolbar && !aside ? null : inTopbar ? (
        <TopbarEnd>
          <span className="bg-border hidden h-5 w-px lg:block" aria-hidden />
          {controls}
        </TopbarEnd>
      ) : (
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
          <div className="flex-1" />
          {controls}
        </div>
      )}
      {notice ? <div className="border-b">{notice}</div> : null}

      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        <nav
          aria-label="Receptionist settings"
          className="hidden w-[216px] shrink-0 flex-col gap-3 overflow-y-auto border-r px-2.5 pt-3 pb-2 lg:flex"
        >
          {groups.map((group) => (
            <div key={group.label}>
              <p className="text-muted-foreground/80 px-2.5 pb-1 text-[11px] font-medium tracking-[0.06em] uppercase">
                {group.label}
              </p>
              <ul className="flex flex-col">
                {group.ids.map((id) => {
                  const section = byId.get(id)!;
                  const { label, icon: Icon } = SECTION_META[id];
                  const selected = id === current.id;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => onSelect(id)}
                        aria-current={selected ? "page" : undefined}
                        className={`flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[14px] transition-colors ${
                          selected
                            ? "bg-muted text-foreground font-semibold"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        }`}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span className="flex-1 truncate">{label}</span>
                        <Badge text={section.badge} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {phase ? (
            <div className="mt-auto flex flex-col gap-1.5 border-t px-2.5 pt-3">
              <PhaseSteps phase={phase} />
              <p className="text-muted-foreground/80 text-[12px] leading-snug">{PHASE_NOTE[phase]}</p>
            </div>
          ) : null}
        </nav>

        <div ref={main} className="min-w-0 flex-1 overflow-y-auto">
          <div className="w-full max-w-[860px] px-4 py-5 md:px-9 md:pt-6 md:pb-16">
            {/* Narrow screens: the menu becomes a picker above the section. */}
            <div className="mb-4 flex flex-col gap-3 lg:hidden">
              {phase ? <PhaseSteps phase={phase} /> : null}
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
            <section aria-labelledby="settings-section-title" className="@container">
              <h2
                id="settings-section-title"
                className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[22px] leading-8 font-semibold tracking-[-0.015em]"
              >
                {meta.label}
                {sectionBadge && !current.guide ? sectionBadge : null}
              </h2>
              {/* A disabled fieldset turns off every input and button inside it at once; the
                  `settings-readonly` rules keep the values readable and hide the actions. */}
              <fieldset
                disabled={readOnly && !current.guide}
                className={`m-0 min-w-0 border-0 p-0 ${readOnly && !current.guide ? "settings-readonly" : ""}`}
              >
                {current.render()}
              </fieldset>
            </section>
          </div>
        </div>

        {aside ? (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize the ${asideTitle.toLowerCase()} panel`}
              onPointerDown={startResize}
              className={`group hidden w-1.5 shrink-0 cursor-col-resize ${open ? "xl:block" : ""}`}
            >
              <div className="bg-border group-hover:bg-primary mx-auto mt-[40vh] h-9 w-0.5 rounded-full" />
            </div>
            <aside
              aria-label={asideTitle}
              style={{ "--console-w": `${width}px` } as React.CSSProperties}
              className={`bg-background flex min-h-0 w-full shrink-0 flex-col border-t lg:w-(--console-w) lg:border-t-0 lg:border-l ${
                open ? "" : "lg:hidden"
              } lg:max-xl:absolute lg:max-xl:inset-y-0 lg:max-xl:right-0 lg:max-xl:z-10 lg:max-xl:shadow-lg`}
            >
              {asideBare ? (
                aside
              ) : (
                <>
                  <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
                    <p className="ta-label-1">{asideTitle}</p>
                    {asideBadge ? (
                      <span className="ta-caption-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                        {asideBadge}
                      </span>
                    ) : null}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">{aside}</div>
                </>
              )}
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Badge({ text }: { text?: string }) {
  if (!text) return null;
  if (text === "Draft") {
    return (
      <span className="ta-caption-2 text-warning flex items-center gap-1" title="Changes not published yet">
        <span className="bg-warning size-1.5 rounded-full" aria-hidden />
        Draft
      </span>
    );
  }
  return <span className="ta-caption-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5">{text}</span>;
}

const PHASES: { id: Phase; label: string }[] = [
  { id: "demo", label: "Demo" },
  { id: "onboarding", label: "Onboarding" },
  { id: "live", label: "Live" },
];

/** Demo › Onboarding › Live, with this receptionist's step marked. */
export function PhaseSteps({ phase }: { phase: Phase }) {
  const at = PHASES.findIndex((p) => p.id === phase);
  return (
    <ol className="flex items-center gap-1.5 text-[13px]" aria-label="Where this receptionist is">
      {PHASES.map((p, i) => (
        <li key={p.id} className="flex items-center gap-1.5">
          {i > 0 ? (
            <span className="text-muted-foreground/60" aria-hidden>
              ›
            </span>
          ) : null}
          <span
            aria-current={i === at ? "step" : undefined}
            className={`flex items-center gap-1 ${
              i === at ? "text-primary font-semibold" : i < at ? "text-foreground" : "text-muted-foreground/70"
            }`}
          >
            {i < at ? <Check className="size-3" /> : null}
            {p.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The line under a section title that says what the section is for. */
export function SectionIntro({ children }: { children: ReactNode }) {
  return <p className="ta-body-2 text-muted-foreground mb-6 max-w-[62ch]">{children}</p>;
}

/**
 * The foot of a section that saves itself (a business): where its autosave stands, and Save now —
 * for whoever doesn't want to wait out the pause, and to retry a save that failed.
 */
export function SaveRow({ state, onSave, note }: { state: AutosaveView; onSave: () => void; note?: string }) {
  const time = state.savedAt
    ? new Date(state.savedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : null;
  const line =
    state.status === "saving"
      ? { text: "Saving…", tone: "text-muted-foreground" }
      : state.status === "pending"
        ? { text: "Unsaved changes. Saving in a moment…", tone: "text-muted-foreground" }
        : state.status === "invalid"
          ? { text: `Not saved: ${state.message}`, tone: "text-warning" }
          : state.status === "error"
            ? { text: `Couldn't save: ${state.message}`, tone: "text-destructive" }
            : state.status === "saved"
              ? { text: `Saved at ${time}. This is what the assistant now uses.`, tone: "text-success" }
              : { text: note ?? "Changes save automatically as you type.", tone: "text-muted-foreground" };
  const failed = state.status === "error" || state.status === "invalid";
  return (
    <div className="bg-muted/40 mt-6 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
      <span
        className={`ta-caption-1 flex-1 ${line.tone}`}
        role={failed ? "alert" : "status"}
        aria-live="polite"
        data-autosave={state.status}
      >
        {line.text}
      </span>
      <Button
        variant={failed ? "default" : "outline"}
        size="sm"
        onClick={onSave}
        disabled={!state.dirty || state.status === "saving"}
      >
        {state.status === "error" ? "Retry" : "Save now"}
      </Button>
    </div>
  );
}
