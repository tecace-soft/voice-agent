---
name: geo-question-generator
description: >-
  Generates a brand-neutral question set for GEO (Generative Engine Optimization)
  measurement of any target brand. Produces EXACTLY the requested number of questions,
  each written so it names no brand yet reliably provokes an answer that names brands —
  which is what makes target visibility measurable. Spreads questions across seven types
  (Information Search, Comparison, Recommendations, Use Cases, Trends, Performance,
  Pricing) and target-specific product/domain categories, runs a brand-leak check, and
  writes the 6-column question CSV (Query ID, Query Text, Category, Type, Tags, Persona)
  that the geo-report-pipeline consumes. Use whenever the user wants GEO questions,
  brand-neutral evaluation queries, an AI-visibility question set, "GEO 질문 만들어줘",
  "질문 세트 생성", "브랜드 중립 질문", or is running Phase 2 of the GEO pipeline.
---

# GEO Question Generator

Builds the measurement instrument for a GEO study: a set of questions that never name a
brand, but that a knowledgeable respondent — or a web-enabled LLM — can barely answer
without naming one.

That tension is the whole point. If a question names the target, the answer proves
nothing. If a question is so generic that answers stay abstract ("it depends on your
needs"), it measures nothing either. Every question has to sit in between.

## Inputs

Collect these before generating. When invoked from `geo-report-pipeline`, they arrive
from the approved brief — do not re-ask. Standalone, run a short plain-text interview
and offer a recommended default for each.

| Input | Notes |
| --- | --- |
| **Target company** | The brand being measured. Never appears in question text. |
| **URL** | Anchors research into what it actually sells. |
| **Products** | Specific products/services the study cares about. |
| **Competitors** | The competitive ring. Also never appears in question text. |
| **Keywords** | Seed terms; these become `Tags`. |
| **Region** | Shapes what "available", "popular", and pricing mean. |
| **Language** | Questions are written natively in it, not translated. |
| **Total questions** | Ask explicitly. Never guess this one. |
| **Evaluation purpose** | Visibility / ranking order / sentiment / competitor context. Drives the type mix. |
| **Direction** (optional) | Any extra steer from the user. |

## Workflow

**1. Research the target briefly.** Fetch the URL and run a few searches (brand +
category, "best <category>", "<category> vs" comparisons; for local businesses, add
location). You need enough to know the real product/domain categories and who buys
them. Do not skip this — categories invented without research drift from the market.

**2. Derive the axes.** From the research plus the inputs, fix two lists before writing
any question:

- **Categories** — the product/domain groupings (e.g. 스마트폰, TV, 무선 이어폰). Derived
  from what the target and its ring actually sell.
- **Personas** — the buyer types, described by age / profession / intent, not by
  demographic label alone. "영상 편집 프리랜서" beats "30대 남성".

Present both lists with the question count before generating, so the user can adjust
cheaply. Changing an axis after 200 questions exist is expensive.

**3. Generate exactly the requested count.** Follow `references/question_design.md` for
the type taxonomy, the design rules, and worked examples. Think as each persona in turn
rather than writing from one generic voice — persona-driven questions are the ones that
sound like real search queries.

**4. Validate every question, then self-correct.** Run the checklist in
`references/question_design.md` §4 on each question, fix failures, and re-check. Then run
the mechanical check:

```bash
python scripts/check_brand_leak.py --questions questions.json \
  --target "<Target>" --competitors "<A>,<B>,<C>" --products "<P1>,<P2>"
```

It flags any question text containing a target, competitor, or product name (including
common spelling variants), reports the Type and Category distribution, and fails on
duplicates. A leak is not a warning — fix it and re-run until clean.

The script catches literal names. It cannot tell you that "the Korean company that makes
foldables" is a disguised brand reference. That judgment is yours; treat any question
that identifies one company by description as a leak.

**5. Write the CSV.**

```bash
python scripts/build_questions_csv.py --in questions.json --out questions.csv
```

This assigns `Query ID`s (`q00000001`…) and writes the fixed 6 columns as UTF-8 with BOM
so Korean opens cleanly in Excel. See `references/output_schema.md` — the column set is a
contract with `geo-report-pipeline`; do not add, drop, or reorder.

**6. Deliver** the CSV plus the type/category distribution table, and say plainly which
questions you were least sure about and why.

## Notes

- **Question count is exact.** Requested 150 means 150 rows, not 148 and not 155.
- **Neutral wording, loaded intent.** Neutral is the constraint; provoking a brand-named
  answer is the goal. A question that satisfies only the first half is a wasted row.
- **No monthly assumption.** Whether this run is a one-off snapshot or one point in a
  trend line is the user's call, and it varies by engagement. Only reuse a previous run's
  categories and personas if the user says they want a comparable run — and ask if it is
  unclear. Do not carry axes forward by default, and do not tell the user their axes must
  stay stable unless they have said they are tracking over time.
- **Language is native.** Write in the target language directly. Translated questions read
  wrong and change what an LLM answers.
- **Trend keywords age.** Anything current-year-flavored should be checked against the
  research, not written from memory.
