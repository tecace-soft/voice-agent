import { IconActivity, IconAlert, IconOverview, IconRuns, IconVoicemail } from "../icons";
import { formatDateTime } from "../lib";

export type ViewId = "overview" | "activity" | "runs" | "failed";

const NAV: { group: string; items: { id: ViewId; label: string; icon: typeof IconOverview }[] }[] = [
  {
    group: "Dashboard",
    items: [
      { id: "overview", label: "Overview", icon: IconOverview },
      { id: "activity", label: "Daily activity", icon: IconActivity },
    ],
  },
  {
    group: "Runs",
    items: [
      { id: "runs", label: "All runs", icon: IconRuns },
      { id: "failed", label: "Failed runs", icon: IconAlert },
    ],
  },
];

// Left rail: brand, grouped navigation between the dashboard's views, and the last-run time pinned
// to the bottom so it's visible from every view.
export function Sidebar({
  active,
  onSelect,
  failedCount,
  lastRunAt,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  failedCount: number;
  lastRunAt: string | null;
}) {
  return (
    <nav className="sidebar" aria-label="Dashboard sections">
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true">
          <IconVoicemail size={16} />
        </span>
        <span className="brand-text">
          <span className="brand-name">TecAce</span>
          <span className="brand-sub ta-caption-2">Transcribe</span>
        </span>
      </div>

      {NAV.map((section) => (
        <div className="sidebar-group" key={section.group}>
          <div className="sidebar-group-label ta-caption-1">{section.group}</div>
          {section.items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item${item.id === active ? " is-active" : ""}`}
                aria-current={item.id === active ? "page" : undefined}
                onClick={() => onSelect(item.id)}
              >
                <ItemIcon size={16} />
                <span className="nav-label">{item.label}</span>
                {item.id === "failed" && failedCount > 0 && (
                  <span className="nav-count">{failedCount}</span>
                )}
              </button>
            );
          })}
        </div>
      ))}

      <div className="sidebar-foot">
        <div className="ta-caption-1 muted">Last run</div>
        <div className="ta-label-2">{lastRunAt ? formatDateTime(lastRunAt) : "No runs yet"}</div>
      </div>
    </nav>
  );
}
