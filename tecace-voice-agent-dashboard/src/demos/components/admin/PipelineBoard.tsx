
import { ChevronLeft, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/admin/shared";
import { FOLLOW_UP_ICON, HEAT_KIND, STAGE_LABEL, sinceLabel } from "@/components/admin/crm-shared";
import { formatDuration } from "@/lib/analytics";
import { CUSTOMER_STAGES } from "@/lib/types";
import type { CustomerStage, CustomerWithStats } from "@/lib/types";

/** The last thing that happened, whichever it was. */
function lastActivity(customer: CustomerWithStats): string | undefined {
  const { lastCallAt, lastViewAt } = customer.stats;
  if (lastCallAt && lastViewAt) return lastCallAt > lastViewAt ? lastCallAt : lastViewAt;
  return lastCallAt ?? lastViewAt;
}

function Card({
  customer,
  overdue,
  onOpen,
  onMove,
}: {
  customer: CustomerWithStats;
  overdue: boolean;
  onOpen: () => void;
  onMove: (stage: CustomerStage) => void;
}) {
  const stage = customer.stage ?? "new";
  const index = CUSTOMER_STAGES.indexOf(stage);
  const at = lastActivity(customer);
  const minutes = Math.round((customer.stats.totalSec / 60) * 10) / 10;

  return (
    <li className="group hover:border-ring/60 rounded-lg border p-2.5 transition-colors">
      <button type="button" onClick={onOpen} className="w-full space-y-1.5 text-left">
        <span className="ta-label-1 line-clamp-2 block">
          {customer.profile.name || customer.businessName || "Unnamed"}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge kind={HEAT_KIND[customer.heat.level]}>
            {customer.heat.level}
          </StatusBadge>
          {at ? (
            <span className="ta-caption-2 text-muted-foreground">{sinceLabel(at)}</span>
          ) : (
            <span className="ta-caption-2 text-muted-foreground">no activity</span>
          )}
        </span>
        <span className="ta-caption-2 text-muted-foreground block tabular-nums">
          {customer.stats.calls} call{customer.stats.calls === 1 ? "" : "s"}
          {minutes >= 0.1 ? ` · ${formatDuration(customer.stats.totalSec)}` : ""}
        </span>
        {overdue ? (
          <span className="ta-caption-2 text-warning flex items-center gap-1">
            <FOLLOW_UP_ICON className="size-3" aria-hidden />
            Follow up due
          </span>
        ) : null}
      </button>

      {/*
        A board nobody can move things on is a list with extra whitespace, and
        a drag library is a lot of weight for five columns. Two arrows nudge a
        card one stage either way; the drawer has the full picker.
      */}
      <div className="mt-1.5 flex justify-between opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          disabled={index <= 0}
          onClick={() => onMove(CUSTOMER_STAGES[index - 1]!)}
          aria-label={
            index > 0 ? `Move back to ${STAGE_LABEL[CUSTOMER_STAGES[index - 1]!]}` : "Already first"
          }
          className="text-muted-foreground hover:text-foreground disabled:opacity-20"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          disabled={index >= CUSTOMER_STAGES.length - 1}
          onClick={() => onMove(CUSTOMER_STAGES[index + 1]!)}
          aria-label={
            index < CUSTOMER_STAGES.length - 1
              ? `Move on to ${STAGE_LABEL[CUSTOMER_STAGES[index + 1]!]}`
              : "Already last"
          }
          className="text-muted-foreground hover:text-foreground disabled:opacity-20"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </li>
  );
}

export function PipelineBoard({
  customers,
  overdueIds,
  onOpen,
  onMove,
}: {
  customers: CustomerWithStats[];
  overdueIds: Set<string>;
  onOpen: (customer: CustomerWithStats) => void;
  onMove: (customer: CustomerWithStats, stage: CustomerStage) => void;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="grid min-w-[52rem] grid-cols-5 gap-3">
        {CUSTOMER_STAGES.map((stage) => {
          // Hottest first inside a column: the stage says where it stands, the
          // order says who to call.
          const inStage = customers
            .filter((customer) => (customer.stage ?? "new") === stage)
            .sort((a, b) => b.heat.score - a.heat.score);
          return (
            <section key={stage} className="flex flex-col gap-2">
              <header className="flex items-baseline justify-between gap-2 px-0.5">
                <h3 className="ta-label-1">{STAGE_LABEL[stage]}</h3>
                <span className="ta-caption-2 text-muted-foreground tabular-nums">
                  {inStage.length}
                </span>
              </header>
              {inStage.length === 0 ? (
                <div className="bg-muted/30 ta-caption-2 text-muted-foreground flex min-h-24 items-center justify-center rounded-lg px-2 text-center">
                  Nobody here
                </div>
              ) : (
                <ul className="space-y-2">
                  {inStage.map((customer) => (
                    <Card
                      key={customer.id}
                      customer={customer}
                      overdue={overdueIds.has(customer.id)}
                      onOpen={() => onOpen(customer)}
                      onMove={(next) => onMove(customer, next)}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
