#!/usr/bin/env python3
"""
GEO Analysis CSV → JSON 변환 스크립트 v4 (Fully Generic)

내장 브랜드 사전 없이, CSV 데이터와 타겟 브랜드명만으로 분석한다.
브랜드 키워드와 도메인은 Answer Text/Reference에서 동적으로 추출한다.
CSV 포맷은 고정이며, 타겟 브랜드명은 필수 입력이다.

Usage:
    python3 analyze_csv.py <csv_path> --brand "Samsung" --output <json_path>
    python3 analyze_csv.py <csv_path> --brand "LG" --baseline <prev.json> --output <json_path>
"""

import csv, json, argparse, re
from collections import Counter, defaultdict
from statistics import mean
from urllib.parse import urlparse

# ── Persona 그룹핑 규칙 (브랜드 무관) ────────────────────
PERSONA_GROUP_RULES = [
    {"group": "얼리어답터/기술 탐색형",
     "keywords": ["신기술","최신","얼리어답터","기술 탐색","최신기술","AI 기능 탐색","혁신","테크","트렌드"]},
    {"group": "가성비/실용성 중시형",
     "keywords": ["가성비","실용","예산","비용","경제적","합리적","절약","효율","에너지 절감","가격"]},
    {"group": "크리에이터/전문가형",
     "keywords": ["크리에이터","전문","사진","영상","콘텐츠","촬영","편집","디자인","프로","색감","모니터 전문"]},
    {"group": "비즈니스/생산성 중시형",
     "keywords": ["비즈니스","생산성","업무","사무","직장인","기업","스타일러스","멀티태스킹","화상 회의"]},
    {"group": "게이머/엔터테인먼트형",
     "keywords": ["게이밍","게이머","게임","엔터테인먼트","콘솔","주사율","응답 시간","리프레시"]},
    {"group": "가정/생활가전 중시형",
     "keywords": ["가정","가전","주부","세탁","냉장","청소","요리","가족","아동","자취","생활","주방","홈"]},
    {"group": "건강/피트니스형",
     "keywords": ["건강","헬스","피트니스","운동","심박","수면","트래킹","웰니스","노약자"]},
    {"group": "내구성/디자인 중시형",
     "keywords": ["내구성","디자인","설계","견고","방수","소형","슬림","얇은","무게","휴대"]},
]

def classify_persona(persona_str):
    if not persona_str: return "기타"
    lower = persona_str.lower()
    for rule in PERSONA_GROUP_RULES:
        for kw in rule["keywords"]:
            if kw.lower() in lower:
                return rule["group"]
    return "기타"

# ── 테크 미디어 도메인 (브랜드 무관) ─────────────────────
TECH_MEDIA_DOMAINS = {
    'gsmarena.com','techradar.com','theverge.com','cnet.com','tomsguide.com',
    'androidauthority.com','macrumors.com','digitalcameraworld.com','rtings.com',
    'notebookcheck.net','engadget.com','wired.com','zdnet.com','pcmag.com',
    'tomshardware.com','9to5google.com','xda-developers.com','phonearena.com',
    '9to5mac.com','ifixit.com','dpreview.com','whathifi.com',
}

# ── 피처 키워드 (브랜드 무관) ────────────────────────────
FEATURE_KW = {
    'AI': ['AI','인공지능','AI 기능','AI 비서','머신러닝','온디바이스'],
    '카메라': ['카메라','촬영','사진','동영상','줌','MP','메가픽셀','화소'],
    '배터리': ['배터리','충전','전력','사용 시간','mAh'],
    '디스플레이': ['디스플레이','화면','OLED','AMOLED','해상도','주사율','Hz','밝기'],
    '성능': ['프로세서','칩셋','RAM','성능','속도','벤치마크'],
    '디자인': ['디자인','두께','무게','소재','힌지','폴더블','슬림'],
    '생태계': ['생태계','IoT','스마트홈','연동','연결','허브'],
    '가성비': ['가성비','가격','비용','저렴','합리적','예산'],
}


# ── 동적 추출 함수 ───────────────────────────────────────

def extract_brand_keywords_from_answers(rows, brand_name):
    """Answer Text에서 타겟 브랜드와 함께 등장하는 제품명/키워드를 동적 추출.
    브랜드명이 포함된 문장에서 고유명사(대문자 시작 단어, 한글 고유명사)를 수집한다.
    """
    keywords = [brand_name]
    product_candidates = Counter()

    for r in rows:
        text = r.get('Answer Text', '')
        if not text or brand_name.lower() not in text.lower():
            continue
        # 브랜드명 + 제품명 패턴: "BrandName ProductName" 또는 "브랜드 제품명"
        # 영문: Brand 뒤에 오는 대문자 시작 단어 조합
        patterns = re.findall(
            rf'{re.escape(brand_name)}\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)',
            text
        )
        for p in patterns:
            full = f"{brand_name} {p}"
            if len(p) > 1:  # 단일 문자 제외
                product_candidates[full] += 1

    # 2회 이상 등장한 제품명만 키워드로 채택
    for prod, count in product_candidates.most_common(30):
        if count >= 2:
            keywords.append(prod)

    return keywords


def extract_owned_domains_from_refs(rows, brand_name):
    """Reference에서 타겟 브랜드의 공식 도메인을 동적 추출.
    브랜드명이 도메인에 포함된 URL을 찾는다.
    """
    brand_lower = brand_name.lower().replace(' ', '')
    domains = set()
    for r in rows:
        for d in parse_references(r.get('Reference', '')):
            dl = d.lower()
            if brand_lower in dl:
                domains.add(d)
    return list(domains) if domains else [f"{brand_lower}.com"]


def extract_competitor_domains_from_refs(rows, brand_name, competitor_brands):
    """Reference에서 경쟁사별 공식 도메인을 동적 추출."""
    comp_domains = {}
    for comp in competitor_brands:
        comp_lower = comp.lower().replace(' ', '')
        for r in rows:
            for d in parse_references(r.get('Reference', '')):
                dl = d.lower()
                if comp_lower in dl:
                    comp_domains[d] = comp
    return comp_domains


# ── 도메인 분류 (동적) ───────────────────────────────────

def classify_domain(domain, owned_domains, competitor_domain_map):
    dl = domain.lower()
    for od in owned_domains:
        if od.lower() in dl:
            return "owned_target"
    for cd, brand in competitor_domain_map.items():
        if cd.lower() in dl:
            return f"competitor_{brand}"
    for td in TECH_MEDIA_DOMAINS:
        if td in dl:
            return "tech_media"
    return "other"


# ── Answer Text 분석 (범용) ──────────────────────────────

def analyze_answer_text(text, mention_count, brand_keywords):
    if not text:
        return {}
    result = {'brand_products': [], 'features': {}, 'framing': 'absent', 'length': len(text)}
    lower = text.lower()

    for kw in brand_keywords:
        if kw.lower() in lower:
            result['brand_products'].append(kw)

    for feat, kws in FEATURE_KW.items():
        cnt = sum(1 for k in kws if k.lower() in lower)
        if cnt > 0:
            result['features'][feat] = cnt

    if mention_count == 0:
        result['framing'] = 'absent'
    else:
        search_terms = [kw.lower() for kw in brand_keywords[:5]]
        positions = [lower.find(t) for t in search_terms if lower.find(t) >= 0]
        pos = min(positions) if positions else 999999
        if pos < 100:
            result['framing'] = 'primary'
        elif pos < len(text) // 2:
            result['framing'] = 'secondary'
        else:
            result['framing'] = 'compared'

    return result


# ── 파싱 유틸 ────────────────────────────────────────────

def parse_references(ref_str):
    domains = []
    if not ref_str or not ref_str.strip():
        return domains
    try:
        cleaned = ref_str.replace('""', '"')
        if cleaned.startswith('"') and cleaned.endswith('"'):
            cleaned = cleaned[1:-1]
        for ref in json.loads(cleaned):
            url = ref.get('url', '')
            if url:
                d = urlparse(url).netloc.replace('www.', '')
                if d:
                    domains.append(d)
    except (json.JSONDecodeError, TypeError):
        for url in re.findall(r'https?://([^\s"\']+)', ref_str):
            d = url.split('/')[0].replace('www.', '')
            if d:
                domains.append(d)
    return domains

def parse_list(s, sep=','):
    return [x.strip() for x in (s or '').split(sep) if x.strip()]

def parse_tags(s):
    return [t.strip() for t in (s or '').split('#') if t.strip()]


# ── 메인 분석 ────────────────────────────────────────────

def analyze(csv_path, brand_name, baseline_path=None):
    with open(csv_path, encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    N = len(rows)
    if N == 0:
        return {"error": "CSV에 데이터가 없습니다."}

    # 동적 키워드/도메인 추출
    brand_keywords = extract_brand_keywords_from_answers(rows, brand_name)
    owned_domains = extract_owned_domains_from_refs(rows, brand_name)

    # 경쟁사 목록 수집
    all_competitors = set()
    for r in rows:
        for c in parse_list(r.get('Competitor(Brand)', '')):
            all_competitors.add(c)
    competitor_domain_map = extract_competitor_domains_from_refs(rows, brand_name, all_competitors)

    # 파싱
    for r in rows:
        r['_mc'] = int(r.get('Target Brand Mentions(Count)', '0').strip() or '0')
        r['_mp'] = int(r.get('Target Brand Mentions(Position)', '0').strip() or '0')
        r['_tm'] = int(r.get('Total Mentions(All Brands)', '0').strip() or '0')
        r['_sc'] = r.get('Sentiment(Category)', '').strip()
        r['_ss'] = float(r.get('Sentiment(Score)', '0').strip() or '0')
        r['_cat'] = r.get('Category', '').strip()
        r['_type'] = r.get('Type', '').strip()
        r['_persona'] = r.get('Persona', '').strip()
        r['_pg'] = classify_persona(r['_persona'])
        r['_tags'] = parse_tags(r.get('Tags', ''))
        r['_comps'] = parse_list(r.get('Competitor(Brand)', ''))
        r['_refs'] = parse_references(r.get('Reference', ''))
        r['_qid'] = r.get('Query ID', '').strip()
        r['_qt'] = r.get('Query Text', '').strip()
        r['_at'] = r.get('Answer Text', '').strip()
        r['_ta'] = analyze_answer_text(r['_at'], r['_mc'], brand_keywords)

    # ── Core KPIs ────────────────────────────────────────
    mentioned = [r for r in rows if r['_mc'] > 0]
    visibility = len(mentioned) / N * 100
    target_total = sum(r['_mc'] for r in rows)
    all_total = sum(r['_tm'] for r in rows)
    sov = (target_total / all_total * 100) if all_total > 0 else 0
    positions = [r['_mp'] for r in rows if r['_mc'] > 0 and r['_mp'] > 0]
    avg_pos = mean(positions) if positions else 0
    pos_dist = Counter(r['_mp'] for r in rows if r['_mc'] > 0 and r['_mp'] > 0)
    scores = [r['_ss'] for r in rows if r['_ss'] > 0]
    avg_sent = mean(scores) if scores else 0
    sent_dist = Counter(r['_sc'] for r in rows if r['_sc'])
    sent_by_cat = defaultdict(list)
    for r in rows:
        if r['_sc'] and r['_ss'] > 0:
            sent_by_cat[r['_sc']].append(r['_ss'])

    # ── 브랜드별 SoV ────────────────────────────────────
    brand_est = Counter()
    brand_est[brand_name] = target_total
    for r in rows:
        non_target = r['_tm'] - r['_mc']
        nc = len(r['_comps'])
        if nc > 0 and non_target > 0:
            per = non_target / nc
            for c in r['_comps']:
                brand_est[c] += per
    total_est = sum(brand_est.values())
    brand_sov = {b: {'est_mentions': round(m, 1),
                      'sov_pct': round(m / total_est * 100, 1) if total_est > 0 else 0}
                 for b, m in brand_est.most_common(15)}

    # ── Helper: aggregate ────────────────────────────────
    def agg_by(key_fn):
        buckets = defaultdict(lambda: {
            'n': 0, 'men': 0, 'sm': 0, 'am': 0, 'pos': [], 'ss': [],
            'comps': Counter(), 'cats': Counter(), 'types': Counter(),
        })
        for r in rows:
            k = key_fn(r); b = buckets[k]
            b['n'] += 1
            if r['_mc'] > 0: b['men'] += 1
            b['sm'] += r['_mc']; b['am'] += r['_tm']
            if r['_mc'] > 0 and r['_mp'] > 0: b['pos'].append(r['_mp'])
            if r['_ss'] > 0: b['ss'].append(r['_ss'])
            for c in r['_comps']: b['comps'][c] += 1
            b['cats'][r['_cat']] += 1; b['types'][r['_type']] += 1
        out = {}
        for k, b in sorted(buckets.items(), key=lambda x: x[1]['n'], reverse=True):
            vis = b['men'] / b['n'] * 100 if b['n'] > 0 else 0
            sv = b['sm'] / b['am'] * 100 if b['am'] > 0 else 0
            out[k] = {
                'total_queries': b['n'], 'mentioned_queries': b['men'],
                'visibility': round(vis, 1), 'sov': round(sv, 1),
                'avg_position': round(mean(b['pos']), 2) if b['pos'] else 0,
                'avg_sentiment': round(mean(b['ss']), 4) if b['ss'] else 0,
                'top_competitors': dict(b['comps'].most_common(5)),
                'top_categories': dict(b['cats'].most_common(5)),
                'type_distribution': dict(b['types']),
            }
        return out

    by_cat = agg_by(lambda r: r['_cat'])
    by_type = agg_by(lambda r: r['_type'])

    # ── Persona 그룹 분석 ────────────────────────────────
    pg_buckets = defaultdict(lambda: {
        'n': 0, 'men': 0, 'sm': 0, 'am': 0, 'pos': [], 'ss': [],
        'comps': Counter(), 'cats': Counter(), 'raw': set(), 'qids': []
    })
    for r in rows:
        g = r['_pg']; b = pg_buckets[g]
        b['n'] += 1
        if r['_mc'] > 0: b['men'] += 1
        b['sm'] += r['_mc']; b['am'] += r['_tm']
        if r['_mc'] > 0 and r['_mp'] > 0: b['pos'].append(r['_mp'])
        if r['_ss'] > 0: b['ss'].append(r['_ss'])
        for c in r['_comps']: b['comps'][c] += 1
        b['cats'][r['_cat']] += 1
        b['raw'].add(r['_persona']); b['qids'].append(r['_qid'])

    persona_groups = {}
    for g, b in sorted(pg_buckets.items(), key=lambda x: x[1]['n'], reverse=True):
        vis = b['men'] / b['n'] * 100 if b['n'] > 0 else 0
        sv = b['sm'] / b['am'] * 100 if b['am'] > 0 else 0
        persona_groups[g] = {
            'total_queries': b['n'], 'mentioned_queries': b['men'],
            'visibility': round(vis, 1), 'sov': round(sv, 1),
            'avg_position': round(mean(b['pos']), 2) if b['pos'] else 0,
            'avg_sentiment': round(mean(b['ss']), 4) if b['ss'] else 0,
            'top_competitors': dict(b['comps'].most_common(5)),
            'top_categories': dict(b['cats'].most_common(5)),
            'raw_persona_count': len(b['raw']),
            'sample_personas': sorted(list(b['raw']))[:5],
            'query_ids': b['qids'],
        }

    # ── Competitors ──────────────────────────────────────
    comp_cnt = Counter(); comp_co = defaultdict(int)
    for r in rows:
        for c in r['_comps']:
            comp_cnt[c] += 1
            if r['_mc'] > 0: comp_co[c] += 1
    competitors = {c: {
        'total_appearances': n,
        'cooccurrence_with_target': comp_co[c],
        'appearance_rate': round(n / N * 100, 1),
        'sov_pct': brand_sov.get(c, {}).get('sov_pct', 0)
    } for c, n in comp_cnt.most_common(15)}

    # ── Tags ─────────────────────────────────────────────
    tc = Counter(); ts = defaultdict(list); tsm = defaultdict(int); tt = defaultdict(int)
    for r in rows:
        for t in r['_tags']:
            tc[t] += 1; tt[t] += 1
            if r['_ss'] > 0: ts[t].append(r['_ss'])
            if r['_mc'] > 0: tsm[t] += 1
    tags = {t: {'count': n,
                'avg_sentiment': round(mean(ts[t]), 4) if ts[t] else 0,
                'target_visibility': round(tsm[t] / tt[t] * 100, 1) if tt[t] > 0 else 0}
            for t, n in tc.most_common(30)}

    # ── Reference 도메인 분류 ────────────────────────────
    dc = Counter(); dsc = defaultdict(int); dcls = defaultdict(Counter)
    for r in rows:
        for d in r['_refs']:
            dc[d] += 1
            if r['_mc'] > 0: dsc[d] += 1
            cls = classify_domain(d, owned_domains, competitor_domain_map)
            dcls[cls][d] += 1
    refs = {d: {'total_citations': n, 'target_context': dsc[d],
                'citation_rate': round(n / N * 100, 1),
                'domain_class': classify_domain(d, owned_domains, competitor_domain_map)}
            for d, n in dc.most_common(20)}
    ref_class = {cls: {'total_citations': sum(ds.values()), 'unique_domains': len(ds),
                        'top_domains': dict(ds.most_common(5))}
                 for cls, ds in dcls.items()}

    # ── 미언급 패턴 분석 ─────────────────────────────────
    zero = []; zc = Counter(); zt = Counter(); zp = Counter()
    for r in rows:
        if r['_mc'] == 0:
            zero.append({'query_id': r['_qid'], 'query_text': r['_qt'],
                         'category': r['_cat'], 'type': r['_type'],
                         'persona': r['_persona'], 'persona_group': r['_pg'],
                         'competitors': r['_comps'][:5], 'total_brands': r['_tm']})
            zc[r['_cat']] += 1; zt[r['_type']] += 1; zp[r['_pg']] += 1
    zero_patterns = {
        'total': len(zero),
        'by_category': dict(zc.most_common()),
        'by_type': dict(zt.most_common()),
        'by_persona_group': dict(zp.most_common()),
        'queries': zero
    }

    # ── Answer Text 종합 ─────────────────────────────────
    all_prod = Counter(); all_feat = Counter(); framing = Counter()
    for r in rows:
        ta = r['_ta']
        for p in ta.get('brand_products', []): all_prod[p] += 1
        for f, c in ta.get('features', {}).items(): all_feat[f] += c
        framing[ta.get('framing', 'absent')] += 1
    answer_analysis = {
        'brand_product_mentions': dict(all_prod.most_common(20)),
        'feature_frequency': dict(all_feat.most_common()),
        'framing_distribution': dict(framing),
        'avg_answer_length': round(mean(len(r['_at']) for r in rows if r['_at'])),
    }

    # ── Category × Type cross ────────────────────────────
    ctx = defaultdict(lambda: {'n': 0, 'men': 0, 'sm': 0, 'am': 0})
    for r in rows:
        k = f"{r['_cat']}|{r['_type']}"; b = ctx[k]
        b['n'] += 1
        if r['_mc'] > 0: b['men'] += 1
        b['sm'] += r['_mc']; b['am'] += r['_tm']
    cross = {k: {'category': k.split('|')[0], 'type': k.split('|')[1],
                  'total_queries': b['n'],
                  'visibility': round(b['men'] / b['n'] * 100, 1) if b['n'] > 0 else 0,
                  'sov': round(b['sm'] / b['am'] * 100, 1) if b['am'] > 0 else 0}
             for k, b in sorted(ctx.items(), key=lambda x: x[1]['n'], reverse=True)}

    # ── Baseline 비교 ────────────────────────────────────
    baseline_cmp = None
    if baseline_path:
        try:
            with open(baseline_path, encoding='utf-8') as f:
                bl = json.load(f).get('summary', {})
            baseline_cmp = {
                'source': baseline_path,
                'delta': {
                    'visibility': round(visibility - bl.get('ai_visibility_pct', 0), 1),
                    'sov': round(sov - bl.get('sov_pct', 0), 1),
                    'avg_position': round(avg_pos - bl.get('avg_position', 0), 2),
                    'avg_sentiment': round(avg_sent - bl.get('avg_sentiment_score', 0), 4),
                },
                'previous': {k: bl.get(k, 0) for k in
                             ['ai_visibility_pct', 'sov_pct', 'avg_position', 'avg_sentiment_score']}
            }
        except Exception as e:
            baseline_cmp = {"error": str(e)}

    # ── 최종 조립 ────────────────────────────────────────
    result = {
        "meta": {
            "total_queries": N,
            "csv_path": csv_path,
            "script_version": "4.0",
            "target_brand": brand_name,
            "brand_keywords_extracted": brand_keywords[:15],
            "owned_domains_extracted": owned_domains,
        },
        "summary": {
            "total_queries": N,
            "target_brand": brand_name,
            "ai_visibility_pct": round(visibility, 1),
            "sov_pct": round(sov, 1),
            "avg_position": round(avg_pos, 2),
            "avg_sentiment_score": round(avg_sent, 4),
            "total_target_mentions": target_total,
            "total_all_brand_mentions": all_total,
            "mentioned_query_count": len(mentioned),
            "zero_mention_query_count": len(zero)
        },
        "brand_sov": brand_sov,
        "sentiment": {
            "distribution": dict(sent_dist),
            "avg_by_category": {k: round(mean(v), 4) for k, v in sent_by_cat.items()},
            "overall_avg": round(avg_sent, 4),
            "score_range": {"min": round(min(scores), 4) if scores else 0,
                            "max": round(max(scores), 4) if scores else 0}
        },
        "position_distribution": dict(sorted(pos_dist.items())),
        "by_category": by_cat,
        "by_type": by_type,
        "by_persona_group": persona_groups,
        "category_type_cross": cross,
        "competitors": competitors,
        "tags": tags,
        "references": refs,
        "reference_class_summary": ref_class,
        "answer_text_analysis": answer_analysis,
        "zero_mention_patterns": zero_patterns,
    }
    if baseline_cmp:
        result["baseline_comparison"] = baseline_cmp
    return result


def main():
    ap = argparse.ArgumentParser(description='GEO CSV 분석 v4 (Fully Generic)')
    ap.add_argument('csv_path', help='분석할 CSV 파일 경로')
    ap.add_argument('--brand', '-b', required=True, help='타겟 브랜드명 (필수)')
    ap.add_argument('--output', '-o', help='출력 JSON 파일 경로')
    ap.add_argument('--baseline', help='이전 월 분석 JSON 경로')
    args = ap.parse_args()

    result = analyze(args.csv_path, args.brand, args.baseline)
    out = json.dumps(result, ensure_ascii=False, indent=2)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(out)
        s = result['summary']
        m = result['meta']
        print(f"분석 완료: {args.output} (v{m['script_version']})")
        print(f"  타겟 브랜드: {s['target_brand']}")
        print(f"  총 쿼리: {s['total_queries']}  |  Visibility: {s['ai_visibility_pct']}%  |  SoV: {s['sov_pct']}%")
        print(f"  Avg Position: {s['avg_position']}  |  Sentiment: {s['avg_sentiment_score']}  |  미언급: {s['zero_mention_query_count']}건")
        print(f"  Persona 그룹: {len(result['by_persona_group'])}개  |  SoV 항목: {len(result['brand_sov'])}개")
        print(f"  키워드 자동추출: {len(m['brand_keywords_extracted'])}개  |  도메인 자동추출: {m['owned_domains_extracted']}")
        if result.get('baseline_comparison') and 'delta' in result['baseline_comparison']:
            d = result['baseline_comparison']['delta']
            print(f"  [Baseline Δ] Vis: {d['visibility']:+.1f}%p  |  SoV: {d['sov']:+.1f}%p")
    else:
        print(out)


if __name__ == '__main__':
    main()
