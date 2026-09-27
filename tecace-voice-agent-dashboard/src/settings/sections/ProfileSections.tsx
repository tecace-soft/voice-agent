import { useState, type ReactNode } from "react";
import { Check, Eye } from "lucide-react";
import { KnowledgeEditor } from "@/components/admin/KnowledgeEditor";
import { PromptEditor } from "@/components/admin/PromptEditor";
import { SchedulePanel } from "@/components/public/SchedulePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { BusinessProfile as DemoBusinessProfile, CallSound, CustomerPrompts } from "@/lib/types";
import type { BehaviourDefault, SessionPreview } from "../../api/types";
import { displayPhone } from "../callSettings";
import { SectionIntro } from "../SettingsShell";
import { FieldMessage, toFieldError } from "./shared";
import { GREETING_EXAMPLES, INSTRUCTION_EXAMPLES, Tips } from "../examples";

// The settings sections that edit what the receptionist knows and how it sounds. Each is a
// controlled editor; the container decides whether it saves itself (a business, with `footer`) or
// rides on the page's own Save (a demo).

export function BusinessInfoSection({
  profile,
  onChange,
  agentName,
  source,
  footer,
}: {
  profile: DemoBusinessProfile | null;
  onChange: (profile: DemoBusinessProfile) => void;
  agentName: string;
  /** Business only: the description card and its re-read. */
  source?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div>
      <SectionIntro>
        What the assistant knows about your business and answers callers from. If something here is wrong,
        callers hear it wrong — anything not here, it says it doesn't know.
      </SectionIntro>
      {source}
      {profile ? (
        <>
          <KnowledgeEditor
            profile={profile}
            onChange={onChange}
            sections={["details", "hours", "services", "policies", "highlights"]}
          />
          {footer}
          <div className="mt-8">
            <p className="ta-headline-2 mb-2">Your week, as the assistant sees it</p>
            <SchedulePanel profile={profile} agentName={agentName} />
          </div>
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
}: {
  profile: DemoBusinessProfile | null;
  onChange: (profile: DemoBusinessProfile) => void;
  footer?: ReactNode;
}) {
  return (
    <div>
      <SectionIntro>
        Questions callers ask, and the answer you want them to get — up to 20. Write answers the way you'd
        say them on the phone: spell a web address out as words, and keep schedules and price lists in
        Business information instead.
      </SectionIntro>
      {profile ? (
        <>
          <KnowledgeEditor profile={profile} onChange={onChange} sections={["faqs"]} />
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
}) {
  const [advanced, setAdvanced] = useState(false);
  return (
    <div>
      <SectionIntro>
        How the assistant behaves on your calls. The standard rules below apply to every call and can't be
        switched off; add your own instructions on top of them.
      </SectionIntro>

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

      <div className="mt-8 border-t pt-6">
        <Button variant="outline" onClick={() => setAdvanced(!advanced)}>
          {advanced ? "Hide advanced" : "Advanced: prompts"}
        </Button>
        {advanced ? (
          <div className="mt-4 space-y-6">
            <p className="ta-caption-1 text-muted-foreground max-w-2xl">
              The persona and knowledge prompts are generated from your settings. Edit them only if you need
              to; once edited they stop following your settings until you rebuild. The rules and your
              transfers, links and message scenarios are added at call time — see the preview.
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
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={onRebuild} disabled={rebuilding}>
                {rebuilding ? "Rebuilding" : "Rebuild from settings"}
              </Button>
              {promptsFooter}
            </div>
            {loadPreview ? <SessionPreviewPanel load={loadPreview} tabs={previewTabs} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SessionPreviewPanel({
  load,
  tabs,
}: {
  load: (which: "draft" | "published") => Promise<SessionPreview>;
  tabs: boolean;
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

export function LaunchSection({
  agentNumber,
  live,
  published,
  checklist,
  onOpenForwarding,
}: {
  agentNumber: string | null;
  /** The business has enough information to answer as itself. */
  live: boolean;
  /** Call settings have been published at least once and nothing is waiting. */
  published: boolean;
  /** Anything else worth a line, e.g. SMS registration. */
  checklist?: { done: boolean; label: string; hint?: string }[];
  /** Opens the Call forwarding section, which has the codes. */
  onOpenForwarding?: () => void;
}) {
  const steps = [
    { done: live, label: "Business information is filled in", hint: "At least your name and what you do." },
    { done: Boolean(agentNumber), label: "A phone number is assigned to your assistant", hint: "Your administrator assigns it." },
    { done: published, label: "Transfers, links and messages are published", hint: "Publish from any of those sections." },
    ...(checklist ?? []),
  ];
  return (
    <div>
      <SectionIntro>
        How to switch your line over to the assistant. Most businesses forward calls when they're busy or
        don't pick up, so the assistant catches what they miss.
      </SectionIntro>

      <ul className="mb-6 space-y-2">
        {steps.map((step) => (
          <li key={step.label} className="flex items-start gap-3">
            <span
              className={`ta-caption-2 mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full ${
                step.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
              aria-hidden
            >
              {step.done ? <Check className="size-3" /> : null}
            </span>
            <span>
              <span className="ta-label-1 block">{step.label}</span>
              {!step.done && step.hint ? <span className="ta-caption-1 text-muted-foreground">{step.hint}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      {agentNumber ? (
        <>
          <div className="bg-primary/5 mb-6 rounded-xl border p-4">
            <p className="ta-caption-1 text-muted-foreground">Your assistant's number</p>
            <p className="ta-headline-1">{displayPhone(agentNumber)}</p>
          </div>
          <p className="ta-headline-2 mb-2">Forward your calls</p>
          <p className="ta-body-2 text-muted-foreground mb-3">
            Point your business line at this number — for missed calls or every call. Callers keep dialling the
            number they know.
          </p>
          {onOpenForwarding ? <Button onClick={onOpenForwarding}>Set up call forwarding</Button> : null}
        </>
      ) : (
        <p className="ta-body-2 text-muted-foreground">Once a number is assigned, forward your calls to it — see Call forwarding.</p>
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
