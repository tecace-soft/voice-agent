import { useCallback, useEffect, useMemo, useState } from "react";
import { countOpenFeedback, countSetupRequests, countUnseenFailures, getTranscribeStats } from "./api/backend";
import type { AuthUser, MailboxScope, TranscribeStats } from "./api/types";
import { useAuth } from "./auth";
import { ChromeContext } from "./chrome";
import { Sidebar, type ViewId } from "./components/Sidebar";
import { MailboxPicker } from "./components/MailboxPicker";
import { DemosView } from "./demos/DemosView";
import { DEMO_VIEWS } from "./demos/views";
import { IconPanelLeft, IconRefresh } from "./icons";
import { AccountsPage } from "./pages/AccountsPage";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { ActivityPage } from "./pages/ActivityPage";
import { AllFeedbackPage } from "./pages/AllFeedbackPage";
import { BillingPage } from "./pages/BillingPage";
import { ChangelogPage } from "./pages/ChangelogPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { FailuresPage } from "./pages/FailuresPage";
import { BusinessPage } from "./pages/BusinessPage";
import { CallsPage } from "./pages/CallsPage";
import { NumbersPage } from "./pages/NumbersPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { LoginPage } from "./pages/LoginPage";
import { WelcomePage, takeLinkFromHash } from "./pages/WelcomePage";
import { ChangePasswordDialog } from "./components/ChangePasswordDialog";
import { OverviewPage } from "./pages/OverviewPage";
import { PeoplePage } from "./pages/PeoplePage";
import { PersonBoardsPage } from "./pages/PersonBoardsPage";
import { RunsPage } from "./pages/RunsPage";
import { SetupPage } from "./pages/SetupPage";
import { useAccountNames } from "./people";
import { useRoute, type ProspectTab, type SectionId } from "./routing";
import { ThemeToggle } from "./theme";
import { DashboardSkeleton } from "./ui";

// An invite or reset link the page was opened with (#/welcome?token=… / #/reset?token=…), read once
// at load and taken out of the address bar before the router sees it.
const LINK_AT_LOAD = typeof window === "undefined" ? null : takeLinkFromHash();
// Which view the address asked for when the page loaded, before the router normalised it. A
// customer who asked for nothing in particular lands on their own page.
const ASKED_AT_LOAD = typeof window === "undefined" ? "" : window.location.hash.replace(/^#\/?/, "").split(/[/?]/)[0] ?? "";

// Views that don't read the transcription stats, so a stats failure shouldn't hide them.
// Analytics reads its own endpoint, so it belongs with the views that don't wait on /transcribe/stats.
const STANDALONE_VIEWS = new Set<ViewId>([
  "accounts",
  "feedback",
  "allFeedback",
  "calls",
  "business",
  "numbers",
  "apiKeys",
  "analytics",
  "people",
  "failed",
  "demoOverview",
  "demoProspects",
  "demoProspect",
  "demoPipeline",
  "changelog",
  "billing",
]);

// Overview and Daily activity fetch per person when an admin is looking at everyone, so they don't
// wait on (or fail with) the shared all-mailboxes stats call either.
const perPersonViews = new Set<ViewId>(["overview", "activity", "analytics"]);

// List screens that take the full width (no 1440px cap). See CLAUDE.md "List screens".
const WIDE_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(["demoProspects"]);

// What a demo-stage account can open; anything else lands on its Overview.
const DEMO_OWNER_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(["myOverview", "myCalls", "demoProspect", "changelog", "billing"]);

const VIEW_TITLES: Record<ViewId, string> = {
  overview: "Overview",
  analytics: "Analytics",
  people: "Per person",
  activity: "Daily activity",
  runs: "All runs",
  failed: "Failed runs",
  feedback: "Send feedback",
  allFeedback: "All feedback",
  calls: "Answered calls",
  business: "Business information",
  numbers: "Agent numbers",
  apiKeys: "API keys",
  accounts: "Accounts",
  demoOverview: "Overview",
  demoProspects: "Customers",
  demoProspect: "Detail",
  demoPipeline: "CRM",
  myOverview: "Overview",
  myCalls: "Call activity",
  changelog: "Changelog",
  billing: "Billing",
};

// One fetch of GET /transcribe/stats, shared by every view, with a manual refresh that keeps the
// current numbers on screen while the new ones load. `mailbox` only narrows an admin's view — the
// backend pins everyone else to their own mailbox whatever is asked for.
function useStats(mailbox: MailboxScope, skip = false) {
  const [data, setData] = useState<TranscribeStats | null>(null);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    // A customer we are still demoing to has no voicemail runs — nothing has ever reported for their
    // address. Asking anyway would be one request per page load answering with zeroes.
    if (skip) return Promise.resolve();
    setLoading(true);
    return getTranscribeStats(mailbox)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load transcription stats."))
      .finally(() => setLoading(false));
  }, [mailbox]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: load };
}

// The signed-in dashboard.
function Dashboard({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  // The view and the mailbox both live in the URL, so a refresh stays where you were and the
  // browser's Back button walks the views you visited.
  const [
    { view: routeView, mailbox: routeMailbox, id: routeRecordId, section: routeSection, tab: routeTab },
    navigate,
  ] = useRoute();
  // Open by default on a desktop-width screen; on narrow screens the rail is an overlay, so it
  // starts closed and the header's toggle brings it in.
  const [navOpen, setNavOpen] = useState(() => window.innerWidth >= 900);
  // The settings studio asks for the whole screen (src/chrome.tsx): the sidebar folds to an icon rail
  // — the header's toggle unfolds it — and the top bar carries the page's own row.
  // Counted, not a flag: a page can ask while a studio inside it asks too (the customer page and its
  // Settings tab), and the inner one closing must not undo the outer one's ask.
  const [studioAsks, setStudioAsks] = useState(0);
  const studio = studioAsks > 0;
  const setStudio = useCallback((on: boolean) => setStudioAsks((n) => Math.max(0, n + (on ? 1 : -1))), []);
  const [railOpen, setRailOpen] = useState(false);
  const [slotMain, setSlotMain] = useState<HTMLDivElement | null>(null);
  const [slotEnd, setSlotEnd] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (studio) setRailOpen(false);
  }, [studio]);
  const chrome = useMemo(() => ({ setStudio, main: slotMain, end: slotEnd }), [setStudio, slotMain, slotEnd]);
  const navState = studio ? (railOpen ? "open" : "rail") : navOpen ? "open" : "closed";
  const toggleNav = () => (studio ? setRailOpen((o) => !o) : setNavOpen((o) => !o));
  const closeNav = () => (studio ? setRailOpen(false) : setNavOpen(false));
  // Admin surfaces only — see `people.ts`. `isAdmin` is read below, so this is declared after it.
  const accountNames = useAccountNames(user.role === "admin");
  // Which mailbox is on screen. Admins choose; for everyone else it stays undefined and the backend
  // scopes them to their own address — so a ?mailbox= in the URL is ignored for a `user` rather than
  // silently doing nothing.
  const isAdmin = user.role === "admin";
  // A customer in the demo stage. They see one screen — the receptionist we built for them — and the
  // URL cannot take them anywhere else: everything below reads `view` through this, so a typed
  // `#/overview` or a bookmarked `#/demos/pipeline` lands on their own page rather than on an empty
  // screen or a permission error. The backend refuses the rest for that account regardless
  // (`auth/guard.ts`), which is what makes this a tidy front end rather than the protection.
  const demoOnly = user.status === "demo";
  // …except the changelog and billing, which are every account's.
  const view = demoOnly && !DEMO_OWNER_VIEWS.has(routeView) ? "myOverview" : routeView;
  const isDemoView = DEMO_VIEWS.has(view);
  const routeId = demoOnly ? (user.businessId ?? undefined) : routeRecordId;
  const mailbox: MailboxScope = isAdmin ? routeMailbox : undefined;
  const setMailbox = useCallback((next: MailboxScope) => navigate({ mailbox: next }), [navigate]);
  // Which settings section is open, on the Business page and a demo's page. In the URL like the
  // view, so a refresh stays on it and a link can point at "Transfer calls".
  const setSection = useCallback((next: SectionId) => navigate({ section: next }), [navigate]);
  // Which tab of a prospect's page is open, in the URL for the same reasons. Choosing a tab closes
  // the section, so the address never names a Settings section while Activity is on screen.
  const setTab = useCallback((next: ProspectTab) => navigate({ tab: next, section: undefined }), [navigate]);
  // A demo-stage customer's address says where they are. Without this a typed `#/overview` (or
  // another prospect's id) stayed in the bar, and a section they opened never reached it, so a
  // refresh lost it. A view that isn't theirs becomes their Overview; their settings page always
  // carries their own record id.
  useEffect(() => {
    if (!demoOnly) return;
    if (!DEMO_OWNER_VIEWS.has(routeView)) navigate({ view: "myOverview" }, { replace: true });
    else if (routeView === "demoProspect" && user.businessId && routeRecordId !== user.businessId) {
      navigate({ view: "demoProspect", id: user.businessId }, { replace: true });
    }
  }, [demoOnly, routeView, routeRecordId, user.businessId, navigate]);
  const { data, loading, error, refresh } = useStats(mailbox, demoOnly);

  // How many notes are waiting on the team, for the sidebar badge. Admins only — it's the one
  // number a `user` isn't allowed to see, and it's cheap enough to refresh with everything else.
  const [openFeedback, setOpenFeedback] = useState(0);

  // The sidebar's failed-runs badge. This counts failures NOBODY HAS LOOKED AT, not failed runs:
  // a count of failed runs can only ever grow, so it could never clear and stopped meaning
  // "something needs attention" the first time anything went wrong.
  const [unseenFailures, setUnseenFailures] = useState(0);
  // Setup requests waiting for an answer (Demo › Customers badge). Admins only.
  const [setupRequests, setSetupRequests] = useState(0);
  const [passwordOpen, setPasswordOpen] = useState(false);
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    countSetupRequests()
      .then((n) => active && setSetupRequests(n))
      .catch(() => {
        /* a badge is a nicety */
      });
    return () => {
      active = false;
    };
  }, [isAdmin, routeView]);
  // A customer who has just been approved lands on their own business information, not on the
  // voicemail Overview they have no use for. Only when nothing else was asked for in the address.
  useEffect(() => {
    if (!isAdmin && user.status === "pre-production" && ASKED_AT_LOAD === "") {
      navigate({ view: "business", section: "business-info" }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!isAdmin) return; // the endpoint is admin-only; asking as a user is a guaranteed 403
    let active = true;
    countUnseenFailures(mailbox)
      .then((n) => active && setUnseenFailures(n))
      .catch(() => {
        /* a badge is a nicety; a failure here shouldn't surface as an error */
      });
    return () => {
      active = false;
    };
  }, [mailbox, isAdmin]);
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    countOpenFeedback()
      .then((n) => active && setOpenFeedback(n))
      .catch(() => {
        /* the badge is a nicety; a failure here shouldn't surface as an error */
      });
    return () => {
      active = false;
    };
  }, [isAdmin, data]);

  // What the numbers on screen belong to, said plainly — it's the difference between "we have no
  // voicemails" and "none of this data is yours".
  // Worded to match the picker and the breakdown — one thing should have one name across the UI.
  const mailboxLabel = isAdmin
    ? mailbox === undefined
      ? "All mailboxes"
      : mailbox === null
        ? "Unattributed"
        : (accountNames.get(mailbox) ?? mailbox)
    : user.name;
  // the address stays visible, just as the quieter second line
  const mailboxSubLabel = isAdmin
    ? mailbox && accountNames.has(mailbox)
      ? mailbox
      : ""
    : user.email;

  // Only when the view can actually contain more than one mailbox is per-row attribution useful;
  // scoped to one, it would be the same address repeated down the page.
  const showMailbox = isAdmin && mailbox === undefined;

  const openView = (id: ViewId) => {
    // For a demo-stage account there is one destination, and it needs the record id in the path.
    if (demoOnly && id === "demoProspect") navigate({ view: "demoProspect", id: user.businessId ?? undefined });
    else navigate({ view: id });
    if (window.innerWidth < 900) closeNav();
  };

  return (
    <ChromeContext.Provider value={chrome}>
    <div className="app" data-nav={navState}>
      <Sidebar
        active={view}
        onSelect={openView}
        failedCount={unseenFailures}
        openFeedback={openFeedback}
        lastRunAt={data?.lastRunAt ?? null}
        mailboxLabel={mailboxLabel}
        mailboxSubLabel={mailboxSubLabel}
        showScope={!isDemoView}
        user={user}
        onSignOut={onSignOut}
        setupRequests={setupRequests}
        onChangePassword={() => setPasswordOpen(true)}
      />
      {passwordOpen ? <ChangePasswordDialog onClose={() => setPasswordOpen(false)} /> : null}
      <div className="nav-scrim" onClick={closeNav} aria-hidden="true" />

      <div className="shell">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn"
            aria-label={navState === "open" ? "Hide navigation" : "Show navigation"}
            aria-expanded={navState === "open"}
            onClick={toggleNav}
          >
            <IconPanelLeft size={16} />
          </button>
          {/* The studio's own row goes here (src/chrome.tsx); only mounted while a page asks for it,
              so every other view's markup is what it was. */}
          {studio && <div className="topbar-slot tw" ref={setSlotMain} />}
          {!studio && (
          <nav className="crumbs ta-label-1" aria-label="Breadcrumb">
            <span className="muted">{demoOnly ? "My receptionist" : isDemoView ? "Demo" : "Transcribe"}</span>
            <span className="muted" aria-hidden="true">
              /
            </span>
            <span className="crumb-current">
              {demoOnly && view === "demoProspect" ? "Settings" : VIEW_TITLES[view]}
            </span>
          </nav>
          )}
          <div className="topbar-actions">
            {studio && <div className="topbar-end tw" ref={setSlotEnd} />}
            {/* The studio's pages say whose settings these are in their own breadcrumb, and read no
                transcription stats, so neither the picker nor Refresh applies there. */}
            {isAdmin && !isDemoView && !studio && <MailboxPicker value={mailbox} onChange={setMailbox} />}
            {!isDemoView && !studio && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void refresh()}
                disabled={loading}
              >
                <IconRefresh size={14} />
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            )}
            <ThemeToggle />
          </div>
        </header>

        <main className={studio ? "content content-bleed" : WIDE_VIEWS.has(view) ? "content content-wide" : "content"}>
          {/* The accounts view doesn't depend on the stats, so a stats failure shouldn't hide it. */}
          {error && !STANDALONE_VIEWS.has(view) && !(showMailbox && perPersonViews.has(view)) && (
            <p className="error ta-body-2">{error}</p>
          )}
          {!data && loading && !STANDALONE_VIEWS.has(view) && !(showMailbox && perPersonViews.has(view)) && (
            <DashboardSkeleton />
          )}
          {view === "overview" &&
            (showMailbox ? (
              <PersonBoardsPage kind="overview" />
            ) : (
              data && (
                <OverviewPage
                  data={data}
                  mailboxLabel={mailboxLabel}
                  showMailbox={false}
                  mailbox={mailbox}
                  isAdmin={isAdmin}
                />
              )
            ))}
          {view === "people" &&
            (isAdmin ? (
              <PeoplePage onPick={setMailbox} />
            ) : (
              <p className="muted ta-body-2">Only an admin can see everyone's totals.</p>
            ))}
          {view === "analytics" &&
            (showMailbox ? <PersonBoardsPage kind="analytics" /> : <AnalyticsPage mailbox={mailbox} />)}
          {view === "activity" &&
            (showMailbox ? <PersonBoardsPage kind="activity" /> : data && <ActivityPage data={data} />)}
          {data && view === "runs" && <RunsPage data={data} showMailbox={showMailbox} />}
          {view === "failed" &&
            (isAdmin ? (
              <FailuresPage
              mailbox={mailbox}
              data={data}
              showMailbox={showMailbox}
                onUnseenChange={setUnseenFailures}
              />
            ) : (
              <p className="muted ta-body-2">Only an admin can see transcription failures.</p>
            ))}
          {view === "calls" && (
            <CallsPage isAdmin={isAdmin} scope={mailbox} onScope={setMailbox} />
          )}
          {view === "business" && (
            <BusinessPage
              isAdmin={isAdmin}
              scope={mailbox}
              onScope={setMailbox}
              section={routeSection}
              onSection={setSection}
            />
          )}
          {view === "numbers" &&
            (isAdmin ? (
              <NumbersPage />
            ) : (
              <p className="muted ta-body-2">Only an admin can manage the agent's phone numbers.</p>
            ))}
          {view === "apiKeys" &&
            (isAdmin ? (
              <ApiKeysPage />
            ) : (
              <p className="muted ta-body-2">Only an admin can manage API keys.</p>
            ))}
          {view === "feedback" && <FeedbackPage />}
          {view === "changelog" && <ChangelogPage isAdmin={isAdmin} />}
          {view === "billing" && <BillingPage />}
          {view === "allFeedback" &&
            (isAdmin ? (
              <AllFeedbackPage onCountChange={setOpenFeedback} />
            ) : (
              <p className="muted ta-body-2">Only an admin can read everyone's feedback.</p>
            ))}
          {view === "accounts" &&
            (user.role === "admin" ? (
              <AccountsPage me={user} onSignOut={onSignOut} />
            ) : (
              <p className="muted ta-body-2">Only an admin can manage accounts.</p>
            ))}
          {isDemoView &&
            (isAdmin ? (
              <DemosView
                view={view}
                id={routeId}
                section={routeSection}
                onSection={setSection}
                tab={routeTab}
                onTab={setTab}
              />
            ) : demoOnly ? (
              <DemosView
                view={view}
                id={routeId}
                section={routeSection}
                onSection={setSection}
                tab={routeTab}
                onTab={setTab}
                operator={false}
              />
            ) : (
              <p className="muted ta-body-2">Only an admin can see the demos.</p>
            ))}
        </main>
      </div>
    </div>
    </ChromeContext.Provider>
  );
}

// Nothing but the sign-in screen exists until there's a session: the stats endpoint is guarded, so
// rendering the dashboard shell first would only produce a 401. Signing in is always the landing
// screen; creating the first account is a step you choose from there, never one you're dropped into.
export function App() {
  const { status, user, needsSetup, signOut } = useAuth();
  const [screen, setScreen] = useState<"signin" | "setup">("signin");
  const [link, setLink] = useState(LINK_AT_LOAD);

  if (status === "loading") {
    return (
      <div className="boot">
        <span className="muted ta-body-2">Signing you in…</span>
      </div>
    );
  }
  // An invite or reset link wins over whoever is signed in here: using it signs in as its account.
  if (link) {
    return (
      <>
        <div className="login-topbar">
          <ThemeToggle />
        </div>
        <WelcomePage token={link.token} onDone={() => setLink(null)} />
      </>
    );
  }
  if (status === "signed-out" || !user) {
    return (
      <>
        <div className="login-topbar">
          <ThemeToggle />
        </div>
        {/* Setup is only reachable while there is genuinely nothing to sign in to, so this also
            sends you back to the sign-in form the moment the first account exists. */}
        {screen === "setup" && needsSetup ? (
          <SetupPage onBack={() => setScreen("signin")} />
        ) : (
          <LoginPage needsSetup={needsSetup} onCreateFirstAccount={() => setScreen("setup")} />
        )}
      </>
    );
  }
  return <Dashboard user={user} onSignOut={() => void signOut()} />;
}
