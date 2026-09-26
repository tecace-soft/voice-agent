import { useCallback, useEffect, useState } from "react";
import { countOpenFeedback, countUnseenFailures, getTranscribeStats } from "./api/backend";
import type { AuthUser, MailboxScope, TranscribeStats } from "./api/types";
import { useAuth } from "./auth";
import { Sidebar, type ViewId } from "./components/Sidebar";
import { MailboxPicker } from "./components/MailboxPicker";
import { DemosView } from "./demos/DemosView";
import { DEMO_VIEWS } from "./demos/views";
import { IconPanelLeft, IconRefresh } from "./icons";
import { AccountsPage } from "./pages/AccountsPage";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { ActivityPage } from "./pages/ActivityPage";
import { AllFeedbackPage } from "./pages/AllFeedbackPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { FailuresPage } from "./pages/FailuresPage";
import { BusinessPage } from "./pages/BusinessPage";
import { CallsPage } from "./pages/CallsPage";
import { NumbersPage } from "./pages/NumbersPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PeoplePage } from "./pages/PeoplePage";
import { PersonBoardsPage } from "./pages/PersonBoardsPage";
import { RunsPage } from "./pages/RunsPage";
import { SetupPage } from "./pages/SetupPage";
import { useAccountNames } from "./people";
import { useRoute } from "./routing";
import { ThemeToggle } from "./theme";
import { DashboardSkeleton } from "./ui";

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
]);

// Overview and Daily activity fetch per person when an admin is looking at everyone, so they don't
// wait on (or fail with) the shared all-mailboxes stats call either.
const perPersonViews = new Set<ViewId>(["overview", "activity", "analytics"]);

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
  const [{ view: routeView, mailbox: routeMailbox, id: routeRecordId }, navigate] = useRoute();
  // Open by default on a desktop-width screen; on narrow screens the rail is an overlay, so it
  // starts closed and the header's toggle brings it in.
  const [navOpen, setNavOpen] = useState(() => window.innerWidth >= 900);
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
  const { refresh: refreshUser } = useAuth();
  const demoOnly = user.status === "demo";
  const view = demoOnly ? "demoProspect" : routeView;
  const isDemoView = DEMO_VIEWS.has(view);
  const routeId = demoOnly ? (user.businessId ?? undefined) : routeRecordId;
  const mailbox: MailboxScope = isAdmin ? routeMailbox : undefined;
  const setMailbox = useCallback((next: MailboxScope) => navigate({ mailbox: next }), [navigate]);
  const { data, loading, error, refresh } = useStats(mailbox, demoOnly);

  // How many notes are waiting on the team, for the sidebar badge. Admins only — it's the one
  // number a `user` isn't allowed to see, and it's cheap enough to refresh with everything else.
  const [openFeedback, setOpenFeedback] = useState(0);

  // The sidebar's failed-runs badge. This counts failures NOBODY HAS LOOKED AT, not failed runs:
  // a count of failed runs can only ever grow, so it could never clear and stopped meaning
  // "something needs attention" the first time anything went wrong.
  const [unseenFailures, setUnseenFailures] = useState(0);
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
    if (demoOnly) navigate({ view: "demoProspect", id: user.businessId ?? undefined });
    else navigate({ view: id });
    if (window.innerWidth < 900) setNavOpen(false);
  };

  return (
    <div className="app" data-nav={navOpen ? "open" : "closed"}>
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
      />
      <div className="nav-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

      <div className="shell">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn"
            aria-label={navOpen ? "Hide navigation" : "Show navigation"}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((o) => !o)}
          >
            <IconPanelLeft size={16} />
          </button>
          <nav className="crumbs ta-label-1" aria-label="Breadcrumb">
            <span className="muted">{isDemoView ? "Demo" : "Transcribe"}</span>
            <span className="muted" aria-hidden="true">
              /
            </span>
            <span className="crumb-current">
              {demoOnly ? "My receptionist" : VIEW_TITLES[view]}
            </span>
          </nav>
          <div className="topbar-actions">
            {isAdmin && !isDemoView && <MailboxPicker value={mailbox} onChange={setMailbox} />}
            {!isDemoView && (
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

        <main className="content">
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
            <BusinessPage isAdmin={isAdmin} scope={mailbox} onScope={setMailbox} />
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
              <DemosView view={view} id={routeId} />
            ) : demoOnly ? (
              <DemosView
                view={view}
                id={routeId}
                operator={false}
                onOnboarded={async () => {
                  // The account is now pre-production: re-read it, which lifts the demo-only view,
                  // and land on the business information they are about to fill in.
                  await refreshUser();
                  navigate({ view: "business", id: undefined });
                }}
              />
            ) : (
              <p className="muted ta-body-2">Only an admin can see the demos.</p>
            ))}
        </main>
      </div>
    </div>
  );
}

// Nothing but the sign-in screen exists until there's a session: the stats endpoint is guarded, so
// rendering the dashboard shell first would only produce a 401. Signing in is always the landing
// screen; creating the first account is a step you choose from there, never one you're dropped into.
export function App() {
  const { status, user, needsSetup, signOut } = useAuth();
  const [screen, setScreen] = useState<"signin" | "setup">("signin");

  if (status === "loading") {
    return (
      <div className="boot">
        <span className="muted ta-body-2">Signing you in…</span>
      </div>
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
