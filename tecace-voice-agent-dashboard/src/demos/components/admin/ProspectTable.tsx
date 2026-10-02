import { demoFetch } from "@/api";
import { useMemo, useRef, useState } from "react";
import { Copy, MoreHorizontal, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, StatusBadge } from "@/components/admin/shared";
import { HEAT_KIND, HEAT_LABEL } from "@/components/admin/crm-shared";
import {
  SortableHead,
  TablePagination,
  nextSort,
  useFitRows,
  usePaged,
  useRemembered,
  type PageSize,
  type SortState,
} from "@/components/ui/data-table";
import { nextStep } from "@/lib/nextStep";
import { PHASE_LABELS, phaseOf } from "@/lib/phase";
import { readJson } from "@/lib/http";
import { customerLink } from "@/lib/share";
import { CUSTOMER_PHASES, type CustomerPhase, type CustomerWithStats, type Heat } from "@/lib/types";
import { demoHref } from "@/routes";

// Dashboard-only (see PORTING.md): the Prospects list, after docs/mockups/admin/prospects.html.
// The promo's CustomerTable with three columns folded into one "Next step" (status, phase and the
// live switch), a "Needs you" tab in front of the phases, and a row menu of three items. What left
// the row (the live switch, demo time, the email, the demo page) lives on the prospect's page.

type Props = {
  customers: CustomerWithStats[];
  onChanged: () => void;
};

type PhaseTab = "needs" | "all" | CustomerPhase;

const NO_CATEGORY = "(none)";

const PHASE_TAB_LABELS: Record<CustomerPhase, string> = { demo: "Demo", onboarding: "Onboarding", production: "Live" };

type SortKey = "heat" | "name" | "category" | "calls" | "views" | "created" | "last";

/** Each comparator sorts descending ("most first"); `asc` reverses it. Name and category read A to Z as desc. */
const SORTS: Record<SortKey, (a: CustomerWithStats, b: CustomerWithStats) => number> = {
  heat: (a, b) => b.heat.score - a.heat.score,
  name: (a, b) => (a.profile.name || a.businessName || "").localeCompare(b.profile.name || b.businessName || ""),
  category: (a, b) => (a.profile.category || "~").localeCompare(b.profile.category || "~"),
  calls: (a, b) => b.stats.calls - a.stats.calls || b.stats.totalSec - a.stats.totalSec,
  views: (a, b) => b.stats.views - a.stats.views || b.stats.visitors - a.stats.visitors,
  created: (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  last: (a, b) =>
    (b.stats.lastCallAt ?? b.stats.lastViewAt ?? "").localeCompare(a.stats.lastCallAt ?? a.stats.lastViewAt ?? ""),
};

function created(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
}

function minutesOf(customer: CustomerWithStats): string {
  const minutes = Math.round(customer.stats.totalSec / 60);
  return `${customer.stats.calls} ${customer.stats.calls === 1 ? "call" : "calls"}${customer.stats.calls ? ` · ${minutes} min` : ""}`;
}

/** The table's rows are two lines tall; the page is sized to whole rows of this height. */
const ROW_HEIGHT = 57;

export function ProspectTable({ customers, onChanged }: Props) {
  const [phase, setPhase] = useState<PhaseTab>("needs");
  const [category, setCategory] = useState("all");
  const [heat, setHeat] = useState<"all" | Heat>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useRemembered<SortState<SortKey>>("prospects.sort", { key: "heat", dir: "desc" });
  const [pageSize, setPageSize] = useRemembered<PageSize>("prospects.pageSize", "fit");
  const [pendingDelete, setPendingDelete] = useState<CustomerWithStats[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const steps = useMemo(() => new Map(customers.map((customer) => [customer.id, nextStep(customer)])), [customers]);
  const counts = useMemo(() => {
    const byPhase: Record<CustomerPhase, number> = { demo: 0, onboarding: 0, production: 0 };
    let needs = 0;
    for (const customer of customers) {
      byPhase[phaseOf(customer)] += 1;
      if (steps.get(customer.id)?.needsYou) needs += 1;
    }
    return { ...byPhase, needs, all: customers.length };
  }, [customers, steps]);
  const categories = useMemo(() => {
    const tally = new Map<string, number>();
    for (const customer of customers) {
      const name = customer.profile.category?.trim() || NO_CATEGORY;
      tally.set(name, (tally.get(name) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [customers]);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = customers.filter((customer) => {
      if (phase === "needs") {
        if (!steps.get(customer.id)?.needsYou) return false;
      } else if (phase !== "all" && phaseOf(customer) !== phase) return false;
      if (category !== "all" && (customer.profile.category?.trim() || NO_CATEGORY) !== category) return false;
      if (heat !== "all" && customer.heat.level !== heat) return false;
      if (!term) return true;
      return [
        customer.customerCode,
        customer.profile.name,
        customer.businessName,
        customer.profile.category,
        customer.label,
        customer.contactName,
        customer.contactEmail,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term));
    });
    const ordered = [...filtered].sort(SORTS[sort.key] ?? SORTS.heat);
    return sort.dir === "asc" ? ordered.reverse() : ordered;
  }, [customers, steps, phase, category, heat, query, sort]);

  const tableRef = useRef<HTMLDivElement>(null);
  const fitRows = useFitRows(tableRef, ROW_HEIGHT);
  const size = pageSize === "fit" ? fitRows : pageSize;
  const paged = usePaged(rows, size, JSON.stringify([query, phase, category, heat, sort, size]));
  const onSort = (key: SortKey) => setSort(nextSort(sort, key, "desc"));
  const filtered = Boolean(query) || category !== "all" || heat !== "all";

  // One at a time, so one refused (a demo someone is onboarding on answers 409) doesn't stop the rest.
  async function remove(targets: CustomerWithStats[]) {
    setDeleting(true);
    const failed: string[] = [];
    let removed = 0;
    for (const customer of targets) {
      try {
        await readJson(await demoFetch(`/customers/${customer.id}`, { method: "DELETE" }));
        removed += 1;
      } catch (caught) {
        failed.push(caught instanceof Error ? caught.message : `${customer.profile.name} could not be deleted.`);
      }
    }
    setDeleting(false);
    setPendingDelete(null);
    setSelected(new Set());
    if (removed) toast.success(removed === 1 ? "Prospect removed." : `${removed} prospects removed.`);
    for (const message of failed) toast.error(message);
    onChanged();
  }

  const visibleIds = paged.pageRows.map((customer) => customer.id);
  const selectedRows = customers.filter((customer) => selected.has(customer.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  function toggleOne(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleAllVisible(on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of visibleIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function copyLink(customer: CustomerWithStats) {
    void navigator.clipboard.writeText(customerLink(customer.id));
    toast.success("Link copied.");
  }

  const emptyMessage = !customers.length
    ? "No prospects yet. Add the first one and we research it."
    : phase === "needs" && !filtered
      ? "Nothing needs you right now."
      : "No prospects match this filter.";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={phase} onValueChange={(value) => setPhase(value as PhaseTab)}>
          <TabsList aria-label="Prospects by stage" className="h-auto flex-wrap">
            <TabsTrigger value="needs">Needs you · {counts.needs}</TabsTrigger>
            <TabsTrigger value="all">All · {counts.all}</TabsTrigger>
            {CUSTOMER_PHASES.map((value) => (
              <TabsTrigger key={value} value={value}>
                {PHASE_TAB_LABELS[value]} · {counts[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="flex-1" />
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search name, ID, contact"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
            aria-label="Search prospects"
          />
        </div>
        <Select value={category} onValueChange={(value) => setCategory(value ?? "all")}>
          <SelectTrigger className="w-44" aria-label="Filter by category">
            <SelectValue>
              <span className="truncate">{category === "all" ? "Any category" : category}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="all">Any category</SelectItem>
            {categories.map(([name, count]) => (
              <SelectItem key={name} value={name}>
                <span className="max-w-72 truncate">{name}</span>
                <span className="text-muted-foreground ml-auto pl-3 tabular-nums">{count}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={heat} onValueChange={(value) => setHeat((value as "all" | Heat) ?? "all")}>
          <SelectTrigger className="w-32" aria-label="Filter by heat">
            <SelectValue>{heat === "all" ? "Any heat" : HEAT_LABEL[heat]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any heat</SelectItem>
            {(["hot", "warm", "cold"] as Heat[]).map((level) => (
              <SelectItem key={level} value={level}>
                {HEAT_LABEL[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery("");
              setCategory("all");
              setHeat("all");
            }}
          >
            Reset
          </Button>
        ) : null}
        {selectedRows.length ? (
          <span className="flex items-center gap-2">
            <span className="ta-label-1 text-muted-foreground">{selectedRows.length} selected</span>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button variant="destructive" onClick={() => setPendingDelete(selectedRows)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          </span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Users className="size-6" />} message={emptyMessage} />
      ) : (
        <div ref={tableRef}>
          {/* Fixed layout: the columns share the width instead of pushing it, so the list never
              scrolls sideways; long names are cut with an ellipsis (full text on hover). */}
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-9">
                  <input
                    type="checkbox"
                    className="accent-primary size-4 align-middle"
                    aria-label="Select all shown prospects"
                    checked={allVisibleSelected}
                    onChange={(event) => toggleAllVisible(event.target.checked)}
                  />
                </TableHead>
                <SortableHead label="Prospect" column="name" sort={sort} onSort={onSort} className="w-[24%]" />
                <TableHead className="ta-caption-1 text-muted-foreground w-[17%]">Contact</TableHead>
                <SortableHead label="Heat" column="heat" sort={sort} onSort={onSort} className="w-[9%]" />
                <SortableHead label="Activity" column="calls" sort={sort} onSort={onSort} className="w-[13%]" />
                <TableHead className="ta-caption-1 text-muted-foreground w-[23%]">Next step</TableHead>
                <SortableHead label="Added" column="created" sort={sort} onSort={onSort} className="w-[8%]" />
                <TableHead className="w-11" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.pageRows.map((customer) => {
                const step = steps.get(customer.id)!;
                const name = customer.profile.name || customer.businessName || "Unnamed";
                return (
                  <TableRow
                    key={customer.id}
                    className="hover:bg-accent"
                    style={{ height: ROW_HEIGHT }}
                    data-state={selected.has(customer.id) ? "selected" : undefined}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        className="accent-primary size-4 align-middle"
                        aria-label={`Select ${name}`}
                        checked={selected.has(customer.id)}
                        onChange={(event) => toggleOne(customer.id, event.target.checked)}
                      />
                    </TableCell>
                    <TableCell className="min-w-0">
                      <a
                        href={demoHref("demoProspect", customer.id)}
                        className="ta-label-1 block truncate font-semibold hover:underline"
                        title={name}
                      >
                        {name}
                      </a>
                      <span
                        className="ta-caption-1 text-muted-foreground block truncate"
                        title={[customer.customerCode, customer.profile.category, PHASE_LABELS[phaseOf(customer)]].filter(Boolean).join(" · ")}
                      >
                        <span className="font-mono">{customer.customerCode ?? ""}</span>
                        {customer.profile.category ? ` · ${customer.profile.category}` : ""}
                        {` · ${PHASE_TAB_LABELS[phaseOf(customer)]}`}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-0">
                      <span className="ta-label-1 block truncate">{customer.contactName || customer.account?.name || ""}</span>
                      {customer.contactEmail || customer.account?.email ? (
                        <span className="ta-caption-1 text-muted-foreground block truncate" title={customer.contactEmail || customer.account?.email}>
                          {customer.contactEmail || customer.account?.email}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span title={customer.heat.reason}>
                        <StatusBadge kind={HEAT_KIND[customer.heat.level]}>{HEAT_LABEL[customer.heat.level]}</StatusBadge>
                      </span>
                    </TableCell>
                    <TableCell className="min-w-0 tabular-nums">
                      <span className="ta-label-1 block truncate">{minutesOf(customer)}</span>
                      <span className="ta-caption-1 text-muted-foreground block truncate">
                        {customer.stats.views ? `${customer.stats.views} ${customer.stats.views === 1 ? "open" : "opens"}` : "No opens yet"}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-0">
                      <span className="block truncate" title={step.label}>
                        {step.kind === "neutral" && !step.needsYou ? (
                          <span className="ta-label-1 text-muted-foreground">{step.label}</span>
                        ) : (
                          <StatusBadge kind={step.kind}>{step.label}</StatusBadge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="ta-caption-1 text-muted-foreground whitespace-nowrap tabular-nums" title={customer.createdAt ? new Date(customer.createdAt).toLocaleString() : undefined}>
                      {created(customer.createdAt)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon" aria-label="More actions">
                              <MoreHorizontal className="size-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="rounded-lg">
                          <DropdownMenuItem render={<a href={demoHref("demoProspect", customer.id)} />}>Open</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => copyLink(customer)}>
                            <Copy className="size-4" />
                            Copy demo link
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => setPendingDelete([customer])}>
                            <Trash2 className="size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TablePagination
            page={paged.page}
            pageCount={paged.pageCount}
            from={paged.from}
            to={paged.to}
            total={paged.total}
            noun="prospects"
            pageSize={pageSize}
            fitRows={fitRows}
            onPage={paged.setPage}
            onPageSize={setPageSize}
          />
        </div>
      )}

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="ta-headline-1">
              {pendingDelete && pendingDelete.length > 1 ? `Delete ${pendingDelete.length} prospects` : "Delete prospect"}
            </DialogTitle>
            <DialogDescription className="ta-body-2">
              This removes{" "}
              {pendingDelete && pendingDelete.length > 1
                ? `${pendingDelete.length} prospects`
                : pendingDelete?.[0]?.profile.name || pendingDelete?.[0]?.businessName}{" "}
              and {(pendingDelete ?? []).reduce((sum, customer) => sum + (customer.stats.calls ?? 0), 0)} call logs. The demo
              link stops working. This can&apos;t be undone.
            </DialogDescription>
            {pendingDelete && pendingDelete.length > 1 ? (
              <ul className="ta-caption-1 text-muted-foreground max-h-40 list-disc overflow-y-auto pl-5">
                {pendingDelete.map((customer) => (
                  <li key={customer.id}>{customer.profile.name || customer.businessName}</li>
                ))}
              </ul>
            ) : null}
            <p className="ta-caption-1 text-muted-foreground">
              A prospect in onboarding or live keeps its record. Unlink the account in Accounts first.
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => pendingDelete && void remove(pendingDelete)}>
              {deleting ? "Deleting" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
