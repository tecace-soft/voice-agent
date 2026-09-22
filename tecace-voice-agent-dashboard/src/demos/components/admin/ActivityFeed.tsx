
import { ENTRY_ICON, sinceLabel } from "@/components/admin/crm-shared";
import type { FeedEntry } from "@/lib/analytics";

/**
 * What moved, across every prospect, newest first.
 *
 * The board beside it says where each deal stands, which is a state and
 * changes rarely. This says what happened, which is what decides who gets
 * called today. Clicking a row opens the prospect it belongs to, so the two
 * halves work as one screen rather than two reports.
 */
export function ActivityFeed({
  entries,
  onOpen,
}: {
  entries: FeedEntry[];
  onOpen: (customerId: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <p className="ta-caption-1 text-muted-foreground">
        Nothing has happened yet. Send a demo link and what they do with it
        lands here.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {entries.map((entry, index) => {
        const Icon = ENTRY_ICON[entry.kind];
        return (
          <li key={`${entry.customerId}-${entry.kind}-${entry.at}-${index}`}>
            <button
              type="button"
              onClick={() => onOpen(entry.customerId)}
              className="hover:bg-accent flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-left"
            >
              <Icon
                className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="ta-label-1 block truncate">{entry.customerName}</span>
                <span className="ta-caption-2 text-muted-foreground block truncate">
                  {entry.text}
                </span>
              </span>
              <span className="ta-caption-2 text-muted-foreground shrink-0 tabular-nums">
                {sinceLabel(entry.at)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
