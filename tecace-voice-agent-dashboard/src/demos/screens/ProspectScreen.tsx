
import { demoFetch } from "@/api";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityTab } from "@/components/admin/ActivityTab";
import { KnowledgeEditor } from "@/components/admin/KnowledgeEditor";
import { SchedulePanel } from "@/components/public/SchedulePanel";
import { PromptEditor } from "@/components/admin/PromptEditor";
import { ResearchInputsPanel } from "@/components/admin/ResearchInputsPanel";
import { SharePanel } from "@/components/admin/SharePanel";
import { SourcesPanel } from "@/components/research/SourcesPanel";
import { PageHeader, StatCard, StatusBadge, statusKind } from "@/components/admin/shared";
import { CallPanel } from "@/components/call/CallPanel";
import { Transcript } from "@/components/call/Transcript";
import { useLiveCall } from "@/hooks/useLiveCall";
import { formatDuration, isResearchStalled } from "@/lib/analytics";
import { readJson } from "@/lib/http";
import type {
  CallLog,
  CrmNote,
  Customer,
  CustomerStats,
  TrackEvent,
} from "@/lib/types";

type Payload = {
  customer: Customer;
  stats: CustomerStats;
  calls: CallLog[];
  events: TrackEvent[];
  notes: CrmNote[];
};

export function ProspectScreen({ id }: { id: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Calls from this panel are the operator's own and stay out of the numbers.
  const call = useLiveCall(id, draft?.callSound, { isTest: true });

  const load = useCallback(async () => {
    try {
      const response = await demoFetch(`/customers/${id}`, { cache: "no-store" });
      const payload = await readJson<Payload>(response);
      setData(payload);
      setDraft(payload.customer);
      setLoadError(null);
    } catch (caught) {
      // Without this the page sits on its skeleton forever and says nothing.
      setLoadError(caught instanceof Error ? caught.message : "Could not load this customer.");
    }
  }, [id]);

  useEffect(() => {
    // Fetching on mount: the state lands in an async callback, which is what
    // the rule is meant to catch a synchronous version of.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Refresh the call list once a test call finishes.
  useEffect(() => {
    if (call.state === "ended") {
      const timer = setTimeout(() => void load(), 1200);
      return () => clearTimeout(timer);
    }
  }, [call.state, load]);

  async function save(partial?: Partial<Customer>) {
    if (!draft) return;
    setSaving(true);
    try {
      const body = {
        businessName: partial?.businessName ?? draft.businessName,
        websiteUrl: partial?.websiteUrl ?? draft.websiteUrl ?? "",
        mapsUrl: partial?.mapsUrl ?? draft.mapsUrl ?? "",
        researchNotes: partial?.researchNotes ?? draft.researchNotes ?? "",
        label: partial?.label ?? draft.label ?? "",
        contactName: partial?.contactName ?? draft.contactName ?? "",
        contactEmail: partial?.contactEmail ?? draft.contactEmail ?? "",
        notes: partial?.notes ?? draft.notes ?? "",
        active: partial?.active ?? draft.active,
        agentName: partial?.agentName ?? draft.agentName,
        demoMinutes: partial?.demoMinutes ?? draft.demoMinutes,
        stage: partial?.stage ?? draft.stage,
        lastContactedAt: partial?.lastContactedAt ?? draft.lastContactedAt ?? "",
        followUpAt: partial?.followUpAt ?? draft.followUpAt ?? "",
        voice: partial?.voice ?? draft.voice,
        language: partial?.language ?? draft.language,
        callSound: partial?.callSound ?? draft.callSound,
        profile: partial?.profile ?? draft.profile,
        prompts: partial?.prompts ?? draft.prompts,
      };
      const response = await demoFetch(`/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readJson<{ customer: Customer }>(response);
      setDraft(payload.customer);
      setData((current) => (current ? { ...current, customer: payload.customer! } : current));
      toast.success("Saved.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const stalled = draft ? isResearchStalled(draft) : false;

  if (!data || !draft) {
    return (
      <div className="space-y-4">
        {loadError ? (
          <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">
            {loadError}
          </div>
        ) : null}
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const { stats, calls } = data;

  return (
    <>
      <PageHeader
        title={draft.profile.name || draft.businessName || "Unnamed business"}
        subtitle={draft.profile.address}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge
              kind={stalled ? "negative" : statusKind(draft.status)}
            >
              {draft.status === "ready"
                ? "Ready"
                : draft.status === "error"
                  ? "Error"
                  : stalled
                    ? "Stalled"
                    : "Researching"}
            </StatusBadge>
            <label className="ta-label-1 flex items-center gap-2">
              <Switch
                checked={draft.active}
                onCheckedChange={(checked) => {
                  setDraft({ ...draft, active: checked });
                  void save({ active: checked });
                }}
                aria-label="Toggle the demo link"
              />
              Live
            </label>
            <Button onClick={() => save()} disabled={saving}>
              {saving ? "Saving" : "Save"}
            </Button>
          </div>
        }
      />

      {draft.status === "error" && draft.error ? (
        <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">
          {draft.error}
        </div>
      ) : null}

      {stalled ? (
        <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">
          Research has been running since {new Date(draft.updatedAt).toLocaleString()},
          which is longer than it takes. The run behind it is gone.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard title="Link opens" value={String(stats.views)} />
        <StatCard title="Calls" value={String(stats.calls)} />
        <StatCard
          title="Minutes"
          value={String(Math.round((stats.totalSec / 60) * 10) / 10)}
        />
        <StatCard
          title="Average call"
          value={formatDuration(stats.calls ? stats.totalSec / stats.calls : 0)}
          caption={
            stats.lastCallAt
              ? `Last call ${new Date(stats.lastCallAt).toLocaleDateString()}`
              : "No calls yet"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="rounded-xl border shadow-none lg:col-span-2">
          <CardContent className="p-4 md:p-6">
            {/*
              No CRM tab. The pipeline reads across every prospect at once, so
              it lives at /admin/crm; what is left here is this one demo — what
              it knows, how it sounds, what happened on it.
            */}
            <Tabs defaultValue="activity">
              <TabsList variant="line" className="w-full justify-start">
                <TabsTrigger value="activity">Activity</TabsTrigger>
                <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
                <TabsTrigger value="schedule">
                  Schedule
                  <span className="ta-caption-2 text-muted-foreground ml-1.5">
                    (Mockup)
                  </span>
                </TabsTrigger>
                <TabsTrigger value="prompt">Prompt</TabsTrigger>
                <TabsTrigger value="sources">Sources</TabsTrigger>
                <TabsTrigger value="share">Share</TabsTrigger>
              </TabsList>

              <TabsContent value="activity" className="pt-4">
                <ActivityTab calls={calls} customerId={id} onChanged={load} />
              </TabsContent>

              <TabsContent value="knowledge" className="pt-4">
                <KnowledgeEditor
                  profile={draft.profile}
                  onChange={(profile) => setDraft({ ...draft, profile })}
                />
              </TabsContent>

              {/*
                The same panel the prospect sees, so the hours edited above can
                be checked against the week they produce without leaving the
                page. It reads the profile in the draft, not the saved record.
              */}
              <TabsContent value="schedule" className="pt-4">
                <SchedulePanel profile={draft.profile} agentName={draft.agentName} />
              </TabsContent>

              <TabsContent value="prompt" className="pt-4">
                <PromptEditor
                  agentName={draft.agentName}
                  voice={draft.voice}
                  language={draft.language}
                  callSound={draft.callSound}
                  onCallSoundChange={(callSound) => setDraft({ ...draft, callSound })}
                  prompts={draft.prompts}
                  regenerating={saving}
                  onAgentNameChange={(agentName) => setDraft({ ...draft, agentName })}
                  onVoiceChange={(voice) => setDraft({ ...draft, voice })}
                  onLanguageChange={(language) => {
                    // The greeting is written in the language, so the prompts
                    // have to be rebuilt for the change to reach the call.
                    setDraft({ ...draft, language });
                    void save({ language });
                  }}
                  onPromptsChange={(prompts) => setDraft({ ...draft, prompts })}
                  onRegenerate={async () => {
                    setSaving(true);
                    try {
                      const response = await demoFetch(`/customers/${id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          profile: draft.profile,
                          agentName: draft.agentName,
                          voice: draft.voice,
                          language: draft.language,
                          regeneratePrompts: true,
                        }),
                      });
                      const payload = await readJson<{ customer: Customer }>(response);
                      setDraft(payload.customer);
                      toast.success("Prompts rebuilt from the data.");
                    } catch (caught) {
                      toast.error(
                        caught instanceof Error ? caught.message : "Could not rebuild.",
                      );
                    } finally {
                      setSaving(false);
                    }
                  }}
                />
              </TabsContent>

              <TabsContent value="sources" className="space-y-6 pt-4">
                <ResearchInputsPanel
                  customer={draft}
                  onChange={(partial) => setDraft({ ...draft, ...partial })}
                />
                <SourcesPanel
                  dossier={draft.dossier}
                  sources={draft.sources}
                  researchedAt={draft.researchedAt}
                />
              </TabsContent>

              <TabsContent value="share" className="pt-4">
                <SharePanel
                  customer={draft}
                  stats={stats}
                  onChange={(partial) => setDraft({ ...draft, ...partial })}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="flex flex-col rounded-xl border shadow-none">
          <CardHeader>
            <CardTitle className="ta-headline-2">Test call</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <CallPanel
              compact
              state={call.state}
              elapsedSec={call.elapsedSec}
              usageSec={call.usageSec}
              muted={call.muted}
              error={call.error}
              disabled={draft.status !== "ready" || !draft.active}
              onDial={call.dial}
              onHangup={call.hangup}
              onToggleMute={call.toggleMute}
              onReset={call.reset}
            />
            <div className="min-h-64 flex-1 overflow-y-auto rounded-lg border">
              <Transcript
                entries={call.transcript}
                thinking={call.thinking}
                emptyMessage="Call to hear how the receptionist answers."
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
