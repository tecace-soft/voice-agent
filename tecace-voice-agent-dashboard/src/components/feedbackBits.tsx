import { useEffect, useRef } from "react";
import type { Feedback, FeedbackCategory } from "../api/types";
import { IconAlert, IconCheck, IconExpand, IconIdea, IconTable } from "../icons";

// Shared between the "send feedback" page and the admin's "all feedback" page, so a note looks the
// same wherever it appears.

export const CATEGORIES: { id: FeedbackCategory; label: string; hint: string }[] = [
  { id: "bug", label: "Something's broken", hint: "A number looks wrong, a page errors, a run didn't record" },
  { id: "idea", label: "Idea or request", hint: "Something you wish the dashboard did" },
  { id: "data", label: "Question about the data", hint: "A transcript, a count, or a run you don't understand" },
  { id: "other", label: "Anything else", hint: "" },
];

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: "Broken",
  idea: "Idea",
  data: "Data",
  other: "Other",
};

const CATEGORY_ICON = {
  bug: IconAlert,
  idea: IconIdea,
  data: IconTable,
  other: IconIdea,
} as const;

export function CategoryBadge({ category }: { category: FeedbackCategory }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span className={`badge badge-cat cat-${category}`}>
      <Icon size={12} />
      {CATEGORY_LABEL[category]}
    </span>
  );
}

export function StatusBadge({ note }: { note: Feedback }) {
  if (note.status === "resolved") {
    return (
      <span className="badge badge-success" title={note.resolvedBy ? `Resolved by ${note.resolvedBy}` : undefined}>
        <IconCheck size={12} />
        Resolved
      </span>
    );
  }
  return <span className="badge badge-neutral">Open</span>;
}

// A screenshot on a note: a thumbnail that opens full size.
//
// Full size is a native <dialog>, which brings Esc-to-close, focus trapping and inertness of the
// page behind it without any of that being written here. The alternative — opening the image in a
// new tab — does not work: these are data: URLs, and browsers block top-level navigation to them.
export function ScreenshotThumb({ src, author }: { src: string; author?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alt = author ? `Screenshot attached by ${author}` : "Attached screenshot";

  // A dialog left open across a re-render (resolving a note, a list refresh) would otherwise stay
  // open over different content than it was opened from.
  useEffect(() => () => dialog.current?.close(), []);

  return (
    <>
      <button
        type="button"
        className="shot-thumb"
        onClick={() => dialog.current?.showModal()}
        title="View full size"
      >
        <img src={src} alt={alt} loading="lazy" />
        <span className="shot-thumb-zoom" aria-hidden="true">
          <IconExpand size={14} />
        </span>
        <span className="sr-only">View screenshot full size</span>
      </button>

      <dialog
        ref={dialog}
        className="shot-dialog"
        onClick={(e) => {
          // Clicking the backdrop closes; clicking the image itself must not. The dialog element
          // *is* the backdrop, so the target being the dialog means the click missed the content.
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <img src={src} alt={alt} />
        <button type="button" className="btn btn-quiet" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </dialog>
    </>
  );
}
