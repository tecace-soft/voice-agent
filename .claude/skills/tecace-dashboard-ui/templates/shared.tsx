/**
 * TecAce Dashboard — shared building blocks
 * Used by every page template. Keep these canonical: outlined cards (no shadow),
 * Poppins numerals, semantic delta colors, 4px-grid spacing.
 */
"use client";

import { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* ---------- KPI card ---------- */
export function StatCard({ title, value, delta, up, caption, spark }: {
  title: string; value: string; delta: string; up: boolean; caption: string; spark?: ReactNode;
}) {
  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="px-5 py-1">
        <div className="flex items-center justify-between">
          <span className="ta-label-1 text-muted-foreground">{title}</span>
          <Badge className={cn("rounded-full gap-0.5 border-none px-1.5 ta-caption-1",
            up ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{delta}
          </Badge>
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <span className="ta-numeric text-[28px] leading-9">{value}</span>
          {spark && <div className="h-10 w-24 shrink-0">{spark}</div>}
        </div>
        <p className="mt-1 ta-caption-1 text-muted-foreground">{caption}</p>
      </CardContent>
    </Card>
  );
}

/* ---------- Status badge ---------- */
export const STATUS_STYLES = {
  positive: "bg-success/10 text-success",       // Done, Paid, Healthy
  active: "bg-primary/10 text-primary",         // In progress, Active
  caution: "bg-warning/10 text-warning",        // In review, At risk
  negative: "bg-destructive/10 text-destructive", // Blocked, Churned, Failed
  neutral: "bg-secondary text-muted-foreground",  // Draft, Archived
} as const;

export function StatusBadge({ kind, children }: {
  kind: keyof typeof STATUS_STYLES; children: ReactNode;
}) {
  return (
    <Badge className={cn("rounded-full border-none ta-caption-1", STATUS_STYLES[kind])}>
      {children}
    </Badge>
  );
}

/* ---------- Chart card ---------- */
export function ChartCard({ title, description, action, className, children }: {
  title: string; description?: string; action?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <Card className={cn("rounded-xl shadow-none", className)}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="ta-headline-2">{title}</CardTitle>
          {description && <CardDescription className="ta-caption-1">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/* ---------- Page title row ---------- */
export function PageHeader({ title, subtitle, actions }: {
  title: string; subtitle?: string; actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="ta-title-3">{title}</h1>
        {subtitle && <p className="ta-label-1 text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

/* ---------- Sparkline (Chart.js Line with everything off) ---------- */
export const sparklineOptions = {
  maintainAspectRatio: false,
  scales: { x: { display: false }, y: { display: false } },
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  elements: { point: { radius: 0 } },
} as const;

export function sparklineData(values: number[], color: string) {
  return {
    labels: values.map((_, i) => String(i)),
    datasets: [{
      data: values, borderColor: color, backgroundColor: color + "1F",
      fill: true, tension: 0.4, borderWidth: 1.5,
    }],
  };
}
