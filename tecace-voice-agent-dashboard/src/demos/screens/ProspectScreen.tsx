
import { demoFetch } from "@/api";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityTab } from "@/components/admin/ActivityTab";
import { AddDemoTimeMenu } from "@/components/admin/AddDemoTimeMenu";
import { LifecycleBadges, LifecycleNotice, StartOnboarding } from "@/components/admin/Lifecycle";
import { ResearchInputsPanel } from "@/components/admin/ResearchInputsPanel";
import { SharePanel } from "@/components/admin/SharePanel";
import { SourcesPanel } from "@/components/research/SourcesPanel";
import { PageHeader, StatCard, StatusBadge, statusKind } from "@/components/admin/shared";
import { formatDuration, isResearchStalled } from "@/lib/analytics";
import { readJson } from "@/lib/http";
import { DemoSettings } from "../../settings/DemoSettings";
import { TestCallPanel } from "../../settings/simulator/TestCallPanel";
import { withDefaults } from "../../settings/callSettings";
import type { SectionId } from "../../routing";
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

/**
 * One demo, either for us or for the customer it belongs to.
 *
 * `operator` false is that customer. What it takes away is everything that is OURS rather than
 * theirs: the live switch and the demo allowance (their side of a deal they do not administer),
 * re-research and the research inputs (a model call we pay for), the call history's reclassify and
 * delete (our metrics), the share link and its tracking, and the test-call panel — an unmetered live
 * minute, which is why the prospect's own link has an allowance and this does not. What is left is
 * what the receptionist knows, how it sounds, and the week it works.
 *
 * Every one of those is refused by the backend for that account as well; this is the dashboard not
 * offering what it knows would be refused. See `auth/guard.ts` and `routes/demo.ts`.
 */
export function ProspectScreen({
  id,
  operator = true,
  onOnboarded,
  section,
  onSection,
}: {
  id: string;
  operator?: boolean;
  /** Dashboard-only: the open settings section, held in the URL. */
  section?: SectionId;
  onSection?: (section: SectionId) => void;
  /** Dashboard-only: the customer started onboarding and is leaving the demo. */
  onOnboarded?: () => void | Promise<void>;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);
  // Calls from this panel are the operator's own and stay out of the numbers.

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
      // Dashboard-only (see PORTING.md): a demo's own customer may send only the receptionist's
      // fields (the backend's CUSTOMER_MAY_EDIT) — the full body was refused with a 403 every time.
      const sent = operator
        ? body
        : {
            profile: body.profile,
            prompts: body.prompts,
            agentName: body.agentName,
            voice: body.voice,
            language: body.language,
            callSound: body.callSound,
          };
      const response = await demoFetch(`/customers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sent),
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

  async function research(regeneratePrompts: boolean) {
    setResearching(true);
    try {
      const response = await demoFetch(`/customers/${id}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regeneratePrompts,
          businessName: draft?.businessName,
          websiteUrl: draft?.websiteUrl ?? "",
          mapsUrl: draft?.mapsUrl ?? "",
          researchNotes: draft?.researchNotes ?? "",
        }),
      });
      const payload = await readJson<{ customer: Customer }>(response);
      setDraft(payload.customer);
      setData((current) => (current ? { ...current, customer: payload.customer! } : current));
      toast.success("Research finished.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Research failed.");
      void load();
    } finally {
      setResearching(false);
    }
  }

  // Only the minutes are taken from the answer, so edits not yet saved stay in
  // the draft rather than being replaced by the stored record.
  async function rebuildPrompts() {
    if (!draft) return;
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
      toast.error(caught instanceof Error ? caught.message : "Could not rebuild.");
    } finally {
      setSaving(false);
    }
  }

  function addedTime(customer: Customer) {
    setDraft((current) => (current ? { ...current, demoMinutes: customer.demoMinutes } : current));
    setData((current) =>
      current
        ? { ...current, customer: { ...current.customer, demoMinutes: customer.demoMinutes } }
        : current,
    );
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
            {/* After the research status, which stays the header's first badge as in the promo. */}
            {operator && <LifecycleBadges customer={draft} />}
            {operator && (
              <>
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
                <AddDemoTimeMenu
                  customerId={id}
                  demoMinutes={draft.demoMinutes}
                  onAdded={addedTime}
                />
                <Button variant="outline" onClick={() => research(false)} disabled={researching}>
                  <RefreshCw className="size-4" />
                  {researching ? "Researching" : "Re-research"}
                </Button>
              </>
            )}
            <Button onClick={() => save()} disabled={saving}>
              {saving ? "Saving" : "Save"}
            </Button>
          </div>
        }
      />

      {operator ? <LifecycleNotice customer={draft} /> : null}
      {!operator && onOnboarded ? (
        <StartOnboarding customer={draft} onOnboarded={onOnboarded} />
      ) : null}

      {draft.status === "error" && draft.error ? (
        <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">
          {draft.error}
        </div>
      ) : null}

      {stalled ? (
        <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">
          Research has been running since {new Date(draft.updatedAt).toLocaleString()},
          which is longer than it takes. The run behind it is gone. Press Re-research.
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
        <Card className={`rounded-xl border shadow-none ${operator ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <CardContent className="p-4 md:p-6">
            {/*
              No CRM tab. The pipeline reads across every prospect at once, so
              it lives at /admin/crm; what is left here is this one demo — what
              it knows, how it sounds, what happened on it.
            */}
            {/* The customer opens on Knowledge, because Activity is not one of their tabs. */}
            {/*
              Dashboard-only (see PORTING.md): the promo's Knowledge, Schedule and Prompt tabs are one
              Settings tab here — the shared receptionist settings (src/settings/), the same screen a
              business gets after onboarding, including transfers, links and message scenarios.
            */}
            <Tabs defaultValue={operator && !section ? "activity" : "settings"}>
              <TabsList variant="line" className="w-full justify-start">
                {operator && <TabsTrigger value="activity">Activity</TabsTrigger>}
                <TabsTrigger value="settings">Settings</TabsTrigger>
                {operator && <TabsTrigger value="sources">Sources</TabsTrigger>}
                {operator && <TabsTrigger value="share">Share</TabsTrigger>}
              </TabsList>

              {operator && (
                <TabsContent value="activity" className="pt-4">
                  <ActivityTab calls={calls} customerId={id} onChanged={load} />
                </TabsContent>
              )}

              <TabsContent value="settings" className="pt-4">
                <DemoSettings
                  customerId={id}
                  draft={draft}
                  setDraft={(change) => setDraft((current) => (current ? change(current) : current))}
                  save={save}
                  onRebuild={() => void rebuildPrompts()}
                  rebuilding={saving}
                  operator={operator}
                  section={section}
                  onSection={(next) => onSection?.(next)}
                />
              </TabsContent>

              {operator && (
              <TabsContent value="sources" className="space-y-6 pt-4">
                <ResearchInputsPanel
                  customer={draft}
                  onChange={(partial) => setDraft({ ...draft, ...partial })}
                  onResearch={() => research(false)}
                  researching={researching}
                />
                <SourcesPanel
                  dossier={draft.dossier}
                  sources={draft.sources}
                  researchedAt={draft.researchedAt}
                />
              </TabsContent>
              )}

              {operator && (
              <TabsContent value="share" className="pt-4">
                <SharePanel
                  customer={draft}
                  stats={stats}
                  onChange={(partial) => setDraft({ ...draft, ...partial })}
                  onAddedTime={addedTime}
                />
              </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>

        {operator && (
        <Card className="flex flex-col rounded-xl border shadow-none">
          <CardHeader>
            <CardTitle className="ta-headline-2">Test call</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            {/*
              Dashboard-only (see PORTING.md): the test call is the settings screen's TestCallPanel —
              the same orb, panel and transcript, plus the simulated phone line for the tools the
              composed session now carries (transfers, links, messages).
            */}
            <TestCallPanel
              api={demoFetch}
              customerId={id}
              settings={withDefaults(draft.callSettings)}
              businessName={draft.profile.name || draft.businessName}
              businessPhone={draft.profile.phone ?? null}
              callSound={draft.callSound}
              disabled={draft.status !== "ready" || !draft.active}
              onEnded={() => void load()}
            />
          </CardContent>
        </Card>
        )}
      </div>
    </>
  );
}
