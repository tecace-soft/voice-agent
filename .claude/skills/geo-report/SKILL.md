---
name: geo-report
description: >
  GEO(Generative Engine Optimization) 분석 리포트를 생성하는 스킬.
  CSV 형식의 Q&A 분석 데이터를 입력받아 정량 분석을 수행하고,
  특정 브랜드의 AI 검색 엔진 가시성을 평가하는 컨설팅 수준의 Word(.docx) 리포트를 작성한다.
  삼성, LG, Apple, Google, Sony 등 어떤 브랜드든 타겟으로 분석 가능하며,
  CSV의 Target Brand 컬럼을 기반으로 타겟 브랜드를 자동 감지한다.
  이 스킬은 사용자가 GEO 리포트, 브랜드 가시성 분석, AI 답변 분석,
  ChatGPT 브랜딩 분석, SoV 분석, 감성 분석 리포트 등을 요청할 때 반드시 사용한다.
  CSV 파일이 업로드되고 "리포트", "분석", "GEO", "SoV", "브랜드 가시성" 등의
  키워드가 포함된 요청이 있으면 이 스킬을 트리거한다.
---

# GEO Analysis Report Skill

## 개요

이 스킬은 특정 브랜드의 GEO(Generative Engine Optimization) 월간 분석 리포트를 생성한다.
ChatGPT 등 생성형 AI가 사용자 질문에 대해 타겟 브랜드를 얼마나 빈번하고, 긍정적이며,
정확하게 인용하는지를 분석하여 컨설팅 수준의 Word(.docx) 리포트를 산출한다.

**브랜드 범용성**: Samsung, LG, Apple, Google, Sony 등 어떤 브랜드든 타겟으로 분석 가능하다.
CSV의 `Target Brand Mentions` 컬럼을 기반으로 타겟 브랜드를 자동 감지하거나,
사용자가 명시적으로 지정할 수 있다.

## 워크플로우

스킬은 3단계 파이프라인으로 작동한다:

### Phase 1: 데이터 분석 (결정론적)
`scripts/analyze_csv.py` 스크립트를 실행하여 CSV에서 정량 지표를 추출한다.
이 단계의 출력은 JSON 형식이며, 모든 수치는 이 스크립트에서 계산된 값만 사용한다.

```bash
# 기본 사용법 (타겟 브랜드 필수 지정)
python3 scripts/analyze_csv.py /path/to/export_analysis.csv --brand "Samsung" --output /tmp/geo_analysis.json

# 다른 브랜드 분석
python3 scripts/analyze_csv.py /path/to/export_analysis.csv --brand "LG" --output /tmp/geo_analysis.json

# 전월 대비 트렌드 분석
python3 scripts/analyze_csv.py /path/to/current.csv --brand "Samsung" --baseline /path/to/prev.json --output /tmp/geo_analysis.json
```

스크립트가 생성하는 JSON에는 다음이 포함된다:
- `meta.target_brand`: 분석 대상 브랜드명 (예: "Samsung", "LG", "Apple")
- `summary`: 전체 요약 (총 쿼리 수, Visibility, SoV, 평균 감성 등)
- `brand_sov`: 타겟 브랜드 + 경쟁사 포함 전 브랜드의 SoV %
- `sentiment`: 감성 분포 및 평균 점수
- `by_category`: 카테고리별 분석 (Visibility, SoV, 경쟁사, 유형 분포)
- `by_type`: 질문 유형별 분석
- `by_persona_group`: 페르소나 그룹별 분석 (자동 클러스터링)
- `competitors`: 경쟁사별 출현 빈도 및 SoV
- `tags`: 태그 빈도, 타겟 브랜드 가시성, 감성 분석
- `references`: 참조 도메인 분석
- `reference_class_summary`: 도메인 분류 요약 (owned_target / tech_media / competitor_X / other)
- `answer_text_analysis`: 타겟 브랜드 제품명 빈도, 피처 키워드, 프레이밍 분포
- `zero_mention_patterns`: 타겟 브랜드 미언급 쿼리의 패턴 분석
- `baseline_comparison`: (선택) 이전 월 대비 변화량

### Phase 2: 인사이트 도출 (Claude 분석)
Phase 1의 JSON 결과와 CSV의 Answer Text를 읽고 정성적 분석을 수행한다.
이 단계에서는 `references/report_structure.md`의 리포트 구조를 따른다.

**핵심: JSON의 `meta.target_brand`를 확인하고, 리포트 전체에서 해당 브랜드명을 사용한다.**

**Phase 2 실행 순서**:
1. `references/report_structure.md`를 읽고 리포트 구조를 숙지한다.
2. JSON의 `meta.target_brand`를 확인하여 리포트의 주어(주체)를 결정한다.
3. JSON에서 핵심 수치를 추출한다 (summary, brand_sov, zero_mention_patterns 등).
4. CSV의 Answer Text를 **전수** 읽는다. 특히:
   - `framing_distribution.primary`에 해당하는 쿼리 (타겟 브랜드 강세)
   - `zero_mention_patterns.queries` (타겟 브랜드 미언급 = 약점)
   - 경쟁사가 타겟보다 먼저 언급되는 쿼리 (framing: compared)
5. 리포트 구조에 맞춰 섹션별 콘텐츠를 작성한다.

분석 시 반드시 지켜야 할 원칙:
- 모든 수치 인용은 Phase 1 JSON에서만 가져온다 (절대 추정하지 않는다)
- Answer Text에서 구체적 근거를 찾아 [qXXXXXXXX] 형태로 레퍼런스를 붙인다
- 컨설팅 톤을 유지한다: 단순 기술이 아닌, 원인 분석 → 시사점 → 제언 흐름
- 비교 분석 시 전월 데이터(Baseline)가 있으면 트렌드를 반드시 포함한다
- 상반된 두 축의 대비로 프레이밍한다 (양적 확대 vs 질적 희석 등)
- 한국어로 작성한다

### Phase 3: Word(.docx) 리포트 생성
docx-js (Node.js)를 사용하여 Word 문서를 생성한다.
`references/docx_style_guide.md`의 스타일 가이드를 참조하고,
Claude의 docx 스킬(`/mnt/skills/public/docx/SKILL.md`)의 기술 가이드를 반드시 먼저 읽는다.

**커버 페이지의 브랜드명은 `meta.target_brand`에서 가져온다.**

## 입력

### 필수
- **CSV 파일**: GEO 분석 데이터 (포맷 고정)
  - 필수 컬럼: Query ID, Query Text, Answer Text, Category, Type, Tags, Persona,
    Target Brand Mentions(Count), Target Brand Mentions(Position),
    Total Mentions(All Brands), Sentiment(Category), Sentiment(Score),
    Reference, Competitor(Brand)
- **타겟 브랜드명**: 분석 대상 브랜드 (예: "Samsung", "LG", "Apple", "Sony" 등)

### 선택
- **Baseline JSON**: 이전 달 분석 결과 (트렌드 비교용)

## 산출물

- **Word 리포트**: `GEO_분석_리포트_[브랜드명]_YYYY년_MM월.docx`
  - 커버 페이지 (타겟 브랜드명 반영)
  - 목차 (Table of Contents)
  - Executive Summary (2-3 페이지)
  - 정량 분석 (3-4 페이지)
  - 카테고리 × 유형 분석 (2-3 페이지)
  - Persona Deep Dive (2-3 페이지)
  - Reference Domain 분석 (2 페이지)
  - 브랜드 SWOT & 경쟁사 분석 (2-3 페이지)
  - 부록 (쿼리 목록)

## 리포트 구조 상세

리포트 구조의 상세 가이드는 `references/report_structure.md`를 참조한다.
Word 문서 스타일링 가이드는 `references/docx_style_guide.md`를 참조한다.
docx-js 기술 가이드는 `/mnt/skills/public/docx/SKILL.md`를 참조한다.

## 핵심 지표 계산 방법

| 지표 | 계산식 | 설명 |
|------|--------|------|
| AI Visibility | (Target Brand Mentions > 0인 쿼리 수) / 전체 쿼리 수 × 100 | 타겟 브랜드가 한 번이라도 언급된 비율 |
| SoV | 타겟 브랜드 총 멘션 수 / 모든 브랜드 총 멘션 수 × 100 | 전체 브랜드 멘션 중 타겟 비중 |
| Avg Position | Target Brand Mentions(Position)의 평균 | 언급 시 평균 노출 순위 (1에 가까울수록 좋음) |
| Sentiment Score | Sentiment(Score)의 평균 | 0~1 사이, 높을수록 긍정적 |

## 분석 프레임워크

데이터를 5개 축으로 교차 분석한다:

1. **Brand/Product 축**: 타겟 브랜드 제품별 멘션 패턴, 경쟁사 대비 포지셔닝
2. **Category/Type/Tag 축**: 제품군-질문유형-태그의 교차 분석으로 맥락 파악
3. **Persona 축**: 사용자 페르소나별 AI 답변 패턴 차이
4. **Reference 축**: AI가 답변 근거로 삼는 도메인 생태계 분석
5. **Time 축**: 월별 트렌드 (Baseline 데이터가 있을 경우)

## v4 주요 변경: 완전 범용화

### 내장 브랜드 사전 제거
v3까지 있던 Samsung, Apple, LG 등의 하드코딩된 제품 키워드/도메인 사전을 완전 제거했다.
모든 브랜드를 동일한 로직으로 분석한다.

### 타겟 브랜드 필수 입력
`--brand` 옵션은 필수이다. 사용자가 CSV와 함께 타겟 브랜드명을 반드시 제공해야 한다.

### 동적 키워드/도메인 추출
내장 사전 대신, CSV의 데이터에서 직접 추출한다:
- **브랜드 키워드**: Answer Text에서 `[브랜드명] + [대문자 시작 단어]` 패턴으로 제품명 자동 추출
  (2회 이상 등장한 것만 채택)
- **공식 도메인**: Reference URL에서 브랜드명이 포함된 도메인 자동 추출
- **경쟁사 도메인**: Competitor 컬럼의 브랜드명으로 Reference에서 경쟁사 도메인 자동 매핑

### Reference 도메인 분류
- `owned_target`: 타겟 브랜드의 공식 도메인
- `tech_media`: 테크 전문 미디어
- `competitor_X`: 경쟁사 공식 도메인
- `other`: 기타 도메인

### 리포트 서술 시 브랜드명 치환
리포트의 모든 섹션에서 "삼성전자" 대신 `meta.target_brand` 값을 사용한다.
예: "LG전자의 GEO 성과는...", "Apple의 AI Visibility는..."

## 주의사항

- CSV의 Answer Text를 반드시 전수 읽어야 한다. 샘플링하지 않는다.
- 근거 없는 추론을 하지 않는다. 데이터에서 확인 가능한 내용만 서술한다.
- QueryID 레퍼런스 [q0000001] 표기를 반드시 붙인다.
- Baseline 데이터가 없으면 트렌드 섹션은 "단일 시점 분석"임을 명시한다.
- 리포트 톤: 브랜드 담당자/eCommerce 담당자가 독자임을 고려한다.
- Accuracy Proxy: Answer Text에서 타겟 브랜드 제품의 모델명/스펙이 정확한지 검증한다.
- Misconception Patterns: AI가 타겟 브랜드에 대해 반복적으로 보이는 오인식을 식별한다.
- 대립적 테제: Executive Summary에서 긍정/부정 양면을 대조하는 서술 구조를 사용한다.
- 각 섹션의 테이블 형식은 `references/report_structure.md`의 컬럼 정의를 정확히 따른다.
- Persona는 `by_persona_group`의 그룹핑된 결과를 사용한다.
- SoV 테이블에서 경쟁사별 수치는 추정치이므로 "약 X%" 또는 "추정 X%"로 표현한다.
