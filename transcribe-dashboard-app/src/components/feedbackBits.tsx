import type { Feedback, FeedbackCategory } from "../api/types";
import { IconAlert, IconCheck, IconIdea, IconTable } from "../icons";

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
