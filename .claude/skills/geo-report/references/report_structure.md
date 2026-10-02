# GEO 분석 리포트 구조 가이드 v2

이 문서는 GEO 월간 분석 리포트의 정확한 구조, 테이블 스키마, 서술 패턴, JSON 필드 매핑을 정의한다.
리포트 작성 시 이 문서를 참조하여 샘플 리포트와 일관된 품질을 유지한다.

---

## 글로벌 작성 원칙

### 톤 & 스타일
- **독자**: 타겟 브랜드의 브랜드매니저, eCommerce 담당자 (의사결정자)
- **톤**: 컨설팅 보고서. 기술 리포트가 아닌 전략 브리핑.
- **서술 흐름**: 항상 `수치 제시 → 원인 분석 → 비즈니스 시사점/제언` 3단 구조
- **한국어 기본**, 기술 용어는 영문 병기 (예: 목소리 점유율(Share of Voice, SoV))
- 수치를 문장에 자연스럽게 녹인다. 별도 표시가 아닌 맥락 내 인용.
  - ✅ "[타겟 브랜드]의 SoV는 약 X%로, 전체 N회 브랜드 멘션 중 M회를 점유했습니다."
  - ❌ "SoV: 22.5%" (단독 수치 나열 금지)

### 증빙 표기 규칙
- Answer Text를 인용하거나 예시를 들 때 **반드시** QueryID를 붙인다: `[q0000003]`
- 복수 근거: `[q0000003][q0000021]`
- 셀 안에서도 표기: "Pixel 10 Pro의 사진 우위가 부각됨[q0000003]"

### 수치 인용 규칙
- **모든 수치는 analyze_csv.py JSON에서만 가져온다** (추정/기억 금지)
- 경쟁사 SoV는 추정치이므로 "약 X%" 또는 "추정 X%"로 표현
- Baseline이 없는 경우: "단일 시점 분석" 명시, 전월 대비 컬럼은 "N/A" 처리

---

## 섹션별 상세 구조

### 교차 분석 항목 (별도 섹션 없이 관련 섹션에 녹여서 서술)

아래 2개 항목은 독립 섹션을 갖지 않지만, Answer Text를 읽으면서 반드시 분석하고
관련 섹션(1.3 Weak Points, 3.3 Sentiment, 7.1 SWOT W/T 등)에 녹여서 서술한다.

#### Accuracy Proxy (정확성 검증)
AI가 타겟 브랜드 제품의 모델명, 스펙, 출시 시기를 정확하게 언급하는지 판단한다.
- `answer_text_analysis.brand_product_mentions`에서 언급된 제품명 목록을 확인
- Answer Text에서 다음을 체크:
  - 출시되지 않은 가상 모델을 만들어내는 경우 (Hallucination)
  - 잘못된 스펙 언급 (예: 타겟 브랜드의 특정 제품 스펙을 잘못 기술)
  - 단종된 구세대 모델을 현행 제품처럼 추천하는 경우
- 발견 사항은 1.3 Weak Points 또는 7.1 SWOT Weakness에 포함

#### Misconception Patterns (오인식 패턴)
AI가 타겟 브랜드에 대해 반복적으로 잘못 생성하는 정보 패턴을 식별한다.
- Answer Text에서 반복 등장하는 부정확한 서술을 카테고리별로 분류
- 특히 경쟁사 대비 타겟 브랜드의 스펙이 잘못 비교되는 경우 주의
- 예: 타겟 브랜드 제품이 특정 기능을 "지원하지 않는다"고 언급했지만 실제로는 지원하는 경우
- 발견 사항은 1.3 Weak Points, 3.3 부정/중립 요인, 6.2 Reference 약점에 포함

---

### 1. Executive Summary (2~3 페이지)

이 섹션은 리포트 전체의 요약이며, 경영진이 이 섹션만 읽어도 핵심을 파악할 수 있어야 한다.

#### 1.1. 핵심 발견

**서술 패턴**: 해당 월의 GEO 성과를 **상반된 두 축의 대비**로 프레이밍한다.
샘플에서는 '편재성(Ubiquity)의 확보'와 '지배력(Dominance)의 희석'을 대비시켰다.

구성:
1. 첫 문단: 해당 월 성과를 한 문장 테제로 선언
2. 둘째 문단: Visibility와 SoV 핵심 수치를 문장에 녹여 서술 (3-4문장)
3. 셋째 문단: 이면의 질적 위협/기회 요인 서술 (3-4문장)

**JSON 매핑**:
- `summary.ai_visibility_pct` → Visibility 수치
- `summary.sov_pct` → SoV 수치
- `summary.avg_position` → 평균 노출 순위
- `answer_text_analysis.framing_distribution` → primary/absent 비율로 양극화 판단
- `zero_mention_patterns.total` → 미언급 건수

**예시 테제 패턴** (해당 회차 데이터에 따라 조정):
- "가시성 확대 vs SoV 희석"
- "AI 기능 리더십 강화 vs 하드웨어 혁신 인식 약화"
- "카테고리 확장 vs 전문 영역 부재"

#### 1.2. Top 3 Strong Points

**포맷**: 각 항목은 `굵은 제목 (영문 부제)` + 2-3문장 설명 + [qXXX] 레퍼런스

각 강점은 "왜 중요한지" 비즈니스 임팩트 관점에서 서술한다.
단순 기술 나열이 아닌, AI가 타겟 브랜드를 어떻게 인식하는지의 프레이밍을 분석한다.

**JSON 매핑** (강점 후보 도출 소스):
- `summary.ai_visibility_pct`가 높으면 → 가시성 자체가 강점
- `by_category`에서 visibility/sov가 특히 높은 카테고리 → 해당 카테고리 강점
- `answer_text_analysis.framing_distribution.primary` 비율 → primary가 높으면 선도적 위치
- `references.reference_class_summary.owned_target` → 공식 도메인 인용이 높으면 정보 통제력 강점
- `by_persona_group`에서 sov가 특히 높은 그룹 → 해당 페르소나에서 강점

**샘플 강점 패턴**:
- 예: "[타겟 브랜드의 핵심 강점 라벨]" → 기능적 차별화
- "플래그십의 기준점 (The Reference Standard)" → 포지셔닝
- "공식 정보 기반의 신뢰도 확보 (Reference Authority)" → 참조 생태계

#### 1.3. Top 3 Weak Points

**포맷**: 강점과 동일. 단, 반드시 원인 분석을 포함하고, 위협적인 경쟁사명을 구체적으로 명시.

**JSON 매핑** (약점 후보 도출 소스):
- `zero_mention_patterns.by_category` → 미언급이 집중된 카테고리
- `by_category`에서 visibility가 낮은 카테고리 → 취약 카테고리
- `brand_sov`에서 경쟁사가 타겟 브랜드와 동등/우위인 경우 → SoV 위협
- `competitors`에서 appearance_rate 높은 경쟁사 → 자주 대비되는 경쟁자
- `by_persona_group`에서 sov가 낮은 그룹 → 약한 페르소나

---

### 2. 분석 데이터 및 방법론 (1~2 페이지)

이 섹션은 분석의 신뢰성을 확보하기 위한 방법론 설명이다.
회차가 바뀌어도 크게 달라지지 않는 부분이므로, 샘플의 구조를 거의 그대로 유지한다.

#### 2.1. 개요 및 분석 프레임워크

서술 내용:
1. GEO 개념 정의 (1문단): SEO와 대비하여 GEO가 무엇인지 간결히 설명
2. 분석 축 4개를 불릿으로 나열 (각 2-3문장):
   - **Time Series (시계열 분석)**: 2025.08~현재까지 추적, 특히 신제품 출시 효과
   - **Contextual Dimension (문맥적 차원)**: Category/Type/Tag 교차 분석
   - **Persona Dimension (사용자 페르소나)**: 질문자 의도별 답변 패턴 차이
   - **Reference Ecology (참조 생태계)**: AI 답변 근거 URL 도메인 분석

#### 2.2. 데이터셋 구성

3종 데이터를 불릿으로 설명:
- **Baseline Data**: 과거 월간 리포트 (있을 경우)
- **Current Data**: 당월 CSV 데이터. `summary.total_queries`개 쿼리. 주요 쿼리 2-3개 예시 + [qXXX]
- **External Intelligence**: 시장 상황 보조 데이터 (선택)

---

### 3. 정량 분석 (Brand, Feature, SoV) (3~4 페이지)

이 섹션은 리포트의 수치적 핵심이다. 반드시 2개의 테이블을 포함한다.

#### 3.1. AI Visibility (브랜드 언급률) 및 Trend

서술 후 **트렌드 테이블**을 삽입한다.

**★ 테이블 1: 월별 트렌드 테이블**

| 기간 (Date) | Brand Visibility (언급률) | Share of Voice (SoV) | Avg. Rank (평균 노출 순위) | 비고 |
|---|---|---|---|---|
| 2025.08 | (Baseline) | (Baseline) | (Baseline) | Baseline |
| ... | ... | ... | ... | ... |
| 당월 | `summary.ai_visibility_pct`% | `summary.sov_pct`% | `summary.avg_position`위 | 당월 키 이벤트 |

- Baseline 데이터가 없으면: 당월 행만 표시하고, "과거 데이터 미제공으로 단일 시점 분석" 명시
- Baseline이 있으면: `baseline_comparison.previous` 값으로 이전 행 채움

테이블 아래 **트렌드 분석** 문단: Visibility와 SoV의 방향이 다른 경우 "양적 팽창 vs 질적 희석" 프레이밍

#### 3.2. Share of Voice (SoV: 목소리 점유율)

도입 문단에서 SoV의 의미를 설명하고, 당월 수치를 제시한다.
이후 **원인 분석** 소제목으로 1-2개 원인을 번호 매겨 서술한다.
마지막으로 **브랜드별 SoV 테이블**을 삽입한다.

**★ 테이블 2: 브랜드별 SoV 테이블**

| 브랜드 | 당월 SoV | 주요 특징 |
|---|---|---|
| [타겟 브랜드] | `brand_sov.[타겟].sov_pct`% | (서술) |
| (2위 브랜드) | ... | ... |
| ... | ... | ... |

- `brand_sov`에서 상위 5-6개 브랜드를 추출
- "주요 특징"은 Answer Text 분석 기반으로 Claude가 작성

**원인 분석 패턴** (샘플 기준):
1. 경쟁자 다변화: "과거 양강 구도에서 다자 구도로 재편"
2. 질문의 세분화: "AI가 카테고리를 쪼개어 답변하면서 독점적 지위 분산"

#### 3.3. Sentiment (감성 분석) & Framing (프레이밍)

서술 내용:
- 긍정 감성 비율: `sentiment.distribution.positive` / 전체 × 100
- 평균 감성 점수: `sentiment.overall_avg`
- **긍정 요인**: Answer Text에서 타겟 브랜드에 대한 긍정 키워드/프레이밍 분석
- **부정/중립 요인**: neutral/negative 비율과 원인
- **프레이밍 분석** (v2 신규):
  - `answer_text_analysis.framing_distribution` 값을 활용
  - primary(답변 초반 최우선) = 타겟 브랜드가 '디폴트' 선택지
  - absent(완전 미언급) = 취약 영역 → `zero_mention_patterns`와 교차 분석
  - secondary/compared = 경쟁사와 함께 비교 대상
  - 양극화 구조를 서술: "언급 시 주로 1순위이나, 아예 배제되는 영역도 존재"

#### 3.4. Tag 상위 5개 및 경쟁력 분석

`tags`에서 count 기준 상위 5개 태그를 선정한다.
각 태그별로 불릿으로 서술:
- 태그명 + 타겟 브랜드의 위치 + 경쟁 구도 설명
- `target_visibility`가 낮은 태그는 경쟁사 우위 영역으로 표기

---

### 4. 카테고리 및 질문 유형별 분석 (2~3 페이지)

#### 4.1. 카테고리별 트렌드 분석

도입 문단 후 **Category × Type 테이블**을 삽입한다.

**★ 테이블 3: Category × Type 교차 분석 테이블**

| Category | Type | Trend | Insight |
|---|---|---|---|
| Smartphone | Recommendations | 유지/분산 | (서술) |
| Smartphone | Performance (AI) | 강화 | (서술) |
| ... | ... | ... | ... |

- `category_type_cross`에서 total_queries ≥ 2인 교차를 선정
- **Trend 컬럼**: Baseline 대비 visibility/sov 변화 → "강화/유지/경합/위협/악화"
  - Baseline 없으면: 절대 수치 기준으로 "강세/보통/약세" 판단
- **Insight 컬럼**: 1-2문장. 타겟 브랜드의 위치, 경쟁사, 시사점을 압축

주요 조합 8-12개를 선정한다. 너무 많으면 가독성이 떨어진다.

#### 4.2. 개선된 유형 vs 악화된 유형

**개선된 유형 (Improved)**: 불릿 1-2개. visibility/sov가 상승한 영역 + 이유 + [qXXX]
**악화된 유형 (Regressed)**: 불릿 1-2개. 하락한 영역 + 경쟁사 + [qXXX]

Baseline 없을 경우: 절대적으로 강한/약한 유형을 "현재 강세/약세"로 표현

#### 4.3. Tag 변화폭 상위 5개

`tags`에서 target_visibility와 count를 기준으로 주목할 만한 5개 태그를 선정한다.
각 태그를 불릿으로 서술: 태그명 + 변화 원인 + 시사점

---

### 5. Persona Deep Dive (2~3 페이지)

도입: "페르소나에 따라 AI 답변의 타겟 브랜드 포지셔닝이 극명하게 갈린다"는 프레이밍

#### 5.1. Persona별 강점/약점 매트릭스

**★ 테이블 4: Persona 강점/약점 매트릭스**

| Persona | 타겟 브랜드 포지셔닝 | 강점 요인 | 약점/위협 요인 |
|---|---|---|---|
| 얼리어답터/기술 탐색형 | (포지셔닝 한마디) | (강점 2-3줄) | (약점 2-3줄) |
| 가성비/실용성 중시형 | ... | ... | ... |
| ... | ... | ... | ... |

- `by_persona_group`에서 total_queries ≥ 2인 그룹을 대상으로 한다
- **포지셔닝 컬럼**: 영어 별명 스타일 (예: "The Benchmark", "Safe Bet but Expensive")
- **강점/약점 컬럼**: 해당 Persona 그룹에서의 타겟 브랜드 vs 경쟁사 차이 분석
  - `top_competitors`로 어떤 경쟁사와 부딪히는지 파악
  - Answer Text에서 구체적 근거를 찾아 [qXXX] 표기

#### 5.2. Persona-Product 매트릭스 분석

3단계로 분류:
- **High Match (최적 조합)**: visibility > 80% & sov > 30%인 Persona-Category 조합
- **Medium Match (경합 조합)**: visibility > 50% & sov 20-30%
- **Low Match (약세 조합)**: visibility < 50% 또는 sov < 15%

각 단계에 1-2개 대표 사례를 서술한다.

#### 5.3. 타겟 브랜드 vs 경쟁사 비교 (Persona 관점)

3개 경쟁 축으로 구분:
- **vs Apple**: 생태계/비디오 선호 Persona에서 열위. 개방성/기능 다양성으로 대응.
- **vs Google**: AI 비서/사진 선호 Persona에서 경합. 하드웨어 완성도로 차별화.
- **vs OnePlus/Chinese Brands**: 스펙/가성비 Persona에서 위협. 브랜드 신뢰도로 방어.

`competitors`와 `by_persona_group.top_competitors`를 교차 참조.

#### 5.4. Persona 트렌드 변화

Baseline 대비 Persona별 변화를 서술한다.
Baseline 없으면: "현재 Persona 분포 특이점"으로 대체.

---

### 6. Reference Domain 분석 (2 페이지)

#### 6.1. 월별 Top Referenced Domains

`references`에서 상위 4-5개 도메인을 **순위별**로 설명한다.
각 도메인에 대해:
- 도메인명 + 인용 횟수
- 어떤 유형의 쿼리에서 주로 인용되는지
- 타겟 브랜드에 대한 영향 (긍정/부정)
- `domain_class` 정보를 자연스럽게 녹임

**순위 패턴** (예시):
- 1위: [타겟 브랜드 공식 도메인] → `reference_class_summary.owned_target` 수치
- 2위: rtings.com → tech_media
- 3위: apple.com → competitor_Apple

#### 6.2. Reference 기준 타겟 브랜드 강점/약점 평가

- **강점**: owned_target 도메인의 인용 빈도와 정보 정확성
- **약점**: tech_media 도메인에서 경쟁사 편향 평가 가능성

`reference_class_summary`의 각 클래스별 인용 수를 비교하여 서술.

#### 6.3. 경쟁사 대비 구조적 유리/불리 요인

- **유리 요인**: 타겟 브랜드 뉴스룸의 대량 텍스트 → AI 학습 우선순위
- **불리 요인**: 경쟁사의 명확한 서사 vs 타겟 브랜드의 서사

#### 6.4. Reference 전략 제언

2개 축으로 제언:
1. **Media Outreach 강화**: 주요 테크 미디어의 리스트에 타겟 브랜드 상위 포지셔닝
2. **Owned Media 최적화**: AI가 읽기 쉬운 구조(Q&A, 비교표)로 콘텐츠 발행

---

### 7. 브랜드별 딥다이브 & SWOT (2~3 페이지)

#### 7.1. Samsung SWOT with Month-to-Month Δ

**★ 테이블 5: SWOT 테이블**

| 구분 | 내용 | 전월 대비 변화 ▲ |
|---|---|---|
| Strengths (강점) | (2개 항목, 각 1-2줄) | ▲/▼ + 구체적 수치 변화 |
| Weaknesses (약점) | (2개 항목) | ▲/▼ + 구체적 수치 변화 |
| Opportunities (기회) | (2개 항목) | ▲/▼ + 관련 쿼리 변화 |
| Threats (위협) | (2개 항목) | ▲/▼ + 경쟁사 동향 |

- ▲: 개선/증가/강화
- ▼: 악화/감소/약화
- Baseline 없으면: "전월 대비 변화" 컬럼을 "현재 진단"으로 변경

**SWOT 항목 도출 소스**:
- S: `summary` 고수치 항목, `by_category` 강세 카테고리
- W: `zero_mention_patterns`, `brand_sov`에서 경쟁사 우위 항목
- O: `tags`에서 성장 중인 태그, `answer_text_analysis.feature_frequency` 유망 키워드
- T: `competitors`에서 성장세인 경쟁사, `by_persona_group`에서 약세 그룹

#### 7.2. Competitor Shifts 요약

주요 경쟁사 3개(Google, OnePlus/Chinese, Apple)에 대해 각 1문단 서술:
- 경쟁사명 + Position 한마디 + GEO 변화 + 타겟 브랜드에 대한 위협 포인트

---

### 8. Competitor Landscape (1~2 페이지)

#### 8.1. 주요 경쟁자별 GEO 포지셔닝

`competitors`에서 상위 3-4개 경쟁사에 대해:
- **Position**: 한 문장 포지셔닝 (예: "가장 똑똑한 카메라와 AI 비서")
- **GEO 특징**: 2-3문장으로 어떤 쿼리 유형에서 강세인지 서술

#### 8.2. 타겟 브랜드의 대응 전략

2개 전략 축으로 제언:
1. **종합적 완성도 + 연결성**: 개별 스펙이 아닌 생태계 기반의 GEO 전략
   - 시나리오 기반 콘텐츠 대량 생성 → AI 학습 유도
2. **Persona 전략**: 약한 Persona 그룹에 맞춤형 GEO 접근
   - `by_persona_group`에서 sov 낮은 그룹을 타겟

---

### 9. 부록 (가변 페이지)

**★ 테이블 6: 전체 쿼리 목록**

| Query ID | Query Text | Category | Type |
|---|---|---|---|
| q0000001 | 2025년 최고의 플래그십... | Smartphone | Recommendations |
| ... | ... | ... | ... |

- CSV의 모든 행을 나열한다.
- 텍스트가 긴 경우 적절히 잘라서 표시 (50자 내외)

---

## 테이블 요약

리포트에는 총 6개의 핵심 테이블이 포함된다:

| # | 테이블명 | 섹션 | 컬럼 |
|---|---------|------|------|
| 1 | 월별 트렌드 | 3.1 | 기간, Visibility, SoV, Avg Rank, 비고 |
| 2 | 브랜드별 SoV | 3.2 | 브랜드, SoV%, 주요 특징 |
| 3 | Category × Type | 4.1 | Category, Type, Trend, Insight |
| 4 | Persona 매트릭스 | 5.1 | Persona, 포지셔닝, 강점, 약점 |
| 5 | SWOT | 7.1 | 구분, 내용, 전월 대비 변화 |
| 6 | 전체 쿼리 목록 | 9 | Query ID, Query Text, Category, Type |

---

## JSON 필드 → 섹션 매핑 요약

| JSON 필드 | 주요 사용 섹션 |
|---|---|
| `summary` | 1.1, 3.1, 3.2 |
| `brand_sov` | 1.1, 3.2, 7.1 |
| `sentiment` | 3.3 |
| `tags` | 3.4, 4.3 |
| `by_category` | 4.1, 5.2 |
| `by_type` | 4.1 |
| `category_type_cross` | 4.1 (테이블 3) |
| `by_persona_group` | 5.1, 5.2, 5.3, 5.4, 8.2 |
| `competitors` | 1.3, 5.3, 7.2, 8.1 |
| `references` | 6.1 |
| `reference_class_summary` | 6.2, 6.3 |
| `answer_text_analysis` | 1.1, 3.3, 3.4 |
| `zero_mention_patterns` | 1.3, 4.2 |
| `baseline_comparison` | 3.1(테이블), 4.2, 5.4, 7.1(SWOT Δ) |
| `position_distribution` | 3.1 |

---

## Baseline 유무에 따른 분기

### Baseline 있을 때
- 3.1 트렌드 테이블: 과거 월 행 포함
- 4.2: "개선된 유형 vs 악화된 유형"으로 서술
- 4.3: "Tag 변화폭 상위 5개"
- 5.4: "Persona 트렌드 변화" (과거→현재)
- 7.1 SWOT: "전월 대비 변화 ▲" 컬럼 활성

### Baseline 없을 때
- 3.1 트렌드 테이블: 당월 행만 표시 + "단일 시점 분석" 명시
- 4.2: "현재 강세 유형 vs 약세 유형"으로 대체
- 4.3: "현재 주목할 Tag 5개"로 대체
- 5.4: "현재 Persona별 특이점"으로 대체
- 7.1 SWOT: "전월 대비 변화" → "현재 진단"으로 컬럼명 변경
