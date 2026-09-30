import { env } from "../config/env.js";
import { OpenAIError } from "../demo/openai.js";
import type { SetupInputItem } from "./types.js";

// One Responses API turn for the setup interview: instructions, the conversation so far as input
// items, and the function tools that write the draft. What comes back is every output item verbatim
// (reasoning included, so the next turn can hand it back), the calls the model made, and its text.
//
// base / apiKey / readError / post are copies of the private helpers in src/demo/openai.ts, not
// imports: that file is a verbatim copy of the promo's pinned by src/demo/parity.test.ts, so it can't
// grow the exports or the item-array input this needs. Same behaviour, same OpenAIError messages.

export type SetupFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: false;
};

export type SetupResponseRequest = {
  model: string;
  instructions: string;
  input: SetupInputItem[];
  tools: SetupFunctionTool[];
  /** Default 900. */
  maxOutputTokens?: number;
};

export type SetupFunctionCall = { callId: string; name: string; arguments: string };

export type SetupResponseResult = {
  /** Concatenated output_text of every `message` item. "" when the model only called tools. */
  text: string;
  functionCalls: SetupFunctionCall[];
  /** Every output item verbatim (reasoning, function_call, message), to append to the transcript. */
  items: SetupInputItem[];
  usage: { inputTokens: number; outputTokens: number } | null;
};

/** Overridable so a proxy, a gateway, or a local stand-in can take the calls. */
function base(): string {
  return env.openaiBaseUrl;
}

function apiKey(): string {
  const key = env.openaiApiKey;
  if (!key) {
    throw new OpenAIError("OPENAI_API_KEY is not set on the server.", 500);
  }
  return key;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message || text;
  } catch {
    return text || response.statusText;
  }
}

/** `fetch` says only "fetch failed"; say which endpoint went quiet. */
async function post(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  const url = `${base()}${path}`;
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    if (cause instanceof OpenAIError) throw cause;
    const reason =
      cause instanceof Error && cause.name === "TimeoutError"
        ? `did not answer within ${Math.round(timeoutMs / 1000)}s`
        : "could not be reached";
    throw new OpenAIError(`OpenAI at ${url} ${reason}.`, 502);
  }
}

type OutputItem = {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type?: string; text?: string }[];
};

type ResponsesBody = {
  output?: OutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

export async function createSetupResponse(
  req: SetupResponseRequest,
  timeoutMs = 45_000,
): Promise<SetupResponseResult> {
  // Reasoning models hand back their reasoning encrypted (store:false keeps nothing server-side),
  // so the next turn can pass it back in; other models reject both fields.
  const reasoning = /^(gpt-5|o\d)/.test(req.model)
    ? { include: ["reasoning.encrypted_content"], reasoning: { effort: "low" } }
    : {};
  const response = await post(
    "/responses",
    {
      model: req.model,
      instructions: req.instructions,
      input: req.input,
      tools: req.tools,
      tool_choice: "auto",
      parallel_tool_calls: false,
      store: false,
      max_output_tokens: req.maxOutputTokens ?? 900,
      ...reasoning,
    },
    timeoutMs,
  );
  if (!response.ok) {
    throw new OpenAIError(await readError(response), response.status);
  }

  // The raw REST body has no `output_text` (that is an SDK convenience); the text is in the items.
  const body = (await response.json()) as ResponsesBody;
  const output = Array.isArray(body.output) ? body.output : [];
  let text = "";
  const functionCalls: SetupFunctionCall[] = [];
  for (const item of output) {
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && typeof part.text === "string") text += part.text;
      }
    } else if (item.type === "function_call") {
      functionCalls.push({ callId: item.call_id ?? "", name: item.name ?? "", arguments: item.arguments ?? "" });
    }
  }

  const usage = body.usage
    ? { inputTokens: body.usage.input_tokens ?? 0, outputTokens: body.usage.output_tokens ?? 0 }
    : null;
  return { text, functionCalls, items: output as SetupInputItem[], usage };
}
