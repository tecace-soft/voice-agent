# Question design — types, axes, rules, validation

## 1. The seven types (fixed)

Every question carries exactly one. This taxonomy does not change per target; only the
mix does.

| Type | What it asks | Why it produces brand names |
| --- | --- | --- |
| **Information Search** | "which X does Y" | The answer has to point at something |
| **Comparison** | ranks or contrasts options on stated criteria | Ranking requires named entities |
| **Recommendations** | asks for a pick for a stated need | A recommendation without a name is not one |
| **Use Cases** | best option for a specific situation/person | Forces a concrete match |
| **Trends** | what is emerging, who is doing it well | "Who" is a brand |
| **Performance** | fastest / most accurate / longest-lasting | Superlatives attach to products |
| **Pricing** | best value at a price ceiling | Value claims need a referent |

**Choosing the mix.** Drive it from the evaluation purpose, not an even split:

- *Visibility benchmark* — spread broadly; lead with Information Search, Recommendations,
  Use Cases.
- *Ranking order* — weight Comparison and Performance.
- *Sentiment* — weight Performance, Use Cases, Pricing, where opinion language appears.
- *Competitor context* — weight Comparison and Trends.

Also spread across the journey: awareness → consideration → evaluation → purchase. A set
that is all purchase-stage measures only the bottom of the funnel.

## 2. Categories

The product/domain grouping a question belongs to (스마트폰, TV, 무선 이어폰, 가전제품 …).

- Derive from research into what the target and its competitive ring actually sell.
- Keep them at one level — do not mix "스마트폰" with "폴더블 스마트폰 힌지".
- Aim for a handful, not dozens; each needs enough questions to say anything.
- Every question gets exactly one.

## 3. Personas

Written as age / profession / intent, not a demographic label. "출장이 잦은 영업직",
"첫 자취를 시작한 사회초년생", "영상 편집 프리랜서".

Generate as each persona in turn. This is what makes questions read like real searches
instead of survey items. Every question gets exactly one.

## 4. Design rules

For each question:

- Natural, conversational phrasing that mirrors a real consumer search query.
- **No brand names** — not the target, not competitors, not their products.
- **No disguised brand references** — "그 폴더블 만드는 한국 회사" is a leak.
- Constructed so a natural answer would name a specific brand or product.
- Follows a real intent flow (features → reviews → pricing → decision).
- Trending terms integrated where they fit, checked against research.
- Reads fluently and natively in the target language.
- Labeled with exactly one Type and one Category, plus Tags and Persona.

## 5. Validation checklist

Run on **every** question. Any failure → rewrite and re-check.

- [ ] No target, competitor, or product name in the text
- [ ] No description that identifies one company without naming it
- [ ] Entirely neutral in product/category terminology
- [ ] A natural answer would very likely contain a brand or product name
- [ ] Reads natively in the target language
- [ ] Exactly one Type and one Category, both plausible for the text
- [ ] Tags present and drawn from the keyword set
- [ ] Persona present and matching the phrasing
- [ ] Not a near-duplicate of another question
- [ ] Serves the stated evaluation purpose

## 6. Worked examples

| Question | Type | Category |
| --- | --- | --- |
| 가장 많은 AI 기능을 제공하는 스마트폰은 무엇인가요? | Information Search | 스마트폰 |
| 심박수 측정 정확도와 배터리 지속 시간을 기준으로 상위권 스마트워치를 비교해 주세요. | Comparison | 스마트워치 |
| 게임용으로 최적화된 노트북 추천을 해주세요. | Recommendations | 노트북 |
| 출장이 많은 직장인에게 가장 적합한 태블릿은 어떤 제품인가요? | Use Cases | 태블릿 |
| 2025년 가장 주목받는 혁신은 AI인데, 가장 사용자에게 편하게 사용할 수 있도록 구현한 가전 브랜드는 무엇인가요? | Trends | 가전제품 |
| 영상 편집 작업에서 가장 빠른 렌더링 속도를 제공하는 PC 브랜드는 무엇인가요? | Performance | PC |
| 50만 원 이하에서 가성비가 가장 좋은 무선 이어폰은 무엇인가요? | Pricing | 무선 이어폰 |

## 7. Failure patterns

- **Too generic** — "좋은 스마트폰은 어떻게 고르나요?" produces advice, not names. Add a
  constraint (price, use case, criterion) that forces a pick.
- **Brand-shaped** — "갤럭시와 아이폰 중 어느 쪽이 낫나요?" is a leak even as a comparison.
  Rewrite to the criterion: "카메라 성능만 놓고 볼 때 상위권 스마트폰은 무엇인가요?"
- **Two questions in one** — split them; one row measures one thing.
- **Category drift** — a "무선 이어폰" question that is really about phone pairing belongs
  in 스마트폰 or gets rewritten.
