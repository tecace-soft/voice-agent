// How much the agent may be told about a business, in one place.
//
// Split out of `extractBusiness.ts` so that `business/derive.ts` can be held to the same ceiling
// without importing that module — which reaches `config/env.ts` for the model key, and a pure
// renderer should not need a database URL to be set before it can run.
//
// The reasoning behind the numbers lives with the extractor, and is worth reading before changing
// one: they were raised twice, each time because a real caller asked something the customer had
// written down and the tail had been dropped silently. Every fact is sent on EVERY call, so this is
// a real per-call cost — roughly 2,800 tokens of system prompt at this ceiling.
export const MAX_FACTS = 80;
export const MAX_FACT_CHARS = 200;
export const MAX_TOTAL_CHARS = 11_000;
