# Tuning the Hermes agent for the voice agent

**Goal:** make Hermes (`gpt-5.6-sol`) answer a live phone caller in **~1–2 seconds with plain, accurate speech** — instead of the **6.7s** (and occasional **40s**) we measured out of the box.

## Why this is needed (what the deep-dive found)

Your Hermes deployment is provisioned as a **full autonomous *coding* agent**, not a lean chat model. `/api/config` shows it has a shell toolset (`hermes-cli`) on a Docker terminal, environment probing, task/verify guidance, and full reasoning. For our use — a short spoken sentence to a caller — all of that is pure overhead:

- **~6.7s** for a normal reply: the reasoning model chews through our large persona+KB prompt every turn.
- **~40s** when it decides to *use its tools* (it browsed for "TecAce's official website" and returned markdown).
- **Hallucinated services** when the knowledge base wasn't in context.

None of that is fixable in our app code — it's the agent's configuration. The fixes below turn it into a fast, deterministic chat responder.

> ## ✅ Applied 2026-07-24 — results
> These settings were applied to the live agent via `PUT /api/config` (body `{"config": <full config>}`). Measured **6.7s → ~3.0s** (stable ~2.95–3.46s), **no 40s tool tangents**, plain-text output, KB-accurate. `gateway_running` stayed true. A backup of the pre-change config is saved at `scratchpad/hermes-config-backup.json`.
> - **Applied:** `toolsets: []`, `agent.disabled_toolsets: ["hermes-cli"]`, `environment_probe: false`, `task_completion_guidance: false`, `verify_guidance: false`, `parallel_tool_call_guidance: false`, `max_verify_nudges: 0`, `max_turns: 2`, `reasoning_overrides: {"gpt-5.6-sol": "minimal"}`.
> - **Not needed / left at `auto`:** the enum fields `tool_use_enforcement`, `coding_context`, `verify_on_stop`, `intent_ack_continuation` — with tools already disabled and reasoning minimal, the result was at the model's ~2.5s inference floor, so these weren't required. Tune later if desired.
> - **Gotcha:** `PUT /api/config` **deep-merges** nested dicts. So `reasoning_overrides` accumulates keys — set the model key you want and pass `null` to delete stray keys. And `"minimal"` is *less* reasoning (faster) than `"low"`.
> - The remaining ~2.5–3s is `gpt-5.6-sol`'s own inference — inherent; masking handles the rest.

> ⚠️ **Golden rule: don't edit your existing/default agent.** It's set up for coding work you may still want. Create a **dedicated profile** for the voice agent (e.g. `voice-agent`) and apply everything below to *that* profile. Your coding agent stays untouched.

---

## The settings to change

Apply these to the **voice-agent profile** (via the Hermes dashboard's agent settings, or `PUT /api/config` scoped to that profile). Field names match the `agent` block in `/api/config`.

### 1. Remove all tools — the single biggest lever
| Field | From | To |
|---|---|---|
| `toolsets` | `["hermes-cli"]` | `[]` (none) |
| `disabled_toolsets` | `[]` | `["hermes-cli"]` |
| `tool_use_enforcement` | `"auto"` | `"off"` / `"never"` |

**Why:** the shell/browse toolset is what caused the 40-second tangent and the *"according to the website"* answer with markdown. A live phone call must never wait on the agent running a command or fetching a page. With no tools, it can only answer from its own knowledge + our system prompt — which is exactly what we want, and it's faster and predictable.

### 2. Turn off the coding / agentic scaffolding
| Field | From | To | Why |
|---|---|---|---|
| `environment_probe` | `true` | `false` | It inspects its Docker environment on session start — startup latency that's irrelevant to a phone chat. |
| `coding_context` | `"auto"` | `"off"` | We're not coding; this injects coding scaffolding that biases toward tool use and verbosity. |
| `task_completion_guidance` | `true` | `false` | A spoken reply isn't a multi-step "task to complete" — this adds planning/continuation overhead. |
| `verify_guidance` | `true` | `false` | Stops the agent re-checking its own answer (extra internal turns = extra seconds). We want one fast reply. |
| `verify_on_stop` | `"auto"` | `"off"` | Same reason — no post-answer verification pass. |
| `max_verify_nudges` | `3` | `0` | Belt-and-suspenders: zero verification nudges. |
| `parallel_tool_call_guidance` | `true` | `false` | No tools, so this is dead weight. |
| `intent_ack_continuation` | `"auto"` | `"off"` | Prevents the agent from adding acknowledgment/continuation turns before answering. |

**Why (overall):** each of these pushes the agent to behave like an autonomous worker — plan, act, verify, continue. For "say one friendly sentence to a caller," they only add latency and can make replies longer/odder for text-to-speech.

### 3. Minimize reasoning
| Field | From | To |
|---|---|---|
| `reasoning_overrides` | `{}` (default = full) | minimal / low effort |

**Why:** `gpt-5.6-sol` is a reasoning model — it generates hidden "thinking" tokens before answering, and **our client discards them anyway**. For short conversational replies and simple classification, deep reasoning is latency we pay for and throw away. Set the lowest reasoning effort the profile allows. *(If the `openai-codex` provider offers a non-reasoning or "fast" variant of the model, prefer it for this profile.)*

### 4. Cap the interaction
| Field | From | To |
|---|---|---|
| `max_turns` | `150` | `1`–`2` |

**Why:** our exchanges are a single question → single answer. Capping turns guarantees the agent can't loop or self-continue. Minor latency, good hygiene.

---

## Bake the persona + knowledge base into the profile

Set the **system prompt / base instructions** of the voice-agent profile to the Tess persona (identity + the TecAce knowledge base + the guardrails). Use the exact text the app already uses — `system_prompt("Tess")` in [`src/voice_agent/agent/persona.py`](../src/voice_agent/agent/persona.py).

**Why this matters — three wins at once:**
1. **Accuracy:** the KB is always in context, so it can't hallucinate services (which it did when the KB was missing).
2. **Speed:** the app then sends only the **short caller line** each turn instead of re-sending the whole persona+KB — far fewer input tokens for the reasoning model to process = a big cut in per-turn latency.
3. **Voice-appropriate output:** the persona already says *"one or two short spoken sentences, no lists, no markdown"* — which fixes the markdown we saw.

> This is only safe **with tools disabled** (step 1). When we tried seeding the persona while tools were on, the agent treated it as a research task and browsed — hence the 40s. Tools off + persona-as-system-prompt = fast and grounded.

---

## Point the app at the profile

Once the `voice-agent` profile exists, the app's Hermes session must target it (rather than `default`). That's a small code change on our side — say the word and I'll wire a `HERMES_PROFILE` setting through `HermesSession` / `session.create`. Until then, the app uses whatever profile the gateway runs by default.

---

## Verify the change

After applying, re-check both speed and behavior:

```bash
python scripts/checks/verify_hermes.py          # still reachable + responding
```

Then a quick latency + quality spot-check (expect **~1–2s, plain text, real services, no 40s**):

```python
# a short caller line against the leaned-out profile should be fast and KB-accurate
from voice_agent.tools.hermes import HermesTools
from voice_agent.config import Config
print(HermesTools(Config.load()).generate("", "what services does TecAce offer?"))
```

Good signs: answer names the *actual* services (AX consulting, Managed Agent Service, AX Knowledge Hub…), it's one or two spoken sentences, no markdown, and it returns in a couple of seconds.

---

## What stays on Gemini (by design)

Even fully tuned, Hermes/`gpt-5.6-sol` will be slower than Gemini (~2s vs ~0.5s) because the model reasons. So the app deliberately keeps the **fast, structured, per-turn classification** on Gemini — readiness/purpose/wrong-person labels, the scheduling `decide`, time parsing, and Korean translation. Hermes is the **generative brain** (persona/FAQ replies, post-call summary) where its quality shows and a ~2s beat is acceptable (and will be masked). Our `USE_HERMES_BRAIN` flag plus the automatic **Gemini fallback** mean a slow or unreachable Hermes never breaks a call.
