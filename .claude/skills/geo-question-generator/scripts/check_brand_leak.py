#!/usr/bin/env python3
"""Brand-leak and sanity check for a GEO question set.

A GEO question must name no brand. This catches literal leaks — target, competitor, and
product names, plus simple spelling variants — and reports the type/category spread and
near-duplicates.

It cannot catch a disguised reference ("the Korean company that makes foldables"). That
judgment stays with the author.

Usage:
    python check_brand_leak.py --questions questions.json \
        --target "Acme" --competitors "Beta,Gamma" --products "AcmeOne,AcmePro"
    python check_brand_leak.py --questions questions.csv --target "Acme"

Exit code 1 if any leak or duplicate is found.
"""
import argparse, csv, json, re, sys, unicodedata


def load(path):
    if path.lower().endswith(".csv"):
        with open(path, encoding="utf-8-sig") as f:
            return [{"question": r.get("Query Text", ""), "category": r.get("Category", ""),
                     "type": r.get("Type", ""), "id": r.get("Query ID", "")}
                    for r in csv.DictReader(f)]
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        data = data.get("questions", data.get("results", []))
    return [{"question": r.get("question", ""), "category": r.get("category", ""),
             "type": r.get("type", ""), "id": ""} for r in data]


def variants(name):
    """Literal name plus cheap spelling variants: spacing and separators removed."""
    n = name.strip()
    if not n:
        return []
    out = {n, n.replace(" ", ""), re.sub(r"[-_.]", "", n), re.sub(r"[-_. ]", "", n)}
    return [v for v in out if len(v) >= 2]


def norm(s):
    return unicodedata.normalize("NFKC", s).casefold()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--questions", required=True)
    ap.add_argument("--target", default="")
    ap.add_argument("--competitors", default="")
    ap.add_argument("--products", default="")
    a = ap.parse_args()

    rows = load(a.questions)
    if not rows:
        sys.exit("ERROR: no questions loaded")

    banned = []
    for label, raw in (("target", a.target), ("competitor", a.competitors),
                       ("product", a.products)):
        for name in [x for x in raw.split(",") if x.strip()]:
            for v in variants(name):
                banned.append((label, name.strip(), norm(v)))

    leaks = []
    for i, r in enumerate(rows, 1):
        hay = norm(re.sub(r"[-_. ]", "", r["question"]))
        hay_plain = norm(r["question"])
        for label, name, v in banned:
            if v in hay or v in hay_plain:
                leaks.append((r["id"] or f"row {i}", label, name, r["question"]))
                break

    seen, dups = {}, []
    for i, r in enumerate(rows, 1):
        k = re.sub(r"\s+", "", norm(r["question"]))
        if k in seen:
            dups.append((r["id"] or f"row {i}", seen[k], r["question"]))
        else:
            seen[k] = r["id"] or f"row {i}"

    print(f"checked {len(rows)} questions against {len(banned)} banned strings\n")

    by_type, by_cat, missing = {}, {}, 0
    for r in rows:
        if not r["type"] or not r["category"]:
            missing += 1
        by_type[r["type"]] = by_type.get(r["type"], 0) + 1
        by_cat[r["category"]] = by_cat.get(r["category"], 0) + 1
    print("Type distribution:")
    for k, v in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {k or '(blank)':20s} {v:4d}  ({v/len(rows)*100:.0f}%)")
    print("\nCategory distribution:")
    for k, v in sorted(by_cat.items(), key=lambda x: -x[1]):
        print(f"  {k or '(blank)':20s} {v:4d}  ({v/len(rows)*100:.0f}%)")
    if missing:
        print(f"\n!! {missing} question(s) missing Type or Category")

    if dups:
        print(f"\n!! {len(dups)} duplicate question(s):")
        for qid, first, q in dups[:20]:
            print(f"  {qid} duplicates {first}: {q[:70]}")

    if leaks:
        print(f"\n!! BRAND LEAK — {len(leaks)} question(s):")
        for qid, label, name, q in leaks[:40]:
            print(f"  {qid}  [{label}: {name}]  {q[:70]}")
        print("\nRewrite these and re-run. A leak makes the row unusable for measurement.")
    else:
        print("\nNo literal brand leak found.")
        print("Reminder: this does not catch disguised references — review those by hand.")

    sys.exit(1 if (leaks or dups) else 0)


if __name__ == "__main__":
    main()
