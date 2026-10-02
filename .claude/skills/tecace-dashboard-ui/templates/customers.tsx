/**
 * TecAce Dashboard — Customers page
 * Charts: radar (segment health, 2 series max), doughnut (plan mix),
 * cohort retention matrix (HTML table with color-mix cells — not a canvas chart).
 */
"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Radar, Doughnut } from "react-chartjs-2";
import "@/lib/chart-register";
import { applyChartDefaults, readChartTheme } from "@/lib/chart-theme";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader, StatCard, StatusBadge, ChartCard } from "./shared";

const COHORTS: { label: string; values: (number | null)[] }[] = [
  { label: "Mar", values: [100, 68, 55, 49, 45, 42] },
  { label: "Apr", values: [100, 71, 58, 52, 48, null] },
  { label: "May", values: [100, 69, 57, 50, null, null] },
  { label: "Jun", values: [100, 74, 61, null, null, null] },
  { label: "Jul", values: [100, 76, null, null, null, null] },
  { label: "Aug", values: [100, null, null, null, null, null] },
];

export default function CustomersPage() {
  const { resolvedTheme } = useTheme();
  useEffect(() => { applyChartDefaults(); }, [resolvedTheme]);
  const t = typeof window !== "undefined" ? readChartTheme() : null;

  return (
    <main className="space-y-4 p-4 md:space-y-6 md:p-6">
      <PageHeader title="Customers" subtitle="2,418 active accounts · Segmented monthly" />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard title="Active accounts" value="2,418" delta="+3.4%" up caption="vs. last month" />
        <StatCard title="Net revenue retention" value="112%" delta="+2pp" up caption="trailing 12 months" />
        <StatCard title="Churn rate" value="1.8%" delta="-0.3pp" up caption="monthly, logo churn" />
        <StatCard title="NPS" value="47" delta="+5" up caption="last survey wave" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Cohort retention matrix — HTML cells tinted with chart-1 at value intensity */}
        <Card className="rounded-xl shadow-none lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="ta-headline-2">Retention by signup cohort</CardTitle>
            <CardDescription className="ta-caption-1">% of accounts still active after N months</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="ta-caption-1 text-muted-foreground text-left p-2">Cohort</th>
                  {["M0", "M1", "M2", "M3", "M4", "M5"].map(m => (
                    <th key={m} className="ta-caption-1 text-muted-foreground text-center p-2">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COHORTS.map(c => (
                  <tr key={c.label}>
                    <td className="ta-label-1 p-2">{c.label}</td>
                    {c.values.map((v, i) => (
                      <td key={i} className="p-1">
                        {v !== null && (
                          <div
                            className="rounded-md py-1.5 text-center ta-caption-1 tabular-nums"
                            style={{
                              background: `color-mix(in srgb, var(--chart-1) ${Math.round(v * 0.55)}%, transparent)`,
                              color: v > 60 ? "#fff" : "var(--foreground)",
                            }}
                          >
                            {v}%
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Radar — 2 series max, 12% fills */}
          <ChartCard title="Segment health" description="Enterprise vs. SMB, indexed">
            <div className="h-[210px]">
              {t && <Radar key={resolvedTheme}
                data={{
                  labels: ["Adoption", "Support", "Billing", "Engagement", "Expansion"],
                  datasets: [
                    { label: "Enterprise", data: [82, 74, 90, 71, 68],
                      borderColor: t.colors[0], backgroundColor: t.colors[0] + "1F",
                      borderWidth: 2, pointRadius: 2 },
                    { label: "SMB", data: [69, 81, 77, 78, 52],
                      borderColor: t.colors[2], backgroundColor: t.colors[2] + "1F",
                      borderWidth: 2, pointRadius: 2 },
                  ],
                }}
                options={{ maintainAspectRatio: false,
                  scales: { r: { ticks: { display: false }, suggestedMin: 0, suggestedMax: 100 } },
                  plugins: { legend: { position: "bottom" } } }} />}
            </div>
          </ChartCard>

          <ChartCard title="Plan mix">
            <div className="h-[180px]">
              {t && <Doughnut key={resolvedTheme}
                data={{
                  labels: ["Enterprise", "Team", "Starter"],
                  datasets: [{ data: [38, 41, 21],
                    backgroundColor: [t.colors[0], t.colors[1], t.colors[2]],
                    borderColor: t.card, borderWidth: 2 }],
                }}
                options={{ maintainAspectRatio: false, cutout: "72%",
                  plugins: { legend: { position: "bottom" } } }} />}
            </div>
          </ChartCard>
        </div>
      </div>

      <Card className="rounded-xl shadow-none">
        <CardHeader className="pb-2"><CardTitle className="ta-headline-2">Accounts to watch</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {["Account", "Plan", "ARR", "Usage trend", "Renewal", "Status"].map(h => (
                  <TableHead key={h} className="ta-caption-1 text-muted-foreground">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {([
                ["Meridian Health", "Enterprise", "$186K", "-24% in 30 days", "Oct 12", "negative", "At risk"],
                ["Hanul Logistics", "Enterprise", "$142K", "+8% in 30 days", "Nov 03", "positive", "Healthy"],
                ["Brightline Media", "Team", "$36K", "flat", "Sep 21", "caution", "Watch"],
                ["Nordvik AB", "Team", "$28K", "-11% in 30 days", "Sep 08", "caution", "Watch"],
              ] as const).map(([name, plan, arr, trend, renewal, kind, label]) => (
                <TableRow key={name} className="h-11 hover:bg-accent">
                  <TableCell className="ta-label-1">
                    <div className="flex items-center gap-2">
                      {/* company avatar: rounded square, not circle */}
                      <Avatar className="size-7 rounded-md"><AvatarFallback className="rounded-md ta-caption-2">{name[0]}</AvatarFallback></Avatar>
                      {name}
                    </div>
                  </TableCell>
                  <TableCell className="ta-label-1 text-muted-foreground">{plan}</TableCell>
                  <TableCell className="ta-label-1 tabular-nums">{arr}</TableCell>
                  <TableCell className={`ta-label-1 ${trend.startsWith("-") ? "text-destructive" : trend.startsWith("+") ? "text-success" : "text-muted-foreground"}`}>{trend}</TableCell>
                  <TableCell className="ta-label-1 text-muted-foreground">{renewal}</TableCell>
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
