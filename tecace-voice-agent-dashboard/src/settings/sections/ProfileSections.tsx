import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye } from "lucide-react";
import { KnowledgeEditor } from "@/components/admin/KnowledgeEditor";
import { PromptEditor } from "@/components/admin/PromptEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { BusinessProfile as DemoBusinessProfile, CallSound, CustomerPrompts } from "@/lib/types";
import type { BehaviourDefault, SessionPreview } from "../../api/types";
import { SectionIntro } from "../SettingsShell";
import { FaqEditor } from "./FaqEditor";
import { FieldMessage, toFieldError } from "./shared";
import { GREETING_EXAMPLES, INSTRUCTION_EXAMPLES, Tips } from "../examples";

// The settings sections that edit what the receptionist knows and how it sounds. Each is a
// controlled editor; the container decides whether it saves itself (a business, with `footer`) or
// rides on the page's own Save (a demo).

/**
 * Prompts edited by hand in Custom training are frozen: they stop following the profile, the FAQs
 * and the agent profile until they are rebuilt. Said wherever an edit would otherwise look like it
 * reached the call.
 */
function FrozenPromptsNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="bg-primary/10 text-primary mb-6 flex flex-wrap items-center gap-3 rounded-lg p-3" role="status">
      <p className="ta-caption-1 min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}

const FROZEN_ELSEWHERE =
  "Your prompts in Custom training were edited by hand, so they don't pick up changes made here. Rebuild them in Custom training to include these.";

export function BusinessInfoSection({
  profile,
  onChange,
  source,
  footer,
  promptsFrozen,
}: {
  profile: DemoBusinessProfile | null;
  onChange: (profile: DemoBusinessProfile) => void;
  /** Business only: the description card and its re-read. */
  source?: ReactNode;
  footer?: ReactNode;
  promptsFrozen?: boolean;
}) {
  return (
    <div>
      <SectionIntro>
        What the assistant knows about your business and answers callers from. If something here is wrong,
        callers hear it wrong — anything not here, it says it doesn't know.
      </SectionIntro>
      {source}
      {promptsFrozen ? <FrozenPromptsNote>{FROZEN_ELSEWHERE}</FrozenPromptsNote> : null}
      {profile ? (
        <>
          <KnowledgeEditor
            profile={profile}
            onChange={onChange}
            sections={["details", "hours", "services", "policies", "highlights"]}
          />
          {footer}
        </>
      ) : (
        <p className="ta-body-2 text-muted-foreground">Nothing to edit yet. Add your business information first.</p>
      )}
    </div>
  );
}

export function FaqsSection({
  profile,
  onChange,
  footer,
  promptsFrozen,
}: {
  profile: DemoBusinessProfile | null;
  onChange: (profile: DemoBusinessProfile) => void;
  footer?: ReactNode;
  promptsFrozen?: boolean;
}) {
  return (
    <div>
      <SectionIntro>
        Questions callers ask, and the answer you want them to get — up to 20. Write answers the way you'd
        say them on the phone: spell a web address out as words, and keep schedules and price lists in
        Business information instead.
      </SectionIntro>
      {promptsFrozen ? <FrozenPromptsNote>{FROZEN_ELSEWHERE}</FrozenPromptsNote> : null}
      {profile ? (
        <>
          <FaqEditor faqs={profile.faqs} onChange={(faqs) => onChange({ ...profile, faqs })} />
          {footer}
          <div className="mt-8">
            <Tips
              title="Writing answers callers understand"
              items={[
                {
                  good: "Q: Do you take walk-ins? A: Yes, most weekdays. Weekends are busy, so booking ahead is best.",
                  avoid: "A: See website.",
                },
                {
                  good: "A: You can book online at olympus spa dot com, slash book.",
                  avoid: "A: https://olympusspa.com/book?ref=phone",
                },
                {
                  good: "Keep each answer to one or two sentences, the way you'd say it on the phone.",
                  avoid: "Pasting a whole price list into one answer. Put prices under Business information.",
                },
              ]}
            />
          </div>
        </>
      ) : (
        <p className="ta-body-2 text-muted-foreground">Add your business information first.</p>
      )}
    </div>
  );
}

export type AgentFields = { agentName: string; voice: string; language: string; greeting: string | null };

export function AgentProfileSection({
  value,
  onChange,
  businessName,
  greetingLine,
  callSound,
  onCallSoundChange,
  footer,
}: {
  value: AgentFields;
  onChange: (value: AgentFields) => void;
  businessName: string;
  /** What callers hear now, for a demo whose greeting is not a typed field. */
  greetingLine?: string;
  /** A demo only: the browser-side call sound. A real call is already a phone call. */
  callSound?: Partial<CallSound> | null;
  onCallSoundChange?: (sound: CallSound) => void;
  footer?: ReactNode;
}) {
  const typedGreeting = value.greeting !== null;
  const heard = typedGreeting
    ? (value.greeting || "").replace(/\{business\}/g, businessName).replace(/\{agent\}/g, value.agentName || "Tess")
    : greetingLine;
  return (
    <div>
      <SectionIntro>
        Who answers: the name the assistant gives, the voice it speaks in, the language it opens in, and the
        first words every caller hears.
      </SectionIntro>
      <PromptEditor
        sections={["identity"]}
        showCallSound={Boolean(onCallSoundChange)}
        callSound={callSound}
        onCallSoundChange={onCallSoundChange}
        agentName={value.agentName}
        voice={value.voice}
        language={value.language}
        prompts={{ live: "", backend: "", greeting: "", edited: false }}
        onAgentNameChange={(agentName) => onChange({ ...value, agentName })}
        onVoiceChange={(voice) => onChange({ ...value, voice })}
        onLanguageChange={(language) => onChange({ ...value, language })}
        onPromptsChange={() => undefined}
        onRegenerate={() => undefined}
        regenerating={false}
        hideRebuild
      />
      {typedGreeting ? (
        <div className="mt-6 space-y-1.5">
          <Label htmlFor="agent-greeting" className="ta-label-1">
            Greeting
          </Label>
          <Textarea
            id="agent-greeting"
            value={value.greeting ?? ""}
            maxLength={240}
            placeholder="Thanks for calling {business}, this is {agent}. How can I help?"
            onChange={(e) => onChange({ ...value, greeting: e.target.value })}
          />
          <p className="ta-caption-1 text-muted-foreground">
            Word for word. Leave it empty for the standard greeting. Write {"{business}"} or {"{agent}"} and we
            fill them in. Any call-recording notice is added for you.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="ta-caption-1 text-muted-foreground">Try one:</span>
            {GREETING_EXAMPLES.map((greeting) => (
              <Button
                key={greeting}
                variant="outline"
                size="sm"
                className="h-auto max-w-full py-1 text-left whitespace-normal"
                onClick={() => onChange({ ...value, greeting })}
              >
                {greeting}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {heard ? (
        <div className="mt-4">
          <p className="ta-caption-1 text-muted-foreground mb-1">Callers hear</p>
          <div className="bg-muted/50 ta-body-2 max-w-xl rounded-2xl p-3">{heard}</div>
        </div>
      ) : null}
      {footer}
    </div>
  );
}

export function CustomTrainingSection({
  standard,
  houseRules,
  onHouseRulesChange,
  houseRulesFooter,
  prompts,
  onPromptsChange,
  onRebuild,
  rebuilding,
  promptsFooter,
  loadPreview,
  previewTabs = true,
  promptsFrozen,
  previewVersion,
}: {
  standard: BehaviourDefault[];
  /** Business only; a demo has no instructions of its own. */
  houseRules?: string;
  onHouseRulesChange?: (text: string) => void;
  houseRulesFooter?: ReactNode;
  prompts: CustomerPrompts;
  onPromptsChange: (prompts: CustomerPrompts) => void;
  onRebuild: () => void;
  rebuilding: boolean;
  promptsFooter?: ReactNode;
  /** Absent where the viewer may not see the composed session (a demo's own customer). */
  loadPreview?: (which: "draft" | "published") => Promise<SessionPreview>;
  /** False where there is no published copy to compare with (a demo). */
  previewTabs?: boolean;
  /** The SAVED prompts are hand-edited (not just typed into and unsaved). */
  promptsFrozen?: boolean;
  /** Bumped after every save that changes what a call is told; an open preview re-reads. */
  previewVersion?: number;
}) {
  return (
    <div>
      <SectionIntro>
        How the assistant behaves on your calls: the prompts built from your settings, the standard rules
        every call follows, and your own instructions on top.
      </SectionIntro>

      {promptsFrozen ? (
        <FrozenPromptsNote
          action={
            <Button variant="outline" size="sm" onClick={onRebuild} disabled={rebuilding}>
              {rebuilding ? "Rebuilding" : "Rebuild from settings"}
            </Button>
          }
        >
          Your prompts were edited by hand, so they no longer follow Business information, FAQs or Agent
          profile. Changes made there don't reach calls until you rebuild them.
        </FrozenPromptsNote>
      ) : null}

      {/* First and always open. It used to sit behind an "Advanced: prompts" toggle at the foot of the
          page, which on a business — ten standard rules and the instructions box above it — was below
          the fold, so the prompts read as missing. */}
      <section className="mb-8 rounded-xl border p-4" aria-labelledby="prompts-heading">
        <h3 id="prompts-heading" className="ta-headline-2">
          Prompts
        </h3>
        <p className="ta-caption-1 text-muted-foreground mt-1 mb-4 max-w-2xl">
          Built from Business information, Agent profile and FAQs, and rebuilt whenever you save those. Edit
          them only if you need to: once edited they stop following your settings until you rebuild. The
          rules and your transfers, links and message scenarios are added at call time — see the preview.
        </p>
        <PromptEditor
          sections={["prompts"]}
          showCallSound={false}
          agentName=""
          voice=""
          prompts={prompts}
          onAgentNameChange={() => undefined}
          onVoiceChange={() => undefined}
          onLanguageChange={() => undefined}
          onPromptsChange={onPromptsChange}
          onRegenerate={onRebuild}
          regenerating={rebuilding}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={onRebuild} disabled={rebuilding}>
            {rebuilding ? "Rebuilding" : "Rebuild from settings"}
          </Button>
          {promptsFooter}
        </div>
        {loadPreview ? (
          <div className="mt-6">
            <SessionPreviewPanel load={loadPreview} tabs={previewTabs} version={previewVersion} />
          </div>
        ) : null}
      </section>

      {standard.length ? (
        <div className="mb-6 rounded-xl border p-4">
          <p className="ta-label-1 mb-2">On every call, as standard</p>
          <ul className="ta-body-2 list-disc space-y-1 pl-5">
            {standard.map((rule) => (
              <li key={rule.does}>
                {rule.does}
                {rule.because ? <span className="ta-caption-1 text-muted-foreground block">{rule.because}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {onHouseRulesChange ? (
        <div className="space-y-1.5">
          <Label htmlFor="house-rules" className="ta-label-1">
            Your own instructions
          </Label>
          <Textarea
            id="house-rules"
            className="min-h-32"
            value={houseRules ?? ""}
            maxLength={1500}
            placeholder={"Mention that tips are cash only.\nTell first-time guests to arrive fifteen minutes early.\nDon't discuss other spas."}
            onChange={(e) => onHouseRulesChange(e.target.value)}
          />
          <p className="ta-caption-1 text-muted-foreground">
            One per line — anything you'd tell a new receptionist on their first day.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="ta-caption-1 text-muted-foreground">Add an example:</span>
            {INSTRUCTION_EXAMPLES.map((line) => (
              <Button
                key={line}
                variant="outline"
                size="sm"
                className="h-auto max-w-full py-1 text-left whitespace-normal"
                disabled={(houseRules ?? "").includes(line)}
                onClick={() => {
                  const current = (houseRules ?? "").trimEnd();
                  onHouseRulesChange(current ? `${current}\n${line}` : line);
                }}
              >
                {line}
              </Button>
            ))}
          </div>
          {houseRulesFooter}
        </div>
      ) : null}
    </div>
  );
}

function SessionPreviewPanel({
  load,
  tabs,
  version,
}: {
  load: (which: "draft" | "published") => Promise<SessionPreview>;
  tabs: boolean;
  version?: number;
}) {
  const [which, setWhich] = useState<"draft" | "published">("draft");
  const [model, setModel] = useState<"live" | "backend">("live");
  const [preview, setPreview] = useState<SessionPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function show(next = which) {
    setLoading(true);
    setError(null);
    try {
      setPreview(await load(next));
    } catch (e) {
      setError(toFieldError(e, "Couldn't build the preview.").message);
    } finally {
      setLoading(false);
    }
  }

  // A save changed what a call is told: an open preview would now be showing the old text.
  const shown = useRef(false);
  shown.current = preview !== null;
  const firstVersion = useRef(version);
  useEffect(() => {
    if (version === firstVersion.current || !shown.current) return;
    void show();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read on a new version only
  }, [version]);

  return (
    <div className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="ta-headline-2">What a call is told</p>
          <p className="ta-caption-1 text-muted-foreground">
            Everything the assistant receives, exactly as sent: the rules, your prompts and instructions, and
            what your settings allow right now.
          </p>
        </div>
        <Button variant="outline" onClick={() => void show()} disabled={loading}>
          <Eye className="size-4" />
          {loading ? "Building" : preview ? "Refresh" : "Show"}
        </Button>
      </div>
      {error ? <FieldMessage>{error}</FieldMessage> : null}
      {preview ? (
        <div className="mt-4 space-y-3">
          {preview.promptsOutdated ? (
            <div className="bg-primary/10 ta-caption-1 text-primary rounded-lg p-3">
              Your prompts were edited before the current version. Rebuild them to pick up the latest wording.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {tabs ? (
              <Tabs
                value={which}
                onValueChange={(v) => {
                  setWhich(v as "draft" | "published");
                  void show(v as "draft" | "published");
                }}
              >
                <TabsList>
                  <TabsTrigger value="draft">Test call (draft)</TabsTrigger>
                  <TabsTrigger value="published">Phone line (published)</TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}
            <Tabs value={model} onValueChange={(v) => setModel(v as "live" | "backend")}>
              <TabsList>
                <TabsTrigger value="live">Voice model</TabsTrigger>
                <TabsTrigger value="backend">Back office model</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <p className="ta-caption-1 text-muted-foreground">
            Tools: {preview.tools.join(", ")}. Transfers open now: {preview.transfers.join(", ") || "none"}.{" "}
            {(model === "live" ? preview.live : preview.backend).length.toLocaleString()} characters.
          </p>
          <pre className="bg-muted/40 max-h-[480px] overflow-auto rounded-lg p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap">
            {model === "live" ? preview.live : preview.backend}
          </pre>
        </div>
      ) : null}
    </div>
  );
}


export function TestSection({ children }: { children?: ReactNode }) {
  return (
    <div>
      <SectionIntro>
        Call your assistant from the browser to hear exactly what callers will. Test calls use your draft
        settings, so you can try a transfer or a link before you publish it.
      </SectionIntro>
      {children ?? (
        <div className="bg-muted/40 rounded-xl border border-dashed p-6">
          <p className="ta-label-1">In-app test calls are coming next</p>
          <p className="ta-caption-1 text-muted-foreground mt-1">
            You'll be able to place a test call here, see how each transfer and link would go, and read the
            review afterwards.
          </p>
        </div>
      )}
    </div>
  );
}

/** A plain labelled input, for small typed fields in business-only cards. */
export function TextField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="ta-label-1">
        {label}
      </Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint ? <p className="ta-caption-1 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
