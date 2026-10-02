---
name: geo-report-pipeline
description: >-
  End-to-end orchestrator for producing a GEO (Generative Engine Optimization)
  analysis report for ANY target brand, with human check-and-confirm gates
  between every major stage. Given a target's name and URL, it runs the full
  pipeline — target research + interview, brand-neutral question generation,
  AI answer collection, first-pass analysis CSV, and the final Korean Word
  report — pausing for the user's approval at four checkpoints, then collects
  every artifact (brief, question CSV, analysis CSV, quant JSON, report docx,
  raw batches) into one named folder saved to the user's computer. Use this
  WHENEVER the user wants to run the whole GEO report workflow for a new target,
  "make a GEO report for this company", "run the GEO pipeline", "GEO 리포트 처음부터
  만들어줘", "새 타겟으로 GEO 분석", or wants a repeatable, checkpoint-gated GEO
  process rather than a single step. Composes the geo-question-generator and
  geo-report skills; do not run those piecemeal when the user wants the full run.
---

# GEO Report Pipeline (orchestrator)

This skill runs the complete GEO reporting workflow for one target, the same way
it was done manually, but as a repeatable process with **four human confirmation
gates**. It does not replace the `geo-question-generator` and `geo-report` skills
— it drives them in sequence and fills the gaps between them (answer collection,
analysis-CSV assembly, final packaging).

The guiding principle: **never advance past a gate without the user's explicit
"OK".** Each gate delivers a concrete artifact for review; the user may edit, ask
for changes, or approve. Only on approval do you move on.

## Inputs to collect up front

Ask for these before starting (this is part of Gate 0, the interview). If the user
gave some already, don't re-ask.

- **Target** — brand/company being measured.
- **URL** — its site (anchors research).
- **Direction** — what the GEO analysis should focus on / which competitive rings
  and segments matter.
- **Question count** — how many questions to generate. ALWAYS ask this explicitly;
  it drives the whole run and the user cares about it.
- **Language** — question language (auto-suggest from the target's market; confirm).
- Optional overrides: competitors, keywords, region, personas.

## The pipeline (6 phases, 4 gates)

### Phase 1 — Target research + interview  →  ✋ GATE 1
Research the target: fetch the URL, run a few web searches (brand + category, "vs"
comparisons, "best <category>" lists, and — for small/local businesses — location
and nearby competitors). Determine business type (enterprise vs local SMB), the
real competitor rings, buyer personas, region, and language.

Then **interview the user** grounded in that research: reflect back a one-paragraph
market read and ask the decisions that shape the question set — competitive rings,
priority client segments, geographic scope, analysis goal (visibility benchmark vs
gap-finding vs high-value growth vs sentiment), language, and **question count**.
Prefer a short, plain-text interview with your recommended default on each point so
the user can just confirm or adjust.

Write the agreed decisions to `brief.md` (see `references/brief_template.md`).

**GATE 1 — present the `brief.md` and interview conclusions. Wait for approval.**
Do not generate questions until the brief is confirmed.

### Phase 2 — Question generation  →  ✋ GATE 2
Invoke the **geo-question-generator** skill with the confirmed inputs (target, URL,
direction, question count, language, overrides). It writes a brand-neutral question
CSV with columns `Query ID, Query Text, Category, Type, Tags, Persona` and runs a
brand-leak check.

Deliver the question CSV and show the category/type distribution.

**GATE 2 — user reviews the question set (wording, weighting, categories). Wait for
approval.** Apply any edits and re-check before proceeding.

### Phase 3 — AI answer collection (no gate; feeds Phase 4)
For each question, simulate what a web-enabled AI assistant would actually answer,
**grounded in real web research**, and record honest visibility for the target.

Split the questions into batches of ~10 and spawn one general-purpose subagent per
batch **in the same turn** (parallel). Give each subagent the template in
`references/answer_collection_prompt.md`. The non-negotiable rule: subagents name
only firms/brands that genuinely surface in research, and record the target's
mentions **honestly** (0 when it would not appear) — the value of the baseline is
truth about where the target is invisible. Answers are written in the question
language. Each subagent saves a JSON array to `results/batch_N.json`.

### Phase 4 — First-pass analysis CSV  →  ✋ GATE 3
Assemble the analysis CSV that the `geo-report` skill consumes:

```bash
python scripts/assemble_analysis_csv.py \
  --questions <question.csv> --answers-dir results/ --out analysis.csv
```

This produces the fixed 14-column schema and prints Visibility / SoV / avg position
/ per-category visibility. Validate that the row count matches and every `Reference`
cell is valid JSON. Deliver `analysis.csv` with the summary metrics.

**GATE 3 — user reviews the analysis CSV (answer tone, competitor labels, mention /
sentiment judgments). Wait for approval.** Regenerate or hand-fix as requested.

### Phase 5 — Report generation  →  ✋ GATE 4
Invoke the **geo-report** skill on the approved `analysis.csv` with the target brand:
its Phase 1 runs `analyze_csv.py` (save the quant JSON as `analysis.json`), Phase 2
writes Korean insights per its `report_structure.md`, Phase 3 builds the `.docx`.
Render the docx to images and check it before showing the user.

**GATE 4 — deliver the report as a DRAFT and ask for confirmation.** Incorporate the
user's edits (tone, specific sections, numbers) and regenerate until they approve
the final report. (This gate is required — do not treat the first docx as final.)

### Phase 6 — Package all artifacts into one folder (saved to the user's computer)
Once the report is approved, collect everything into one named folder:

```bash
python scripts/package_outputs.py \
  --target "<Target>" --month <YYYY-MM> --out-root <workspace>/geo_runs \
  --brief brief.md --questions <question.csv> --analysis analysis.csv \
  --analysis-json analysis.json --report <report.docx> --raw results/ \
  --generated-at "<today>"
```

This builds `GEO_<target-slug>_<YYYY-MM>/` (00_brief.md, 01_questions.csv,
02_analysis.csv, 03_analysis.json, 04_report.docx, raw/, README.md) plus a `.zip`.

**Save it to the user's computer** (their chosen destination):
1. If a desktop folder is connected (device bridge), write each file of the folder
   into the user's chosen directory with `device_commit_files` (absolute paths under
   the connected folder), preserving the `GEO_<target>_<month>/...` structure. Confirm
   the destination path to the user in plain language.
2. If no folder is connected, tell the user you need one: ask them to click **Add
   folder** in the desktop app (or say where to put it), and in the meantime deliver
   the `.zip` with `SendUserFile` so nothing is lost. Once a folder is connected,
   commit the files there.

Always also `SendUserFile` the final report and the zip so the user has them in chat
regardless of device state.

## Notes & guardrails

- **Honesty over flattery.** The answer-collection step must reflect reality; never
  inflate the target's visibility. Low visibility in some areas is the finding, not a
  failure.
- **State assumptions when unattended.** If the user is away at a gate, do as much
  prep as is safe, state your assumption at the top, and stop at the gate rather than
  guessing past an irreversible choice.
- **Trend is optional, not assumed.** A run is a single-point analysis unless the user
  says they want it compared against an earlier one. Ask which they want rather than
  defaulting to a monthly cadence. Keep the output folder either way — if a later run
  should be comparable, pass the earlier `analysis.json` to geo-report as baseline and
  reuse the same categories and personas.
- **Schema is fixed.** The analysis CSV must keep the 14 columns in order (see
  `references/analysis_csv_schema.md`) or geo-report will not parse it.
- The reusable scripts (`assemble_analysis_csv.py`, `package_outputs.py`) live in this
  skill's `scripts/`. The answer-collection prompt and templates live in `references/`.
