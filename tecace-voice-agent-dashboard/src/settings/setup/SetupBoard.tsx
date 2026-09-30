import type { ReactNode } from "react";
import { Check, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SetupTopic, TopicStatus } from "../../api/types";
import type { SectionId } from "../../routing";
import type { CallSettings } from "../callSettings";
import { Tag } from "../sections/shared";
import { appointmentsCard, messageCard, timezoneCard, transferCard, type CardLine } from "./boardCopy";

// The settings board beside the guided setup: what the draft holds, in plain words, one card per
// setting, with the cards the consultant's latest reply touched lit for a moment. It shares the
// studio's side panel with the test console, which stays mounted (CSS-hidden) behind it.

type Props = {
  draft: CallSettings;
  dirty: boolean;
  publishedAt: string | null;
  topics: Record<SetupTopic, TopicStatus> | null; // null before a session
  highlightIds: ReadonlySet<string>;
  /** Opens the real editor; absent = read-only board (a demo). */
  onEdit?: (section: SectionId) => void;
  /** The console is CSS-hidden behind the board; this shows it again. */
  onShowConsole?: () => void;
  callActive?: boolean;
};

export function SetupBoard({
  draft,
  dirty,
  publishedAt,
  topics,
  highlightIds,
  onEdit,
  onShowConsole,
  callActive,
}: Props) {
  const transfers = draft.transfer.scenarios;
  const messages = draft.messages.scenarios;
  return (
    // A div, not an aside: the studio's side panel around it is already the "Settings board" landmark.
    <div data-board="settings" className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <p className="ta-label-1">Settings board</p>
        {dirty ? (
          <span className="ta-caption-2 bg-warning/15 text-warning rounded-full px-2 py-0.5">
            Draft — not published yet
          </span>
        ) : (
          <span className="ta-caption-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5">
            {publishedAt ? "Published" : "Nothing published yet"}
          </span>
        )}
        {onShowConsole ? (
          <div className="ml-auto flex items-center gap-1.5">
            {callActive ? (
              <>
                <span className="bg-success size-1.5 rounded-full" aria-hidden />
                <span className="sr-only">in progress</span>
              </>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onShowConsole}>
              <PhoneCall className="size-4" />
              Test call
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <BoardGroup
          id="board-transfers"
          title="Transfers"
          status={topics?.transfers}
          onEdit={onEdit ? () => onEdit("transfers") : undefined}
        >
          {transfers.length ? (
            transfers.map((s) => {
              const line = transferCard(s);
              return <BoardCard key={line.key} line={line} highlighted={highlightIds.has(line.key)} />;
            })
          ) : (
            <p className="ta-caption-1 text-muted-foreground">
              Nobody to put callers through to yet — the assistant takes a message.
            </p>
          )}
        </BoardGroup>

        <BoardGroup
          id="board-messages"
          title="Messages"
          status={topics?.messages}
          onEdit={onEdit ? () => onEdit("take-message") : undefined}
        >
          {messages.length ? (
            messages.map((s) => {
              const line = messageCard(s);
              return <BoardCard key={line.key} line={line} highlighted={highlightIds.has(line.key)} />;
            })
          ) : (
            <p className="ta-caption-1 text-muted-foreground">
              Every message gets the caller's name, number and what it's about. No special situations yet.
            </p>
          )}
        </BoardGroup>

        <BoardGroup
          id="board-appointments"
          title="Appointments"
          status={topics?.appointments}
          onEdit={onEdit ? () => onEdit("appointments") : undefined}
        >
          <BoardCard line={appointmentsCard(draft.appointments)} highlighted={highlightIds.has("appointments")} />
        </BoardGroup>

        <BoardGroup id="board-timezone" title="Time zone">
          <BoardCard line={timezoneCard(draft.timezone)} highlighted={highlightIds.has("timezone")} />
          <p className="ta-caption-2 text-muted-foreground">Tell the consultant to change it.</p>
        </BoardGroup>
      </div>
    </div>
  );
}

const STATUS_CHIP: Record<TopicStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  done: { label: "Done", className: "bg-primary/10 text-primary" },
  skipped: { label: "Skipped", className: "bg-muted text-muted-foreground" },
};

function BoardGroup({
  id,
  title,
  status,
  onEdit,
  children,
}: {
  id: string;
  title: string;
  status?: TopicStatus;
  onEdit?: () => void;
  children: ReactNode;
}) {
  const chip = status ? STATUS_CHIP[status] : null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 id={id} className="ta-label-1">
          {title}
        </h3>
        {chip ? (
          <span className={cn("ta-caption-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5", chip.className)}>
            {status === "done" ? <Check className="size-3" aria-hidden /> : null}
            {chip.label}
          </span>
        ) : null}
        {onEdit ? (
          <button type="button" className="ta-caption-1 text-primary ml-auto hover:underline" onClick={onEdit}>
            Edit
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function BoardCard({ line, highlighted }: { line: CardLine; highlighted: boolean }) {
  return (
    <div
      data-card={line.key}
      data-highlight={highlighted || undefined}
      className={cn(
        // An outline, not a ring: a ring is a box-shadow, and a card never has both border and shadow.
        "rounded-2xl border p-3 outline-2 outline-offset-0 outline-transparent transition-[outline-color,border-color] duration-150 ease-in-out",
        highlighted && "border-primary outline-primary/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="ta-label-1 font-semibold">{line.title}</p>
        {line.tag ? <Tag>{line.tag}</Tag> : null}
        {line.off ? <Tag>Off</Tag> : null}
      </div>
      {line.detail
        .filter((d) => d !== "")
        .map((d, i) => (
          <p key={i} className="ta-caption-1 text-muted-foreground">
            {d}
          </p>
        ))}
    </div>
  );
}
