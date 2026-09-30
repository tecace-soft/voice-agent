
import { demoFetch } from "@/api";
import { useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Search,
  Copy,
  ExternalLink,
  Mail,
  MoreHorizontal,
  Trash2,
  Users,
} from "lucide-react";
import { dueFollowUps } from "@/lib/analytics";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AddDemoTimeSubmenu } from "@/components/admin/AddDemoTimeMenu";
import { EmptyState, StatusBadge, statusKind } from "@/components/admin/shared";
import { isResearchStalled } from "@/lib/analytics";
import { customerLink, emailBody, emailSubject } from "@/lib/share";
import { CUSTOMER_PHASES, type CustomerPhase, type CustomerWithStats } from "@/lib/types";
import { PHASE_KIND, PHASE_LABELS, phaseOf } from "@/lib/phase";
import { demoHref } from "@/routes";
import { readJson } from "@/lib/http";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

type Props = {
  customers: CustomerWithStats[];
  onChanged: () => void;
};

const STATUS_LABELS: Record<string, string> = {
  all: "All statuses",
  ready: "Ready",
  researching: "Researching",
  error: "Error",
};

/** The tabs across the top: every customer, the ones waiting on us, then each phase. */
type PhaseTab = "all" | "requested" | "signups" | CustomerPhase;

const NO_CATEGORY = "(none)";

function relative(iso?: string): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Which column the list is ordered by. Heat first: it answers "who now?". */
type SortKey = "heat" | "name" | "category" | "calls" | "views" | "created" | "last";

const SORT_LABELS: Record<SortKey, string> = {
  heat: "Interest",
  name: "Name",
  category: "Category",
  calls: "Calls",
  views: "Link opens",
  created: "Created",
  last: "Last activity",
};

/** Each comparator sorts descending ("most first"); `asc` reverses it. Name and category read A–Z as desc. */
const SORTS: Record<SortKey, (a: CustomerWithStats, b: CustomerWithStats) => number> = {
  heat: (a, b) => b.heat.score - a.heat.score,
  name: (a, b) => (a.profile.name || a.businessName || "").localeCompare(b.profile.name || b.businessName || ""),
  category: (a, b) => (a.profile.category || "~").localeCompare(b.profile.category || "~"),
  calls: (a, b) => b.stats.calls - a.stats.calls || b.stats.totalSec - a.stats.totalSec,
  views: (a, b) => b.stats.views - a.stats.views || b.stats.visitors - a.stats.visitors,
  created: (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  last: (a, b) =>
    (b.stats.lastCallAt ?? b.stats.lastViewAt ?? "").localeCompare(
      a.stats.lastCallAt ?? a.stats.lastViewAt ?? "",
    ),
};

/** Where a first click on a column starts: A–Z for words, most/newest first for the rest. */
const NATURAL: Record<SortKey, "asc" | "desc"> = {
  heat: "desc",
  name: "desc",
  category: "desc",
  calls: "desc",
  views: "desc",
  created: "desc",
  last: "desc",
};

function created(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
}

/** The table's rows are two lines tall; the page is sized to whole rows of this height. */
const ROW_HEIGHT = 57;

const HEAT_KIND = { hot: "negative", warm: "caution", cold: "neutral" } as const;

export function CustomerTable({ customers, onChanged }: Props) {
  const [status, setStatus] = useState("all");
  const [phase, setPhase] = useState<PhaseTab>("all");
  const [category, setCategory] = useState("all");
  const phaseCounts = useMemo(() => {
    const counts: Record<CustomerPhase, number> = { demo: 0, onboarding: 0, production: 0 };
    for (const customer of customers) counts[phaseOf(customer)] += 1;
    return counts;
  }, [customers]);
  // Demo customers waiting for an admin's Approve or Decline (PORTING.md: phase gates).
  const requestedCount = useMemo(
    () => customers.filter((customer) => customer.request).length,
    [customers],
  );
  // Businesses that signed themselves up at /start and are still in the demo.
  const isSignup = (customer: CustomerWithStats) => customer.account?.source === "start" && phaseOf(customer) === "demo";
  const signupCount = useMemo(() => customers.filter(isSignup).length, [customers]); // eslint-disable-line react-hooks/exhaustive-deps
  // The business categories research found, commonest first, for the category filter.
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const customer of customers) {
      const name = customer.profile.category?.trim() || NO_CATEGORY;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [customers]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useRemembered<SortState<SortKey>>("customers.sort", { key: "heat", dir: "desc" });
  const [pageSize, setPageSize] = useRemembered<PageSize>("customers.pageSize", "fit");
  const [dueOnly, setDueOnly] = useState(false);
  const dueCount = useMemo(() => dueFollowUps(customers).length, [customers]);
  // Dashboard-only (PORTING.md): delete works on a selection, one row from its menu or many ticked.
  const [pendingDelete, setPendingDelete] = useState<CustomerWithStats[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const due = new Set(dueFollowUps(customers).map((customer) => customer.id));
    const filtered = customers.filter((customer) => {
      if (dueOnly && !due.has(customer.id)) return false;
      if (status !== "all" && customer.status !== status) return false;
      if (category !== "all" && (customer.profile.category?.trim() || NO_CATEGORY) !== category) return false;
      if (phase === "requested") {
        if (!customer.request) return false;
      } else if (phase === "signups") {
        if (!isSignup(customer)) return false;
      } else if (phase !== "all" && phaseOf(customer) !== phase) {
        return false;
      }
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
    const compare = SORTS[sort.key] ?? SORTS.heat;
    const ordered = [...filtered].sort(compare);
    return sort.dir === "asc" ? ordered.reverse() : ordered;
  }, [customers, dueOnly, phase, query, sort, status, category]); // eslint-disable-line react-hooks/exhaustive-deps

  // Paging: by default as many rows as fit the window, so the list never scrolls.
  const tableRef = useRef<HTMLDivElement>(null);
  const fitRows = useFitRows(tableRef, ROW_HEIGHT);
  const size = pageSize === "fit" ? fitRows : pageSize;
  const paged = usePaged(rows, size, JSON.stringify([query, status, phase, category, dueOnly, sort, size]));
  const onSort = (key: SortKey) => setSort(nextSort(sort, key, NATURAL[key]));
  const filtered = query || status !== "all" || category !== "all" || dueOnly;

  async function toggleActive(customer: CustomerWithStats, active: boolean) {
    setBusyId(customer.id);
    try {
      await demoFetch(`/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      toast.success(active ? "Demo is live." : "Demo is paused.");
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

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
    if (removed) toast.success(removed === 1 ? "Customer removed." : `${removed} customers removed.`);
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

  function copyEmail(customer: CustomerWithStats) {
    const text = `${emailSubject(customer.profile.name)}\n\n${emailBody(
      customer.profile.name,
      customer.contactName,
      customerLink(customer.id),
    )}`;
    void navigator.clipboard.writeText(text);
    toast.success("Email copied.");
  }

  return (
    <div className="space-y-3">
      <Tabs value={phase} onValueChange={(value) => setPhase(value as PhaseTab)}>
        <TabsList aria-label="Customers by phase" className="h-auto flex-wrap">
          <TabsTrigger value="all">All · {customers.length}</TabsTrigger>
          <TabsTrigger value="requested">Setup requested · {requestedCount}</TabsTrigger>
          <TabsTrigger value="signups">New signups · {signupCount}</TabsTrigger>
          {CUSTOMER_PHASES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {PHASE_LABELS[value]} · {phaseCounts[value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search name, ID, category or contact"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-8"
            aria-label="Search customers"
          />
        </div>
        <Select value={category} onValueChange={(value) => setCategory(value ?? "all")}>
          <SelectTrigger className="w-56" aria-label="Filter by category">
            <SelectValue>
              <span className="truncate">{category === "all" ? "All categories" : category}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(([name, count]) => (
              <SelectItem key={name} value={name}>
                <span className="max-w-72 truncate">{name}</span>
                <span className="text-muted-foreground ml-auto pl-3 tabular-nums">{count}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(value) => setStatus(value ?? "all")}>
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue>{STATUS_LABELS[status]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="researching">Researching</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={`${sort.key}:${sort.dir}`}
          onValueChange={(value) => {
            const [key, dir] = String(value).split(":") as [SortKey, "asc" | "desc"];
            setSort({ key, dir });
          }}
        >
          <SelectTrigger className="w-48" aria-label="Sort customers">
            <SelectValue>
              Sort: {SORT_LABELS[sort.key]} {sort.dir === "asc" ? "↑" : "↓"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="heat:desc">Interest, hottest first</SelectItem>
            <SelectItem value="created:desc">Newest first</SelectItem>
            <SelectItem value="created:asc">Oldest first</SelectItem>
            <SelectItem value="name:desc">Name, A–Z</SelectItem>
            <SelectItem value="category:desc">Category, A–Z</SelectItem>
            <SelectItem value="calls:desc">Most calls</SelectItem>
            <SelectItem value="views:desc">Most link opens</SelectItem>
            <SelectItem value="last:desc">Recently active</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={dueOnly ? "default" : "outline"}
          onClick={() => setDueOnly((current) => !current)}
        >
          <CalendarClock className="size-4" />
          Follow-ups due
          {dueCount ? ` (${dueCount})` : ""}
        </Button>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery("");
              setStatus("all");
              setCategory("all");
              setDueOnly(false);
            }}
          >
            Reset
          </Button>
        ) : null}
        {selectedRows.length ? (
          <span className="ml-auto flex items-center gap-2">
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
        <EmptyState
          icon={<Users className="size-6" />}
          message={
            customers.length
              ? "No customers match this filter."
              : "No customers yet. Add your first customer to get started."
          }
        />
      ) : (
        <div ref={tableRef}>
        {/* Fixed layout: the columns share the width instead of pushing it, so the list never
            scrolls sideways; long names and categories are cut with an ellipsis (full text on hover). */}
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-9">
                <input
                  type="checkbox"
                  className="accent-primary size-4 align-middle"
                  aria-label="Select all shown customers"
                  checked={allVisibleSelected}
                  onChange={(event) => toggleAllVisible(event.target.checked)}
                />
              </TableHead>
              <SortableHead label="Customer" column="name" sort={sort} onSort={onSort} className="w-[24%]" />
              <TableHead className="ta-caption-1 text-muted-foreground w-[17%]">Contact</TableHead>
              <TableHead className="ta-caption-1 text-muted-foreground w-[12%]">Phase</TableHead>
              <SortableHead label="Interest" column="heat" sort={sort} onSort={onSort} className="w-[12%]" />
              <TableHead className="ta-caption-1 text-muted-foreground w-[11%]">Status</TableHead>
              <TableHead className="ta-caption-1 text-muted-foreground w-12">Live</TableHead>
              <SortableHead label="Activity" column="calls" sort={sort} onSort={onSort} className="w-[14%]" />
              <SortableHead label="Created" column="created" sort={sort} onSort={onSort} className="w-[8%]" />
              <TableHead className="w-11" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.pageRows.map((customer) => (
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
                    aria-label={`Select ${customer.profile.name || customer.businessName}`}
                    checked={selected.has(customer.id)}
                    onChange={(event) => toggleOne(customer.id, event.target.checked)}
                  />
                </TableCell>
                <TableCell className="min-w-0">
                  <a
                    href={demoHref("demoProspect", customer.id)}
                    className="ta-label-1 block truncate font-semibold hover:underline"
                    title={customer.profile.name || customer.businessName || undefined}
                  >
                    {customer.profile.name || customer.businessName || "Unnamed"}
                  </a>
                  <span
                    className="ta-caption-1 text-muted-foreground block truncate"
                    title={[customer.profile.category, customer.label].filter(Boolean).join(" · ") || undefined}
                  >
                    <span className="font-mono">{customer.customerCode ?? "—"}</span>
                    {customer.profile.category ? ` · ${customer.profile.category}` : ""}
                    {customer.label ? ` · ${customer.label}` : ""}
                  </span>
                </TableCell>
                <TableCell className="min-w-0">
                  <span className="ta-label-1 block truncate">{customer.contactName || "—"}</span>
                  {customer.contactEmail ? (
                    <span className="ta-caption-1 text-muted-foreground block truncate" title={customer.contactEmail}>
                      {customer.contactEmail}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <span className="inline-flex flex-wrap gap-1">
                    <StatusBadge kind={PHASE_KIND[phaseOf(customer)]}>
                      {PHASE_LABELS[phaseOf(customer)]}
                    </StatusBadge>
                    {customer.request ? (
                      <StatusBadge kind="caution">Setup requested</StatusBadge>
                    ) : null}
                    {isSignup(customer) ? <StatusBadge kind="neutral">Signed up</StatusBadge> : null}
                  </span>
                </TableCell>
                <TableCell className="min-w-0">
                  <span title={customer.heat.reason}>
                    <StatusBadge kind={HEAT_KIND[customer.heat.level]}>
                      {customer.heat.level}
                    </StatusBadge>
                  </span>
                  <span className="ta-caption-2 text-muted-foreground block truncate pt-0.5" title={customer.heat.reason}>
                    {customer.heat.reason}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge
                    kind={
                      isResearchStalled(customer)
                        ? "negative"
                        : customer.status === "ready" && !customer.researchedAt
                          ? "neutral"
                          : statusKind(customer.status)
                    }
                  >
                    {customer.status === "ready"
                      ? customer.researchedAt
                        ? "Ready"
                        : "Not researched"
                      : customer.status === "error"
                        ? "Error"
                        : isResearchStalled(customer)
                          ? "Stalled"
                          : "Researching"}
                  </StatusBadge>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={customer.active}
                    disabled={busyId === customer.id}
                    onCheckedChange={(checked) => toggleActive(customer, checked)}
                    aria-label={`Toggle the demo for ${customer.profile.name}`}
                  />
                </TableCell>
                <TableCell className="min-w-0 tabular-nums">
                  <span className="ta-label-1 block truncate">
                    {customer.stats.calls} calls · {Math.round((customer.stats.totalSec / 60) * 10) / 10} min
                  </span>
                  <span
                    className="ta-caption-1 text-muted-foreground block truncate"
                    title={`Last call: ${relative(customer.stats.lastCallAt)}`}
                  >
                    {customer.stats.views} opens · {customer.stats.visitors} people
                  </span>
                </TableCell>
                <TableCell className="ta-label-1 whitespace-nowrap tabular-nums" title={customer.createdAt ? new Date(customer.createdAt).toLocaleString() : undefined}>
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
                      <DropdownMenuItem
                        render={<a href={demoHref("demoProspect", customer.id)} />}
                      >
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => copyLink(customer)}>
                        <Copy className="size-4" />
                        Copy link
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => copyEmail(customer)}>
                        <Mail className="size-4" />
                        Copy email
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        render={
                          <a
                            href={customerLink(customer.id)}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        <ExternalLink className="size-4" />
                        Open demo
                      </DropdownMenuItem>
                      <AddDemoTimeSubmenu customerId={customer.id} onAdded={onChanged} />
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setPendingDelete([customer])}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination
          page={paged.page}
          pageCount={paged.pageCount}
          from={paged.from}
          to={paged.to}
          total={paged.total}
          noun="customers"
          pageSize={pageSize}
          fitRows={fitRows}
          onPage={paged.setPage}
          onPageSize={setPageSize}
        />
        </div>
      )}

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="ta-headline-1">
              {pendingDelete && pendingDelete.length > 1 ? `Delete ${pendingDelete.length} customers` : "Delete customer"}
            </DialogTitle>
            <DialogDescription className="ta-body-2">
              This removes{" "}
              {pendingDelete && pendingDelete.length > 1
                ? `${pendingDelete.length} customers`
                : pendingDelete?.[0]?.profile.name || pendingDelete?.[0]?.businessName}{" "}
              and {(pendingDelete ?? []).reduce((sum, customer) => sum + (customer.stats.calls ?? 0), 0)} call
              logs. The demo link stops working. This can&apos;t be undone.
            </DialogDescription>
            {pendingDelete && pendingDelete.length > 1 ? (
              <ul className="ta-caption-1 text-muted-foreground max-h-40 list-disc overflow-y-auto pl-5">
                {pendingDelete.map((customer) => (
                  <li key={customer.id}>{customer.profile.name || customer.businessName}</li>
                ))}
              </ul>
            ) : null}
            <p className="ta-caption-1 text-muted-foreground">
              A customer in onboarding or live keeps its record — unlink the account in Accounts first.
            </p>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => pendingDelete && void remove(pendingDelete)}
            >
              {deleting ? "Deleting" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
