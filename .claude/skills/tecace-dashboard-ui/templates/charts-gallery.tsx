/**
 * TecAce Dashboard — extended chart gallery
 * Working configs for the extended chart types in references/charts.md §2b:
 * scatter, bubble, polar area, gauge, waterfall, range bar, histogram, activity heatmap.
 * Copy the config you need into a page; don't ship this page as-is.
 */
"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Scatter, Bubble, PolarArea, Doughnut, Bar } from "react-chartjs-2";
import "@/lib/chart-register";
import { applyChartDefaults, readChartTheme } from "@/lib/chart-theme";
import { PageHeader, ChartCard } from "./shared";

const noX = { grid: { display: false }, border: { display: false } };
const noB = { border: { display: false } };

export default function ChartsGalleryPage() {
  const { resolvedTheme } = useTheme();
  useEffect(() => { applyChartDefaults(); }, [resolvedTheme]);
  const t = typeof window !== "undefined" ? readChartTheme() : null;
  if (!t) return null;

  return (
    <main className="space-y-4 p-4 md:space-y-6 md:p-6">
      <PageHeader title="Chart gallery" subtitle="Extended chart types · pick by data shape" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">

        {/* Scatter — the only type that keeps x-gridlines */}
        <ChartCard title="Scatter" description="Deal size vs. sales cycle, by segment">
          <div className="h-[240px]">
            <Scatter key={resolvedTheme}
              data={{ datasets: [
                { label: "Enterprise", data: [{x:34,y:52},{x:42,y:61},{x:51,y:74},{x:62,y:80},{x:47,y:66},{x:55,y:71}],
                  backgroundColor: t.colors[0], pointRadius: 4, pointHoverRadius: 6 },
                { label: "SMB", data: [{x:8,y:14},{x:12,y:22},{x:15,y:18},{x:9,y:25},{x:18,y:31},{x:13,y:16}],
                  backgroundColor: t.colors[2], pointRadius: 4, pointHoverRadius: 6 },
              ]}}
              options={{ maintainAspectRatio: false,
                scales: { x: { ...noB, title: { display: true, text: "Cycle (days)" } },
                          y: { ...noB, title: { display: true, text: "Deal size ($K)" } } },
                plugins: { legend: { position: "bottom" } } }} />
          </div>
        </ChartCard>

        {/* Bubble — third variable as radius (4–20px) */}
        <ChartCard title="Bubble" description="Adoption vs. satisfaction, sized by accounts">
          <div className="h-[240px]">
            <Bubble key={resolvedTheme}
              data={{ datasets: [
                { label: "Core features", data: [{x:82,y:74,r:16},{x:68,y:81,r:11},{x:91,y:69,r:19}],
                  backgroundColor: t.colors[0] + "A8", borderColor: t.colors[0], borderWidth: 1.5 },
                { label: "Add-ons", data: [{x:35,y:62,r:7},{x:52,y:48,r:9},{x:24,y:71,r:5}],
                  backgroundColor: t.colors[1] + "A8", borderColor: t.colors[1], borderWidth: 1.5 },
              ]}}
              options={{ maintainAspectRatio: false,
                scales: { x: { ...noB, title: { display: true, text: "Adoption %" } },
                          y: { ...noB, title: { display: true, text: "CSAT" } } },
                plugins: { legend: { position: "bottom" } } }} />
          </div>
        </ChartCard>

        {/* Polar area — max 6 slices, 70% fills */}
        <ChartCard title="Polar area" description="Support tickets by category">
          <div className="h-[240px]">
            <PolarArea key={resolvedTheme}
              data={{ labels: ["Billing", "Onboarding", "API", "Performance", "Other"],
                datasets: [{ data: [42, 35, 28, 19, 12],
                  backgroundColor: t.colors.slice(0, 5).map(c => c + "B3"),
                  borderColor: t.card, borderWidth: 2 }]}}
              options={{ maintainAspectRatio: false,
                scales: { r: { ticks: { display: false } } },
                plugins: { legend: { position: "bottom" } } }} />
          </div>
        </ChartCard>

        {/* Gauge — half doughnut + HTML overlay for the number */}
        <ChartCard title="Gauge" description="API uptime, current month">
          <div className="relative h-[200px]">
            <Doughnut key={resolvedTheme}
              data={{ datasets: [{ data: [99.2, 0.8],
                backgroundColor: [t.colors[0], "rgba(112,115,124,.16)"],
                borderWidth: 0 }]}}
              options={{ maintainAspectRatio: false, rotation: -90, circumference: 180,
                cutout: "78%", plugins: { legend: { display: false }, tooltip: { enabled: false } } }} />
            <div className="absolute inset-x-0 bottom-6 text-center">
              <div className="ta-numeric text-[32px] leading-10">99.2%</div>
              <div className="ta-caption-1 text-muted-foreground">SLA target 99.0%</div>
            </div>
          </div>
        </ChartCard>

        {/* Waterfall — floating bars; the one chart where semantic colors carry the series */}
        <ChartCard title="Waterfall" description="ARR bridge, Q2 → Q3 ($K)">
          <div className="h-[240px]">
            <Bar key={resolvedTheme}
              data={{ labels: ["Q2 ARR", "New", "Expansion", "Contraction", "Churn", "Q3 ARR"],
                datasets: [{
                  data: [[0, 4200], [4200, 4810], [4810, 5150], [5150, 4980], [4980, 4760], [0, 4760]],
                  backgroundColor: [t.colors[0], t.success, t.success, t.destructive, t.destructive, t.colors[0]],
                  borderRadius: 4, maxBarThickness: 36,
                }]}}
              options={{ maintainAspectRatio: false,
                scales: { x: noX, y: { ...noB, ticks: { callback: (v: number | string) => "$" + Number(v) / 1000 + "M" } } },
                plugins: { legend: { display: false } } }} />
          </div>
        </ChartCard>

        {/* Range bar — min–max bands, single hue */}
        <ChartCard title="Range bar" description="API response time p5–p95 by endpoint (ms)">
          <div className="h-[240px]">
            <Bar key={resolvedTheme}
              data={{ labels: ["/search", "/auth", "/reports", "/export", "/webhooks"],
                datasets: [{ data: [[40, 210], [12, 95], [180, 640], [220, 1400], [30, 380]],
                  backgroundColor: t.colors[0] + "99", borderRadius: 999, maxBarThickness: 14 }]}}
              options={{ maintainAspectRatio: false, indexAxis: "y",
                scales: { x: noB, y: { grid: { display: false }, border: { display: false } } },
                plugins: { legend: { display: false } } }} />
          </div>
        </ChartCard>

        {/* Histogram — bars nearly touch */}
        <ChartCard title="Histogram" description="Session duration distribution (minutes)">
          <div className="h-[240px]">
            <Bar key={resolvedTheme}
              data={{ labels: ["0–2", "2–5", "5–10", "10–15", "15–20", "20–30", "30–45", "45+"],
                datasets: [{ data: [420, 980, 1450, 1180, 760, 430, 180, 90],
                  backgroundColor: ["8C","8C","FF","8C","8C","8C","8C","8C"].map(a => t.colors[0] + a),
                  categoryPercentage: 0.95, barPercentage: 1.0, borderRadius: 4 }]}}
              options={{ maintainAspectRatio: false,
                scales: { x: noX, y: noB }, plugins: { legend: { display: false } } }} />
          </div>
        </ChartCard>

        {/* Activity heatmap — HTML grid, not canvas (see charts.md §2b) */}
        <ChartCard className="xl:col-span-2" title="Activity heatmap" description="Deploys per day, last 12 weeks">
          <ActivityHeatmap />
        </ChartCard>

      </div>
    </main>
  );
}

/* HTML/CSS heatmap — chart-1 intensity via color-mix, same technique as the cohort matrix */
const HEAT: number[][] = [
  [2,4,3,5,1,0,0],[3,6,4,7,2,1,0],[1,3,5,4,3,0,0],[4,8,6,9,5,2,1],
  [2,5,7,6,4,1,0],[3,4,2,5,3,0,0],[5,9,8,11,6,2,1],[2,3,4,3,2,0,0],
  [4,6,5,8,4,1,0],[3,5,6,7,3,1,1],[6,10,9,12,7,3,1],[2,4,3,5,2,0,0],
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX = 12;

function ActivityHeatmap() {
  return (
    <div className="flex gap-2">
      <div className="flex flex-col justify-between py-0.5">
        {DAYS.map(d => <span key={d} className="ta-caption-1 text-muted-foreground leading-4">{d}</span>)}
      </div>
      <div className="grid flex-1 grid-flow-col gap-1" style={{ gridTemplateRows: "repeat(7, 1fr)" }}>
        {HEAT.flatMap((week, w) => week.map((v, d) => (
          <div key={`${w}-${d}`} title={`${v} deploys`}
            className="aspect-square rounded-[4px]"
            style={{ background: v === 0 ? "var(--muted)" : `color-mix(in srgb, var(--chart-1) ${Math.round((v / MAX) * 60)}%, transparent)` }} />
        )))}
      </div>
    </div>
  );
}
