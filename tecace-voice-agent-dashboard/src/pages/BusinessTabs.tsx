import { useEffect, useState } from "react";
import { KnowledgeEditor } from "@/components/admin/KnowledgeEditor";
import { PromptEditor } from "@/components/admin/PromptEditor";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildPrompts } from "@/lib/prompt";
import type { BusinessProfile as DemoBusinessProfile, CustomerPrompts } from "@/lib/types";
import { DEFAULT_VOICE } from "@/lib/types";
import { saveBusinessKnowledge, saveBusinessPrompts } from "../api/backend";
import type { BusinessProfile } from "../api/types";
import { accountErrorMessage } from "../auth";

// The Knowledge and Prompt tabs, for a real customer — the demo prospects' own editors, rendering a
// real business's profile.
//
// They are the same components, not a matching pair: `KnowledgeEditor` and `PromptEditor` are
// imported from `src/demos/`, the profile is the same `BusinessProfile` shape, and the prompts are
// generated and resolved by the demo's own `prompt.ts` on the backend. Anything that changes about
// how a prospect's knowledge is edited changes here too, by construction.
//
// Two differences from the prospect screen, both deliberate:
//
//   * **Each tab saves itself.** The demo has one Save in the page header covering every tab,
//     because a prospect record is one PATCH. A business's settings are split across endpoints that
//     must not disturb each other — editing a greeting has never been allowed to reword what the
//     agent knows — so Knowledge and Prompt have a save each, to their own endpoint.
//   * **No call-sound controls.** Those synthesise a phone line in a browser so a demo sounds like
//     a call. A customer's calls arrive down a real one.
//
// Everything is rendered inside `.tw`: these are Tailwind components and the rest of this page is
// the transcribe stylesheet. See the header of `src/styles/index.css`.

type Props = {
  profile: BusinessProfile;
  /** Whose profile this is, when an admin is acting for a customer. */
  userId?: string;
  /** Re-read the whole page after a save, so every card shows the same row. */
  onSaved: (profile: BusinessProfile) => void;
  /** There is a description saved but nothing read out of it yet — offer the re-read, not a form. */
  needsReread: boolean;
};

/** What the Prompt tab shows before anything has generated one. */
function promptsFor(profile: BusinessProfile): CustomerPrompts {
  if (profile.prompts) return profile.prompts;
  const structured = profile.profile;
  if (!structured) {
    return { live: "", backend: "", greeting: "", edited: false };
  }
  // Built here only so the boxes are not empty while the first save is in flight; the backend
  // builds and stores the real one, with the same function.
  return buildPrompts(structured, profile.agentName ?? "", profile.language ?? undefined);
}

export function BusinessTabs({ profile, userId, onSaved, needsReread }: Props) {
  const [draft, setDraft] = useState<DemoBusinessProfile | null>(profile.profile);
  const [prompts, setPrompts] = useState<CustomerPrompts>(() => promptsFor(profile));
  const [voice, setVoice] = useState(profile.voice ?? DEFAULT_VOICE);
  const [language, setLanguage] = useState(profile.language ?? "");
  const [agentName, setAgentName] = useState(profile.agentName ?? "");
  const [saving, setSaving] = useState<"knowledge" | "prompt" | "rebuild" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"knowledge" | "prompt" | null>(null);

  // The row can change underneath this (another card saved, or the admin switched customer), and
  // the editors are controlled — so the draft follows the row rather than sitting on a stale copy.
  useEffect(() => {
    setDraft(profile.profile);
    setPrompts(promptsFor(profile));
    setVoice(profile.voice ?? DEFAULT_VOICE);
    setLanguage(profile.language ?? "");
    setAgentName(profile.agentName ?? "");
    setSaved(null);
  }, [profile]);

  async function saveKnowledge() {
    if (!draft) return;
    setSaving("knowledge");
    setError(null);
    try {
      const { profile: next } = await saveBusinessKnowledge(draft, userId);
      onSaved(next);
      setSaved("knowledge");
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't save that. Nothing was changed."));
    } finally {
      setSaving(null);
    }
  }

  async function savePrompts(rebuild = false) {
    setSaving(rebuild ? "rebuild" : "prompt");
    setError(null);
    try {
      const { profile: next } = await saveBusinessPrompts(
        {
          // On a rebuild the prompts are not sent at all: the backend generates them from the
          // profile, and sending the old text alongside would read as a hand edit.
          ...(rebuild ? {} : { prompts }),
          voice,
          language,
          rebuild,
        },
        userId,
      );
      onSaved(next);
      setSaved("prompt");
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't save that. Nothing was changed."));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="tw">
      <div className="flex flex-col gap-4">
        <Tabs defaultValue="knowledge">
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
            <TabsTrigger value="prompt">Prompt</TabsTrigger>
          </TabsList>

          <TabsContent value="knowledge" className="space-y-4 pt-4">
            {needsReread ? (
              <div className="bg-primary/10 ta-caption-1 text-primary rounded-lg p-3">
                We haven't read your description into this form yet. Use "Read my details again"
                above and everything here fills in.
              </div>
            ) : null}

            {draft ? (
              <KnowledgeEditor profile={draft} onChange={setDraft} />
            ) : (
              <p className="ta-caption-1 text-muted-foreground">
                Nothing to edit yet. Add your business information first.
              </p>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={() => void saveKnowledge()} disabled={!draft || saving !== null}>
                {saving === "knowledge" ? "Saving" : "Save"}
              </Button>
              {saved === "knowledge" ? (
                <span className="ta-caption-1 text-muted-foreground">
                  Saved. This is what the assistant now knows.
                </span>
              ) : null}
            </div>
          </TabsContent>

          <TabsContent value="prompt" className="space-y-4 pt-4">
            <PromptEditor
              agentName={agentName}
              voice={voice}
              language={language}
              prompts={prompts}
              showCallSound={false}
              onAgentNameChange={setAgentName}
              onVoiceChange={setVoice}
              onLanguageChange={setLanguage}
              onPromptsChange={setPrompts}
              onRegenerate={() => void savePrompts(true)}
              regenerating={saving === "rebuild"}
            />

            <div className="flex items-center gap-3">
              <Button onClick={() => void savePrompts()} disabled={saving !== null}>
                {saving === "prompt" ? "Saving" : "Save"}
              </Button>
              {saved === "prompt" ? (
                <span className="ta-caption-1 text-muted-foreground">Saved.</span>
              ) : null}
            </div>
          </TabsContent>
        </Tabs>

        {error ? (
          <p className="ta-label-1 text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
