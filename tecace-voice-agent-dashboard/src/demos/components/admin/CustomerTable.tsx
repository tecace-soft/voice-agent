
import { demoFetch } from "@/api";
import { useMemo, useState } from "react";
import {
  ArrowDown,
  CalendarClock,
  Copy,
  ExternalLink,
  Mail,
  MoreHorizontal,
  Trash2,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import { EmptyState, StatusBadge, statusKind } from "@/components/admin/shared";
import { isResearchStalled } from "@/lib/analytics";
import { customerLink, emailBody, emailSubject } from "@/lib/share";
import type { CustomerWithStats } from "@/lib/types";
import { demoHref } from "@/routes";

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
type SortKey = "heat" | "name" | "views" | "visitors" | "calls" | "minutes" | "last";

const SORTS: Record<SortKey, (a: CustomerWithStats, b: CustomerWithStats) => number> = {
  heat: (a, b) => b.heat.score - a.heat.score,
  name: (a, b) => (a.profile.name || "").localeCompare(b.profile.name || ""),
  views: (a, b) => b.stats.views - a.stats.views,
  visitors: (a, b) => b.stats.visitors - a.stats.visitors,
  calls: (a, b) => b.stats.calls - a.stats.calls,
  minutes: (a, b) => b.stats.totalSec - a.stats.totalSec,
  last: (a, b) =>
    (b.stats.lastCallAt ?? b.stats.lastViewAt ?? "").localeCompare(
      a.stats.lastCallAt ?? a.stats.lastViewAt ?? "",
    ),
};

const HEAT_KIND = { hot: "negative", warm: "caution", cold: "neutral" } as const;

function SortHead({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sort: SortKey;
  onSort: (column: SortKey) => void;
  className?: string;
}) {
  const active = sort === column;
  return (
    <TableHead className={cn("ta-caption-1 text-muted-foreground", className)}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1",
          active && "text-foreground",
        )}
        aria-label={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <ArrowDown
          className={cn("size-3", active ? "opacity-100" : "opacity-0")}
          aria-hidden
        />
      </button>
    </TableHead>
  );
}

export function CustomerTable({ customers, onChanged }: Props) {
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("heat");
  const [dueOnly, setDueOnly] = useState(false);
  const dueCount = useMemo(() => dueFollowUps(customers).length, [customers]);
  const [pendingDelete, setPendingDelete] = useState<CustomerWithStats | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const due = new Set(dueFollowUps(customers).map((customer) => customer.id));
    const filtered = customers.filter((customer) => {
      if (dueOnly && !due.has(customer.id)) return false;
      if (status !== "all" && customer.status !== status) return false;
      if (!term) return true;
      return [
        customer.profile.name,
        customer.label,
        customer.contactName,
        customer.contactEmail,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term));
    });
    return [...filtered].sort(SORTS[sort]);
  }, [customers, dueOnly, query, sort, status]);

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

  async function remove(customer: CustomerWithStats) {
    await demoFetch(`/customers/${customer.id}`, { method: "DELETE" });
    toast.success("Customer removed.");
    setPendingDelete(null);
    onChanged();
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search business or contact"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-64"
          aria-label="Search customers"
        />
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
        <Button
          variant={dueOnly ? "default" : "outline"}
          onClick={() => setDueOnly((current) => !current)}
        >
          <CalendarClock className="size-4" />
          Follow-ups due
          {dueCount ? ` (${dueCount})` : ""}
        </Button>
        {query || status !== "all" || dueOnly ? (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery("");
              setStatus("all");
              setDueOnly(false);
            }}
          >
            Reset
          </Button>
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
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Business" column="name" sort={sort} onSort={setSort} />
              <TableHead className="ta-caption-1 text-muted-foreground">Contact</TableHead>
              <SortHead label="Interest" column="heat" sort={sort} onSort={setSort} />
              <TableHead className="ta-caption-1 text-muted-foreground">Status</TableHead>
              <TableHead className="ta-caption-1 text-muted-foreground">Live</TableHead>
              <SortHead
                label="People"
                column="visitors"
                sort={sort}
                onSort={setSort}
                className="text-right"
              />
              <SortHead
                label="Opens"
                column="views"
                sort={sort}
                onSort={setSort}
                className="text-right"
              />
              <SortHead
                label="Calls"
                column="calls"
                sort={sort}
                onSort={setSort}
                className="text-right"
              />
              <SortHead
                label="Minutes"
                column="minutes"
                sort={sort}
                onSort={setSort}
                className="text-right"
              />
              <SortHead
                label="Last call"
                column="last"
                sort={sort}
                onSort={setSort}
                className="hidden xl:table-cell"
              />
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((customer) => (
              <TableRow key={customer.id} className="hover:bg-accent h-11">
                <TableCell className="ta-label-1">
                  <a
                    href={demoHref("demoProspect", customer.id)}
                    className="hover:underline"
                  >
                    {customer.profile.name || "Unnamed"}
                  </a>
                  {customer.label ? (
                    <span className="ta-caption-1 text-muted-foreground block">
                      {customer.label}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="ta-label-1">
                  {customer.contactName || "—"}
                  {customer.contactEmail ? (
                    <span className="ta-caption-1 text-muted-foreground block">
                      {customer.contactEmail}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <span title={customer.heat.reason}>
                    <StatusBadge kind={HEAT_KIND[customer.heat.level]}>
                      {customer.heat.level}
                    </StatusBadge>
                  </span>
                  <span className="ta-caption-2 text-muted-foreground block pt-0.5">
                    {customer.heat.reason}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge
                    kind={
                      isResearchStalled(customer)
                        ? "negative"
                        : statusKind(customer.status)
                    }
                  >
                    {customer.status === "ready"
                      ? "Ready"
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
                <TableCell className="ta-label-1 text-right tabular-nums">
                  {customer.stats.visitors}
                </TableCell>
                <TableCell className="ta-label-1 text-right tabular-nums">
                  {customer.stats.views}
                </TableCell>
                <TableCell className="ta-label-1 text-right tabular-nums">
                  {customer.stats.calls}
                </TableCell>
                <TableCell className="ta-label-1 text-right tabular-nums">
                  {Math.round((customer.stats.totalSec / 60) * 10) / 10}
                </TableCell>
                <TableCell className="ta-label-1 hidden xl:table-cell">
                  {relative(customer.stats.lastCallAt)}
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
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setPendingDelete(customer)}
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
      )}

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="ta-headline-1">Delete customer</DialogTitle>
            <DialogDescription className="ta-body-2">
              This removes {pendingDelete?.profile.name} and{" "}
              {pendingDelete?.stats.calls ?? 0} call logs. The demo link stops working.
              This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingDelete && remove(pendingDelete)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
