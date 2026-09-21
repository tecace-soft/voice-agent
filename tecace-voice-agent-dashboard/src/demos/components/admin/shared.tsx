
import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StatCard({
  title,
  value,
  caption,
}: {
  title: string;
  value: string;
  caption?: string;
}) {
  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="px-5 py-1">
        <span className="ta-label-1 text-muted-foreground">{title}</span>
        <div className="mt-2 flex items-end justify-between gap-3">
          <span className="ta-numeric text-[28px] leading-9">{value}</span>
        </div>
        {caption ? (
          <p className="ta-caption-1 mt-1 text-muted-foreground">{caption}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export const STATUS_STYLES = {
  positive: "bg-success/10 text-success",
  active: "bg-primary/10 text-primary",
  caution: "bg-warning/10 text-warning",
  negative: "bg-destructive/10 text-destructive",
  neutral: "bg-secondary text-muted-foreground",
} as const;

export function StatusBadge({
  kind,
  children,
}: {
  kind: keyof typeof STATUS_STYLES;
  children: ReactNode;
}) {
  return (
    <Badge className={cn("ta-caption-1 rounded-full border-none", STATUS_STYLES[kind])}>
      {children}
    </Badge>
  );
}

export function ChartCard({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("rounded-xl border shadow-none", className)}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="ta-headline-2">{title}</CardTitle>
          {description ? (
            <CardDescription className="ta-caption-1">{description}</CardDescription>
          ) : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="ta-title-3">{title}</h1>
        {subtitle ? <p className="ta-label-1 text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({
  icon,
  message,
  action,
}: {
  icon: ReactNode;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <p className="ta-body-2 text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}

export function statusKind(
  status: "researching" | "ready" | "error",
): keyof typeof STATUS_STYLES {
  if (status === "ready") return "positive";
  if (status === "error") return "negative";
  return "caution";
}
