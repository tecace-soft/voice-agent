import { env } from "../config/env.js";

/** Overridable so a proxy, a gateway, or a local stand-in can take the calls. */
function base(): string {
  return env.openaiBaseUrl;
}

export class OpenAIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OpenAIError";
    this.status = status;
  }
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

/**
 * `fetch` reports a connection failure as "fetch failed", which tells nobody
 * where to look. Say which endpoint went quiet.
 */
async function post(
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
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

export type ResponsesTool =
  | { type: "web_search"; search_context_size?: "low" | "medium" | "high" }
  | { type: "function"; name: string; description?: string; parameters: unknown };

export type ResponsesRequest = {
  model: string;
  input: string;
  instructions?: string;
  tools?: ResponsesTool[];
  text?: Record<string, unknown>;
  max_output_tokens?: number;
};

export type ResponsesResult = {
  text: string;
  citations: { url: string; title: string }[];
  raw: unknown;
};

type OutputContent = {
  type?: string;
  text?: string;
  annotations?: { type?: string; url?: string; title?: string }[];
};

type OutputItem = { type?: string; content?: OutputContent[] };

export async function createResponse(
  request: ResponsesRequest,
  timeoutMs = 120_000,
): Promise<ResponsesResult> {
  const response = await post("/responses", request, timeoutMs);

  if (!response.ok) {
    throw new OpenAIError(await readError(response), response.status);
  }

  const data = (await response.json()) as {
    output_text?: string;
    output?: OutputItem[];
  };

  let text = data.output_text ?? "";
  const citations: { url: string; title: string }[] = [];
  const seen = new Set<string>();

  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && !data.output_text) {
        text += content.text;
      }
      for (const annotation of content.annotations ?? []) {
        if (annotation.type !== "url_citation" || !annotation.url) continue;
        if (seen.has(annotation.url)) continue;
        seen.add(annotation.url);
        citations.push({
          url: annotation.url,
          title: annotation.title || annotation.url,
        });
      }
    }
  }

  return { text: text.trim(), citations, raw: data };
}

export type LiveSessionConfig = {
  model: string;
  instructions: string;
  audio?: { output?: { voice?: string } };
  delegation?: Record<string, unknown>;
  store?: boolean;
};

export type LiveSessionResult = { id: string; sdp: string };

/** Creates a GPT-Live session and exchanges the browser SDP offer for an answer. */
export async function createLiveSession(
  session: LiveSessionConfig,
  sdp: string,
  timeoutMs = 30_000,
): Promise<LiveSessionResult> {
  const response = await post(
    "/live/sessions",
    { session, transport: { type: "webrtc", sdp } },
    timeoutMs,
  );

  if (!response.ok) {
    throw new OpenAIError(await readError(response), response.status);
  }

  const data = (await response.json()) as {
    id?: string;
    transport?: { sdp?: string };
    sdp?: string;
  };
  const answer = data.transport?.sdp ?? data.sdp;
  if (!answer) {
    throw new OpenAIError("Live session response did not include an SDP answer.", 502);
  }
  return { id: data.id ?? "unknown", sdp: answer };
}
