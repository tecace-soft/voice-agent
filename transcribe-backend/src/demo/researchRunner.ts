import { env } from "../config/env.js";
import { ClaudeCliError } from "./callReview.js";
import { createResponse } from "./openai.js";
import type { ResearchSource } from "./types.js";

/**
 * The promo's `lib/research-runner.ts`, **narrowed to one provider**. Its own comment explains
 * the three ways to get a model that can search the web:
 *
 * - the Claude Code CLI on the operator's machine, which runs on their Claude subscription and
 *   costs nothing per run,
 * - the OpenAI Responses API with its web search tool, which reuses the key the voice side
 *   already needs, and
 * - the Anthropic API, for a host that has neither.
 *
 * Only the middle one is built here, and the reason is the deployment: this backend is a Bun
 * process on Vercel (`package.json`: "Bun locally, Vercel/Node in prod"). There is no Claude CLI
 * in that image to spawn, and the Anthropic branch needs `@anthropic-ai/sdk`, a dependency this
 * repo does not have and would be adding for a code path the deployed service can never take —
 * the promo's own `resolveProvider` picks `openai` on a host that has `OPENAI_API_KEY`, which is
 * the host we are. `PORTING.md` records that decision and what it costs.
 *
 * The other two names survive as *settings*, not as silence: `RESEARCH_PROVIDER=cli` is answered
 * with an error that says the branch is not carried, rather than by quietly running something
 * else. A provider that is configured and does nothing is the failure mode worth avoiding.
 *
 * `runResearchPrompt` still takes a prompt and returns text, so `research.ts` does not care which
 * one answered — the seam the promo built is kept, and a second provider is an added branch here
 * and nothing else.
 */

export type ResearchProvider = "cli" | "openai" | "anthropic";

export type ResearchRun = {
  text: string;
  costUsd?: number;
  provider: ResearchProvider;
  /** Sources the provider cited itself, where it reports them. */
  citations?: ResearchSource[];
};

const PROVIDERS: ResearchProvider[] = ["cli", "openai", "anthropic"];

/** The only provider this backend carries an implementation for. */
const BUILT_IN: ResearchProvider = "openai";

export function resolveProvider(): ResearchProvider {
  const configured = env.researchProvider;
  if (PROVIDERS.includes(configured as ResearchProvider)) {
    return configured as ResearchProvider;
  }
  // The promo asked `process.env.VERCEL` here, because it had a CLI to prefer when it was not on
  // one. This service has no CLI on either side of that question, so there is nothing to ask.
  return BUILT_IN;
}

function openaiModel(): string {
  return env.researchOpenaiModel;
}

function searchContextSize(): "low" | "medium" | "high" {
  const configured = env.researchSearchContext;
  return configured === "low" || configured === "high" ? configured : "medium";
}

/**
 * Both passes have to finish inside one serverless invocation, so the searching
 * pass gets the long budget and the pass that only reformats gets the short one.
 */
const SEARCH_TIMEOUT_MS = 180_000;
const PLAIN_TIMEOUT_MS = 90_000;

async function runViaOpenAI(prompt: string, withSearch: boolean): Promise<ResearchRun> {
  const result = await createResponse(
    {
      model: openaiModel(),
      input: prompt,
      tools: withSearch
        ? [{ type: "web_search", search_context_size: searchContextSize() }]
        : [],
      max_output_tokens: 8000,
    },
    withSearch ? SEARCH_TIMEOUT_MS : PLAIN_TIMEOUT_MS,
  );

  return {
    text: result.text,
    provider: "openai",
    citations: result.citations,
  };
}

export async function runResearchPrompt(
  prompt: string,
  options: { withSearch: boolean },
): Promise<ResearchRun> {
  const provider = resolveProvider();
  if (provider !== "openai") {
    // `ClaudeCliError` because that is the class the promo throws for a provider that cannot run,
    // and `research.ts` — copied verbatim — throws it too. One class, one `instanceof`.
    throw new ClaudeCliError(
      `Research is set to the "${provider}" provider, which this backend does not carry. Unset RESEARCH_PROVIDER, or set it to openai.`,
    );
  }
  return runViaOpenAI(prompt, options.withSearch);
}
