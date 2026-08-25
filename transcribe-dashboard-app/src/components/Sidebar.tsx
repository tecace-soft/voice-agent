import type { AuthUser } from "../api/types";
import {
  IconActivity,
  IconAlert,
  IconAnalytics,
  IconInbox,
  IconMessage,
  IconOverview,
  IconRuns,
  IconSignOut,
  IconUsers,
  IconVoicemail,
} from "../icons";
import { formatDateTime } from "../lib";

export type ViewId =
  | "overview"
  | "analytics"
  | "activity"
  | "runs"
  | "failed"
  | "feedback"
  | "allFeedback"
  | "accounts";

const NAV: {
  group: string;
  items: { id: ViewId; label: string; icon: typeof IconOverview; adminOnly?: boolean }[];
}[] = [
  {
    group: "Dashboard",
    items: [
      { id: "overview", label: "Overview", icon: IconOverview },
      { id: "analytics", label: "Analytics", icon: IconAnalytics },
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
    group: "Feedback",
    items: [
      { id: "feedback", label: "Send feedback", icon: IconMessage },
      { id: "allFeedback", label: "All feedback", icon: IconInbox, adminOnly: true },
    ],
  },
  {
    group: "Settings",
    items: [{ id: "accounts", label: "Accounts", icon: IconUsers, adminOnly: true }],
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
  openFeedback,
  lastRunAt,
  mailboxLabel,
  user,
  onSignOut,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  failedCount: number;
  openFeedback: number;
  lastRunAt: string | null;
  mailboxLabel: string;
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

      {NAV.map((section) => {
        // Account management is admin-only; a `user` doesn't see the section at all. The backend
        // enforces it too — this only keeps the nav honest about what's reachable.
        const items = section.items.filter((item) => !item.adminOnly || user.role === "admin");
        if (items.length === 0) return null;
        return (
        <div className="sidebar-group" key={section.group}>
          <div className="sidebar-group-label ta-caption-1">{section.group}</div>
          {items.map((item) => {
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
                {item.id === "allFeedback" && openFeedback > 0 && (
                  <span className="nav-count nav-count-info">{openFeedback}</span>
                )}
              </button>
            );
          })}
        </div>
        );
      })}

      <div className="sidebar-foot">
        <div className="sidebar-meta">
          <div className="ta-caption-1 muted">Showing</div>
          <div className="ta-label-2 mailbox-label" title={mailboxLabel}>
            {mailboxLabel}
          </div>
        </div>
        <div className="sidebar-meta sidebar-meta-tight">
          <div className="ta-caption-1 muted">Last run</div>
          <div className="ta-label-2">{lastRunAt ? formatDateTime(lastRunAt) : "No runs yet"}</div>
        </div>

        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">
            {initials(user)}
          </span>
          <span className="user-text">
            <span className="user-name-row">
              <span className="user-name ta-label-1" title={user.name}>
                {user.name}
              </span>
              {user.role === "admin" && <span className="badge badge-admin badge-sm">Admin</span>}
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
