import type { AuthUser } from "../api/types";
import {
  IconActivity,
  IconAlert,
  IconAnalytics,
  IconColumns,
  IconInbox,
  IconMessage,
  IconOverview,
  IconPresentation,
  IconRuns,
  IconSignOut,
  IconIdea,
  IconKey,
  IconPhone,
  IconTable,
  IconUsers,
} from "../icons";
import { VoiceOrb } from "../demos/components/call/VoiceOrb";
import { formatDateTime } from "../lib";

export type ViewId =
  | "overview"
  | "analytics"
  | "people"
  | "activity"
  | "runs"
  | "failed"
  | "feedback"
  | "allFeedback"
  | "numbers"
  | "business"
  | "calls"
  | "apiKeys"
  | "accounts"
  | "demoOverview"
  | "demoProspects"
  | "demoProspect"
  | "demoPipeline";

const NAV: {
  key: string;
  group: string;
  items: { id: ViewId; label: string; icon: typeof IconOverview; adminOnly?: boolean }[];
}[] = [
  {
    key: "dashboard",
    group: "Dashboard",
    items: [
      { id: "overview", label: "Overview", icon: IconOverview },
      { id: "analytics", label: "Analytics", icon: IconAnalytics },
      { id: "people", label: "Per person", icon: IconUsers, adminOnly: true },
      { id: "activity", label: "Daily activity", icon: IconActivity },
    ],
  },
  {
    key: "runs",
    group: "Runs",
    items: [
      { id: "runs", label: "All runs", icon: IconRuns },
      { id: "failed", label: "Failed runs", icon: IconAlert, adminOnly: true },
    ],
  },
  {
    key: "feedback",
    group: "Feedback",
    items: [
      { id: "feedback", label: "Send feedback", icon: IconMessage },
      { id: "allFeedback", label: "All feedback", icon: IconInbox, adminOnly: true },
    ],
  },
  {
    key: "settings",
    group: "Settings",
    items: [
      { id: "calls", label: "Answered calls", icon: IconPhone },
      { id: "business", label: "Business information", icon: IconIdea },
      { id: "numbers", label: "Agent numbers", icon: IconPhone, adminOnly: true },
      { id: "apiKeys", label: "API keys", icon: IconKey, adminOnly: true },
      { id: "accounts", label: "Accounts", icon: IconUsers, adminOnly: true },
    ],
  },
  {
    key: "demos",
    group: "Demo",
    items: [
      { id: "demoOverview", label: "Overview", icon: IconPresentation, adminOnly: true },
      { id: "demoProspects", label: "Customers", icon: IconTable, adminOnly: true },
      { id: "demoPipeline", label: "CRM", icon: IconColumns, adminOnly: true },
    ],
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
  mailboxSubLabel,
  showScope = true,
  user,
  onSignOut,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  failedCount: number;
  openFeedback: number;
  lastRunAt: string | null;
  mailboxLabel: string;
  mailboxSubLabel: string;
  // The "Showing <mailbox>" block describes the transcribe scope; Demos views have none, so App
  // passes false there rather than this component guessing from the view id.
  showScope?: boolean;
  user: AuthUser;
  onSignOut: () => void;
}) {
  return (
    <nav className="sidebar" aria-label="Dashboard sections">
      <div className="sidebar-brand">
        {/* The brand mark is the voice orb, idling — the same film the Demo test call plays, so
            the thing that listens on a call is the thing on the letterhead (the promo does this in
            components/public/Logo.tsx's BrandMark). The inner `.tw` span is the boundary the
            promo's scoped Tailwind needs: the sidebar is legacy markup, and without it the
            component's `rounded-full object-cover shrink-0` would match nothing — measured, that
            is border-radius 0 and object-fit `contain`, i.e. the whole frame letterboxed into a
            square. `.brand-mark-orb` drops the tinted square behind it —
            the orb is an opaque circle filling the box, so the tint would only ever show as four
            corners. */}
        <span className="brand-mark brand-mark-orb" aria-hidden="true">
          <span className="tw">
            <VoiceOrb state="idle" size={28} />
          </span>
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
        <div className="sidebar-group" key={section.key} data-group={section.key}>
          <div className="sidebar-group-label ta-caption-1">{section.group}</div>
          {items.map((item) => {
            // A prospect's own page highlights "Prospects": it's where you came from and go back to.
            const isActive = item.id === active || (item.id === "demoProspects" && active === "demoProspect");
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item${isActive ? " is-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
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
        {showScope && (
          <div className="sidebar-meta">
            <div className="ta-caption-1 muted">Showing</div>
            <div className="ta-label-2 mailbox-label" title={mailboxSubLabel || mailboxLabel}>
              {mailboxLabel}
            </div>
            {mailboxSubLabel && (
              <div className="ta-caption-2 muted mailbox-label" title={mailboxSubLabel}>
                {mailboxSubLabel}
              </div>
            )}
          </div>
        )}
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
