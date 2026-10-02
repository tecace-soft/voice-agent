# Dashboard layout & component recipes

"A lot of information on one screen" — the goal of a TecAce dashboard is high information density that stays quiet. Density is carried by hierarchy (type opacity) and alignment (4px grid), not by color, shadows, or motion.

## 0. shadcn component install list

```bash
npx shadcn@latest add sidebar card table badge button tabs select input \
  dropdown-menu avatar separator tooltip skeleton scroll-area breadcrumb \
  chart sheet dialog command popover calendar progress toggle sonner
```

## 1. Page skeleton

```
SidebarProvider
├─ AppSidebar (collapsible, w-64 / icon mode w-12)
│   ├─ SidebarHeader: logo (symbol + wordmark) or type logo "TecAce"
│   ├─ SidebarGroup×N: menu (lucide icons 24px, stroke 2)
│   └─ SidebarFooter: user avatar (circle) + menu
└─ SidebarInset
    ├─ header (h-14, border-b, sticky top-0 bg-background — no blur)
    │   ├─ SidebarTrigger + Breadcrumb
    │   └─ right: period Select · search (Command) · dark toggle · alerts · Avatar
    └─ main (p-4 md:p-6, space-y-4 md:space-y-6)
        ├─ ① Title row: .ta-title-3 + right-side actions (Export, New)
        ├─ ② KPI row: grid grid-cols-2 xl:grid-cols-4 gap-4
        ├─ ③ Main chart row: grid grid-cols-1 lg:grid-cols-3 gap-4
        │     (2/3-width trend line + 1/3-width doughnut/list)
        ├─ ④ Secondary row: bar chart · ranked list · progress cards, col-span mixes
        └─ ⑤ Table row: card containing Tabs + Table + Pagination
```

Which template to start from (`templates/`):

| Page type | Template | Chart mix |
| --- | --- | --- |
| Landing/summary | `overview.tsx` | line, doughnut, grouped bar, table |
| Traffic/conversion | `analytics.tsx` | sparkline KPIs, stacked area, funnel (h-bar), channel table |
| Revenue | `sales.tsx` | combo bar+line, cumulative area, region table |
| Users/customers | `customers.tsx` | radar, doughnut, cohort retention matrix, table |
| Projects/ops | `operations.tsx` | progress bars, horizontal stacked bar timeline, status table |

Principles when there is a lot of information: don't add rows — **raise density inside cards** (table row height h-11, captions .ta-caption-1). Max ~12 cards per screen. Anything collapsible goes into Tabs/Accordion.

## 2. KPI card (StatCard)

See `templates/shared.tsx` for the canonical implementation. Key points: outlined card (no shadow), value in Poppins, delta in semantic color, label in muted-foreground, optional 40px sparkline pinned to the right of the value.

## 3. Chart card

```tsx
<Card className="rounded-xl shadow-none lg:col-span-2">
  <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
    <div>
      <CardTitle className="ta-headline-2">Revenue trend</CardTitle>
      <CardDescription className="ta-caption-1">Last 12 months, USD thousands</CardDescription>
    </div>
    <Tabs defaultValue="12m"><TabsList className="h-8">
      <TabsTrigger value="30d" className="ta-caption-1">30d</TabsTrigger>
      <TabsTrigger value="12m" className="ta-caption-1">12m</TabsTrigger>
    </TabsList></Tabs>
  </CardHeader>
  <CardContent className="h-[280px]"><Line key={resolvedTheme} data={..} options={..} /></CardContent>
</Card>
```

## 4. Data table

- Wrap in a card. Header row: `ta-caption-1 text-muted-foreground`; body: `ta-label-1`; row height `h-11`; hover `hover:bg-accent`.
- Status as Badge: positive `bg-success/10 text-success`, pending `bg-warning/10 text-warning`, failed `bg-destructive/10 text-destructive`, neutral `bg-secondary text-muted-foreground`, active `bg-primary/10 text-primary`. All `rounded-full border-none`.
- Numeric columns right-aligned + `tabular-nums`. People avatars circular / company avatars `rounded-md`.
- Many rows: TanStack Table + Pagination. Beyond 8 columns, hide the less important ones with `hidden xl:table-cell`.

## 5. Dark mode toggle

`next-themes`, class strategy:

```tsx
// app/layout.tsx
<html lang="en" suppressHydrationWarning>
  <body><ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    {children}</ThemeProvider></body>
</html>

// components/mode-toggle.tsx
const { resolvedTheme, setTheme } = useTheme();
<Button variant="ghost" size="icon" aria-label="Toggle dark mode"
  onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
  <Sun className="size-4 dark:hidden" /><Moon className="size-4 hidden dark:block" />
</Button>
```

Light is the default. Chart refresh on toggle: see charts.md (`key={resolvedTheme}`).

## 6. States & feedback

- Loading: Skeleton (`bg-muted`). Don't scatter spinners.
- Empty state: icon (24px, muted) + `.ta-body-2` message + one secondary button. Action-oriented copy: "No data yet. Add your first item to get started."
- Toasts: sonner, bottom-right, short declaratives ("Saved.").

## 7. Don'ts (review checklist)

- [ ] No green (#2AA25F) or #3366FF anywhere (deprecated doc / repo bug values)
- [ ] No accent colors on buttons, links, or controls
- [ ] No card with both border and shadow
- [ ] No heavy drop shadows, bounce animations, or gratuitous gradients
- [ ] No body text at weight 400 (default is 500)
- [ ] No spacing off the 4px grid
- [ ] Copy is sentence case, no ALL CAPS, no emoji; `TecAce` spelled exactly
- [ ] Dark mode flips charts, badges, and borders together
