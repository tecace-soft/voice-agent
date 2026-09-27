import { env } from "../config/env.js";
import type { LiveSessionConfig } from "../demo/openai.js";
import type { ComposedSession } from "./compose.js";

/**
 * A composed session as GPT-Live's `session` object — the voice model's instructions and voice, and
 * the delegate with its instructions and tools.
 *
 * The same shape the phone agent sends in `session.start` (openai-agent-app `live_session.py`):
 * tools on `delegation.responses`, `strict: false`, one tool call at a time. Kept in one place so an
 * in-app test call and a phone call cannot drift apart in anything but the transport.
 */
export function liveSessionConfig(session: ComposedSession, fallbackVoice?: string | null): LiveSessionConfig {
  const voice = session.voice || fallbackVoice || undefined;
  return {
    model: env.openaiLiveModel,
    instructions: session.live,
    ...(voice ? { audio: { output: { voice } } } : {}),
    delegation: {
      type: "responses",
      responses: {
        model: env.openaiBackendModel,
        instructions: session.backend,
        tools: session.tools.map((tool) => ({ ...tool, strict: false })),
        tool_choice: "auto",
        parallel_tool_calls: false,
      },
    },
    store: false,
  };
}
