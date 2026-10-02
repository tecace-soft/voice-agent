# Output schema (fixed — geo-report-pipeline input)

The question CSV MUST have exactly these 6 columns, in this order. Encoding: UTF-8 with
BOM (`utf-8-sig`) so Korean opens cleanly in Excel.

```
Query ID, Query Text, Category, Type, Tags, Persona
```

- **Query ID** — `q00000001`, `q00000002`, … zero-padded to 8 digits. Join key for the
  whole pipeline; the final report cites answers as `[q00000001]`.
- **Query Text** — the question, in the target language, brand-free.
- **Category** — product/domain grouping. Exactly one.
- **Type** — one of: `Information Search`, `Comparison`, `Recommendations`, `Use Cases`,
  `Trends`, `Performance`, `Pricing`.
- **Tags** — comma-separated keywords for this question, drawn from the keyword set.
- **Persona** — the buyer type the question was written as.

`geo-report-pipeline` merges these six columns with collected answers into its fixed
14-column analysis CSV (see that skill's `references/analysis_csv_schema.md`). Adding,
dropping, or reordering columns here breaks that merge.

## Intermediate JSON

Generate to JSON first, validate, then convert. One object per question:

```json
[
  {
    "question": "50만 원 이하에서 가성비가 가장 좋은 무선 이어폰은 무엇인가요?",
    "category": "무선 이어폰",
    "type": "Pricing",
    "tags": "가성비, 노이즈캔슬링",
    "persona": "첫 무선 이어폰을 사는 대학생"
  }
]
```

`tags` may also be a JSON array; the converter joins it with commas.
