# Answer-collection subagent prompt template

Spawn one general-purpose subagent per batch of ~10 questions, all in the same turn.
Fill the `{{...}}` placeholders. The honesty rule is the whole point — do not let
subagents fabricate the target's presence.

---

You are running the answer-collection step of a GEO analysis. TARGET BRAND =
"{{TARGET}}" ({{TARGET one-line description: what it is, where, who it serves}}).

The questions are in {{LANGUAGE}} and represent a real user asking an AI assistant.
For each question, SIMULATE what a web-enabled AI assistant (e.g. ChatGPT with
browsing) would actually answer, GROUNDED IN REAL WEB RESEARCH about the relevant
market ({{market / region / competitor set}}). Then record analysis fields.

Batch file to read: {{BATCH_PATH}}  (fields per item: query_id, question, category,
type, tags, persona)

For EACH question:
1. Do 1–3 web searches (WebSearch/WebFetch) to find which REAL firms/brands actually
   surface for that specific need + location/context.
2. Write a natural, helpful answer IN {{LANGUAGE}} (about 3–6 sentences) naming the
   SPECIFIC REAL brands that genuinely appear in your research — the way an AI
   assistant answers this kind of question.
3. HONESTY IS CRITICAL — this is a visibility baseline. Only name the target in the
   answer if your research GENUINELY surfaces it for that query. Where it does not
   actually surface, DO NOT force it in — record 0 mentions. Never fabricate target
   prominence.

Produce one JSON object per question:
{
 "query_id": "...",
 "answer_text": "the answer in {{LANGUAGE}}, naming real brands",
 "target_brand_mentions_count": <int, times the target is named>,
 "target_brand_mentions_position": <int, among brands named in order, 1-based rank of
     the FIRST target mention; 0 if absent>,
 "total_mentions_all_brands": <int, total brand-name mention occurrences, target +
     competitors>,
 "sentiment_category": "긍정" | "중립" | "부정"  (toward the target; if absent, "중립"),
 "sentiment_score": <float 0..1; target absent ~0.5>,
 "reference": [{"title":"...","url":"..."}, ...]  (2–4 real URLs actually used),
 "competitor_brand": "comma-separated real competitor brands named (exclude target)"
}

Save the JSON array (all items, in query_id order) to: {{OUTPUT_PATH}}
Final message: how many of the batch surfaced the target vs not, and any pattern.

---

## Sentiment labels
Keep the Korean labels `긍정 / 중립 / 부정` so the downstream `geo-report` analyzer and
the sample dataset stay consistent, regardless of the answer language.
