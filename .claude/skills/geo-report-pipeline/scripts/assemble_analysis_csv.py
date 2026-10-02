#!/usr/bin/env python3
"""Assemble the 1st-pass GEO analysis CSV from a question CSV + answer-batch JSONs.

The analysis CSV is the exact input the `geo-report` skill consumes. This script
merges the brand-neutral question set (Query ID, Query Text, Category, Type, Tags,
Persona) with the collected AI answers and their per-answer analysis fields, and
writes the fixed 14-column schema.

Usage:
    python assemble_analysis_csv.py \
        --questions questions.csv \
        --answers-dir results/ \
        --out export_analysis.csv

- questions.csv: output of the geo-question-generator (6 columns).
- answers-dir: a folder of JSON files (any names), each a list of objects with:
      query_id, answer_text, target_brand_mentions_count,
      target_brand_mentions_position, total_mentions_all_brands,
      sentiment_category, sentiment_score, reference (list of {title,url}),
      competitor_brand
  Objects are matched to questions by query_id.

Prints a summary (Visibility, SoV, avg position, per-category visibility) so the
human reviewer can sanity-check before approving.
"""
import argparse, csv, json, os, sys
from collections import defaultdict

OUT_COLS = ["Query ID","Query Text","Answer Text","Category","Type","Tags","Persona",
 "Target Brand Mentions(Count)","Target Brand Mentions(Position)","Total Mentions(All Brands)",
 "Sentiment(Category)","Sentiment(Score)","Reference","Competitor(Brand)"]

def load_questions(path):
    with open(path, encoding="utf-8-sig") as f:
        return {r["Query ID"]: r for r in csv.DictReader(f)}

def load_answers(d):
    out = {}
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".json"): continue
        data = json.load(open(os.path.join(d, fn), encoding="utf-8"))
        if isinstance(data, dict): data = data.get("results", data.get("answers", []))
        for r in data:
            out[r["query_id"]] = r
    return out

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--questions", required=True)
    ap.add_argument("--answers-dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    qs = load_questions(args.questions)
    ans = load_answers(args.answers_dir)
    ids = sorted(qs.keys())
    missing = [q for q in ids if q not in ans]
    if missing:
        print(f"⚠  {len(missing)} question(s) have no answer JSON: {missing[:8]}...", file=sys.stderr)

    rows = []
    for qid in ids:
        q = qs[qid]; r = ans.get(qid, {})
        rows.append({
            "Query ID": qid,
            "Query Text": q.get("Query Text",""),
            "Answer Text": r.get("answer_text",""),
            "Category": q.get("Category",""),
            "Type": q.get("Type",""),
            "Tags": q.get("Tags",""),
            "Persona": q.get("Persona",""),
            "Target Brand Mentions(Count)": r.get("target_brand_mentions_count",0),
            "Target Brand Mentions(Position)": r.get("target_brand_mentions_position",0),
            "Total Mentions(All Brands)": r.get("total_mentions_all_brands",0),
            "Sentiment(Category)": r.get("sentiment_category","중립"),
            "Sentiment(Score)": r.get("sentiment_score",0.5),
            "Reference": json.dumps(r.get("reference",[]), ensure_ascii=False),
            "Competitor(Brand)": r.get("competitor_brand",""),
        })

    with open(args.out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=OUT_COLS)
        w.writeheader(); w.writerows(rows)

    n = len(rows)
    vis = sum(1 for r in rows if int(r["Target Brand Mentions(Count)"] or 0) > 0)
    tgt = sum(int(r["Target Brand Mentions(Count)"] or 0) for r in rows)
    tot = sum(int(r["Total Mentions(All Brands)"] or 0) for r in rows)
    poss = [int(r["Target Brand Mentions(Position)"]) for r in rows if int(r["Target Brand Mentions(Count)"] or 0) > 0]
    print(f"Wrote {n} rows to {args.out}")
    print(f"AI Visibility = {vis}/{n} = {vis/n*100:.1f}%")
    print(f"SoV = {tgt}/{tot} = {tgt/tot*100:.1f}%" if tot else "SoV = n/a")
    print(f"Avg Position (when mentioned) = {sum(poss)/len(poss):.1f}" if poss else "Avg Position = n/a")
    cat = defaultdict(lambda:[0,0])
    for r in rows:
        c = r["Category"]; cat[c][1]+=1
        if int(r["Target Brand Mentions(Count)"] or 0) > 0: cat[c][0]+=1
    print("Visibility by category:")
    for c,(v,tt) in sorted(cat.items(), key=lambda x:-x[1][0]/x[1][1] if x[1][1] else 0):
        print(f"  {c}: {v}/{tt} ({v/tt*100:.0f}%)")

if __name__ == "__main__":
    main()
