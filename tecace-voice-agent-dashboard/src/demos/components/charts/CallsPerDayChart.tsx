
import { useDocumentTheme } from "@/theme";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { applyChartDefaults, readChartTheme } from "@/lib/chart-theme";
import type { DayBucket } from "@/lib/analytics";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler);

export function CallsPerDayChart({ data }: { data: DayBucket[] }) {
  const resolvedTheme = useDocumentTheme();

  // Set during render, before the chart below is created. In an effect (as in the promo) it ran
  // after the child's effect had already built the chart, so a theme toggle drew the axis labels
  // in the previous theme's colours. Idempotent: it only copies the current theme into defaults.
  applyChartDefaults();

  const theme = typeof window === "undefined" ? null : readChartTheme();
  const color = theme?.colors[0] ?? "#116dff";

  return (
    <Line
      key={resolvedTheme}
      data={{
        labels: data.map((bucket) => bucket.date.slice(5)),
        datasets: [
          {
            label: "Calls",
            data: data.map((bucket) => bucket.calls),
            borderColor: color,
            backgroundColor: `${color}1F`,
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
        ],
      }}
      options={{
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            border: { display: false },
          },
        },
      }}
    />
  );
}
