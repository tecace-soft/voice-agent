#!/usr/bin/env python3
"""Collect all GEO pipeline artifacts into one structured, named folder (+ zip).

Run this LAST, after the report is approved. It gathers every intermediate and
final deliverable into a single folder named for the target and month, writes a
README manifest, and zips it. The SKILL then either commits that folder to the
user's connected computer folder (device_commit_files) or delivers the zip.

Usage:
    python package_outputs.py \
        --target "SHK Group" --month 2026-07 \
        --out-root /home/claude/geo_runs \
        --brief brief.md \
        --questions questions.csv \
        --analysis analysis.csv \
        --analysis-json analysis.json \
        --report report.docx \
        --raw results/            # optional dir of raw answer batches
        --extra notes.md          # optional, repeatable

Produces:
    <out-root>/GEO_<target-slug>_<month>/
        00_brief.md
        01_questions.csv
        02_analysis.csv
        03_analysis.json
        04_report.docx
        raw/...
        README.md
    <out-root>/GEO_<target-slug>_<month>.zip
Prints the folder path and zip path (the SKILL reads these to deliver/commit).
"""
import argparse, os, re, shutil, sys, zipfile, datetime

def slug(s):
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE).strip().lower()
    return re.sub(r"[\s]+", "-", s) or "target"

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target", required=True)
    ap.add_argument("--month", required=True, help="YYYY-MM")
    ap.add_argument("--out-root", required=True)
    ap.add_argument("--brief"); ap.add_argument("--questions"); ap.add_argument("--analysis")
    ap.add_argument("--analysis-json"); ap.add_argument("--report"); ap.add_argument("--raw")
    ap.add_argument("--extra", action="append", default=[])
    ap.add_argument("--generated-at", default="", help="timestamp string (scripts can't call time)")
    args = ap.parse_args()

    folder_name = f"GEO_{slug(args.target)}_{args.month}"
    dest = os.path.join(args.out_root, folder_name)
    if os.path.exists(dest): shutil.rmtree(dest)
    os.makedirs(dest, exist_ok=True)

    mapping = [
        (args.brief, "00_brief.md"),
        (args.questions, "01_questions.csv"),
        (args.analysis, "02_analysis.csv"),
        (args.analysis_json, "03_analysis.json"),
        (args.report, "04_report.docx"),
    ]
    placed = []
    for src, name in mapping:
        if src and os.path.exists(src):
            shutil.copy2(src, os.path.join(dest, name)); placed.append(name)
    if args.raw and os.path.isdir(args.raw):
        shutil.copytree(args.raw, os.path.join(dest, "raw"))
        placed.append("raw/")
    for ex in args.extra:
        if os.path.exists(ex):
            base = os.path.basename(ex)
            shutil.copy2(ex, os.path.join(dest, base)); placed.append(base)

    readme = [
        f"# GEO 분석 산출물 — {args.target} ({args.month})", "",
        f"생성 시각: {args.generated_at or 'N/A'}", "",
        "## 파일 구성", "",
        "| 파일 | 설명 |",
        "|---|---|",
        "| `00_brief.md` | 인터뷰 결정사항(방향·경쟁링·세그먼트·언어·지역·질문수) |",
        "| `01_questions.csv` | 브랜드 중립 질문 세트 (geo-question-generator 산출) |",
        "| `02_analysis.csv` | 1차 분석 CSV — 답변+멘션·감성·레퍼런스·경쟁사 (geo-report 입력) |",
        "| `03_analysis.json` | geo-report Phase1 정량분석 결과 |",
        "| `04_report.docx` | 최종 GEO 분석 리포트 (한국어) |",
        "| `raw/` | 답변 수집 원본(배치 JSON) 등 중간 산출물 |",
        "", "## 재현/갱신 방법", "",
        "- 다음 회차: 같은 질문 세트로 답변을 다시 수집해 `02_analysis.csv`를 만들고,",
        "  이 실행과 비교할 이전 회차가 있다면, 그 `03_analysis.json`을 baseline으로 넘기면 트렌드가 리포트에 포함됩니다.",
        f"- 포함된 파일: {', '.join(placed)}",
    ]
    with open(os.path.join(dest, "README.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(readme) + "\n")

    zip_path = os.path.join(args.out_root, folder_name + ".zip")
    if os.path.exists(zip_path): os.remove(zip_path)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(dest):
            for fn in files:
                fp = os.path.join(root, fn)
                z.write(fp, os.path.relpath(fp, args.out_root))

    print("FOLDER:", dest)
    print("ZIP:", zip_path)
    print("PLACED:", placed)

if __name__ == "__main__":
    main()
