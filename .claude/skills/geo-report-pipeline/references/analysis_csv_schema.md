# Analysis CSV schema (fixed — geo-report input)

The first-pass analysis CSV MUST have exactly these 14 columns, in this order, or the
`geo-report` skill's `analyze_csv.py` will not parse it. Encoding: UTF-8 with BOM
(`utf-8-sig`) so Korean opens cleanly in Excel.

```
Query ID, Query Text, Answer Text, Category, Type, Tags, Persona,
Target Brand Mentions(Count), Target Brand Mentions(Position),
Total Mentions(All Brands), Sentiment(Category), Sentiment(Score),
Reference, Competitor(Brand)
```

Column meaning:

- **Query ID** — `q00000001` … (join key; used as `[q00000001]` citations in report)
- **Query Text / Category / Type / Tags / Persona** — carried straight from the
  question CSV.
- **Answer Text** — the collected AI answer (question language).
- **Target Brand Mentions(Count)** — times the target appears in the answer.
- **Target Brand Mentions(Position)** — 1-based rank of the target's first mention
  among the brands named in the answer; 0 if absent.
- **Total Mentions(All Brands)** — total brand mention occurrences in the answer.
- **Sentiment(Category)** — `긍정 / 중립 / 부정` toward the target (absent → `중립`).
- **Sentiment(Score)** — 0..1.
- **Reference** — a JSON array string: `[{"title": "...", "url": "..."}, ...]`.
- **Competitor(Brand)** — comma-separated competitor brand names named in the answer.

The first six columns are produced by `geo-question-generator`; the rest are filled
during answer collection. `scripts/assemble_analysis_csv.py` merges them.
