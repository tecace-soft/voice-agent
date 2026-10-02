# TecAce → shadcn token mapping reference

Source of truth: `TECACE DESIGN SYSTEM_JULY.fig` (2026-08 revised guide).
Original code repo: https://github.com/tecace-soft/design-system (`tecace-design-system/tokens/fig-tokens.css`)

> **Known upstream bug:** the repo's `fig-tokens.css` still contains `--primary-normal: rgb(51,102,255)` (#3366FF), which is an extraction error. The canonical brand blue is **#116DFF**. This skill's theme files are already corrected — just be careful if you ever copy values back out of the repo.

## 1. Rationale for the shadcn variable mapping

| shadcn var | TecAce token | Light | Dark |
| --- | --- | --- | --- |
| `--background` | background-normal | `#FFFFFF` | `#1B1C1E` |
| `--foreground` | label-normal | `#171717` | `#F7F7F7` |
| `--card` | background-elevated | `#FFFFFF` | `#212225` |
| `--primary` | primary-normal | `#116DFF` | `#5B84FF` |
| `--primary-strong`* | primary-strong (hover/pressed) | `#0E64E6` | `#3383FF` |
| `--secondary` | fill-normal | `rgba(112,115,124,0.08)` | `rgba(112,115,124,0.22)` |
| `--muted` | fill-alternative | `rgba(112,115,124,0.05)` | `rgba(112,115,124,0.12)` |
| `--muted-foreground` | label-alternative | `rgba(55,56,60,0.61)` | `rgba(174,176,182,0.61)` |
| `--destructive` | status-negative | `#E83034` | `#F05555` |
| `--success`* | status-positive | `#0ABE5C` | `#37D278` |
| `--warning`* | status-cautionary | `#E18A0F` | `#EEA832` |
| `--border` / `--input` | line-normal-neutral | `rgba(112,115,124,0.16)` | `rgba(112,115,124,0.28)` |
| `--ring` | primary-normal | `#116DFF` | `#5B84FF` |
| `--sidebar` | cool-neutral-99 / 10 | `#F7F7F8` | `#171719` |

`*` = TecAce extensions beyond stock shadcn. Already mapped in `@theme inline`, so utilities like `bg-success`, `text-warning`, `hover:bg-primary-strong` work out of the box.

The original system draws lines with an inset shadow (`inset 0 0 0 1px`) rather than `border`, but for shadcn component structure we substitute `border`. The visual result is identical as long as the values (0.16/0.22 opacity) are respected.

## 2. Text hierarchy (opacity, not color)

| Purpose | Class/value |
| --- | --- |
| Top emphasis | `text-[--label-strong]` (#000 / #FFF) |
| Default body | `text-foreground` |
| Secondary body | `text-[--label-neutral]` (0.88) |
| Captions, help text | `text-muted-foreground` (0.61) |
| Placeholders | `--label-assistive` (0.28) — applied to inputs automatically |
| Disabled | `--label-disable` (0.16) |

## 3. Chart / data-viz palette (accent only)

The accent palette is **for data visualization and illustration only**. Never on buttons, badges-as-controls, or interactive elements.
Series order: `chart-1` (brand blue) → `chart-2` (cyan) → `chart-3` (purple) → `chart-4` (pink) → `chart-5` (lime) → `chart-6` (violet) → `chart-7` (red-orange).

| Series | Light (50 step) | Dark (60 step) |
| --- | --- | --- |
| chart-1 blue | `#116DFF` | `#5B84FF` |
| chart-2 cyan | `#00B9DC` | `#28CDEB` |
| chart-3 purple | `#7038E1` | `#8E5AEB` |
| chart-4 pink | `#F532A8` | `#F85FB9` |
| chart-5 lime | `#66BC12` | `#87D237` |
| chart-6 violet | `#5860D5` | `#787FDE` |
| chart-7 red-orange | `#EB4E1C` | `#F27041` |

For area fills and light emphasis backgrounds, don't invent new colors — mix transparency into the same series color (safe in both modes):
`color-mix(in srgb, var(--chart-1) 12%, transparent)` (in Chart.js, 8-digit hex like `hex + '1F'` works too).
The original scale's 90–95 steps are also available if needed: cyan-90 `#C8F5FC`, purple-90 `#E4D2FC`, pink-90 `#FED8ED`, lime-90 `#E4F8C8`, violet-90 `#DBDDF8`, red-orange-90 `#FDDCCA`, green-90 `#D0F8DE`, red-90 `#FCD7D4`, orange-90 `#FDEEC6`.

Up/down indicators use semantic colors, not accents: up `text-success`, down `text-destructive`.

## 4. Spacing · radius · shadows · motion

- **Spacing**: multiples of 4 only — `4 8 12 16 20 24 32 48 64`. In Tailwind: `gap-1/2/3/4/5/6/8/12/16`.
- **Radius**: icons 5 / small buttons 8 (`rounded-sm`) / medium buttons 10 (`rounded-md`) / large buttons & inputs 12 (`rounded-lg`) / cards 16 (`rounded-xl`) / dialogs 20 (`rounded-2xl`) / chips & switches full.
- **Card surfaces**: `outlined` (1px border) **or** `elevated` (shallow shadow) — never both. Dashboards default to outlined.
- **Shadows**: ambient only. No punchy drop shadows. Don't create values outside the defined `--shadow-*` set.
- **Blur**: nowhere except the secondary button's `backdrop-filter: blur(64px)`.
- **Motion**: short `.15s ease` fades only. No bounce/spring/scale pops.
- **Hover/press**: subtle brightness/opacity shifts only. Primary button hover goes to `--primary-strong`.

## 5. Typography summary

- Pretendard = all UI and body (Korean + Latin). Poppins = display/numerals only (`.ta-numeric`, KPI values).
- The 19 `.ta-*` classes ship in the theme CSS. Above the 17px boundary tracking is negative, below it positive — never "clean up" the values.
- Three weights: Display/Title 700, Heading/Headline 600, body 500. **Body defaults to 500, not 400** — the most common mistake.
- Recommended dashboard mapping: page title `.ta-title-3`, section/card title `.ta-headline-2`, KPI value `.ta-numeric text-[28px]`, table body `.ta-label-1`, captions `.ta-caption-1`.

## 6. Voice & tone (UI copy)

**English (default)**
- Sentence case everywhere; never ALL CAPS for emphasis. Product name is always `TecAce`.
- Warm, direct, benefit-oriented. Buttons are short verbs: "Save", "Apply", "Export report", "Cancel".
- No emoji in product UI.
- Examples: "Give applicants a better experience." / "Hiring, redesigned." / Empty state: "No data yet. Add your first item to get started."

**Korean (for Korean-market products)**
- Korean-first; English only for product names, numerals, technical terms.
- Polite declaratives (–합니다 / –해요), benefit-oriented, speaks to the user.
- Buttons: "저장", "지원하기", "취소".
