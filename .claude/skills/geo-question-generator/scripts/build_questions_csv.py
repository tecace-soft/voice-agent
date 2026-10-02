#!/usr/bin/env python3
"""Convert a validated question JSON into the fixed 6-column question CSV.

The CSV is the exact input `geo-report-pipeline` merges with collected answers, so the
column set is a contract: Query ID, Query Text, Category, Type, Tags, Persona.

Usage:
    python build_questions_csv.py --in questions.json --out questions.csv
    python build_questions_csv.py --in questions.json --out questions.csv --expect 150

Input: a JSON array of objects with keys question, category, type, and optionally
tags (string or list) and persona. Query IDs are assigned in input order.
"""
import argparse, csv, json, sys

COLS = ["Query ID", "Query Text", "Category", "Type", "Tags", "Persona"]
TYPES = {"Information Search", "Comparison", "Recommendations", "Use Cases",
         "Trends", "Performance", "Pricing"}


def norm_tags(v):
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        return ", ".join(str(t).strip() for t in v if str(t).strip())
    return str(v).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    ap.add_argument("--expect", type=int, default=None,
                    help="required question count; mismatch is a hard error")
    a = ap.parse_args()

    with open(a.inp, encoding="utf-8") as f:
        rows = json.load(f)
    if isinstance(rows, dict):
        rows = rows.get("questions", rows.get("results", []))
    if not isinstance(rows, list) or not rows:
        sys.exit("ERROR: input JSON must be a non-empty array of question objects")

    problems = []
    for i, r in enumerate(rows, 1):
        if not str(r.get("question", "")).strip():
            problems.append(f"  row {i}: empty question")
        if not str(r.get("category", "")).strip():
            problems.append(f"  row {i}: missing category")
        t = str(r.get("type", "")).strip()
        if t not in TYPES:
            problems.append(f"  row {i}: type {t!r} is not one of the seven")
        if not str(r.get("persona", "")).strip():
            problems.append(f"  row {i}: missing persona")
        if not norm_tags(r.get("tags")):
            problems.append(f"  row {i}: missing tags")
    if problems:
        sys.exit("ERROR: %d field problem(s):\n%s" % (len(problems), "\n".join(problems)))

    if a.expect is not None and len(rows) != a.expect:
        sys.exit(f"ERROR: expected {a.expect} questions, got {len(rows)}")

    with open(a.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(COLS)
        for i, r in enumerate(rows, 1):
            w.writerow([f"q{i:08d}", str(r["question"]).strip(),
                        str(r["category"]).strip(), str(r["type"]).strip(),
                        norm_tags(r.get("tags")), str(r["persona"]).strip()])

    print(f"wrote {a.out}  ({len(rows)} questions, utf-8-sig)")
    by_type, by_cat = {}, {}
    for r in rows:
        by_type[r["type"]] = by_type.get(r["type"], 0) + 1
        by_cat[r["category"]] = by_cat.get(r["category"], 0) + 1
    print("\nType distribution:")
    for k, v in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {k:20s} {v:4d}  ({v/len(rows)*100:.0f}%)")
    print("\nCategory distribution:")
    for k, v in sorted(by_cat.items(), key=lambda x: -x[1]):
        print(f"  {k:20s} {v:4d}  ({v/len(rows)*100:.0f}%)")


if __name__ == "__main__":
    main()
