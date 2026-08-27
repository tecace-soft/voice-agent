import { useCallback, useEffect, useMemo, useState } from "react";
import { listAllFeedback, setFeedbackStatus } from "../api/backend";
import type { Feedback } from "../api/types";
import { accountErrorMessage } from "../auth";
import { CategoryBadge, ScreenshotThumb, StatusBadge } from "../components/feedbackBits";
import { TabBar, type TabDef } from "../components/TabBar";
import { IconCheck, IconSignOut } from "../icons";
import { formatDateTime } from "../lib";

// The team's side of feedback: everything anyone has sent, newest first, with a way to work the
// open ones down to none. Admins only — the sidebar hides it and the backend refuses it otherwise.

type TabId = "open" | "resolved" | "all";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join("") || "?").toUpperCase();
}

export function AllFeedbackPage({ onCountChange }: { onCountChange?: (open: number) => void }) {
  const [notes, setNotes] = useState<Feedback[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("open");

  const load = useCallback(() => {
    listAllFeedback()
      .then(({ feedback, open }) => {
        setNotes(feedback);
        setError(null);
        onCountChange?.(open);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load the feedback.")));
  }, [onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(note: Feedback) {
    setBusyId(note.id);
    setError(null);
    try {
      await setFeedbackStatus(note.id, note.status === "open" ? "resolved" : "open");
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't update that note."));
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(
    () => ({
      open: notes?.filter((n) => n.status === "open").length ?? 0,
      resolved: notes?.filter((n) => n.status === "resolved").length ?? 0,
      all: notes?.length ?? 0,
    }),
    [notes],
  );

  const shown = (notes ?? []).filter((n) => (tab === "all" ? true : n.status === tab));

  const tabs: TabDef<TabId>[] = [
    { id: "open", label: "Open", count: counts.open },
    { id: "resolved", label: "Resolved", count: counts.resolved },
    { id: "all", label: "All", count: counts.all },
  ];

  const emptyMessage = {
    open: "Nothing open — everything sent has been dealt with.",
    resolved: "Nothing resolved yet.",
    all: "No feedback has been sent yet.",
  }[tab];

  return (
    <div className="view">
      {error && (
        <p className="error ta-body-2" role="alert">
          {error}
        </p>
      )}

      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">All feedback</div>
            <div className="card-sub ta-caption-1">
              Everything the team has been sent · newest first
            </div>
          </div>
          <TabBar tabs={tabs} active={tab} onChange={setTab} label="Which feedback to show" />
        </div>

        {notes === null ? (
          <p className="feedback-empty muted ta-body-2">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="feedback-empty muted ta-body-2">{emptyMessage}</p>
        ) : (
          <ul className="feedback-list">
            {shown.map((note) => (
              <li key={note.id} className={`feedback-item${note.status === "resolved" ? " is-resolved" : ""}`}>
                <div className="feedback-head">
                  <span className="person">
                    <span className="avatar avatar-sm" aria-hidden="true">
                      {initials(note.authorName)}
                    </span>
                    <span className="feedback-author">
                      <span className="user-name ta-label-1">{note.authorName}</span>
                      <span className="user-email ta-caption-2">{note.authorEmail}</span>
                    </span>
                  </span>
                  <div className="feedback-meta">
                    <CategoryBadge category={note.category} />
                    <StatusBadge note={note} />
                    <span className="ta-caption-1 muted">{formatDateTime(note.createdAt)}</span>
                  </div>
                </div>

                <p className="feedback-message ta-body-2">{note.message}</p>
                {note.screenshot && (
                  <ScreenshotThumb src={note.screenshot} author={note.authorName} />
                )}

                <div className="feedback-actions">
                  {note.status === "resolved" && note.resolvedBy && (
                    <span className="ta-caption-1 muted">
                      Resolved by {note.resolvedBy}
                      {note.resolvedAt ? ` · ${formatDateTime(note.resolvedAt)}` : ""}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => void toggle(note)}
                    disabled={busyId === note.id}
                  >
                    {note.status === "open" ? <IconCheck size={14} /> : <IconSignOut size={14} />}
                    {note.status === "open" ? "Mark resolved" : "Reopen"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
