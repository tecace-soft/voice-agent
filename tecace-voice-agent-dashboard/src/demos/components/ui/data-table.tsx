import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableHead } from "@/components/ui/table";

// The dashboard's list-screen kit (dashboard-only). Every list that can grow past a screenful — Customers
// first — is built from these, so they all search, sort and page the same way. The rules they carry
// are written down in the dashboard's CLAUDE.md under "List screens".
//
// - SortableHead: a column header that sorts; a second click flips the direction.
// - useFitRows: how many rows fit between the table's top and the bottom of the window, so the
//   default page never scrolls.
// - usePaged: the page of rows to show, reset to the first page when the filter changes.
// - TablePagination: "1–25 of 1,240", the page size (Fit to screen / 25 / 50 / 100) and the pager.
//
// The paging runs on the client today. The shape (page, pageSize, total) is the one a server-side
// list will answer, so moving a screen to `?page=&pageSize=` later changes the fetch, not the UI.

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };

/** Flip the direction on the active column; a new column starts at its natural direction. */
export function nextSort<K extends string>(current: SortState<K>, key: K, natural: SortDir = "desc"): SortState<K> {
  return current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: natural };
}

export function SortableHead<K extends string>({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: K;
  sort: SortState<K>;
  onSort: (column: K) => void;
  className?: string;
}) {
  const active = sort.key === column;
  const Arrow = active && sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={cn("ta-caption-1 text-muted-foreground", className)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn("hover:text-foreground inline-flex items-center gap-1", active && "text-foreground")}
        aria-label={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <Arrow className={cn("size-3", active ? "opacity-100" : "opacity-0")} aria-hidden />
      </button>
    </TableHead>
  );
}

/** "fit" sizes the page to the window; a number is a fixed page size. */
export type PageSize = "fit" | 25 | 50 | 100;
export const PAGE_SIZES: PageSize[] = ["fit", 25, 50, 100];

/**
 * Rows that fit from the top of `ref` (the table) to the bottom of the window, leaving `reserve`
 * pixels below for the pagination bar and the page's own padding. Never fewer than `min`.
 */
export function useFitRows(ref: RefObject<HTMLElement | null>, rowHeight: number, reserve = 104, min = 5): number {
  const [rows, setRows] = useState(10);
  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const header = node.querySelector("thead")?.getBoundingClientRect().height ?? 40;
    const top = node.getBoundingClientRect().top;
    const available = window.innerHeight - top - header - reserve;
    setRows(Math.max(min, Math.floor(available / rowHeight)));
  }, [ref, rowHeight, reserve, min]);
  useLayoutEffect(() => {
    measure();
  }, [measure]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    // The toolbar above can wrap or unwrap without the window changing size.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const parent = ref.current?.parentElement;
    if (observer && parent) observer.observe(parent);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure, ref]);
  return rows;
}

/** The page of `rows` to show. Going back to page 1 whenever `resetKey` changes (a new filter). */
export function usePaged<T>(rows: T[], pageSize: number, resetKey: string) {
  const [page, setPage] = useState(1);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
    setPage(1);
  }
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => rows.slice((current - 1) * pageSize, current * pageSize),
    [rows, current, pageSize],
  );
  return {
    page: current,
    setPage,
    pageCount,
    pageRows,
    from: rows.length ? (current - 1) * pageSize + 1 : 0,
    to: Math.min(current * pageSize, rows.length),
    total: rows.length,
  };
}

/** Page numbers with gaps: 1 … 4 5 6 … 20. */
function pageList(page: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set([1, count, page - 1, page, page + 1].filter((p) => p >= 1 && p <= count));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1]! > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

const SIZE_LABEL = (size: PageSize, fitRows: number) => (size === "fit" ? `Fit to screen (${fitRows})` : `${size} per page`);

export function TablePagination({
  page,
  pageCount,
  from,
  to,
  total,
  noun,
  pageSize,
  fitRows,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  /** Plural, lower case: "customers". */
  noun: string;
  pageSize: PageSize;
  fitRows: number;
  onPage: (page: number) => void;
  onPageSize: (size: PageSize) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3" role="navigation" aria-label="Pages">
      <span className="ta-label-1 text-muted-foreground tabular-nums">
        {total ? `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} ${noun}` : `No ${noun}`}
      </span>
      <Select
        value={String(pageSize)}
        onValueChange={(value) => onPageSize(value === "fit" ? "fit" : (Number(value) as PageSize))}
      >
        <SelectTrigger className="w-44" aria-label="Rows per page">
          <SelectValue>{SIZE_LABEL(pageSize, fitRows)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {SIZE_LABEL(size, fitRows)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="flex-1" />
      {pageCount > 1 ? (
        <span className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          {pageList(page, pageCount).map((item, i) =>
            item === "gap" ? (
              <span key={`gap-${i}`} className="ta-label-1 text-muted-foreground px-1" aria-hidden>
                …
              </span>
            ) : (
              <Button
                key={item}
                variant={item === page ? "secondary" : "ghost"}
                size="sm"
                className="min-w-8 tabular-nums"
                aria-label={`Page ${item}`}
                aria-current={item === page ? "page" : undefined}
                onClick={() => onPage(item)}
              >
                {item}
              </Button>
            ),
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </span>
      ) : null}
    </div>
  );
}

/** A per-viewer remembered value (page size, sort) — browser storage, best effort. */
export function useRemembered<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private windows and blocked storage: the choice just isn't remembered.
      }
    },
    [key],
  );
  return [value, set];
}
