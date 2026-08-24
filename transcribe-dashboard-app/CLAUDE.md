# Transcribe dashboard — UI conventions

**All UI / styling / chart work on this dashboard MUST follow the `tecace-dashboard-ui` skill**
(the TecAce Dashboard UI design system). Invoke that skill before writing dashboard styles or charts.

This app is **plain React + Vite + hand-rolled CSS** — NOT shadcn/ui or Tailwind. So apply the
skill's **design language** onto the existing CSS: its tokens, the 19 `.ta-*` type styles, and its
KPI / card / table / chart recipes. **Do not migrate to shadcn/Tailwind** unless explicitly asked.

Tokens + the type scale live in `src/tecace/{fig-tokens,typography}.css`; `src/index.css` maps them
to component styles. Never hardcode a hex — reference a token.

Hard rules (from the skill) to keep:
- Brand blue **#116DFF** only — never `#3366FF` or `#2AA25F`.
- Body text **weight 500** (not 400).
- **Sentence case** — no ALL CAPS / `text-transform: uppercase` for emphasis; write `TecAce` exactly.
- **Outlined cards at radius 16** — never both border and shadow; shadows ambient only.
- Header is a **plain 1px hairline** — no gradient strip, no blur.
- Spacing on the **4px grid**; motion is **.15s ease** fades only.
- The KPI value is Poppins `.ta-numeric`; the per-run chart is a single-series line in `--chart-1`
  (brand blue), grid in the fill family, area fill ~15%, emphasized newest point.
