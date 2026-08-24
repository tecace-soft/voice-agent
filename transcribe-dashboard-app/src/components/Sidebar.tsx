import type { AuthUser } from "../api/types";
import {
  IconActivity,
  IconAlert,
  IconOverview,
  IconRuns,
  IconSignOut,
  IconUsers,
  IconVoicemail,
} from "../icons";
import { formatDateTime } from "../lib";

export type ViewId = "overview" | "activity" | "runs" | "failed" | "accounts";

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
  {
    group: "Settings",
    items: [{ id: "accounts", label: "Accounts", icon: IconUsers }],
  },
];

// Up to two initials for the account avatar ("Jane Kim" -> "JK"), falling back to the email.
function initials(user: AuthUser): string {
  const source = user.name.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join("") || "?").toUpperCase();
}

// Left rail: brand, grouped navigation between the dashboard's views, and — pinned to the bottom so
// they're visible from every view — the last-run time and who is signed in.
export function Sidebar({
  active,
  onSelect,
  failedCount,
  lastRunAt,
  user,
  onSignOut,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  failedCount: number;
  lastRunAt: string | null;
  user: AuthUser;
  onSignOut: () => void;
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
        <div className="sidebar-meta">
          <div className="ta-caption-1 muted">Last run</div>
          <div className="ta-label-2">{lastRunAt ? formatDateTime(lastRunAt) : "No runs yet"}</div>
        </div>

        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">
            {initials(user)}
          </span>
          <span className="user-text">
            <span className="user-name ta-label-1" title={user.name}>
              {user.name}
            </span>
            <span className="user-email ta-caption-2" title={user.email}>
              {user.email}
            </span>
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={onSignOut}
            aria-label={`Sign out ${user.name}`}
            title="Sign out"
          >
            <IconSignOut size={16} />
          </button>
        </div>
      </div>
    </nav>
  );
}
