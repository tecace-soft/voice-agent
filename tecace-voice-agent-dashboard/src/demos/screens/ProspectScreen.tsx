
import { demoFetch } from "@/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, MoreHorizontal, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityTab } from "@/components/admin/ActivityTab";
import { AddDemoTimeMenu } from "@/components/admin/AddDemoTimeMenu";
import { LifecycleBadges, LifecycleNotice, RequestSetup } from "@/components/admin/Lifecycle";
import { ResearchInputsPanel } from "@/components/admin/ResearchInputsPanel";
import { SharePanel } from "@/components/admin/SharePanel";
import { SourcesPanel } from "@/components/research/SourcesPanel";
import { StatCard, StatusBadge, statusKind } from "@/components/admin/shared";
import { formatDuration, isResearchStalled } from "@/lib/analytics";
import { readJson } from "@/lib/http";
import { quotedGreeting } from "@/lib/prompt";
import { customerLink } from "@/lib/share";
import { TopbarMain, useHasTopbar, useStudioChrome } from "../../chrome";
import { DemoSettings } from "../../settings/DemoSettings";
import { TestCallPanel } from "../../settings/simulator/TestCallPanel";
import { ExampleCallPanel } from "../../settings/simulator/ExampleCallPanel";
import { withDefaults } from "../../settings/callSettings";
import type { ProspectTab, SectionId } from "../../routing";
import { demoHref } from "@/routes";
import type {
  CallLog,
  CrmNote,
  Customer,
  CustomerStats,
  TrackEvent,
} from "@/lib/types";

type Tab = ProspectTab;

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
  section,
  onSection,
  tab: routeTab,
  onTab,
}: {
  id: string;
  operator?: boolean;
  /** Dashboard-only: the open settings section, held in the URL. */
  section?: SectionId;
  onSection?: (section: SectionId) => void;
  /** Dashboard-only: the open tab, held in the URL like the section. Without `onTab` it is local state. */
  tab?: Tab;
  onTab?: (tab: Tab) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Customer | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [researching, setResearching] = useState(false);
  const [localTab, setLocalTab] = useState<Tab>(operator && !section ? "activity" : "settings");
  // Dashboard-only: read from the URL, so Back/Forward, a link or a refresh opens the tab the
  // address names (an open section is on Settings); local state only where no router is attached.
  const tab: Tab = onTab
    ? section
      ? "settings"
      : (routeTab ?? (operator ? "activity" : "settings"))
    : localTab;
  const setTab = onTab ?? setLocalTab;
  // Dashboard-only (PORTING.md, B2): the page takes the whole screen — sidebar as an icon rail, its
  // header in the app's top bar — on every tab, so switching tabs doesn't move the header.
  useStudioChrome(true);
  const inTopbar = useHasTopbar();
  // The notices under the bar take height from the studio, which otherwise fills the screen; their
  // height goes to the shell as --studio-above so the studio still ends at the bottom edge.
  const [above, setAbove] = useState(0);
  const aboveRef = useRef<ResizeObserver | null>(null);
  const measureAbove = useCallback((node: HTMLDivElement | null) => {
    aboveRef.current?.disconnect();
    aboveRef.current = null;
    if (!node) return setAbove(0);
    const read = () => setAbove(node.offsetHeight);
    read();
    if (typeof ResizeObserver !== "undefined") {
      aboveRef.current = new ResizeObserver(read);
      aboveRef.current.observe(node);
    }
  }, []);
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
      setData((current) => (current ? { ...current, customer: payload.customer } : current));
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

  // A request, an Approve or a Decline (Lifecycle.tsx) answers with the whole record; only its
  // lifecycle is taken, so an operator's unsaved edits on this page survive it. Dashboard-only
  // (PORTING.md: phase gates).
  function mergeLifecycle(customer: Customer) {
    const lifecycle = {
      phase: customer.phase,
      request: customer.request,
      declined: customer.declined,
      liveAt: customer.liveAt,
      accountEmail: customer.accountEmail,
      stage: customer.stage,
    };
    setDraft((current) => (current ? { ...current, ...lifecycle } : current));
    setData((current) =>
      current ? { ...current, customer: { ...current.customer, ...lifecycle } } : current,
    );
  }

  const stalled = draft ? isResearchStalled(draft) : false;

  if (!data || !draft) {
    return (
      <div className="space-y-4 p-4 md:p-6">
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
  // Unsaved edits to the record. Call settings save on their own, so they don't count.
  const withoutCalls = (customer: Customer) => ({ ...customer, callSettings: undefined });
  const dirty = JSON.stringify(withoutCalls(draft)) !== JSON.stringify(withoutCalls(data.customer));
  const businessName = draft.profile.name || draft.businessName;

  const statCards = (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard title="Link opens" value={String(stats.views)} />
      <StatCard title="Calls" value={String(stats.calls)} />
      <StatCard title="Minutes" value={String(Math.round((stats.totalSec / 60) * 10) / 10)} />
      <StatCard
        title="Average call"
        value={formatDuration(stats.calls ? stats.totalSec / stats.calls : 0)}
        caption={stats.lastCallAt ? `Last call ${new Date(stats.lastCallAt).toLocaleDateString()}` : "No calls yet"}
      />
    </div>
  );

  // Added without a research run (dashboard-only): ready to edit by hand, never researched.
  const unresearched = draft.status === "ready" && !draft.researchedAt;
  const statusText =
    draft.status === "ready"
      ? unresearched
        ? "Not researched"
        : "Ready"
      : draft.status === "error"
        ? "Error"
        : stalled
          ? "Stalled"
          : "Researching";
  const title = draft.profile.name || draft.businessName || "Unnamed business";

  // The page's row, in the app's top bar (src/chrome.tsx): where you are, what state the demo is in,
  // the tabs, and the operator's controls. Rarely used actions sit behind "More".
  const header = (
    <>
      <nav className="ta-label-1 flex min-w-16 shrink items-center gap-1.5 overflow-hidden whitespace-nowrap" aria-label="Breadcrumb">
        {operator ? (
          <span className="hidden items-center gap-1.5 xl:flex">
            <a href={demoHref("demoProspects")} className="text-muted-foreground hover:text-foreground">
              Customers
            </a>
            <span className="text-muted-foreground/60" aria-hidden>
              /
            </span>
          </span>
        ) : null}
        <h1 className="ta-label-1 truncate font-semibold!" title={draft.profile.address || undefined}>
          {title}
        </h1>
      </nav>
      <span className="flex shrink-0 items-center gap-1.5">
        <StatusBadge kind={stalled ? "negative" : unresearched ? "neutral" : statusKind(draft.status)}>
          {statusText}
        </StatusBadge>
        {/* After the research status, which stays the header's first badge as in the promo. */}
        {operator && (
          <span className="hidden items-center gap-1.5 lg:flex">
            <LifecycleBadges customer={draft} />
          </span>
        )}
      </span>
      {operator && (
        <TabsList className="ml-1 shrink-0">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="share">Share</TabsTrigger>
        </TabsList>
      )}
      <span className="flex-1" />
      {operator && (
        <span className="flex shrink-0 items-center gap-2">
          <label className="ta-label-1 flex items-center gap-2 whitespace-nowrap">
            <Switch
              checked={draft.active}
              onCheckedChange={(checked) => {
                setDraft({ ...draft, active: checked });
                void save({ active: checked });
              }}
              aria-label="Toggle the demo link"
            />
            <span className="hidden xl:inline">Live link</span>
          </label>
          <AddDemoTimeMenu customerId={id} demoMinutes={draft.demoMinutes} onAdded={addedTime} />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="More actions" title="More actions">
                  {researching ? <RefreshCw className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => void research(false)} disabled={researching}>
                <RefreshCw className="size-4" />
                {researching ? "Researching" : unresearched ? "Run research" : "Re-research"}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={<a href={customerLink(id)} target="_blank" rel="noreferrer" />}
              >
                <ExternalLink className="size-4" />
                Open the demo page
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* On the Settings tab, Save lives at the end of the bar with the studio's save state. */}
          {tab !== "settings" && (
            <Button size="sm" onClick={() => save()} disabled={saving}>
              {saving ? "Saving" : "Save"}
            </Button>
          )}
        </span>
      )}
    </>
  );

  const problems = (
    <>
      {unresearched ? (
        <div className="bg-muted/60 ta-label-1 flex flex-wrap items-center gap-3 rounded-lg p-3">
          <span className="min-w-0 flex-1">
            Not researched yet. Fill in Settings by hand, or research the business to fill it in for you — it
            replaces what's in Business information and takes a minute or two.
          </span>
          <Button size="sm" onClick={() => void research(false)} disabled={researching}>
            <RefreshCw className={`size-4 ${researching ? "animate-spin" : ""}`} />
            {researching ? "Researching" : "Run research"}
          </Button>
        </div>
      ) : null}
      {draft.status === "error" && draft.error ? (
        <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">{draft.error}</div>
      ) : null}

      {stalled ? (
        <div className="bg-destructive/10 ta-label-1 text-destructive rounded-lg p-3">
          Research has been running since {new Date(draft.updatedAt).toLocaleString()}, which is longer than it
          takes. The run behind it is gone. Press Re-research.
        </div>
      ) : null}
    </>
  );

  // Under the bar. The operator's: an open request to answer, research that failed. The customer's:
  // one line saying this is a preview, with Request setup and how the demo has been used.
  const notices = operator ? (
    <div className="flex flex-col gap-3 border-b px-4 py-3 empty:hidden md:px-6">
      <LifecycleNotice customer={draft} onChanged={mergeLifecycle} />
      {problems}
    </div>
  ) : (
    <div className="border-b">
      <RequestSetup
        customer={draft}
        onChanged={mergeLifecycle}
        variant="strip"
        extra={`Your demo so far: ${stats.views} link opens · ${stats.calls} calls · ${
          Math.round((stats.totalSec / 60) * 10) / 10
        } minutes`}
      />
      {/* The customer's version of the operator's problems: their receptionist is still being built
          (a /start sign-up waiting on research, or one we finish by hand). No error text, no
          "press Re-research" — that is ours to do. */}
      {draft.status !== "ready" ? (
        <p className="bg-warning/10 ta-caption-1 px-4 py-2.5 md:px-6" role="status">
          <b className="font-semibold">We're still building your receptionist.</b> What's here fills in when it's
          ready, usually within a day. You can request setup meanwhile.
        </p>
      ) : null}
    </div>
  );

  return (
    <>
      {/*
        Dashboard-only (see PORTING.md): laid out as the settings studio's page (B2) — the business,
        its state, the tabs and the operator's controls are one row in the app's top bar, the sidebar
        is an icon rail, and the Settings tab's studio runs to the edges of the screen. Without the
        dashboard's top bar (tests) the row sits at the top of the page instead. The stat cards are
        the Activity tab's (they are about the link's use); the demo's own customer gets them as one
        line.
      */}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        style={{ "--studio-above": `${above}px` } as React.CSSProperties}
      >
        {inTopbar ? (
          <TopbarMain>{header}</TopbarMain>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-4 py-3">{header}</div>
        )}

        <div ref={measureAbove}>{notices}</div>

        {operator && (
          <TabsContent value="activity" className="flex flex-col gap-4 p-4 md:p-6">
            {statCards}
            <Card className="rounded-xl border shadow-none">
              <CardContent className="p-4 md:p-6">
                <ActivityTab calls={calls} customerId={id} onChanged={load} />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="settings">
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
            phase="demo"
            asideTitle={operator ? "Test call" : "Example call"}
            asideBadge={operator ? undefined : "Example"}
            asideBare={operator}
            aside={
              operator ? (
                <TestCallPanel
                  api={demoFetch}
                  customerId={id}
                  settings={withDefaults(draft.callSettings)}
                  businessName={businessName}
                  businessPhone={draft.profile.phone ?? null}
                  agentName={draft.agentName}
                  callSound={draft.callSound}
                  disabled={draft.status !== "ready" || !draft.active}
                  onEnded={() => void load()}
                  example={
                    <ExampleCallPanel
                      businessName={businessName}
                      agentName={draft.agentName}
                      greetingLine={quotedGreeting(draft.prompts.greeting)}
                      settings={withDefaults(draft.callSettings)}
                    />
                  }
                  footer={
                    <>
                      <span>
                        Test minutes <b className="text-foreground">unlimited</b> (operator)
                      </span>
                      <span className="flex-1" />
                      <span>Phone line simulated</span>
                    </>
                  }
                />
              ) : (
                <ExampleCallPanel
                  businessName={businessName}
                  agentName={draft.agentName}
                  greetingLine={quotedGreeting(draft.prompts.greeting)}
                  settings={withDefaults(draft.callSettings)}
                  demoLink={customerLink(id)}
                  unavailable={draft.status !== "ready" || !draft.active}
                />
              )
            }
            toolbar={(current) =>
              !operator ? (
                <span className="ta-caption-1 text-muted-foreground whitespace-nowrap">Preview · read only</span>
              ) : current === "transfers" || current === "text-link" || current === "take-message" || current === "appointments" ? (
                <span className="ta-caption-1 text-muted-foreground flex items-center gap-1.5 whitespace-nowrap">
                  <span className="bg-success size-1.5 rounded-full" aria-hidden />
                  Saved as you go
                </span>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="ta-caption-1 text-muted-foreground flex items-center gap-1.5 whitespace-nowrap">
                    <span className={`size-1.5 rounded-full ${dirty ? "bg-warning" : "bg-success"}`} aria-hidden />
                    {dirty ? "Unsaved changes" : "All changes saved"}
                  </span>
                  <Button size="sm" onClick={() => save()} disabled={saving || !dirty}>
                    {saving ? "Saving" : "Save"}
                  </Button>
                </div>
              )
            }
          />
        </TabsContent>

        {operator && (
          <TabsContent value="sources" className="p-4 md:p-6">
            <Card className="rounded-xl border shadow-none">
              <CardContent className="space-y-6 p-4 md:p-6">
                <ResearchInputsPanel
                  customer={draft}
                  onChange={(partial) => setDraft({ ...draft, ...partial })}
                  onResearch={() => research(false)}
                  researching={researching}
                />
                <SourcesPanel dossier={draft.dossier} sources={draft.sources} researchedAt={draft.researchedAt} />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {operator && (
          <TabsContent value="share" className="p-4 md:p-6">
            <Card className="rounded-xl border shadow-none">
              <CardContent className="p-4 md:p-6">
                <SharePanel
                  customer={draft}
                  stats={stats}
                  onChange={(partial) => setDraft({ ...draft, ...partial })}
                  onAddedTime={addedTime}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
