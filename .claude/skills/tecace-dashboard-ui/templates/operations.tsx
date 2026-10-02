/**
 * TecAce Dashboard — Operations page (projects & delivery)
 * Charts: horizontal stacked bar (phase timeline), progress bars per project,
 * grouped bar (team capacity), status table.
 */
"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Plus } from "lucide-react";
import { Bar } from "react-chartjs-2";
import "@/lib/chart-register";
import { applyChartDefaults, readChartTheme } from "@/lib/chart-theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { PageHeader, StatCard, StatusBadge, ChartCard } from "./shared";

export default function OperationsPage() {
  const { resolvedTheme } = useTheme();
  useEffect(() => { applyChartDefaults(); }, [resolvedTheme]);
  const t = typeof window !== "undefined" ? readChartTheme() : null;

  return (
    <main className="space-y-4 p-4 md:space-y-6 md:p-6">
      <PageHeader
        title="Delivery operations"
        subtitle="14 active projects · 6 teams"
        actions={<Button className="rounded-lg gap-1.5"><Plus className="size-4" />New project</Button>}
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard title="On-time delivery" value="87%" delta="+4pp" up caption="trailing 90 days" />
        <StatCard title="Open blockers" value="7" delta="+2" up={false} caption="3 older than a week" />
        <StatCard title="Utilization" value="78%" delta="+1.5pp" up caption="billable hours / capacity" />
        <StatCard title="Sprint completion" value="91%" delta="-2pp" up={false} caption="last sprint, all teams" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Phase timeline — horizontal stacked bar, weeks per phase */}
        <ChartCard className="lg:col-span-2" title="Project phases" description="Weeks spent / planned per phase">
          <div className="h-[260px]">
            {t && <Bar key={resolvedTheme}
              data={{
                labels: ["Atlas migration", "OneID rollout", "Gigs mobile v2", "LaaS billing", "Space redesign"],
                datasets: [
                  { label: "Discovery", data: [2, 1, 2, 1, 3] },
                  { label: "Build", data: [6, 4, 7, 5, 4] },
                  { label: "QA", data: [2, 2, 3, 1, 0] },
                  { label: "Rollout", data: [1, 2, 0, 0, 0] },
                ].map((d, i) => ({
                  ...d, backgroundColor: t.colors[i], borderRadius: 4, maxBarThickness: 20,
                })),
              }}
              options={{
                maintainAspectRatio: false, indexAxis: "y",
                scales: {
                  x: { stacked: true, border: { display: false },
                    ticks: { callback: (v: number | string) => v + "w" } },
                  y: { stacked: true, grid: { display: false }, border: { display: false } },
                },
                plugins: { legend: { position: "bottom" } },
              }} />}
          </div>
        </ChartCard>

        {/* Per-project progress — Progress component, no gradients */}
        <Card className="rounded-xl shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="ta-headline-2">Completion</CardTitle>
            <CardDescription className="ta-caption-1">Scope delivered to date</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {([
              ["Atlas migration", 82, "positive", "On track"],
              ["OneID rollout", 64, "positive", "On track"],
              ["Gigs mobile v2", 51, "caution", "Watch"],
              ["LaaS billing", 38, "negative", "Blocked"],
              ["Space redesign", 22, "active", "Started"],
            ] as const).map(([name, pct, kind, label]) => (
              <div key={name}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="ta-label-1">{name}</span>
                  <div className="flex items-center gap-2">
                    <span className="ta-caption-1 text-muted-foreground tabular-nums">{pct}%</span>
                    <StatusBadge kind={kind}>{label}</StatusBadge>
                  </div>
                </div>
                <Progress value={pct} className="h-2" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Team capacity — grouped bar */}
        <ChartCard title="Team capacity" description="Hours this sprint">
          <div className="h-[240px]">
            {t && <Bar key={resolvedTheme}
              data={{
                labels: ["Platform", "Web", "Mobile", "Data", "QA", "Design"],
                datasets: [
                  { label: "Committed", data: [310, 280, 240, 180, 150, 120],
                    backgroundColor: t.colors[0], borderRadius: 6, maxBarThickness: 24 },
                  { label: "Capacity", data: [360, 320, 300, 200, 200, 160],
                    backgroundColor: t.colors[0] + "40", borderRadius: 6, maxBarThickness: 24 },
                ],
              }}
              options={{
                maintainAspectRatio: false,
                scales: {
                  x: { grid: { display: false }, border: { display: false } },
                  y: { border: { display: false } },
                },
                plugins: { legend: { position: "bottom" } },
              }} />}
          </div>
        </ChartCard>

        {/* Blocker table */}
        <Card className="rounded-xl shadow-none lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="ta-headline-2">Open blockers</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {["Blocker", "Project", "Owner", "Age", "Severity"].map(h => (
                    <TableHead key={h} className="ta-caption-1 text-muted-foreground">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {([
                  ["Payment provider sandbox down", "LaaS billing", "J. Rivera", "9 days", "negative", "Critical"],
                  ["SSO cert renewal pending", "OneID rollout", "M. Chen", "6 days", "caution", "High"],
                  ["App store review delayed", "Gigs mobile v2", "S. Park", "4 days", "caution", "High"],
                  ["Legacy data mapping unclear", "Atlas migration", "D. Novak", "2 days", "neutral", "Medium"],
                ] as const).map(([b, p, o, age, kind, label]) => (
                  <TableRow key={b} className="h-11 hover:bg-accent">
                    <TableCell className="ta-label-1">{b}</TableCell>
                    <TableCell className="ta-label-1 text-muted-foreground">{p}</TableCell>
                    <TableCell className="ta-label-1 text-muted-foreground">{o}</TableCell>
                    <TableCell className="ta-label-1 tabular-nums">{age}</TableCell>
                    <TableCell><StatusBadge kind={kind}>{label}</StatusBadge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
