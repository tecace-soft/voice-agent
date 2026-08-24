import { useCallback, useEffect, useState } from "react";
import { getTranscribeStats } from "./api/backend";
import type { AuthUser, TranscribeStats } from "./api/types";
import { useAuth } from "./auth";
import { Sidebar, type ViewId } from "./components/Sidebar";
import { IconPanelLeft, IconRefresh } from "./icons";
import { AccountsPage } from "./pages/AccountsPage";
import { ActivityPage } from "./pages/ActivityPage";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RunsPage } from "./pages/RunsPage";
import { SetupPage } from "./pages/SetupPage";
import { derive } from "./stats";
import { ThemeToggle } from "./theme";
import { DashboardSkeleton } from "./ui";

const VIEW_TITLES: Record<ViewId, string> = {
  overview: "Overview",
  activity: "Daily activity",
  runs: "All runs",
  failed: "Failed runs",
  accounts: "Accounts",
};

// One fetch of GET /transcribe/stats, shared by every view, with a manual refresh that keeps the
// current numbers on screen while the new ones load.
function useStats() {
  const [data, setData] = useState<TranscribeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return getTranscribeStats()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load transcription stats."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: load };
}

// The signed-in dashboard.
function Dashboard({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const [view, setView] = useState<ViewId>("overview");
  // Open by default on a desktop-width screen; on narrow screens the rail is an overlay, so it
  // starts closed and the header's toggle brings it in.
  const [navOpen, setNavOpen] = useState(() => window.innerWidth >= 900);
  const { data, loading, error, refresh } = useStats();

  const failedCount = data ? derive(data).failedRuns.length : 0;
  const openView = (id: ViewId) => {
    setView(id);
    if (window.innerWidth < 900) setNavOpen(false);
  };

  return (
    <div className="app" data-nav={navOpen ? "open" : "closed"}>
      <Sidebar
        active={view}
        onSelect={openView}
        failedCount={failedCount}
        lastRunAt={data?.lastRunAt ?? null}
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
            <span className="muted">Transcribe</span>
            <span className="muted" aria-hidden="true">
              /
            </span>
            <span className="crumb-current">{VIEW_TITLES[view]}</span>
          </nav>
          <div className="topbar-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <IconRefresh size={14} />
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <ThemeToggle />
          </div>
        </header>

        <main className="content">
          {/* The accounts view doesn't depend on the stats, so a stats failure shouldn't hide it. */}
          {error && view !== "accounts" && <p className="error ta-body-2">{error}</p>}
          {!data && loading && view !== "accounts" && <DashboardSkeleton />}
          {data && view === "overview" && <OverviewPage data={data} />}
          {data && view === "activity" && <ActivityPage data={data} />}
          {data && view === "runs" && <RunsPage data={data} />}
          {data && view === "failed" && <RunsPage data={data} onlyFailed />}
          {view === "accounts" &&
            (user.role === "admin" ? (
              <AccountsPage me={user} onSignOut={onSignOut} />
            ) : (
              <p className="muted ta-body-2">Only an admin can manage accounts.</p>
            ))}
        </main>
      </div>
    </div>
  );
}

// Nothing but the sign-in screen exists until there's a session: the stats endpoint is guarded, so
// rendering the dashboard shell first would only produce a 401.
export function App() {
  const { status, user, signOut } = useAuth();

  if (status === "loading") {
    return (
      <div className="boot">
        <span className="muted ta-body-2">Signing you in…</span>
      </div>
    );
  }
  if (status === "setup") {
    return (
      <>
        <div className="login-topbar">
          <ThemeToggle />
        </div>
        <SetupPage />
      </>
    );
  }
  if (status === "signed-out" || !user) {
    return (
      <>
        <div className="login-topbar">
          <ThemeToggle />
        </div>
        <LoginPage />
      </>
    );
  }
  return <Dashboard user={user} onSignOut={() => void signOut()} />;
}
