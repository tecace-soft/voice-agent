
import { useDocumentTheme } from "@/theme";
import { BarElement, CategoryScale, Chart as ChartJS, LinearScale } from "chart.js";
import { Bar } from "react-chartjs-2";
import { applyChartDefaults, readChartTheme } from "@/lib/chart-theme";

ChartJS.register(CategoryScale, LinearScale, BarElement);

type Entry = { id: string; name: string; minutes: number; calls: number };

const OPACITY_STEPS = ["FF", "D9", "B3", "8C", "66", "66", "66", "66"];

export function TopCustomersChart({ data }: { data: Entry[] }) {
  const resolvedTheme = useDocumentTheme();

  // Set during render, before the chart below is created. In an effect (as in the promo) it ran
  // after the child's effect had already built the chart, so a theme toggle drew the axis labels
  // in the previous theme's colours. Idempotent: it only copies the current theme into defaults.
  applyChartDefaults();

  const theme = typeof window === "undefined" ? null : readChartTheme();
  const base = theme?.colors[0] ?? "#116dff";

  return (
    <Bar
      key={resolvedTheme}
      data={{
        labels: data.map((entry) => entry.name),
        datasets: [
          {
            label: "Minutes",
            data: data.map((entry) => entry.minutes),
            backgroundColor: data.map(
              (_, index) => `${base}${OPACITY_STEPS[index] ?? "66"}`,
            ),
            borderRadius: 6,
            maxBarThickness: 32,
          },
        ],
      }}
      options={{
        indexAxis: "y",
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, border: { display: false } },
          y: { grid: { display: false }, border: { display: false } },
        },
      }}
    />
  );
}
