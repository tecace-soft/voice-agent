/**
 * TecAce Dashboard — Analytics page (traffic & conversion)
 * Charts: sparkline KPIs, stacked area, funnel (horizontal bar, single hue), channel table.
 */
"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Line, Bar } from "react-chartjs-2";
import "@/lib/chart-register";
import { applyChartDefaults, readChartTheme } from "@/lib/chart-theme";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, StatCard, ChartCard, sparklineData, sparklineOptions } from "./shared";

const WEEKS = ["W27", "W28", "W29", "W30", "W31", "W32", "W33", "W34"];

export default function AnalyticsPage() {
  const { resolvedTheme } = useTheme();
  useEffect(() => { applyChartDefaults(); }, [resolvedTheme]);
  const t = typeof window !== "undefined" ? readChartTheme() : null;

  const spark = (values: number[]) => t && (
    <Line key={resolvedTheme} data={sparklineData(values, t.colors[0])} options={sparklineOptions} />
  );

  return (
    <main className="space-y-4 p-4 md:space-y-6 md:p-6">
      <PageHeader
        title="Product analytics"
        subtitle="Web + mobile · Rolling 8 weeks"
        actions={
          <Tabs defaultValue="8w"><TabsList className="h-8">
            <TabsTrigger className="ta-caption-1" value="4w">4 weeks</TabsTrigger>
            <TabsTrigger className="ta-caption-1" value="8w">8 weeks</TabsTrigger>
            <TabsTrigger className="ta-caption-1" value="12w">12 weeks</TabsTrigger>
          </TabsList></Tabs>
        }
      />

      {/* Sparkline KPIs — spark color stays chart-1; direction lives in the badge */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard title="Sessions" value="482K" delta="+8.1%" up caption="vs. prior 8 weeks"
          spark={spark([52, 55, 58, 56, 61, 63, 66, 71])} />
        <StatCard title="Signups" value="12,940" delta="+15.2%" up caption="vs. prior 8 weeks"
          spark={spark([1.2, 1.3, 1.5, 1.4, 1.6, 1.7, 1.9, 2.1])} />
        <StatCard title="Activation rate" value="41.7%" delta="-1.3pp" up={false} caption="signup → first action"
          spark={spark([44, 43, 44, 42, 43, 42, 41, 41.7])} />
        <StatCard title="Weekly active users" value="86.3K" delta="+4.9%" up caption="vs. prior 8 weeks"
          spark={spark([74, 76, 79, 78, 81, 82, 84, 86])} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Stacked area — palette order, ~24% fills */}
        <ChartCard className="lg:col-span-2" title="Sessions by platform" description="Weekly, stacked">
          <div className="h-[280px]">
            {t && <Line key={resolvedTheme}
              data={{
                labels: WEEKS,
                datasets: [
                  { label: "Web", data: [28, 30, 31, 30, 33, 34, 35, 38] },
                  { label: "iOS", data: [15, 15, 16, 16, 17, 18, 19, 20] },
                  { label: "Android", data: [9, 10, 11, 10, 11, 11, 12, 13] },
                ].map((d, i) => ({
                  ...d, borderColor: t.colors[i], backgroundColor: t.colors[i] + "3D",
                  fill: true, tension: 0.3, borderWidth: 2, pointRadius: 0,
                })),
              }}
              options={{
                maintainAspectRatio: false,
                scales: {
                  x: { stacked: true, grid: { display: false }, border: { display: false } },
                  y: { stacked: true, border: { display: false } },
                },
                plugins: { legend: { position: "bottom" } },
              }} />}
          </div>
        </ChartCard>

        {/* Funnel — horizontal bar, single hue with opacity steps */}
        <ChartCard title="Signup funnel" description="This month">
          <div className="h-[280px]">
            {t && <Bar key={resolvedTheme}
              data={{
                labels: ["Visited", "Viewed pricing", "Started signup", "Completed", "Activated"],
                datasets: [{
                  data: [100, 46, 24, 15, 9],
                  backgroundColor: ["FF", "D9", "B3", "8C", "66"].map(a => t.colors[0] + a),
                  borderRadius: 6, maxBarThickness: 24,
                }],
              }}
              options={{
                maintainAspectRatio: false, indexAxis: "y",
                scales: {
                  x: { border: { display: false }, ticks: { callback: (v: number | string) => v + "%" } },
                  y: { grid: { display: false }, border: { display: false } },
                },
                plugins: { legend: { display: false } },
              }} />}
          </div>
        </ChartCard>
      </div>

      <Card className="rounded-xl shadow-none">
        <CardHeader className="pb-2"><CardTitle className="ta-headline-2">Acquisition channels</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="ta-caption-1 text-muted-foreground">Channel</TableHead>
                {["Sessions", "Signups", "Conv. rate", "Δ vs. prior"].map(h => (
                  <TableHead key={h} className="ta-caption-1 text-muted-foreground text-right">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {([
                ["Organic search", "168K", "4,820", "2.9%", "+0.4pp", true],
                ["Direct", "112K", "3,610", "3.2%", "+0.1pp", true],
                ["Paid social", "96K", "2,270", "2.4%", "-0.6pp", false],
                ["Referral", "58K", "1,540", "2.7%", "+0.2pp", true],
                ["Email", "48K", "700", "1.5%", "-0.1pp", false],
              ] as const).map(([ch, s, su, cr, d, up]) => (
                <TableRow key={ch} className="h-11 hover:bg-accent">
                  <TableCell className="ta-label-1">{ch}</TableCell>
                  <TableCell className="ta-label-1 text-right tabular-nums">{s}</TableCell>
                  <TableCell className="ta-label-1 text-right tabular-nums">{su}</TableCell>
                  <TableCell className="ta-label-1 text-right tabular-nums">{cr}</TableCell>
                  <TableCell className={`ta-label-1 text-right tabular-nums ${up ? "text-success" : "text-destructive"}`}>{d}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
