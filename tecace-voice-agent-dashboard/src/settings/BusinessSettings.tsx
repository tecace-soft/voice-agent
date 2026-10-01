import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import type { BusinessProfile as DemoBusinessProfile, CustomerPrompts } from "@/lib/types";
import { DEFAULT_VOICE } from "@/lib/types";
import { quotedGreeting } from "@/lib/prompt";
import { suggestedQuestions } from "@/lib/proof";
import {
  getCallSettings,
  getSessionPreview,
  publishCallSettings,
  saveAgentIdentity,
  saveBusinessKnowledge,
  researchBusinessProfile,
  type BusinessResearchInputs,
  saveBusinessPrompts,
  saveCallSettingsDraft,
  saveHouseRules,
  setWaterfallAllowed,
} from "../api/backend";
import type { AgentNumber, BehaviourDefault, BusinessProfile } from "../api/types";
import { accountErrorMessage } from "../auth";
import type { SectionId } from "../routing";
import { displayPhone, withDefaults, type CallSettings, type StoredCallSettings } from "./callSettings";
import { SaveRow, SettingsShell, type Phase, type SettingsSection } from "./SettingsShell";
import { PublishControl, makeUpdater, type CallSettingsBinding } from "./sections/shared";
import { TransferCallsSection } from "./sections/TransferCallsSection";
import { AppointmentsSection } from "./sections/AppointmentsSection";
import { TextLinkSection } from "./sections/TextLinkSection";
import { TakeMessageSection } from "./sections/TakeMessageSection";
import { ForwardingSection } from "./sections/ForwardingSection";
import { LaunchGuide } from "./sections/LaunchGuide";
import { BusinessTestConsole, BusinessTestSection, useTestCalls } from "./sections/TestSection";
import { GuidedSetupSection } from "./sections/GuidedSetupSection";
import { ResearchFillCard, type ResearchOutcome } from "./sections/ResearchFillCard";
import { mergeResearch } from "./researchMerge";
import { SetupBoard } from "./setup/SetupBoard";
import { useGuidedSetup } from "./setup/useGuidedSetup";
import {
  AgentProfileSection,
  BusinessInfoSection,
  CustomTrainingSection,
  FaqsSection,
  type AgentFields,
} from "./sections/ProfileSections";
import { ScenarioTestsSection } from "./scenarios/ScenarioTestsSection";

// A real business's receptionist settings: the shared shell, with every section saving to its own
// endpoint — the same split the old cards and tabs had, because a business's settings are stored
// separately on purpose (editing a greeting must never reword what the assistant knows).
//
// The three call-settings sections save a DRAFT, published from the settings bar; callers keep the
// published copy until it is pressed, and the test call beside the settings uses the draft.
// Everything else saves straight through, as before.

type Props = {
  profile: BusinessProfile;
  number: AgentNumber | null;
  standard: BehaviourDefault[];
  needsReread: boolean;
  factsStale: boolean;
  rereading: boolean;
  onReread: () => void;
  onEditDescription: () => void;
  /** Whose settings, when an admin is acting for a customer. */
  userId?: string;
  isAdmin: boolean;
  section: SectionId | undefined;
  onSection: (section: SectionId) => void;
  onSaved: (profile: BusinessProfile) => void;
  /** Where the account is, when the page knows better than the profile (an account being set up). */
  phase?: Phase;
  /** A line across the top of the studio: the Go live checklist, a line that isn't answering yet. */
  notice?: ReactNode;
  /** Where the guided setup stands, so the page can offer it to a business that hasn't started it. */
  onSetupState?: (state: { available: boolean; hasSession: boolean }) => void;
};

type Saving = "knowledge" | "faqs" | "agent" | "rules" | "prompts" | "rebuild" | null;

const NO_PROMPTS: CustomerPrompts = { live: "", backend: "", greeting: "", edited: false };

const sameText = (a: CustomerPrompts, b: CustomerPrompts) =>
  a.live === b.live && a.backend === b.backend && a.greeting === b.greeting;

function agentOf(profile: BusinessProfile): AgentFields {
  return {
    agentName: profile.agentName ?? "",
    voice: profile.voice ?? DEFAULT_VOICE,
    language: profile.language ?? "",
    greeting: profile.greeting ?? "",
  };
}

export function BusinessSettings(props: Props) {
  const { profile, userId } = props;
  const [knowledge, setKnowledge] = useState<DemoBusinessProfile | null>(profile.profile);
  const [agent, setAgent] = useState<AgentFields>(() => agentOf(profile));
  const [rules, setRules] = useState(profile.houseRules ?? "");
  const [prompts, setPrompts] = useState<CustomerPrompts>(profile.prompts ?? NO_PROMPTS);
  // What the server holds, so the editor can tell a person's unsaved typing from text a save made
  // stale — and so "edited by hand" means saved that way, not merely typed into.
  const [savedPrompts, setSavedPrompts] = useState<CustomerPrompts>(profile.prompts ?? NO_PROMPTS);
  const savedPromptsRef = useRef(savedPrompts);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [saving, setSaving] = useState<Saving>(null);
  const [saved, setSaved] = useState<Saving>(null);
  const [error, setError] = useState<{ where: Saving; message: string } | null>(null);
  const [calls, setCalls] = useState<StoredCallSettings | null>(null);
  const [callsError, setCallsError] = useState<string | null>(null);
  const test = useTestCalls(userId);
  // "Fill in from research" (Business information). The form before the run is kept for Undo.
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchOutcome, setResearchOutcome] = useState<ResearchOutcome | null>(null);
  const beforeResearch = useRef<DemoBusinessProfile | null>(null);

  // Drafts start over only when the account changes (an admin switching customer). A save in one
  // section must not reset the others: each section takes its own saved value back in `run`, and
  // every other section keeps whatever the person has typed but not saved yet.
  const accountRef = useRef(profile.userId);
  useEffect(() => {
    if (accountRef.current === profile.userId) return;
    accountRef.current = profile.userId;
    setKnowledge(profile.profile);
    setAgent(agentOf(profile));
    setRules(profile.houseRules ?? "");
    setPrompts(profile.prompts ?? NO_PROMPTS);
    savedPromptsRef.current = profile.prompts ?? NO_PROMPTS;
    setSavedPrompts(savedPromptsRef.current);
    setSaved(null);
    setError(null);
    setResearchOutcome(null);
    setResearchError(null);
  }, [profile]);

  // Call-settings saves are applied to the latest value and made one at a time (see makeUpdater).
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const latestCalls = useRef<CallSettings>(withDefaults(null));
  const callsQueue = useRef<Promise<unknown>>(Promise.resolve());
  const updateCalls = useRef(
    makeUpdater(
      latestCalls,
      async (next) => {
        const updated = await saveCallSettingsDraft(next, userIdRef.current);
        const draft = withDefaults(updated.draft);
        setCalls({ ...updated, draft });
        return draft;
      },
      callsQueue,
    ),
  );

  const loadCalls = useCallback(() => {
    getCallSettings(userId)
      .then((stored) => {
        const draft = withDefaults(stored.draft);
        latestCalls.current = draft;
        setCalls({ ...stored, draft });
        setCallsError(null);
      })
      .catch((e) => setCallsError(accountErrorMessage(e, "Couldn't load transfers and links.")));
  }, [userId]);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  // The guided setup writes the same call-settings draft the sections edit. Every draft a turn
  // returns is adopted into BOTH the ref and the state — the ref is what the next section save is
  // applied to, so leaving it behind would PUT a stale draft over the consultant's write — and each
  // turn waits its place on `callsQueue` behind any section save in flight.
  const setup = useGuidedSetup(userId, {
    onDraft: (draft, dirty) => {
      latestCalls.current = draft;
      setCalls((c) => (c ? { ...c, draft, dirty } : c));
    },
    queue: callsQueue,
  });
  // Two booleans, not the session: a new session object arrives with every turn, and the page only
  // needs to know whether to offer the interview.
  const onSetupStateRef = useRef(props.onSetupState);
  onSetupStateRef.current = props.onSetupState;
  const hasSession = setup.session !== null;
  useEffect(() => {
    onSetupStateRef.current?.({ available: setup.available, hasSession });
  }, [setup.available, hasSession]);

  // The side panel on the guided setup: the settings board, over a console that stays mounted.
  const guided = props.section === "guided-setup";
  const [asideView, setAsideView] = useState<"board" | "console">("board");
  const [callActive, setCallActive] = useState(false);
  useEffect(() => {
    if (!guided) setAsideView("board");
  }, [guided]);
  const boardDraft = calls?.draft ?? setup.draft;
  const showBoard = guided && asideView === "board" && Boolean(boardDraft);
  // The console draws its own header; so does the board. Anywhere else with no console (its
  // settings didn't load), the shell keeps its "Test call" header around the status line.
  const asideBare = Boolean(calls) || (guided && Boolean(boardDraft));
  const highlightIds = useMemo(() => new Set(setup.highlightIds), [setup.highlightIds]);

  /** What a successful save of each section takes back from the saved row — and nothing else. */
  function adopt(which: Exclude<Saving, null>, next: BusinessProfile) {
    if (which === "knowledge") {
      // Business information: everything but the questions, which keep their own draft.
      setKnowledge((draft) => (next.profile ? { ...next.profile, faqs: draft?.faqs ?? next.profile.faqs } : draft));
    } else if (which === "faqs") {
      setKnowledge((draft) => (draft && next.profile ? { ...draft, faqs: next.profile.faqs } : draft));
    } else if (which === "agent") {
      setAgent(agentOf(next));
    } else if (which === "rules") {
      setRules(next.houseRules ?? "");
    }
    // Every save answers with the stored prompts, and a knowledge, FAQ or agent save rebuilds them
    // when nobody edited them by hand. The editor follows — unless the person has typed into it
    // and not saved yet. Left showing the old text, "Save prompts" would freeze that old text as a
    // hand edit and quietly undo the save that rebuilt it.
    const incoming = next.prompts ?? NO_PROMPTS;
    const before = savedPromptsRef.current;
    savedPromptsRef.current = incoming;
    setSavedPrompts(incoming);
    setPrompts((shown) => (which === "prompts" || which === "rebuild" || sameText(shown, before) ? incoming : shown));
    setPreviewVersion((v) => v + 1);
  }

  async function run(
    which: Exclude<Saving, null>,
    action: (saved: (next: BusinessProfile) => void) => Promise<{ profile: BusinessProfile }>,
    failure = "Couldn't save that. Nothing was changed.",
  ) {
    setSaving(which);
    setError(null);
    setSaved(null);
    // A save made of two requests reports the first as soon as it lands, so a failure in the second
    // leaves the page showing what really was saved.
    const partial = (next: BusinessProfile) => {
      adopt(which, next);
      props.onSaved(next);
    };
    try {
      const { profile: next } = await action(partial);
      partial(next);
      setSaved(which);
    } catch (e) {
      setError({ where: which, message: accountErrorMessage(e, failure) });
    } finally {
      setSaving(null);
    }
  }

  const footer = (which: Exclude<Saving, null>, onSave: () => void, note?: string) => (
    <>
      {error?.where === which ? (
        <p className="ta-label-1 text-destructive mt-4" role="alert">
          {error.message}
        </p>
      ) : null}
      <SaveRow
        onSave={onSave}
        saving={saving === which}
        disabled={saving !== null}
        saved={saved === which ? "Saved. This is what the assistant now uses." : null}
        note={note}
      />
    </>
  );

  // Business information and FAQs edit one profile, but each Save sends only its own part, laid over
  // what is saved — so saving the questions never publishes half-finished business details.
  const saveKnowledge = (which: "knowledge" | "faqs") => {
    const saved = profile.profile;
    if (!knowledge || !saved) return;
    const body = which === "faqs" ? { ...saved, faqs: knowledge.faqs } : { ...knowledge, faqs: saved.faqs };
    void run(which, () => saveBusinessKnowledge(body, userId));
  };

  // Research fills the form; it saves nothing. The business checks what changed and presses Save.
  const runResearch = async (inputs: BusinessResearchInputs) => {
    setResearching(true);
    setResearchError(null);
    setResearchOutcome(null);
    try {
      const result = await researchBusinessProfile(inputs, userId);
      beforeResearch.current = knowledge;
      const merged = mergeResearch(knowledge, result.profile);
      setKnowledge(merged.profile);
      setResearchOutcome({ ...merged, sources: result.sources });
    } catch (e) {
      setResearchError(accountErrorMessage(e, "The research didn't finish. Nothing in the form was changed."));
    } finally {
      setResearching(false);
    }
  };
  const undoResearch = () => {
    setKnowledge(beforeResearch.current);
    setResearchOutcome(null);
  };

  const saveAgent = () =>
    void run(
      "agent",
      async (saved) => {
        saved((await saveAgentIdentity(agent.agentName.trim(), (agent.greeting ?? "").trim(), userId)).profile);
        // Voice and language live with the prompts, which follow the new name and greeting too.
        return saveBusinessPrompts({ voice: agent.voice, language: agent.language }, userId);
      },
      "The name and greeting may have saved, but the voice and language didn't. Try Save again.",
    );

  const bindingFor = (stored: StoredCallSettings): CallSettingsBinding => ({
    value: stored.draft,
    mode: "business",
    businessName: profile.businessName ?? profile.profile?.name ?? "",
    agentNumber: stored.agentNumber,
    waterfallAllowed: stored.waterfallAllowed,
    update: updateCalls.current,
  });

  const publish = async () => {
    // After any save still in flight, so what is published is what the screen shows.
    await callsQueue.current.catch(() => undefined);
    const updated = await publishCallSettings(userId);
    const draft = withDefaults(updated.draft);
    latestCalls.current = draft;
    setCalls({ ...updated, draft });
  };

  const callsSection = (render: (binding: CallSettingsBinding) => ReactNode) => () =>
    calls ? (
      render(bindingFor(calls))
    ) : (
      <p className={callsError ? "ta-body-2 text-destructive" : "ta-body-2 text-muted-foreground"}>
        {callsError ?? "Loading…"}
      </p>
    );

  const legacyTransfer =
    profile.transferNumber && calls && calls.draft.transfer.scenarios.length === 0 ? (
      <div className="bg-primary/5 ta-caption-1 text-primary mb-5 rounded-lg px-3 py-2.5">
        Callers who ask for a person are put through to {displayPhone(profile.transferNumber)}, the number you set
        up before transfer scenarios existed. Add a transfer and publish it to replace that.
      </div>
    ) : null;

  const waterfallAdmin =
    props.isAdmin && userId && calls ? (
      <label className="mb-5 flex items-center justify-between gap-4 border-y py-2.5">
        <span>
          <span className="ta-label-1 block">Waterfall transfers on this account</span>
          <span className="ta-caption-1 text-muted-foreground">Admin only. A higher-plan feature.</span>
        </span>
        <Switch
          checked={calls.waterfallAllowed}
          onCheckedChange={(allowed) =>
            void setWaterfallAllowed(userId, allowed)
              .then((updated) => {
                const draft = withDefaults(updated.draft);
                latestCalls.current = draft;
                setCalls({ ...updated, draft });
                setCallsError(null);
              })
              .catch((e) => setCallsError(accountErrorMessage(e, "Couldn't change waterfall for this account.")))
          }
          aria-label="Allow waterfall transfers"
        />
      </label>
    ) : null;

  const source = (
    <div className="bg-muted/40 mb-6 flex flex-wrap items-center gap-3 rounded-xl border p-4">
      <div className="min-w-0 flex-1">
        <p className="ta-label-1">Your business, in your own words</p>
        <p className="ta-caption-1 text-muted-foreground">
          {props.needsReread
            ? "We haven't read your description into the form below yet."
            : props.factsStale
              ? "Read by an older version of the assistant — reading it again may pick up more."
              : "The description everything below was first read from. Edit it and we read it again."}
        </p>
      </div>
      {props.needsReread || props.factsStale ? (
        <Button onClick={props.onReread} disabled={props.rereading}>
          {props.rereading ? "Reading it again…" : "Read my details again"}
        </Button>
      ) : null}
      <Button variant="outline" onClick={props.onEditDescription}>
        Edit description
      </Button>
    </div>
  );

  const phase: Phase = props.phase ?? (profile.isLive && props.number ? "live" : "onboarding");

  const businessName = profile.businessName ?? profile.profile?.name ?? "";

  const sections: SettingsSection[] = [
    {
      id: "business-info",
      render: () => (
        <BusinessInfoSection
          profile={knowledge}
          onChange={setKnowledge}
          source={
            <>
              {source}
              {knowledge ? (
                <ResearchFillCard
                  defaults={{ businessName, websiteUrl: knowledge.website ?? profile.website ?? "" }}
                  running={researching}
                  error={researchError}
                  outcome={researchOutcome}
                  onRun={(inputs) => void runResearch(inputs)}
                  onUndo={undoResearch}
                  onOpenFaqs={() => props.onSection("faqs")}
                />
              ) : null}
            </>
          }
          footer={footer("knowledge", () => {
            setResearchOutcome(null);
            saveKnowledge("knowledge");
          })}
          promptsFrozen={savedPrompts.edited}
        />
      ),
    },
    // Not first: the shell opens sections[0] when none is chosen. The menu order is SECTION_GROUPS'.
    {
      id: "guided-setup",
      render: () => (
        <GuidedSetupSection
          setup={setup}
          onOpenSection={props.onSection}
          onPublish={publish}
          dirty={Boolean(calls?.dirty)}
        />
      ),
    },
    {
      id: "agent-profile",
      render: () => (
        <AgentProfileSection
          value={agent}
          onChange={setAgent}
          businessName={profile.businessName ?? ""}
          footer={footer("agent", saveAgent)}
        />
      ),
    },
    {
      id: "faqs",
      render: () => (
        <FaqsSection
          profile={knowledge}
          onChange={setKnowledge}
          footer={footer("faqs", () => saveKnowledge("faqs"))}
          promptsFrozen={savedPrompts.edited}
        />
      ),
    },
    {
      id: "take-message",
      badge: calls?.dirty ? "Draft" : undefined,
      render: callsSection((binding) => <TakeMessageSection binding={binding} />),
    },
    {
      id: "appointments",
      render: callsSection((binding) => <AppointmentsSection binding={binding} userId={userId} />),
    },
    {
      id: "text-link",
      badge: calls?.dirty ? "Draft" : undefined,
      render: callsSection((binding) => <TextLinkSection binding={binding} />),
    },
    {
      id: "transfers",
      badge: calls?.dirty ? "Draft" : undefined,
      render: callsSection((binding) => (
        <TransferCallsSection
          binding={binding}
          notes={
            <>
              {legacyTransfer}
              {waterfallAdmin}
            </>
          }
        />
      )),
    },
    {
      id: "custom-training",
      render: () => (
        <CustomTrainingSection
          standard={props.standard}
          houseRules={rules}
          onHouseRulesChange={setRules}
          houseRulesFooter={footer("rules", () => void run("rules", () => saveHouseRules(rules.trim(), userId)))}
          prompts={prompts}
          onPromptsChange={setPrompts}
          rebuilding={saving === "rebuild"}
          onRebuild={() => void run("rebuild", () => saveBusinessPrompts({ rebuild: true }, userId))}
          promptsFooter={
            <Button onClick={() => void run("prompts", () => saveBusinessPrompts({ prompts }, userId))} disabled={saving !== null}>
              {saving === "prompts" ? "Saving" : "Save prompts"}
            </Button>
          }
          loadPreview={(which) => getSessionPreview(which, userId)}
          promptsFrozen={savedPrompts.edited}
          previewVersion={previewVersion}
        />
      ),
    },
    { id: "test", render: () => <BusinessTestSection test={test} /> },
    // Admin only: the menu only lists sections that are in this array (SettingsShell filters by it).
    ...(props.isAdmin && userId
      ? [{ id: "scenario-tests" as const, render: () => <ScenarioTestsSection key={userId} userId={userId} /> }]
      : []),
    {
      id: "launch",
      render: () => (
        <LaunchGuide
          phase={phase}
          audience="business"
          agentName={agent.agentName}
          agentNumber={props.number?.phoneE164 ?? null}
          questions={suggestedQuestions({ faqs: knowledge?.faqs ?? [] }, undefined, 3)}
          checklist={[
            { done: profile.isLive, label: "Business information is filled in", hint: "At least your name and what you do." },
            { done: Boolean(props.number), label: "A phone number is assigned to your assistant", hint: "We assign it." },
            {
              done: Boolean(calls?.publishedAt) && !calls?.dirty,
              label: "Transfers, links and messages are published",
              hint: "Publish from any of those sections.",
            },
          ]}
          onOpenSection={props.onSection}
        />
      ),
    },
    {
      id: "forwarding",
      guide: true,
      render: () => <ForwardingSection agentNumber={props.number?.phoneE164 ?? null} />,
    },
  ];

  const PUBLISHED_SECTIONS: SectionId[] = ["transfers", "text-link", "take-message", "guided-setup"];

  const callsStatus = (
    <p className={callsError ? "ta-body-2 text-destructive" : "ta-body-2 text-muted-foreground"}>
      {callsError ?? "Loading…"}
    </p>
  );

  // The aside, and the test console must never unmount while a call may be running (see SettingsShell).
  // Only when this section is open, the settings board sits over the console, which is then hidden with
  // CSS, never removed: the tree below keeps the console in the same place whichever is showing.
  return (
    <SettingsShell
      sections={sections}
      active={props.section}
      onSelect={props.onSection}
      phase={phase}
      asideTitle={guided ? "Settings board" : "Test call"}
      asideBadge="Uses your draft"
      asideBare={asideBare}
      notice={props.notice}
      aside={
        boardDraft ? (
          <div className="flex h-full min-h-0 flex-col">
            {showBoard ? (
              <SetupBoard
                draft={boardDraft}
                dirty={calls?.dirty ?? setup.dirty}
                publishedAt={calls?.publishedAt ?? null}
                topics={setup.session?.topics ?? null}
                highlightIds={highlightIds}
                onEdit={setup.available ? props.onSection : undefined}
                onShowConsole={() => setAsideView("console")}
                callActive={callActive}
              />
            ) : null}
            <div className={showBoard ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
              {guided ? (
                <button
                  type="button"
                  className="ta-caption-1 text-primary border-b px-4 py-2 text-left hover:underline"
                  onClick={() => setAsideView("board")}
                >
                  ‹ Back to the settings board
                </button>
              ) : null}
              {calls ? (
                <BusinessTestConsole
                  test={test}
                  userId={userId}
                  profileUserId={profile.userId}
                  settings={calls.draft}
                  businessName={businessName}
                  agentNumber={calls.agentNumber}
                  agentName={agent.agentName || undefined}
                  greetingLine={quotedGreeting(prompts.greeting)}
                  onCallState={setCallActive}
                />
              ) : (
                <div className={asideBare ? "p-4" : undefined}>{callsStatus}</div>
              )}
            </div>
          </div>
        ) : (
          callsStatus
        )
      }
      toolbar={(current) =>
        calls && (PUBLISHED_SECTIONS.includes(current) || calls.dirty) ? (
          <PublishControl dirty={calls.dirty} publishedAt={calls.publishedAt} onPublish={publish} />
        ) : (
          <span className="ta-caption-1 text-muted-foreground whitespace-nowrap">Each section saves on its own</span>
        )
      }
    />
  );
}
