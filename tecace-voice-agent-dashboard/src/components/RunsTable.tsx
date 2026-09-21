import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { VoicemailRun } from "../api/types";
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconColumns,
} from "../icons";
import { formatDateTime, formatMailbox } from "../lib";

// Columns the run table can show. "When" is the row's identity, so it's never hideable; the rest
// can be toggled off from the Columns menu when the table gets busy.
const COLUMNS = [
  { key: "when", label: "When", numeric: false, fixed: true },
  { key: "mailbox", label: "Mailbox", numeric: false, fixed: false },
  { key: "status", label: "Status", numeric: false, fixed: false },
  { key: "voicemails", label: "Found", numeric: true, fixed: false },
  { key: "processed", label: "Transcribed", numeric: true, fixed: false },
  { key: "skipped", label: "Skipped", numeric: true, fixed: false },
  { key: "failed", label: "Failed", numeric: true, fixed: false },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];

const ROWS_PER_PAGE = [10, 20, 50];

// A run's outcome, as a pill: anything that errored is the thing worth seeing first.
function StatusBadge({ run }: { run: VoicemailRun }) {
  if (run.failed > 0) return <span className="badge badge-danger">Failed</span>;
  if (run.voicemails === 0) return <span className="badge badge-neutral">No voicemails</span>;
  return (
    <span className="badge badge-success">
      <IconCheck size={12} />
      Done
    </span>
  );
}

// Column-visibility menu — a plain popover (no menu library) that closes on outside click or Escape.
function ColumnsMenu({
  hidden,
  onToggle,
  showMailbox,
}: {
  hidden: Set<ColumnKey>;
  onToggle: (key: ColumnKey) => void;
  showMailbox: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="btn btn-quiet"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <IconColumns size={14} />
        Columns
        <IconChevronDown size={14} />
      </button>
      {open && (
        <div className="menu" role="group" aria-label="Toggle columns">
          {COLUMNS.filter((c) => !c.fixed && (showMailbox || c.key !== "mailbox")).map((c) => (
            <button
              type="button"
              key={c.key}
              className="menu-item"
              role="checkbox"
              aria-checked={!hidden.has(c.key)}
              onClick={() => onToggle(c.key)}
            >
              <span className="menu-check">{hidden.has(c.key) ? null : <IconCheck size={14} />}</span>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The run table card: a toolbar (the caller's tabs on the left, the Columns menu on the right),
// paginated rows, and a footer that says how much you're looking at. `runs` arrives newest-first;
// the caller decides which runs belong in the current tab. Pass a `key` that changes with the tab
// so paging state resets when the row set does.
export function RunsTable({
  runs,
  emptyMessage,
  tabs,
  showMailbox = false,
  detailsFor,
}: {
  runs: VoicemailRun[];
  emptyMessage: string;
  tabs?: ReactNode;
  /** Extra detail for a run, revealed by clicking its row. Returning null leaves that row plain and
   *  unclickable — so a table with nothing to expand behaves exactly as it did before. */
  detailsFor?: (run: VoicemailRun) => ReactNode | null;
  /** Whose data each row is. Only worth a column when the view mixes mailboxes — when everything
   *  on screen is one mailbox the column is the same value repeated. */
  showMailbox?: boolean;
}) {
  // Which run's detail is open. One at a time: these rows are read to answer "what happened here",
  // and several open at once turns the table back into the wall of text it is meant to summarise.
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<ColumnKey>>(() =>
    showMailbox ? new Set() : new Set<ColumnKey>(["mailbox"]),
  );
  const [perPage, setPerPage] = useState(ROWS_PER_PAGE[0]!);
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(runs.length / perPage));
  // A refresh can shrink the list out from under the current page.
  const current = Math.min(page, pageCount - 1);
  useEffect(() => {
    setPage(0);
  }, [perPage]);

  const visible = COLUMNS.filter((c) => !hidden.has(c.key));
  const rows = useMemo(
    () => runs.slice(current * perPage, current * perPage + perPage),
    [runs, current, perPage],
  );

  const cell = (run: VoicemailRun, key: ColumnKey) => {
    switch (key) {
      case "when":
        return formatDateTime(run.createdAt);
      case "status":
        return <StatusBadge run={run} />;
      case "mailbox":
        return (
          <span className={`mailbox-cell${run.mailboxEmail ? "" : " is-unattributed"}`}>
            {formatMailbox(run.mailboxEmail)}
          </span>
        );
      default:
        return run[key];
    }
  };

  const toggle = (key: ColumnKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="card">
      <div className="card-toolbar">
        {tabs}
        <ColumnsMenu hidden={hidden} onToggle={toggle} showMailbox={showMailbox} />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {visible.map((c) => (
                <th key={c.key} className={c.numeric ? "num" : undefined} scope="col">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="table-empty" colSpan={visible.length}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.flatMap((run) => {
                const detail = detailsFor?.(run) ?? null;
                const open = openRun === run.id;
                return [
                  <tr
                    key={run.id}
                    className={detail ? `row-expandable${open ? " is-open" : ""}` : undefined}
                    onClick={detail ? () => setOpenRun(open ? null : run.id) : undefined}
                    // Keyboard parity with the click, since the row is the control here.
                    tabIndex={detail ? 0 : undefined}
                    role={detail ? "button" : undefined}
                    aria-expanded={detail ? open : undefined}
                    onKeyDown={
                      detail
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setOpenRun(open ? null : run.id);
                            }
                          }
                        : undefined
                    }
                  >
                    {visible.map((c) => (
                      <td
                        key={c.key}
                        className={`${c.numeric ? "num" : ""}${
                          c.key === "failed" && run.failed > 0 ? " is-danger" : ""
                        }`.trim() || undefined}
                      >
                        {c.key === "when" && detail ? (
                          <span className="row-toggle">
                            <IconChevronDown size={14} className={`icon chevron${open ? " is-open" : ""}`} />
                            {cell(run, c.key)}
                          </span>
                        ) : (
                          cell(run, c.key)
                        )}
                      </td>
                    ))}
                  </tr>,
                  ...(open && detail
                    ? [
                        <tr key={`${run.id}-detail`} className="row-detail">
                          <td colSpan={visible.length}>{detail}</td>
                        </tr>,
                      ]
                    : []),
                ];
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="table-foot">
        <div className="ta-caption-1 muted">
          {runs.length.toLocaleString()} {runs.length === 1 ? "run" : "runs"}
        </div>
        <div className="table-foot-controls">
          <label className="rows-per-page ta-caption-1">
            Rows per page
            <select
              className="select"
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value))}
            >
              {ROWS_PER_PAGE.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="ta-caption-1 page-count">
            Page {current + 1} of {pageCount}
          </div>
          <div className="pager">
            <button
              type="button"
              className="icon-btn"
              aria-label="First page"
              disabled={current === 0}
              onClick={() => setPage(0)}
            >
              <IconChevronsLeft size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous page"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <IconChevronLeft size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next page"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
            >
              <IconChevronRight size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Last page"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(pageCount - 1)}
            >
              <IconChevronsRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
