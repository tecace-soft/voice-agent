import { Chart, Legend, Tooltip } from "chart.js";

// Defaults below reach into plugin option trees, which only exist once the
// plugins are registered.
Chart.register(Legend, Tooltip);

export const CHART_SERIES = 7; // --chart-1 .. --chart-7

export function readChartTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    colors: Array.from({ length: CHART_SERIES }, (_, i) => v(`--ui-chart-${i + 1}`)),
    fg: v("--ui-foreground"),
    mutedFg: v("--ui-muted-foreground"),
    grid: "rgba(112, 115, 124, 0.12)",
    card: v("--ui-card"),
    border: v("--ui-border"),
    success: v("--ui-success"),
    destructive: v("--ui-destructive"),
    fontSans: v("--ui-font-sans"),
  };
}

export function applyChartDefaults() {
  const t = readChartTheme();
  Chart.defaults.font.family = t.fontSans;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = t.mutedFg;
  Chart.defaults.borderColor = t.grid;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.boxHeight = 8;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.tooltip.backgroundColor = t.card;
  Chart.defaults.plugins.tooltip.titleColor = t.fg;
  Chart.defaults.plugins.tooltip.bodyColor = t.mutedFg;
  Chart.defaults.plugins.tooltip.borderColor = t.border;
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.animation = { duration: 150, easing: "easeOutQuad" };
}
