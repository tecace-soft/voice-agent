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
  saveBusinessPrompts,
  saveCallSettingsDraft,
  saveHouseRules,
  setWaterfallAllowed,
} from "../api/backend";
import type { AgentNumber, BehaviourDefault, BusinessProfile, Readiness } from "../api/types";
import { accountErrorMessage } from "../auth";
import type { SectionId } from "../routing";
import { displayPhone, withDefaults, type CallSettings, type StoredCallSettings } from "./callSettings";
import { SaveRow, SettingsShell, type Phase, type SettingsSection } from "./SettingsShell";
import { useAutosave, type AutosaveView } from "./useAutosave";
import { businessInfoProblem, faqsProblem } from "./sectionChecks";
import { PublishControl, makeUpdater, type CallSettingsBinding } from "./sections/shared";
import { TransferCallsSection } from "./sections/TransferCallsSection";
import { AppointmentsSection } from "./sections/AppointmentsSection";
import { TextLinkSection } from "./sections/TextLinkSection";
import { TakeMessageSection } from "./sections/TakeMessageSection";
import { ForwardingSection } from "./sections/ForwardingSection";
import { LaunchGuide } from "./sections/LaunchGuide";
import { RequestGoLive } from "./sections/RequestGoLive";
import { BusinessTestConsole, BusinessTestSection, useTestCalls } from "./sections/TestSection";
import { GuidedSetupSection } from "./sections/GuidedSetupSection";
import { SetupBoard } from "./setup/SetupBoard";
import { useGuidedSetup } from "./setup/useGuidedSetup";
import {
  AgentProfileSection,
  BusinessInfoSection,
  CustomTrainingSection,
  FaqsSection,
  type AgentFields,
} from "./sections/ProfileSections";

// A real business's receptionist settings: the shared shell, with every section saving to its own
// endpoint — the same split the old cards and tabs had, because a business's settings are stored
// separately on purpose (editing a greeting must never reword what the assistant knows).
//
// The three call-settings sections save a DRAFT, published from the settings bar; callers keep the
// published copy until it is pressed, and the test call beside the settings uses the draft.
// Business information, Agent profile, FAQs and House rules save themselves a moment after typing
// stops (useAutosave; Save now does it at once). They have no draft, so the pause, and holding back
// a section that doesn't pass (a cleared business name), is what keeps half an edit from callers.
// The prompt editor still saves on its button: saving it freezes the prompts as a hand edit.
//
// Mounted once per account (BusinessPage keys it by user id), so a draft never crosses accounts.

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
  /** Onboarding: the Go live checklist and any go-live request (`GET /business/readiness`). */
  readiness?: Readiness | null;
  /** The business itself may request go live; an admin looking at its settings may not. */
  canRequestLive?: boolean;
  onReadinessChanged?: (next: Readiness) => void;
  /** After a publish: the page re-reads the checklist ("Call settings are published"). */
  onPublished?: () => void;
  /** Where the guided setup stands, so the page can offer it to a business that hasn't started it. */
  onSetupState?: (state: { available: boolean; hasSession: boolean }) => void;
};

/** The sections that save themselves. */
type Autosaved = "knowledge" | "faqs" | "agent" | "rules";
/** The saves still made on a button. */
type Saving = "prompts" | "rebuild" | null;

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
  const [error, setError] = useState<{ where: Saving; message: string } | null>(null);
  const [calls, setCalls] = useState<StoredCallSettings | null>(null);
  const [callsError, setCallsError] = useState<string | null>(null);
  const test = useTestCalls(userId);

  // The business profile as last saved from here. Business information and FAQs each send their own
  // part laid over it, so it must be what the server holds NOW — taken from each save's answer, never
  // from the page's props, which a slower re-read can bring back older than a save that just landed.
  const serverProfile = useRef(profile.profile);
  // Profile saves go one at a time, in order: two sections saving at once would each lay their part
  // over the same old profile, and the later answer would undo the earlier section.
  const profileQueue = useRef<Promise<unknown>>(Promise.resolve());

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

  /**
   * What a save takes back from the saved row. The sections that save themselves keep their own
   * draft — the person may be typing into it while the save is on its way — so only the prompts
   * follow.
   */
  function adopt(which: Autosaved | Exclude<Saving, null>, next: BusinessProfile) {
    serverProfile.current = next.profile;
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
    // A save made of two requests reports the first as soon as it lands, so a failure in the second
    // leaves the page showing what really was saved.
    const partial = (next: BusinessProfile) => {
      adopt(which, next);
      props.onSaved(next);
    };
    try {
      const { profile: next } = await action(partial);
      partial(next);
    } catch (e) {
      setError({ where: which, message: accountErrorMessage(e, failure) });
    } finally {
      setSaving(null);
    }
  }

  /** A self-saving section's save, queued behind any other profile save. Throws on a refusal. */
  function persist(
    which: Autosaved,
    action: (saved: (next: BusinessProfile) => void) => Promise<{ profile: BusinessProfile }>,
  ): Promise<void> {
    const step = profileQueue.current
      .catch(() => undefined)
      .then(async () => {
        // A save made of two requests reports the first as soon as it lands, so a failure in the
        // second leaves the page showing what really was saved.
        const partial = (next: BusinessProfile) => {
          adopt(which, next);
          props.onSaved(next);
        };
        const { profile: next } = await action(partial);
        partial(next);
      });
    profileQueue.current = step;
    return step;
  }

  // Business information and FAQs edit one profile, but each sends only its own part, laid over what
  // is saved — so saving the questions never sends half-finished business details, and the reverse.
  const saveKnowledge = (which: "knowledge" | "faqs") =>
    persist(which, () => {
      const saved = serverProfile.current;
      if (!knowledge || !saved) return Promise.reject(new Error("There's nothing to save yet."));
      const body = which === "faqs" ? { ...saved, faqs: knowledge.faqs } : { ...knowledge, faqs: saved.faqs };
      return saveBusinessKnowledge(body, userId);
    });

  const saveAgent = () =>
    persist("agent", async (saved) => {
      saved((await saveAgentIdentity(agent.agentName.trim(), (agent.greeting ?? "").trim(), userId)).profile);
      // Voice and language live with the prompts, which follow the new name and greeting too.
      try {
        return await saveBusinessPrompts({ voice: agent.voice, language: agent.language }, userId);
      } catch (e) {
        throw new Error(
          accountErrorMessage(e, "The name and greeting saved, but the voice and language didn't. Try again."),
        );
      }
    });

  const saveError = (e: unknown) => accountErrorMessage(e, "Couldn't save that. Nothing was changed.");
  const knowledgeSave = useAutosave({
    // Everything but the questions, which save on their own.
    value: knowledge ? { ...knowledge, faqs: null } : null,
    save: () => saveKnowledge("knowledge"),
    validate: () => businessInfoProblem(knowledge),
    errorMessage: saveError,
  });
  const faqsSave = useAutosave({
    value: knowledge?.faqs ?? null,
    save: () => saveKnowledge("faqs"),
    validate: () => faqsProblem(knowledge),
    errorMessage: saveError,
  });
  const agentSave = useAutosave({ value: agent, save: saveAgent, errorMessage: saveError });
  const rulesSave = useAutosave({
    value: rules,
    save: () => persist("rules", () => saveHouseRules(rules.trim(), userId)),
    errorMessage: saveError,
  });

  // Leaving a section, the tab going to the background, or anything that reloads these settings
  // saves what is waiting first; closing the tab with something unsaved asks.
  const autosaves = [knowledgeSave, faqsSave, agentSave, rulesSave];
  const flushAll = () => Promise.all(autosaves.map((view) => view.flush())).then(() => undefined);
  const flushRef = useRef(flushAll);
  flushRef.current = flushAll;
  const unsaved = autosaves.some((view) => view.dirty || view.status === "saving");
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  const openSection = (id: SectionId) => {
    void flushAll();
    props.onSection(id);
  };

  const footer = (view: AutosaveView, note?: string) => (
    <SaveRow state={view} onSave={() => void view.flush()} note={note} />
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
    props.onPublished?.();
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
        <Button onClick={() => void flushAll().finally(props.onReread)} disabled={props.rereading}>
          {props.rereading ? "Reading it again…" : "Read my details again"}
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => void flushAll().finally(props.onEditDescription)}>
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
          source={source}
          footer={footer(knowledgeSave)}
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
          onOpenSection={openSection}
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
          footer={footer(agentSave)}
        />
      ),
    },
    {
      id: "faqs",
      render: () => (
        <FaqsSection
          profile={knowledge}
          onChange={setKnowledge}
          footer={footer(faqsSave)}
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
          houseRulesFooter={footer(rulesSave)}
          prompts={prompts}
          onPromptsChange={setPrompts}
          rebuilding={saving === "rebuild"}
          onRebuild={() => void run("rebuild", () => saveBusinessPrompts({ rebuild: true }, userId))}
          promptsFooter={
            <>
              {error ? (
                <p className="ta-label-1 text-destructive" role="alert">
                  {error.message}
                </p>
              ) : null}
              <Button onClick={() => void run("prompts", () => saveBusinessPrompts({ prompts }, userId))} disabled={saving !== null}>
                {saving === "prompts" ? "Saving" : "Save prompts"}
              </Button>
            </>
          }
          loadPreview={(which) => getSessionPreview(which, userId)}
          promptsFrozen={savedPrompts.edited}
          previewVersion={previewVersion}
        />
      ),
    },
    { id: "test", render: () => <BusinessTestSection test={test} /> },
    {
      id: "launch",
      render: () => (
        <LaunchGuide
          phase={phase}
          audience="business"
          agentName={agent.agentName}
          agentNumber={props.number?.phoneE164 ?? null}
          questions={suggestedQuestions({ faqs: knowledge?.faqs ?? [] }, undefined, 3)}
          readiness={props.readiness}
          requestSlot={
            props.readiness && phase === "onboarding" ? (
              <RequestGoLive
                readiness={props.readiness}
                canRequest={Boolean(props.canRequestLive)}
                onChanged={(next) => props.onReadinessChanged?.(next)}
                variant="card"
              />
            ) : null
          }
          onOpenSection={openSection}
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
      onSelect={openSection}
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
                onEdit={setup.available ? openSection : undefined}
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
          <span className="ta-caption-1 text-muted-foreground whitespace-nowrap">Changes save automatically</span>
        )
      }
    />
  );
}
