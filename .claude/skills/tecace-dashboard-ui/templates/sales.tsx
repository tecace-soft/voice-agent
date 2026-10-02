/**
 * TecAce Dashboard — Sales page (revenue)
 * Charts: combo bar+line (revenue + margin % on y1), cumulative area vs. target, region table.
 */
"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Download } from "lucide-react";
import { Chart as ChartComp, Line } from "react-chartjs-2";
import "@/lib/chart-register";
import { applyChartDefaults, readChartTheme } from "@/lib/chart-theme";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PageHeader, StatCard, StatusBadge, ChartCard } from "./shared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];

export default function SalesPage() {
  const { resolvedTheme } = useTheme();
  useEffect(() => { applyChartDefaults(); }, [resolvedTheme]);
  const t = typeof window !== "undefined" ? readChartTheme() : null;

  return (
    <main className="space-y-4 p-4 md:space-y-6 md:p-6">
      <PageHeader
        title="Revenue"
        subtitle="FY2026 · USD thousands · Updated daily at 6 AM"
        actions={<Button className="rounded-lg gap-1.5"><Download className="size-4" />Download CSV</Button>}
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard title="Revenue (MTD)" value="$1.84M" delta="+9.6%" up caption="vs. same period last month" />
        <StatCard title="New bookings" value="$612K" delta="+21.3%" up caption="42 deals closed" />
        <StatCard title="Gross margin" value="63.4%" delta="+1.2pp" up caption="vs. last month" />
        <StatCard title="Avg. deal size" value="$14.6K" delta="-4.8%" up={false} caption="vs. trailing 90 days" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Combo: bars = revenue (chart-1), line = margin % on second axis (chart-2) */}
        <ChartCard className="lg:col-span-2" title="Revenue & margin" description="Monthly revenue (bars) with gross margin % (line)">
          <div className="h-[280px]">
            {t && <ChartComp key={resolvedTheme} type="bar"
              data={{
                labels: MONTHS,
                datasets: [
                  { type: "bar" as const, label: "Revenue", data: [1210, 1180, 1350, 1420, 1510, 1590, 1720, 1840],
                    backgroundColor: t.colors[0], borderRadius: 6, maxBarThickness: 32, yAxisID: "y" },
                  { type: "line" as const, label: "Margin %", data: [58.1, 59.4, 60.2, 61.0, 61.8, 62.1, 62.9, 63.4],
                    borderColor: t.colors[1], borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: "y1" },
                ],
              }}
              options={{
                maintainAspectRatio: false,
                scales: {
                  x: { grid: { display: false }, border: { display: false } },
                  y: { border: { display: false } },
                  y1: { position: "right", grid: { display: false }, border: { display: false },
                    ticks: { callback: (v: number | string) => v + "%" } },
                },
                plugins: { legend: { position: "bottom" } },
              }} />}
          </div>
        </ChartCard>

        {/* Cumulative vs. target */}
        <ChartCard title="Progress to annual target" description="Cumulative bookings vs. plan">
          <div className="h-[220px]">
            {t && <Line key={resolvedTheme}
              data={{
                labels: MONTHS,
                datasets: [
                  { label: "Actual", data: [1.2, 2.4, 3.7, 5.1, 6.7, 8.3, 10.0, 11.8],
                    borderColor: t.colors[0], backgroundColor: t.colors[0] + "1F",
                    fill: true, tension: 0.3, borderWidth: 2, pointRadius: 0 },
                  { label: "Plan", data: [1.3, 2.6, 3.9, 5.2, 6.5, 7.8, 9.1, 10.4],
                    borderColor: t.mutedFg, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0 },
                ],
              }}
              options={{
                maintainAspectRatio: false,
                scales: {
                  x: { grid: { display: false }, border: { display: false } },
                  y: { border: { display: false }, ticks: { callback: (v: number | string) => "$" + v + "M" } },
                },
                plugins: { legend: { position: "bottom" } },
              }} />}
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="flex justify-between"><span className="ta-caption-1 text-muted-foreground">$11.8M of $18M target</span><span className="ta-caption-1 text-success">113% of plan</span></div>
            <Progress value={66} className="h-2" />
          </div>
        </ChartCard>
      </div>

      <Card className="rounded-xl shadow-none">
        <CardHeader className="pb-2"><CardTitle className="ta-headline-2">Revenue by region</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="ta-caption-1 text-muted-foreground">Region</TableHead>
                {["Revenue (MTD)", "QoQ", "Top account", "Pipeline"].map(h => (
                  <TableHead key={h} className="ta-caption-1 text-muted-foreground text-right">{h}</TableHead>
                ))}
                <TableHead className="ta-caption-1 text-muted-foreground">Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {([
                ["North America", "$842K", "+11.2%", "Meridian Health", "$2.4M", "positive", "On track"],
                ["Korea & Japan", "$516K", "+18.9%", "Hanul Logistics", "$1.7M", "positive", "On track"],
                ["Europe", "$294K", "+2.1%", "Nordvik AB", "$980K", "caution", "Watch"],
                ["Rest of world", "$188K", "-6.4%", "Austral Mining", "$430K", "negative", "At risk"],
              ] as const).map(([r, rev, d, acct, pipe, kind, label]) => (
                <TableRow key={r} className="h-11 hover:bg-accent">
                  <TableCell className="ta-label-1">{r}</TableCell>
                  <TableCell className="ta-label-1 text-right tabular-nums">{rev}</TableCell>
                  <TableCell className={`ta-label-1 text-right tabular-nums ${d.startsWith("-") ? "text-destructive" : "text-success"}`}>{d}</TableCell>
                  <TableCell className="ta-label-1 text-right text-muted-foreground">{acct}</TableCell>
                  <TableCell className="ta-label-1 text-right tabular-nums">{pipe}</TableCell>
                  <TableCell><StatusBadge kind={kind}>{label}</StatusBadge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
