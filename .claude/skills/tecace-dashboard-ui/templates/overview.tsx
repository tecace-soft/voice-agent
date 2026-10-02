/**
 * TecAce Dashboard — Overview page (landing/summary)
 * Charts: trend line (filled), doughnut, grouped bar + recent-items table.
 * Deps: shadcn components (recipes.md §0), chart.js, react-chartjs-2, next-themes, lucide-react.
 * Theme: assets/tecace-theme.css as globals.css. Layout shell (sidebar/header) omitted — see recipes.md §1.
 */
"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Download } from "lucide-react";
import { Line, Bar, Doughnut } from "react-chartjs-2";
import "@/lib/chart-register"; // Chart.register(...) once, see charts.md
import { applyChartDefaults, readChartTheme } from "@/lib/chart-theme";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, StatCard, StatusBadge, ChartCard } from "./shared";

const MONTHS = ["Mar", "Apr", "May", "Jun", "Jul", "Aug"];

export default function OverviewPage() {
  const { resolvedTheme } = useTheme();
  useEffect(() => { applyChartDefaults(); }, [resolvedTheme]);
  const t = typeof window !== "undefined" ? readChartTheme() : null;

  const noAxis = {
    x: { grid: { display: false }, border: { display: false } },
    y: { border: { display: false } },
  };

  return (
    <main className="space-y-4 p-4 md:space-y-6 md:p-6">
      <PageHeader
        title="August at a glance"
        subtitle="TecAce hiring suite · Last updated 9:20 AM"
        actions={<Button className="rounded-lg gap-1.5"><Download className="size-4" />Export report</Button>}
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard title="New applicants" value="1,284" delta="+12.4%" up caption="vs. last 30 days" />
        <StatCard title="Open positions" value="32" delta="+4" up caption="5 new this week" />
        <StatCard title="Screening pass rate" value="38.2%" delta="-2.1pp" up={false} caption="vs. last 30 days" />
        <StatCard title="Avg. time to hire" value="21 days" delta="-3 days" up caption="Target: under 25 days" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard className="lg:col-span-2" title="Applicant trend" description="Last 6 months · applied / hired">
          <div className="h-[280px]">
            {t && <Line key={resolvedTheme}
              data={{
                labels: MONTHS,
                datasets: [
                  { label: "Applied", data: [620, 710, 850, 940, 1120, 1284],
                    borderColor: t.colors[0], backgroundColor: t.colors[0] + "1F",
                    fill: true, tension: 0.3, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
                  { label: "Hired", data: [48, 61, 66, 79, 92, 103],
                    borderColor: t.colors[1], tension: 0.3, borderWidth: 2, pointRadius: 0 },
                ],
              }}
              options={{ maintainAspectRatio: false, scales: noAxis,
                plugins: { legend: { position: "bottom" } } }} />}
          </div>
        </ChartCard>

        <ChartCard title="Sources" description="This month's applicants">
          <div className="h-[280px]">
            {t && <Doughnut key={resolvedTheme}
              data={{
                labels: ["TecAce Gigs", "Referrals", "Job boards", "Direct"],
                datasets: [{ data: [42, 26, 21, 11],
                  backgroundColor: [t.colors[0], t.colors[1], t.colors[2], t.colors[3]],
                  borderColor: t.card, borderWidth: 2 }],
              }}
              options={{ maintainAspectRatio: false, cutout: "72%",
                plugins: { legend: { position: "bottom" } } }} />}
          </div>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard className="lg:col-span-2" title="Hiring by department">
          <div className="h-[240px]">
            {t && <Bar key={resolvedTheme}
              data={{
                labels: ["Engineering", "Design", "Product", "Sales", "Operations"],
                datasets: [
                  { label: "Open", data: [12, 5, 4, 7, 4], backgroundColor: t.colors[0],
                    borderRadius: 6, maxBarThickness: 32 },
                  { label: "Filled", data: [8, 3, 2, 5, 3], backgroundColor: t.colors[1],
                    borderRadius: 6, maxBarThickness: 32 },
                ],
              }}
              options={{ maintainAspectRatio: false, scales: noAxis,
                plugins: { legend: { position: "bottom" } } }} />}
          </div>
        </ChartCard>

        <Card className="rounded-xl shadow-none">
          <CardHeader className="pb-2"><CardTitle className="ta-headline-2">Top postings</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {([
              ["Senior frontend engineer", "214 applicants", "positive", "Filled"],
              ["AI engineer", "189 applicants", "active", "Open"],
              ["Product designer", "152 applicants", "active", "Open"],
              ["Sales manager", "98 applicants", "caution", "In review"],
            ] as const).map(([name, n, kind, label]) => (
              <div key={name} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="ta-label-1 truncate">{name}</p>
                  <p className="ta-caption-1 text-muted-foreground">{n}</p>
                </div>
                <StatusBadge kind={kind}>{label}</StatusBadge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl shadow-none">
        <CardHeader className="pb-2"><CardTitle className="ta-headline-2">Recent applicants</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {["Applicant", "Position", "Source", "Status", "Applied"].map(h => (
                  <TableHead key={h} className="ta-caption-1 text-muted-foreground">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {([
                ["Sofia Park", "Senior frontend engineer", "TecAce Gigs", "active", "Open", "Aug 19"],
                ["Daniel Lee", "AI engineer", "Referral", "caution", "In review", "Aug 19"],
                ["Mina Choi", "Product designer", "Job board", "positive", "Hired", "Aug 18"],
                ["Ethan Jung", "Sales manager", "Direct", "negative", "Declined", "Aug 17"],
              ] as const).map(([name, role, src, kind, label, d]) => (
                <TableRow key={name} className="h-11 hover:bg-accent">
                  <TableCell className="ta-label-1">
                    <div className="flex items-center gap-2">
                      <Avatar className="size-7"><AvatarFallback className="ta-caption-2">{name.split(" ").map(w => w[0]).join("")}</AvatarFallback></Avatar>
                      {name}
                    </div>
                  </TableCell>
                  <TableCell className="ta-label-1">{role}</TableCell>
                  <TableCell className="ta-label-1 text-muted-foreground">{src}</TableCell>
                  <TableCell><StatusBadge kind={kind}>{label}</StatusBadge></TableCell>
                  <TableCell className="ta-label-1 text-muted-foreground">{d}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
