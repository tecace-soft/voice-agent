# shadcn component styling — TecAce rules per component

How each shadcn/ui component should look and behave under the TecAce theme. The theme CSS already restyles most things through the variables; this file covers the **per-component choices the variables can't make for you** — sizes, radii, variants, and which variant to use when. Grouped like the TecAce Figma library (action / selection / display / feedback / navigation / overlay).

General: every interactive element transitions `.15s ease`, focus rings use `--ring` (blue), and disabled state is opacity via `--label-disable` — never a gray recolor.

## Action

**Button** — size → radius mapping is fixed: `sm` h-8 `rounded-sm`(8) · default h-10 `rounded-md`(10) · `lg` h-12 `rounded-lg`(12). Variants:
- `default` (primary): filled `bg-primary`, hover `hover:bg-primary-strong`. One primary action per view region.
- `secondary`: translucent fill — this is the one place the design system uses blur: `bg-secondary backdrop-blur-[64px]`.
- `outline`: 1px border, transparent fill. For neutral actions beside a primary.
- `ghost`: no border/fill, hover `bg-accent`. Toolbars and icon rows.
- `destructive`: `bg-destructive`. Only for irreversible actions; always pair with a confirm Dialog.
- Icon buttons: square (`size-9` / `size-10`), `rounded-md`, lucide icon `size-4`, always `aria-label`.

**DropdownMenu** — content `rounded-lg` (12), items `ta-label-1` h-9, destructive item gets `text-destructive`. Separators between groups, not between every item.

## Selection (forms)

**Input / Textarea** — h-10 (lg h-12), `rounded-lg`(12), `ta-label-1`. Placeholder color comes from the theme (`--label-assistive`). Error state: `border-destructive` + helper text `ta-caption-1 text-destructive` below; never red fills.

**Select / Combobox** — same box as Input; menu `rounded-lg`, checked item shows a leading check icon, not a fill.

**Checkbox / Radio** — 16px, checked = `bg-primary border-primary`; Radio dot 8px. Label `ta-label-1`, gap-2.

**Switch** — track `rounded-full`, on = `bg-primary`, off = `bg-fill-strong` (`rgba(112,115,124,.16)`). No color = state meaning beyond on/off.

**Slider** — 4px track `bg-secondary`, filled range `bg-primary`, thumb 16px white with 1px border + `shadow-sm`.

**DatePicker / Calendar** — selected day `bg-primary text-primary-foreground rounded-md`, today = outline only. Range selection uses `bg-primary/10` between endpoints.

**Form density** — labels above fields (`ta-label-1`, gap-1.5), fields stacked at `space-y-4`, section breaks `space-y-6` + `SectionHeader`. Two-column only at `md:` and up.

## Display

**Card** — `rounded-xl`(16) + border, `shadow-none`. Elevated variant (shadow, no border) is for popover-like floating surfaces only.

**Badge** — status colors per `templates/shared.tsx` STATUS_STYLES: `bg-<semantic>/10 text-<semantic> rounded-full border-none ta-caption-1`. Never accent colors.

**Tag / Chip** — `rounded-full`, `bg-secondary`, removable chips get a trailing X icon button `size-3.5`. Selected filter chip: `bg-primary/10 text-primary`.

**Avatar** — people circular, companies `rounded-md`. Sizes 24/28/32. Avatar group: overlap `-space-x-2`, ring `ring-2 ring-background`, overflow as `+N` avatar in `bg-secondary`.

**Accordion** — trigger `ta-label-1` h-11, chevron rotates, content `ta-body-2 text-muted-foreground`. Border between items only (`divide-y`), no card-per-item.

**Separator** — always `bg-border`; use sparingly — spacing should do most separation.

**Table** — see recipes.md §4.

## Feedback

**Alert** — `rounded-lg`, tinted background `bg-<semantic>/10`, icon + `ta-label-1` title + `ta-caption-1` body, no border. Variants: info uses `primary`, success/warning/destructive use their tokens.

**Toast (sonner)** — bottom-right, `rounded-lg`, card background + border, short declaratives ("Saved.", "Export started."). One action max.

**Tooltip** — dark surface in light mode (`bg-foreground text-background`), `rounded-md`, `ta-caption-1`, 4–8px offset. Never put essential info only in tooltips.

**Progress** — 8px `rounded-full`, track `bg-secondary`, fill `bg-primary`. Health-colored fills (`bg-warning`, `bg-destructive`) only when the bar itself expresses a judgment.

**Skeleton** — `bg-muted rounded-md`, mirror the final layout's shapes; text lines h-4 at varying widths.

**EmptyState** — centered, icon 24px `text-muted-foreground`, `ta-body-2` message, one secondary button. Copy is action-oriented: "No data yet. Add your first item to get started."

**Spinner** — only for indeterminate waits under ~1s expectation; otherwise Skeleton.

## Navigation

**Tabs** — underline style for page-level sections; `TabsList` pill style (`bg-secondary rounded-lg`, active = card background + shadow-sm) for card-level toggles like time ranges.

**SegmentedControl** — the pill TabsList pattern above; 2–4 options max.

**Breadcrumb** — `ta-caption-1 text-muted-foreground`, current page `text-foreground`; chevron separators.

**Pagination** — `ghost` buttons `size-9 rounded-md`, active page `bg-secondary`; show first/last + window of 5.

**Sidebar** — see recipes.md §1. Active item = filled `bg-primary text-primary-foreground rounded-md`; hover = `bg-secondary`. Icons 18px within 24px slots.

**Command (⌘K palette)** — dialog `rounded-2xl`(20), input borderless with leading search icon, groups labeled `ta-caption-1`, item h-10.

## Overlay

**Dialog** — `rounded-2xl`(20), max-w-md for confirms / max-w-2xl for forms, title `ta-headline-1`, footer buttons right-aligned (ghost/outline cancel + primary confirm). Overlay `bg-black/40` — a dim, not a blur.

**Sheet** — side="right" w-96 for record detail/edit; same radius rules on the leading edge only. Prefer Sheet over Dialog when the user needs page context behind it.

**Popover** — `rounded-lg`, `shadow-md` (elevated — this is the no-border case), max-w-80.

## Composition patterns for "adapting to the situation"

- **Filter bar**: row of Select + filter chips + a ghost "Reset" — above tables, `gap-2`, wraps on mobile.
- **Toolbar**: card header right side — icon buttons (ghost) + one DropdownMenu; never more than 4 visible icons.
- **Detail drawer**: table row click → Sheet with header (avatar + title + StatusBadge), body in `space-y-6` sections, footer actions.
- **Confirm destructive**: destructive Button → Dialog with the consequence in the body ("This removes 3 projects. This can't be undone.") → destructive confirm.
- **Bulk actions**: checkbox column + floating bottom bar (card, `shadow-lg` allowed here as it floats) showing count + actions.
- **Inline edit**: text becomes Input on click, save on blur/Enter — no dialog for single-field edits.
