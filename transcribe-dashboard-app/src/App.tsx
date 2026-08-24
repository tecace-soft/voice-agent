import { useCallback, useEffect, useState } from "react";
import { getTranscribeStats } from "./api/backend";
import type { TranscribeStats } from "./api/types";
import { Sidebar, type ViewId } from "./components/Sidebar";
import { IconMoon, IconPanelLeft, IconRefresh, IconSun } from "./icons";
import { ActivityPage } from "./pages/ActivityPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RunsPage } from "./pages/RunsPage";
import { derive } from "./stats";
import { DashboardSkeleton } from "./ui";

const VIEW_TITLES: Record<ViewId, string> = {
  overview: "Overview",
  activity: "Daily activity",
  runs: "All runs",
  failed: "Failed runs",
};

// Light/dark theme, applied via the design system's `data-theme` on <html> and persisted so it
// survives reloads (index.html also applies the saved value before first paint to avoid a flash).
function useTheme(): [("light" | "dark"), () => void] {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* localStorage unavailable — theme just won't persist */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

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

export function App() {
  const [theme, toggleTheme] = useTheme();
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
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
            >
              {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
            </button>
          </div>
        </header>

        <main className="content">
          {error && <p className="error ta-body-2">{error}</p>}
          {!data && loading && <DashboardSkeleton />}
          {data && view === "overview" && <OverviewPage data={data} />}
          {data && view === "activity" && <ActivityPage data={data} />}
          {data && view === "runs" && <RunsPage data={data} />}
          {data && view === "failed" && <RunsPage data={data} onlyFailed />}
        </main>
      </div>
    </div>
  );
}
