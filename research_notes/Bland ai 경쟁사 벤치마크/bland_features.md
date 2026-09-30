# Bland AI — complete product feature inventory (docs.bland.ai, state as of 2026-09-29)

Scope note: this catalog is built almost entirely from Bland's own docs (`docs.bland.ai`, Mintlify; every page is also served as raw markdown at `<path>.md`), the site index at https://docs.bland.ai/llms.txt, Bland's pricing / trust pages, and the docs changelog. Telephony internals and dashboard UX are only listed for existence. Field names are quoted verbatim from the docs. Where the docs contradict each other (they do — the platform is mid-migration from "pathways/personas" (V1) to "agents" (V2)), the conflict is called out explicitly.

Platform shape (for orientation): the docs are organised around a V2 "Agents" product (builder at `v2.app.bland.ai`, API under `/v2/agents`) that sits on top of the older V1 primitives — Send Call, Conversational Pathways, Personas, Inbound Numbers, Knowledge, Tools — all of which remain live and are "unchanged" — [V2 overview](https://docs.bland.ai/api-v2/overview.md). The V2 overview says: "It does not replace the rest of the Bland API. Calls, numbers, knowledge bases, tools, and everything else still live in the API Reference tab, and those endpoints are unchanged."

---

## 1. Core outbound call features — `POST /v1/calls` (Send Call)

### Takeaway
Send Call is a single flat JSON body with ~45 documented parameters covering prompt/pathway/persona selection, voice, language (50 codes incl. auto-switching "babel"/"fluent"), interruption tuning, voicemail handling, transfers, scheduling, tools/KB, dynamic data, webhooks, post-call summary/dispositions/citations and TCPA guard rails. Notably there is **no `model` parameter on Send Call** (it exists on inbound numbers as `base|turbo`), and voicemail/answering-machine detection is expressed via a `voicemail` object plus the `answered_by` result field.

### Cited Findings

**Selection of what the agent runs**
- `phone_number` (required, E.164); `task` (required if no `pathway_id`, "Max task length: 2000 characters recommended"); `pathway_id` (dev-portal pathway; "certain parameters don't apply"); `pathway_version` (integer, default production); `persona_id` ("Pre-configured template ID; overridden by request params"); `first_sentence` ("Makes your agent say a specific phrase or sentence for its first response.") — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `voice` default `"Karen"`: "The voice of the AI agent to use. Accepts any form of voice ID, including custom voice clones and voice presets." — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- **No `model` parameter exists** on Send Call; no `voice_settings`, `answered_by_enabled`, `sensitive_voicemail_detection`, `dispatch_hours`, `analysis_schema`/`analysis_preset`, or `memory_id` parameters are present on this page either (each confirmed ABSENT on a targeted read of the raw markdown). `amd` is documented as a legacy alias for `ivr_mode`. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)

**Language**
- `language` default `"babel-en"`; description: "Select a supported language of your choice. Optimizes every part of our API for that language - transcription, speech, and other inner workings." Full allowed list: `babel, fluent, en, babel-en, en-US, en-GB, en-AU, en-NZ, en-IN, es, babel-es, es-419, fr, babel-fr, fr-CA, de, babel-de, el, hi, hi-Latn, hu, ja, ko, ko-KR, vi, pt, pt-BR, pt-PT, zh, zh-CN, zh-Hans, zh-TW, zh-Hant, it, nl, pl, ru, sv, sv-SE, da, da-DK, fi, no, id, ms, tr, uk, bg, cs, ro, sk, auto`. "Babel enables multilingual conversations by identifying and switching languages on the fly (experimental). Fluent auto-detects spoken language and switches between languages (powered by multilingual transcription). Auto detects between English and Spanish." — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)

**Turn-taking / interruption**
- `wait_for_greeting` (bool, default false): "By default, the agent starts talking as soon as the call connects. When wait_for_greeting is set to true, the agent will wait for the call recipient to speak first before responding." — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `interruption_threshold` (number, default 500): "Adjusts how patient the AI is when waiting for the user to finish speaking. Lower values mean the AI will respond more quickly." The inbound-number page adds "Range: 50-200 recommended." — [Send Call](https://docs.bland.ai/api-v1/post/calls.md); [Update Inbound Number](https://docs.bland.ai/api-v1/post/inbound-number-update.md)
- `interruptibility` (integer, default 2): 0 = block interruptions, 1 = difficult, 2 = balanced, 3 = easy. The Agent Speech tutorial documents a 5-level scale 0–4 where 4 = "Always interrupt — Any caller speech stops the agent" and 0 = "Block interruptions — The agent ignores caller speech entirely while talking"; configurable on Send Call, inbound numbers, and per pathway node in Advanced options. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md); [Agent Speech](https://docs.bland.ai/tutorials/agent-speech.md)
- Adaptive "Resumption" (no config): the agent "automatically measures each caller's speech pace and adjusts response timing accordingly—up to ~2.5 seconds for deliberate speakers." Shipped as changelog "Adaptive resumption and node-scoped interruptibility" dated **August 3, 2026**. — [Agent Speech](https://docs.bland.ai/tutorials/agent-speech.md); [Changelog 2026-08-03](https://docs.bland.ai/changelog/08_03_2026.md)
- `block_interruptions` (bool, default false): "AI ignores user interruptions if true." — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `temperature` float 0–1, default 0.7. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)

**Transcription / pronunciation**
- `keywords` (string[], default []): "These words will be boosted in the transcription engine - recommended for proper nouns or words that are frequently mis-transcribed." Format `"word"` or `"word:boostFactor"` (e.g. `"Reece:3"`), max 20 keywords. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md); [Update Inbound Number](https://docs.bland.ai/api-v1/post/inbound-number-update.md)
- `pronunciation_guide` (array of `{word, pronunciation, case_sensitive, spaced}`): "An array of objects that guides the agent on how to say specific words. Use this to improve clarity for acronyms, names, brand terms, or jargon." — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)

**Dispatch / caller ID / scheduling**
- `from` (owned number); `dialing_strategy` object `{type: "local" | "custom_pooling", pool_id}` — "local" "automatically selects numbers matching callee's area code for US calls (requires add-on purchase)"; "custom_pooling" "selects from pre-configured phone number pool (enterprise only)". — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `timezone` default `"America/Los_Angeles"`; `start_time` "format: YYYY-MM-DD HH:MM:SS -HH:MM; minimum 5 minutes ahead". — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `max_duration` integer minutes, default 30. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- Rate limiting: "10-second minimum between calls to same number"; international calls "require ≥$5 credits or auto-recharge enabled"; Agent Phone Plan numbers "call US/Canada only". — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)

**Transfers**
- `transfer_phone_number`: "Number for agent to transfer to (e.g., human/supervisor)". `transfer_list`: "Give your agent the ability to transfer calls to a set of phone numbers." — routing map with `default` key plus department keys (`"sales"`, `"support"`, `"billing"`). — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `stream_post_transfer_transcript` (bool, default false): "Live transcription stream to WebSocket during transferred calls". — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- Live transfer of an in-progress call also exists as its own endpoint: `POST /v1/calls/active/transfer` ("Transfer Active Call"), alongside Stop Active Call, Listen to Active Call, Stop All Active Calls. — [llms.txt index](https://docs.bland.ai/llms.txt)

**Audio**
- `background_track`: `null | "office" | "cafe" | "restaurant" | "none"`; `noise_cancellation` bool (default `true` on Send Call, `false` on inbound-number update); `record` bool default false ("accessible via `recording_url`"). — [Send Call](https://docs.bland.ai/api-v1/post/calls.md); [Update Inbound Number](https://docs.bland.ai/api-v1/post/inbound-number-update.md)

**Voicemail / IVR / DTMF**
- `ivr_mode` (bool, default false): "Set true for phone menu; suppresses voicemail handling". — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `voicemail` object: `message`, `action` enum `"hangup" | "leave_message" | "leave_message_and_sms" | "ignore"` (hangup = end without message; leave_message = play then end; leave_message_and_sms = play, end, send SMS; ignore = continue as if no voicemail), `sms` `{message (required), from}` ("Configuration for sending an SMS notification when a voicemail is left"), `sensitive` (bool, default false — "LLM-based voicemail detection when true"). — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `precall_dtmf_sequence`: "A sequence of DTMF digits that will be played before the call starts. Acceptable characters are 0-9, *, #, and w, where w is a pause of 0.5 seconds." `ignore_button_press` bool. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- Answering-machine result is exposed post-call as `answered_by`: `human | voicemail | unknown | no-answer | null`. — [Call Details](https://docs.bland.ai/api-v1/get/calls-id.md)

**Retry**
- `retry` object: `wait` (integer seconds before retry), `voicemail_action` (same enum as above), `voicemail_message`. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)

**Knowledge / tools / data injection**
- `tools` (array): "Add custom tools and knowledge base items to your call for your agent to call upon." Format `"TL-uuid"` or `"KB-uuid"`. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `dynamic_data` (object[]): "Integrate data from external APIs into your agent's knowledge." Sub-fields `url, method, body, headers, query, cache, response_data`. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `request_data` (object): "Custom key-value pairs available as variables in prompt/pathways"; `metadata` (object) returned in webhook. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)

**Post-call / analysis / compliance**
- `webhook` (URL); `webhook_events` array: `"queue", "call", "latency", "webhook", "tool", "dynamic_data", "citations", "evals", "post_transfer_transcript"`. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `summary_prompt` (max 2000 chars): "Custom instructions for how the call summary should be generated after the call completes." — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `dispositions` (string[]): "A list of possible outcome tags you define. After the call ends, the AI reviews the transcript and picks one of these tags." Defaults to built-in tags if omitted. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `citation_schema_ids` (string[], "enterprise only"); `post_call_evals` `{workbench_setup_id | workbench_setup_version_id}` ("Recording required for post_call_evals; auto-enabled if omitted"). — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- `guard_rails` array with `type` in `"tcpa:ai_disclosure", "tcpa:self_introduction", "tcpa:recording_disclosure", "tcpa:opt_out", "custom"` plus actions and config: "Configure guard rails to monitor the call for compliance violations and trigger actions automatically." — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- Response: `status`, `message`, `call_id`, `batch_id`, `errors`. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- Simplified variants exist: "Send Call With Task (Simple)" and "Send Call using Pathways (Simple)". — [llms.txt index](https://docs.bland.ai/llms.txt)

**Voice-quality guidance ("Making calls sound human")**
- Recommends `noise_cancellation: true`, `background_track`, `keywords` for all proper nouns, `record: true`, and setting `voicemail` before dialing; prompt style: contractions, sparing fillers (`"um"`, `"uh"`), false starts; performance tags `[say angrily]`, `[say warmly]`, `[say excitedly]`, `[laughs]`, `[sighs]` (max two per line). — [Sounding human](https://docs.bland.ai/platform/sounding-human.md)

### Inferences
- The Send Call body is a "kitchen-sink" flat config; every behaviour toggle an in-house receptionist would need (greeting-wait, interruption sensitivity, AMD action, transfer map, summary prompt, disposition list) has a one-line equivalent here — useful as a checklist for feature parity.
- Defaults differ between endpoints (`noise_cancellation` true on outbound, false on inbound; `language` `babel-en` on outbound vs `en-US` on inbound), suggesting the two surfaces evolved separately.

### Gaps
- No documented list of what "certain parameters don't apply" when `pathway_id` is set.
- No page documents API rate limits (requests/second) — only per-plan concurrency and hourly/daily call caps (see Pricing).
- `webhook_events` `"evals"` and `"latency"` payload shapes are not documented on the pages read.

---

## 2. Inbound: numbers, purchasing, inbound agent config, routing, transfers, IVR

### Takeaway
Inbound is configured per phone number via `POST /v1/inbound/{number}` with essentially the same parameter set as Send Call plus `model` (`base|turbo`), `fallback_number`, `memory_id`, and a Persona/Agent attachment. Numbers are $15/mo (US/CA only self-serve), BYO Twilio numbers are supported, warm transfer is an enterprise add-on, and inbound-only number blocking exists.

### Cited Findings
- Purchase: `POST /v1/inbound/purchase` — `area_code` (default `"415"`), `country_code` (default `"US"`; "US" or "CA" for Canada; others require contacting support), `phone_number` (exact number, overrides area_code); "$15/mo. subscription using your stored payment method". — [Purchase Phone Number](https://docs.bland.ai/api-v1/post/inbound-purchase.md)
- Update Inbound Number fields (verbatim names): `prompt` (required — "Provide instructions, relevant information, and examples of the ideal conversation flow."), `pathway_id` (overrides prompt), `pathway_version`, `voice`, `first_sentence`, **`model` (string, default `"base"`, allowed `base`, `turbo`)**, `language` (default `"en-US"`, "40+ language options including auto-detect"), `timezone`, `background_track`, `noise_cancellation` (default false), `keywords`, `pronunciation_guide`, `interruption_threshold` (default 500), `block_interruptions`, `ignore_button_press`, `request_data`, `dynamic_data`, `transfer_phone_number`, `transfer_list`, **`fallback_number`** ("Forwards calls during maintenance windows"), `max_duration` (default 30), `record`, `webhook`, `webhook_events` (`queue, call, latency, webhook, tool, dynamic_data, citations`), `summary_prompt`, `citation_schema_ids` (enterprise), **`memory_id`** ("Attaches memory store for cross-session context"), `metadata`, `tools`. — [Update Inbound Number](https://docs.bland.ai/api-v1/post/inbound-number-update.md)
- Other number endpoints: Update Inbound Number Label, List Numbers, Number Details, **Create Inbound Session** (`POST /v1/inbound/session`: "a session token that can be used to pass variables to inbound calls via SIP headers"; fields `phone_number`, `request_data`, `voice`; default TTL 1 hour, response has `expires_at`). — [Create Inbound Session](https://docs.bland.ai/api-v1/post/inbound-session.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Personas attach to numbers: "Attach Phone Numbers to Persona", "Detach Phone Numbers from Persona", "Update Persona Number Settings"; V2 agents likewise: "Attach Numbers to Agent", "Detach Numbers from Agent", "Get Agent Number Binding". — [llms.txt](https://docs.bland.ai/llms.txt)
- V2 gotcha: "an agent that has not been promoted to Production will not answer calls" — "the single most common reason a new agent does not pick up." — [Agent builder](https://docs.bland.ai/agents/agent-builder.md)
- BYO Twilio ("BYOT"): Dashboard "Add-ons → BYOT" generates an `encrypted_key` from Twilio `account_sid` + `auth_token` ("Save the `encrypted_key` immediately as it is only shown once"); imported numbers appear in dashboard; API calls using them must send `encrypted_key` as a header; "International calling permissions for imported numbers are inherited from the Twilio account they came from." Endpoints: Create/Delete Encrypted Key, Upload Inbound Phone Numbers, Delete Inbound Phone Number. — [Custom Twilio](https://docs.bland.ai/tutorials/custom-twilio.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Transfer time is "Free when using your own Twilio number" (BYOT). — [Billing](https://docs.bland.ai/platform/billing.md)
- SIP trunking: full SIP API (attach/detach config, discover endpoint, test call, firewall IPs, trunk health, SIP call logs, number portability check / port requests). As of **March 23, 2026** "SIP trunks now available to all organizations (entitlement requirement removed)". — [llms.txt](https://docs.bland.ai/llms.txt); [Changelog 2026-03-23](https://docs.bland.ai/changelog/03_23_2026.md)
- **Warm transfer** (enterprise): "AI starts a second call to brief your human agent on the call details. Once the agent is ready, the calls merge into a smooth three-way conversation." Enabled via "Transfer Call node → Toggle 'Enable Warm Transfer'". Settings: Proxy Agent Number (E.164), DTMF Sequence (e.g. `w54` for an extension), Live Agent Briefing Prompt, Allow Live Agent Conversation ("Gives the human agent control over when the calls get merged"), Hold Music, Merge Call Prompt, Optimize for IVR/Queue Systems, Hold Timeout (30–3600 s), Voicemail Message Configuration for failed transfers. Cold transfer is the default. "Warm Transfer requires an enterprise account". — [Warm Transfer](https://docs.bland.ai/tutorials/warm-transfer.md)
- Post-call fields for transfers: `transferred_to`, `transferred_at`, `pre_transfer_duration`, `post_transfer_duration`, `warm_transfer_call` (`proxy_agent_calls`, `state`, incl. `CANCELLED` when "Customer hung up during the transfer process"). — [Post Call Webhooks](https://docs.bland.ai/tutorials/post-call-webhooks.md); [Warm Transfer](https://docs.bland.ai/tutorials/warm-transfer.md)
- IVR navigation: `ivr_mode`, `precall_dtmf_sequence`, "Press Button" pathway node; Turbo model "excludes transferring, IVR navigation, custom tools". — [Send Call](https://docs.bland.ai/api-v1/post/calls.md); [Update Pathway](https://docs.bland.ai/api-v1/post/update_pathways.md); [Bland University lesson 4](https://university.bland.ai/modules/1/lesson-4)
- Blocked numbers: inbound-only ("prevent specific phone numbers from reaching your Bland inbound lines"); Global rules ("Block a number across all your inbound numbers") vs Individual rules (specific inbound number); bulk input CSV/space/newline separated; after creation only `reason` and active/inactive status are editable ("the phone number itself becomes immutable"). API: Create/List/Get/Delete/Edit Block Rules. — [Blocked Numbers](https://docs.bland.ai/tutorials/blocked-numbers.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Live monitoring: "Listen to Active Call" endpoint; "Re-implemented live listen functionality for real-time monitoring" (changelog 2025-09-02). — [llms.txt](https://docs.bland.ai/llms.txt); [Changelog 2025-09-02](https://docs.bland.ai/changelog/09_02_2025.md)
- Agent identity / branded calling: V2 endpoints "Get/Update Agent Identity", "Upload Agent Logo", "Download Agent Contact Card", "Send Test Contact Card". — [llms.txt](https://docs.bland.ai/llms.txt)

### Inferences
- The `fallback_number` + `memory_id` + `model` fields exist only on the inbound surface, so an inbound receptionist on Bland has a slightly richer per-number config than a one-off outbound call.
- "Inbound session" is Bland's answer to "pre-load caller context before the phone rings" — the analogue for an in-house product is looking up the CRM by caller ID at ring time.

### Gaps
- No documented per-number business-hours / after-hours routing field (Triggers offer "business hours" timing only for outbound call actions).
- Outbound DNC list is referenced in Dispatch ("numbers on your do-not-call list are dropped at dial time") but no DNC list API/page was found beyond inbound Blocked Numbers.

---

## 3. Conversational Pathways (V1 flow builder)

### Takeaway
Pathways are a node/edge graph with 11 node types (Default, End Call, Transfer Call, Webhook, Knowledge Base, SMS, Custom Code, Press Button, Wait for Response, Transfer Pathway, Scheduling), per-node fine-tuning examples, global nodes, extracted variables, per-node model options, versioning (draft → production), folders, reusable "blocks", a "Flex Mode" for non-linear routing, node-level test harnesses, and an ordered call-event timeline.

### Cited Findings
- Node `type` values (Update Pathway schema): `Default`, `End Call`, `Transfer Call`, `Webhook`, `Knowledge Base`, `SMS`, `Custom Code`, `Press Button`, `Wait for Response`, `Transfer Pathway`, `Scheduling`. — [Update Pathway](https://docs.bland.ai/api-v1/post/update_pathways.md)
- Node `data` fields: common `name, isStart, isGlobal, globalLabel, text, prompt, condition`; specific `transferNumber` (Transfer Call), `kb` (Knowledge Base), `url, method, body, headers` (Webhook), `extractVars`, `responseData`, `responsePathways` ("conditional routing based on responses"); fine-tuning `pathwayExamples, conditionExamples, dialogueExamples`; `modelOptions.modelName`, `modelOptions.interruptionThreshold`, `modelOptions.interruptibility` (0–3), `modelOptions.temperature`. Edge fields: `id, source, target, label, data` (label + optional conditions). — [Update Pathway](https://docs.bland.ai/api-v1/post/update_pathways.md)
- Tutorial descriptions: Webhook node "Used to execute webhooks at any point during the conversation, and send speech during/after the webhook"; End Call node "Will end the call when the node is reached, and the dialogue at this node is complete"; Wait for Response node is a Default node "equipped with the ability to wait if the user requires time to respond or needs to hold for a moment"; Global Nodes are reachable from any node and "automatically return the agent to the originating node afterward". — [Pathways tutorial](https://docs.bland.ai/tutorials/pathways.md)
- Built-in variables: `{{lastUserMessage}}`, `{{prevNodePrompt}}`, `{{now_utc}}`, `{{from}}`, `{{to}}`, `{{call_id}}`, `{{voice_id}}`; extracted variables defined per node with Name, Type (string/integer/boolean), Description. — [Pathways tutorial](https://docs.bland.ai/tutorials/pathways.md)
- Testing modes: text chat, voice chat, real phone calls; versions "function as snapshots—drafts don't affect live calls until published to production". API: Get Pathway Versions, Create/Update/Delete Pathway Version, Promote Pathway Version; folders API; Generate Pathway (AI-generated from description) + status; Pathway Chat (text simulation). — [Pathways tutorial](https://docs.bland.ai/tutorials/pathways.md); [llms.txt](https://docs.bland.ai/llms.txt)
- **Tools on pathway nodes** (changelog **2026-03-23**): "Condense your pathways by running tools directly inside Default nodes" — webhook configs attach to Default nodes, agent decides when to call, "Tool response routing with variable extraction from outputs", "Configurable speech behavior, timeout, and retry settings inline". — [Changelog 2026-03-23](https://docs.bland.ai/changelog/03_23_2026.md)
- **Pathway Blocks** (changelog **2026-02-16**): "Save any group of nodes and edges as a reusable block and insert it into any pathway with one click." Same entry: edge dragging/rerouting, markdown toggle in prompt section. — [Changelog 2026-02-16](https://docs.bland.ai/changelog/02_16_2026.md)
- **Multiple knowledge bases per node** (changelog **2025-09-02**): "Pathway nodes now support attaching multiple knowledge bases simultaneously". — [Changelog 2025-09-02](https://docs.bland.ai/changelog/09_02_2025.md)
- **Flex Mode**: "Let your agent choose where to go next based on the conversation, instead of strictly following the edges between nodes." Edges become suggestions; agent can backtrack/jump ahead; enabled by "Flex" button in pathway header; "Flex Groups" (named, colour-coded; each node in one group; cross-group moves follow strict edges); Global Nodes are not flex candidates; groups of 20+ nodes reduce effectiveness. — [Flex Mode](https://docs.bland.ai/tutorials/flex-mode.md)
- **Scheduling Node** (enterprise section): "works by sending web requests to your appointment scheduling system"; config: "Extract Call Info Into Variables" (String/Number/Boolean), "Get Available Slots Webhook" (headers, timeout), "Loop Condition" (default: "the agent must explicitly repeat the date and time back to the user, and the user must agree"), "Custom Exit Instructions"; outputs `chosen_datetime` in ISO format for downstream booking. — [Scheduling Node](https://docs.bland.ai/enterprise-features/scheduling-node.md)
- **Custom Code Node** (enterprise): JavaScript with `fetch(request, env, ctx)` pattern (Cloudflare-Workers style), inputs via `json["variable_name"]` including `{{from}}`, `{{to}}`, `{{call_id}}` and request data; returns `Response.json()` whose keys become `{{variable_name}}` variables; "Requires 'Bland Enterprise account with Custom Code Node access'"; unresolved variables pass as literal strings. "[Enterprise] Enabled Node.js compatibility for Custom Code nodes" (changelog 2025-12-01). — [Custom Code Node](https://docs.bland.ai/enterprise-features/custom-code-node.md); [Changelog 2025-12-01](https://docs.bland.ai/changelog/12_01_2025.md)
- **Node-level testing** (changelog **2025-12-01**): "Historical Call Testing", "User Input Permutations", "Pinned Call Features"; Testbed lets you "isolate a specific node interaction, edit the prompt, and run it multiple times" for Dialogue, Loop condition, Variable extraction. API: Get/Invoke Node Test Run. — [Changelog 2025-12-01](https://docs.bland.ai/changelog/12_01_2025.md); [Testbed](https://docs.bland.ai/tutorials/testbed.md); [llms.txt](https://docs.bland.ai/llms.txt)
- **Pathway Call Events**: `GET https://api.bland.ai/v1/pathway_calls/{conversation_id}?v=2` returns an ordered timeline; envelope `conversation_id, sequence, event_type, node_id, operation_id, payload, created_at`; event families: conversation.init, node.transition, node.tag, transcript.user/assistant, interrupts, button presses, llm.action, plus invoke/result/error/warning phases for webhooks, tools, KB lookups, SMS, scheduling, loop conditions, variable extraction, custom code, pathway transfers, call transfers, unit tests; values truncate at 64 KiB; sensitive values redacted; newer fields `available_routes`, `available_tools`. — [Pathway Call Events](https://docs.bland.ai/tutorials/pathway-call-events.md)
- **Norm** (AI assistant in the pathway editor, changelog **2026-02-16**): "Meet Norm, our new AI assistant built directly into the pathway editor" — plain-language changes with a diff of every node/edge, applied to a forked version. Norm can edit "nodes, edges, routes, variables, model configuration, attached tools", query call logs/analytics in plain English, run `/systematic-debugging`-style skills; accessible via dashboard chat, editor panel, iMessage (+1 321-424-0172), and a Claude Code plugin; Draft → Commit → Link safety model; billed on a "token-based pricing model". — [Changelog 2026-02-16](https://docs.bland.ai/changelog/02_16_2026.md); [Norm](https://docs.bland.ai/tutorials/norm.md); [Billing](https://docs.bland.ai/platform/billing.md)
- Pathway-level memory toggle: "Enable Memory" checkbox ("Remember previous conversations across all calls per user"). — [Memory](https://docs.bland.ai/tutorials/memories.md)
- Pathway analytics: post-call `pathway_logs`, `pathway_tags` ("Node labels visited"), and Outcomes combine "pathway tags, citations, and call metadata". — [Post Call Webhooks](https://docs.bland.ai/tutorials/post-call-webhooks.md); [Outcomes](https://docs.bland.ai/tutorials/outcomes.md)

### Inferences
- The older tutorial page lists only 6 node types; the API schema lists 11 — the tutorial is stale. Trust the Update Pathway schema.
- "Transfer Pathway" node + Personas' routing suggest Bland composes small pathways per intent rather than one giant graph — the same structure the V2 Agent builder formalises as "Prompt / Pathway / Authentication Zone" scenarios.

### Gaps
- No page enumerates node-level settings like "skip user response", "disable end-call tool", "static text vs prompt" toggles by field name beyond what the Update Pathway schema shows.
- Pathway-level analytics dashboard (funnel by node) is not documented as a distinct feature page.

---

## 4. Personas, V2 Agents, prompting

### Takeaway
Three generations coexist: (a) raw `task` prompt on a call/number; (b) **Personas** — reusable agents (global prompt, voice, language, KB, memory, routing to pathways, versions draft/production) attachable to many numbers; (c) **V2 Agents** — a git-like build/publish/promote model with dev/staging/production environments, branches, semver versions, checks (evals) gating promotion, experiments, and dispositions. V2's prompt is split into a per-node "Prompt" and a global "System Prompt", with tools/knowledge referenced by `@` tags.

### Cited Findings
- Persona definition: "Unified AI agents that manage all your phone numbers and use cases in one place." Fields: Name/role/description, Voice (e.g. "June", "Karl", "Estella"), Language, Background noise, Global Prompt ("Large text area to describe the persona's overall behaviors, personality, and motivations"), Wait for Greeting toggle, Interruption Threshold, Conversational Pathways routing rules, knowledge-base toggles ("Continuous Learning" coming soon), Summary generation, citation schemas, Outcomes/evaluations, Webhook endpoint; Modalities: Voice & Calls, SMS Messaging (coming soon), Web Widget (coming soon); Draft vs Production with visual diff, "Promote to Production", "Reset Draft", version history. API param `persona_id`; "Persona settings provide the base configuration; any additional parameters in your API request override the persona defaults." — [Personas](https://docs.bland.ai/tutorials/personas.md)
- Persona API: List/Get/Create/Update/Delete, attach/detach numbers, number settings, versions list/promote/get. — [llms.txt](https://docs.bland.ai/llms.txt)
- Guard rails on personas: "General" → "Policy & Compliance". — [Guard Rails](https://docs.bland.ai/tutorials/guard-rails.md)
- V2 Agent: "a single thing to build, test, and publish: its instructions, the tools and knowledge it can reach, and the branches of behavior it needs." Scenario types: **Prompt** ("A single prompt for one job, like booking an appointment or handling a cancellation"), **Pathway** (custom flow with steps incl. custom code and webhook), **Authentication Zone** (identity questions, optional SMS code on enterprise). Prompt fields: **Prompt** ("Defines the agent's goal and how it should achieve it while on this node") and **System Prompt** ("Sets the agent's personality and demeanor on every node"); only Prompt supports `@` tagging. — [Agent builder](https://docs.bland.ai/agents/agent-builder.md)
- V2 Settings tab: Display name, Voice and languages, Channels, Memory (+ schema), Metadata, Request data; Advanced: "Disable recording (PCI compliance)", context management, response exclusion from logs, image sending. "a new agent opens with **memory on** and **call recording on**". — [Agent builder](https://docs.bland.ai/agents/agent-builder.md)
- V2 variables: "Variables to extract" are "key:value pairs the agent extracts to reuse during the conversation" and each "adds turn latency"; "Request data" = "facts you hand the agent before the call rather than ones it works out during it". Routing: "Creating a pathway does not make it run" — needs routing conditions. Tools: "Tagging is the only way, and it is per prompt"; "Building a tool without tagging it fails silently." — [Agent builder](https://docs.bland.ai/agents/agent-builder.md)
- V2 deployment: Publish (Development → Staging, patch/minor/major version) then Promote (Staging → Production); "Staging is read-only post-publish"; "publishing runs them [evaluations] first". — [Agent builder](https://docs.bland.ai/agents/agent-builder.md)
- V2 API concepts: Agents ("org-scoped records with three empty environments"), Versions ("a complete agent configuration, saved and never modified afterwards"), Environments `dev`, `staging`, `production`, Branches ("dev workspaces"); plus checks, experiments, dispositions ("classify call outcomes"). Endpoint families: versions, environments, deployments, publish/promote/rollback, branches (create/rebase-preview/rebase/merge), per-env variables, checks and check runs, experiments (A/B), library scenarios, archived nodes, migration from pathway/persona (incl. streaming and pathway translation), dispositions (drafts, versions, cost estimates, test runs, CSV export, align/correct, extractors, judge/variable/model-profile catalogs), identity, memory schema (get/infer). `POST /v2/agents` body: only `name` ("Display name for the agent. Must be non-empty after trimming whitespace."). — [V2 overview](https://docs.bland.ai/api-v2/overview.md); [Create Agent](https://docs.bland.ai/api-v2/post/agents.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Prompts library: List/Get/Create Prompt endpoints. Agent Onboarding API (start/poll/approve, "headless agent onboarding", "call recipes for agents") and an MCP server / Claude Code / Cursor / Codex plugins exist. — [llms.txt](https://docs.bland.ai/llms.txt)

### Inferences
- Bland is steering new users to V2 Agents (welcome page routes "Build" to `/agents/agent-builder`), while all runtime call APIs still key off `pathway_id` / `persona_id` / `task`. A competitor comparison should treat "Persona" ≈ "AI receptionist config" and "V2 Agent" ≈ "versioned, testable receptionist config".

### Gaps
- The V2 Create Agent page exposes only `name`; the full V2 agent configuration schema (nodes, settings) is set via version endpoints whose bodies were not read.
- No V1 (pathways/personas) deprecation timeline is published.

---

## 5. Knowledge bases and custom tools (function calling)

### Takeaway
Knowledge = org-level sources (PDF/TXT/CSV/JSON/DOCX ≤10 MB, pasted text ≤1M chars, website scrape with sitemap discovery + daily sync, Notion/Google Docs sync) attached by checkbox or `@`-tag, with retrieval testing and versioned editing. Tools (v2) = declarative HTTP/integration actions with an OpenAI-style `input_schema`, spoken filler `speech`, `timeout` 1–60 s, retries, caching, and `response_data` JSON-path extraction; integrations include `rest_api`, `custom-code`, `bland-sms`, `slack`, `salesforce`, `hubspot`, `calendly`, `cal-com-v2`, `notion`.

### Cited Findings
- KB sources: "PDF, TXT, CSV, JSON, DOCX (up to 10 MB each, max 10 files per upload)"; pasted text "up to one million characters"; web: "Discover from a site" (sitemap) or individual URLs, "Sync now" and optional daily auto-sync; Notion / Google Docs synced (read-only in platform). Sources "belong to organizations, not individual agents" and are "available on every call, everywhere in the agent". Retrieval returns ranked passages with scores; "Source testing" previews retrieval; version history; query logs on a 30-day rolling window; knowledge map with 30-day coverage. — [Knowledge](https://docs.bland.ai/agents/knowledge.md)
- KB API: Upload File / Upload Text / Scrape Websites / Discover Sitemap URLs / Chat with Knowledge Base Item / List / Get / Update / Delete, plus older `vectors` endpoints (Create/Update/List/Get/Delete Knowledge Base Item, Upload Media, Upload Text). Attach on a call via `tools: ["KB-uuid"]`. — [llms.txt](https://docs.bland.ai/llms.txt); [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- Knowledge base editing shipped **2026-01-20**: "Direct file editing with version control, diff previews, and integrated chat testing across file types (text, PDF, DOCX, CSV)". 2025 recap: "Web scraping with URL discovery, playground mode for testing, suggestions system for feedback, and automatic gap detection". — [Changelog 2026-01-20](https://docs.bland.ai/changelog/01_20_2026.md); [2025 recap](https://www.bland.ai/blog/2025-bland-product-recap)
- KB limits by plan: Start 10 knowledge bases, Build 50, Enterprise unlimited. — [Pricing](https://www.bland.ai/pricing)
- Create Tool (`POST /v2/tools`) required: `name` ("The name the AI will see when deciding to use this tool"), `description` ("Shown to the AI to help it decide when to use this tool"), `integration` ∈ `bland-sms, custom-code, slack, salesforce, rest_api, hubspot, calendly, cal-com-v2, notion`, `action`. Optional: `input_schema` (OpenAI function-calling schema), `body` (template with `"{{input.channel}}"`-style variables), `speech` ("Text the AI speaks while executing the tool"), `timeout` (1000–60000 ms), `cache` (bool), `response_data` (array of `{name, data (JSON path), context}`), `max_retries` (0–4), `cooldown` (1–30 s), `resource_id`, `public`, `label`. Also Update Tool, List Tools, **Tool Execution Logs**, **Tool Execution Stats**; legacy v1 Custom Tools CRUD remain. — [Create Tool v2](https://docs.bland.ai/api-v2/post/tools.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Integration Tools tutorial documents Cal.com by API key with a "Schedule Meeting" action returning `meeting_url, booking_id, booking_uid, status, start_time, end_time, attendee_email, attendee_name, attendee_timezone`; "The same patterns apply to all built-in integrations" (Slack, Salesforce mentioned). — [Integration Tools](https://docs.bland.ai/tutorials/tools/integration-tools.md)
- Secrets: "{{ SECRET.SECRET_NAME }}" usable in webhook authorization, request headers, and custom tools; Static vs Refreshable (fetched at intervals, max 1440 min); values cannot be viewed after creation; managed at `app.bland.ai/dashboard/secrets`. — [Secrets](https://docs.bland.ai/tutorials/secrets.md)
- Static IPs page exists (for allow-listing tool/webhook egress). — [llms.txt](https://docs.bland.ai/llms.txt)
- `dynamic_data` on Send Call pre-fetches external APIs before/at call start (fields `url, method, body, headers, query, cache, response_data`). — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)

### Inferences
- Bland separates *pre-call* data injection (`request_data`, `dynamic_data`, inbound session) from *mid-call* function calling (tools) — a clean split worth mirroring.
- The `speech` field on tools (filler sentence while the HTTP call runs) and `timeout`/`max_retries` are the practical knobs that keep latency perceptually acceptable.

### Gaps
- No documented per-tool execution timing guarantees (e.g. p95 latency) or max tools per agent.
- Docs do not list the full action catalogue per integration (only Cal.com's "Schedule Meeting" is spelled out).

---

## 6. Memory, citations, post-call analysis, event streaming, webhooks, call logs, recordings

### Takeaway
Bland has a contact-centric cross-channel memory (facts, rolling summary, open items, entities, recent messages), enterprise "Citations" schemas for structured extraction (String/Number/Boolean/Array/Category), a generic `POST /v1/calls/{id}/analyze` Q&A extractor, custom `summary_prompt`, `dispositions` tags + enterprise "Outcomes" code, HMAC-SHA256-signed post-call webhooks with a rich payload, a per-call event stream, corrected transcripts, and recording URLs with expiry.

### Cited Findings
- Memory data per contact: Facts (key-value), Summary ("A rolling plain-text overview of past conversations, used for agent context"), Open Items, Entities (orders, appointments, tickets), plus "a sliding window of the latest exchanges across all channels"; contacts auto-linked by phone number, email, or external ID. Enable: pathway "Enable Memory" checkbox, persona Knowledge tab toggle, or API "Enable or Disable Memory" (`pathway_id`+`version_number` or `persona_id`+`version_id`, `memory_enabled`); inbound number field `memory_id`. "One person can have separate histories with different personas". Dashboard: Call Logs → MEMORY tab; API: Contacts (list/find/get/resolve/update/merge), Get Memory Context, Get Memory Changes, Update Facts/Summary, Reset Contact Memory, plus legacy memory-store endpoints (create/update/delete memory, add user/call, search user calls). — [Memory](https://docs.bland.ai/tutorials/memories.md); [Update Inbound Number](https://docs.bland.ai/api-v1/post/inbound-number-update.md); [llms.txt](https://docs.bland.ai/llms.txt)
- V2 agents: memory "writes facts about the person into their contact record"; memory schema defines "what the agent should remember about a person" (Get/Infer Agent Memory Schema). "Memory belongs to the contact, not to any one conversation." — [Agent builder](https://docs.bland.ai/agents/agent-builder.md); [Conversations](https://docs.bland.ai/agents/conversations.md)
- Citations (enterprise): "Citations allow you to define structured post-call and post-conversation analytics for enterprise use cases." Schema = Variables (String, Number, Boolean, Array, Category — each with name, description, type), Groupings, Conditions ("logic for flagging calls"), Analysis. Pass `citation_schema_ids` to Send Call / Update Inbound Number / Send SMS / SMS Batch. Delivery: separate citation webhook (default) or delayed main webhook (add `citations` to `webhook_events` or "Delay post call webhook" toggle). "For voice calls, citations are only processed on calls with a status of 'completed'." Backfill endpoint exists. 2025 recap adds "subjective question analysis with confidence-based answers, full audio analysis capabilities, and automatic problem call flagging". — [Citations](https://docs.bland.ai/enterprise-features/citations.md); [2025 recap](https://www.bland.ai/blog/2025-bland-product-recap)
- Analyze Call with AI: `POST /v1/calls/{call_id}/analyze` with `goal` (string, required) and `questions` (`string[][]` of `[question, expected answer type]`, e.g. `["Who answered the call?", "human or voicemail"]`, `["Customer confirmed satisfaction", "boolean"]`); response `status, message, answers, credits_used`; cost "0.003 credits, plus 0.0015 credits per call". — [Analyze Call](https://docs.bland.ai/api-v1/post/calls-id-analyze.md)
- Dispositions / Outcomes: Send Call `dispositions` (free-text tags, AI picks one) → `disposition_tag` in results. Enterprise **Outcomes**: combine "pathway tags, citations, and call metadata to define what truly happened on each call"; define fields (e.g. `appointmentBooked`, boolean/string/number + description) and Bland "generates the transformation code"; back-testing, versioning with rollback; attach via `disposition_ids` on calls/SMS. V2 agents also have Dispositions with extractors, judges, test runs and CSV export. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md); [Outcomes](https://docs.bland.ai/tutorials/outcomes.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Post-call webhook payload fields: `call_id`/`c_id`, `batch_id`, `pathway_id`, `metadata`, `to`, `from`, `phone_number`, `answered_by`, `call_length`, `call_ended_by` ("ASSISTANT"/"USER"), `status`, `completed`, `inbound`, `created_at`, `started_at`, `end_at`, `transcripts` (`id, user, text, created_at`), `concatenated_transcript`, `summary`, `pathway_logs`, `variables`, `disposition_tag`, `citations`, `record`, `recording_url`, `recording_expiration`, `price`, `queue_status`, `error_message`, `transferred_to`, `transferred_at`, `pre_transfer_duration`, `post_transfer_duration`, `warm_transfer_call`, `pathway_tags`, `max_duration`, `local_dialing`, `is_proxy_agent_call`, `is_canary`, `corrected_transcript` ("Enhanced transcript with confidence scores (delayed webhook)"), `event_type` (`citations`, `post_transfer_transcript`, `live_translation_transcript`, `multiple`). Delivery: 2xx success; 4xx/429/5xx retried. Configured on inbound numbers under Advanced ("Test Webhook" button), per outbound call via `webhook`, or in the Send Call dashboard. — [Post Call Webhooks](https://docs.bland.ai/tutorials/post-call-webhooks.md)
- Webhook signing: "HMAC algorithm with the SHA-256 hash function", header `X-Webhook-Signature`, secret under Account Settings → "Keys" tab; verify with `crypto.createHmac('sha256', key).update(data).digest('hex')`. — [Webhook Signing](https://docs.bland.ai/tutorials/webhook-signing.md)
- Post-call webhook management API: Get / Create / Resend Post Call Webhook. — [llms.txt](https://docs.bland.ai/llms.txt)
- Call Details (`GET /v1/calls/{id}`) extra fields: `queue_status` ∈ `new, queued, allocated, started, complete, pre_queue_error, queue_error, call_error, complete_error`; `status` ∈ `completed, failed, busy, no-answer, canceled, unknown`; `analysis` ("The structured data extracted from the call"), `corrected_duration`, `endpoint_url`, `voice_id`, `pathway_version`, `request_data`. — [Call Details](https://docs.bland.ai/api-v1/get/calls-id.md)
- Other call-data endpoints: List Calls, List Active Calls, Get Call Recording, Get Corrected Transcript, Event Stream (`level` ∈ `queue|call`, `category` ∈ `info|performance|error`, `message`, `call_id`, `timestamp`). — [Event Stream](https://docs.bland.ai/api-v1/get/event-stream.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Conversations screen: "Every call, every message thread, every web chat, in one list you can filter, read, and export"; columns incl. channel, length, contact, agent, direction, status, disposition, cost, QC tags, escalation flags; Transcript / Detail / Logs views; recording "pinned to the bottom"; Memory tab; Contacts tab; export 30–180 day ranges via email. Email is **not** listed as a channel here, although the welcome page says "phone, SMS, web, and email". — [Conversations](https://docs.bland.ai/agents/conversations.md); [Welcome](https://docs.bland.ai/welcome-to-bland)
- Alerts/Alarms: built-in metrics "Call length" and "API errors" (all plans); enterprise: "Latency", "Transcription score", "Silence count", "Sentiment score", low engagement ratio, user interruption count; custom conditions from citation variables / disposition fields / pathway tags; three severities (INFO, WARNING, CRITICAL) with operator+value, percentage trigger, lookback window (10 min, 30 min, 1 h, 3 h, 24 h), minimum call count; channels: Email, Phone ("an outbound voice call to a list of numbers ... custom spoken message"), Custom tool (webhooks, Slack, PagerDuty). Alarms API: list/create/history/get/update/delete/toggle/trigger/notify. — [Alerts](https://docs.bland.ai/tutorials/alerts.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Triage: issue-tracking API (issues, flags, categories, relations, comments, attach calls/resources, agent sessions, "Prompt Norm"). — [llms.txt](https://docs.bland.ai/llms.txt)
- Evaluations (V2): judges (Transcript or Audio mode; context; task; verdicts; model/retry), test cases ("Generate based on production calls reads up to 50 real calls and writes one test case per call"; max turns default 20), runs; a judge "passes when that share is half or more"; up to five judges as promotion checks with 1/3/5 conversations per test case; "Only staging has a configuration, and it gates both hops". Evals API: eval agents, workbench setups, runs, estimates, templates. Agent Testing API: scenarios, templates, batch runs, analytics, simulation sets, "Tornado" sessions. — [Evaluations](https://docs.bland.ai/agents/evaluations.md); [llms.txt](https://docs.bland.ai/llms.txt)
- PII: "Real-time PII redaction on call recordings and transcripts"; "Zero-retention processing available for sensitive workflows". — [Trust & Security](https://www.bland.ai/trust-security)

### Inferences
- The post-call webhook payload is the de-facto "call record" contract; an in-house product's summary email / CRM push can be mapped field-for-field against it (`summary`, `disposition_tag`, `variables`, `recording_url`, `answered_by`, `call_ended_by`).
- Bland deliberately sends structured extraction (citations) on a *second* delayed webhook by default — a design choice to keep the primary webhook fast.

### Gaps
- Recording retention period behind `recording_expiration` is not stated numerically anywhere read.
- Analyze Call's "credits" unit is not defined in USD on that page.
- Webhook retry count/backoff and replay protection are not documented.

---

## 7. Batches / campaigns, scheduling, retry, DNC and compliance

### Takeaway
Batches (v2) are a `global` call config plus `call_objects` (any Send Call fields per row, incl. `start_time`), fed by CSV (`phone_number` column, extra columns → `{{variables}}`, 125 MB, no row limit, chunked >1,000 calls) with a `status_webhook` per phase; duplicates and DNC numbers are dropped at dial time. Compliance is handled through TCPA guard rails, per-plan hourly/daily caps, and `retry`/`voicemail` objects rather than a dedicated campaign scheduler.

### Cited Findings
- Create Batch (`POST /v2/batches`): `call_objects` (array; each supports `/v1/calls` fields incl. `phone_number` (required), `task`, `start_time` ("supports timezone; defaults to UTC"), `record`, `b_cid` (UUID v7, requires entitlements)), `global` (required; must include `task` or `pathway_id`; cannot include `phone_number`), `description` (≤60 chars, default "Untitled Batch"), `status_webhook`. Response `data.batch_id`. Also List / Get / Get Batch Logs / Stop Batch. — [Create Batch](https://docs.bland.ai/api-v2/post/batches.md); [llms.txt](https://docs.bland.ai/llms.txt)
- CSV: "`phone_number` column (exact spelling)"; "Numbers need a country code. `+14155550100` works, `4155550100` does not."; columns → `{{column_name}}`; column names cannot contain spaces (or prepend `request_data.`); files up to 125 MB, no row limit; >1,000 calls processed in chunks; max call length 1–120 min; recording on by default; "Duplicates and numbers on your do-not-call list are dropped at dial time and the rest of the batch runs"; "a CSV with one bad row is rejected whole"; "Over your call limit" alert blocks if hourly/daily limits exceeded. Statuses: Initializing, Validating, Dispatching, In Progress, In Progress (Chunked), Waiting for Scheduled Calls, Completed, Completed Partial, Failed, Unknown. Status webhook POSTs per phase `validating → dispatching → in_progress` then `completed | failed | completed_partial`. — [Dispatch](https://docs.bland.ai/agents/dispatch.md); [Batch Calls](https://docs.bland.ai/tutorials/batch-calls.md)
- Scheduling: per-call `start_time` (≥5 min ahead) with `timezone`; Triggers offer "Timing: Immediate, business hours, or custom schedule (calls only)". — [Send Call](https://docs.bland.ai/api-v1/post/calls.md); [Triggers](https://docs.bland.ai/agents/triggers.md)
- Retry: Send Call `retry` `{wait, voicemail_action, voicemail_message}`. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- Guard rails: "Require" (time-window, default 30 s, for `tcpa:ai_disclosure`, `tcpa:self_introduction`, `tcpa:recording_disclosure`) vs "Forbid" (continuous, for `tcpa:opt_out`, custom, content policy); actions "End call", "Transfer to human", "Move to node"; configured on Personas ("Policy & Compliance"), Pathways, Inbound numbers ("Advanced" → "Guard Rails"), or `guard_rails` on `POST /v1/calls`; enterprise "up to 5 custom guard rails" with backtesting. Four built-ins on all plans. — [Guard Rails](https://docs.bland.ai/tutorials/guard-rails.md); [Agent builder](https://docs.bland.ai/agents/agent-builder.md)
- Custom dialing (enterprise): "guarantees the highest pickup rate for your outbound calls by using the most optimal phone number from your phone number inventory"; dashboard curates numbers → `pool_id`; API `dialing_strategy: {type: "custom_pool", pool_id}` (note: Send Call page spells the type `"custom_pooling"`); pools API get/list/create/update. Local dialing add-on: `dialing_strategy.type = "local"`. — [Custom Dialing](https://docs.bland.ai/enterprise-features/custom-dialing.md); [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- Per-plan caps: Start 100 calls/day, 100/hour, concurrency 10; Build 2,000/day, 1,000/hour, concurrency 50; Scale 5,000/day, 1,000/hour, concurrency 100; Enterprise unlimited. — [Billing](https://docs.bland.ai/platform/billing.md)
- Audit logs endpoint exists ("List Audit Logs"). — [llms.txt](https://docs.bland.ai/llms.txt)
- SMS batches: "Send SMS Batch" endpoint; "SMS batches are only available at the All agents level". — [Dispatch](https://docs.bland.ai/agents/dispatch.md); [llms.txt](https://docs.bland.ai/llms.txt)

### Inferences
- Bland has no campaign-level "dispatch hours / max attempts / spacing" object on the documented v2 batch; multi-attempt cadences must be built with per-row `start_time`, `retry`, or Triggers. This is a comparative weakness vs. dedicated outbound dialers.

### Gaps
- No documentation found for a DNC list management API/UI (only "do-not-call list" mention in Dispatch).
- No documented STIR/SHAKEN attestation or spam-label monitoring feature page.

---

## 8. SMS, web calls / widget, WebRTC

### Takeaway
Two-way AI messaging (SMS/RCS/iMessage/WhatsApp channels via one Send SMS API) is **enterprise-only** for SMS at $0.02/msg with A2P registration; the Web Chat Widget (script tag, text + voice input, live-agent handoff, custom components, auto-translation) and the `@blandsdk/client` Web Agent SDK (token-based browser sessions) cover web/browser channels.

### Cited Findings
- SMS "available exclusively on Enterprise plans"; "All US SMS numbers require A2P (Application to Person) campaign registration with Twilio"; Bland-purchased numbers are "linked to a Messaging Service SID automatically"; BYO numbers must pass a Messaging Service SID; self-serve A2P setup "forthcoming". Human handoff via "Transfer to Human" pathway node or "Hand Off Conversation to a Human" API; humans reply via "Send Message on Conversation". "Each SMS message is billed at $0.02". — [Messaging: SMS](https://docs.bland.ai/tutorials/messaging/sms.md); [Billing](https://docs.bland.ai/platform/billing.md)
- Send SMS (`POST /v1/sms/send`) fields: `user_number`, `agent_number` (required, E.164), `agent_message`, `objective` (≤20,000 chars; e.g. "Book a haircut for Tuesday afternoon and confirm the price."), `request_data`, `new_conversation`, `persona_id`, `persona_version` (`production|draft`), `persona_settings` (`pathway_id, pathway_version, start_node_id`), `pathway_id`, `pathway_version`, `start_node_id`, `webhook`, `metadata`, `disposition_ids`, `citation_schema_ids`, `channel` (`"sms"`, `"whatsapp"`, `"imessage"`), `content_sid`, `content_variables` (Twilio templated content), `time_out`, `timeout_message`, `warning_time`, `warning_message`; response `data.conversation_id`, `data.message_id`. Other endpoints: List SMS Numbers, Update SMS Configuration, Send SMS Batch, Create SMS Conversation, list/get/update/delete conversations, delete messages, post-conversation webhook, SMS Conversation Analysis. RCS and iMessage have their own pages. — [Send SMS](https://docs.bland.ai/api-v1/post/sms-send.md); [llms.txt](https://docs.bland.ai/llms.txt)
- SMS from calls: `voicemail.action = "leave_message_and_sms"` with `voicemail.sms {message, from}`; pathway `SMS` node; tool integration `bland-sms`; Triggers "SMS" action; "SMS code" in V2 Authentication Zone (enterprise). — [Send Call](https://docs.bland.ai/api-v1/post/calls.md); [Update Pathway](https://docs.bland.ai/api-v1/post/update_pathways.md); [Create Tool v2](https://docs.bland.ai/api-v2/post/tools.md); [Triggers](https://docs.bland.ai/agents/triggers.md); [Agent builder](https://docs.bland.ai/agents/agent-builder.md)
- Web Chat Widget: embed `window.blandSettings = { widget_id }` + `https://widget.bland.ai/loader.js`; settings `widget_id`, `request_data`, `default_chat`, `visitor_id`, `enable_widget_state_events`, `draggable`; features: custom components "that display at specific points in the conversation", live agent escalation ("hands off the conversation with full context"), auto-detect + translate languages. Widget API: create/list/get/update, threads, "Send Live Agent Message", custom components CRUD. Voice input in widget shipped (changelog: "Voice input was added to the web chat widget, allowing users to talk with agents using the same speech pipeline as phone calls"). Price "$0.01 per agent message". — [Chat Widget](https://docs.bland.ai/tutorials/chat-widget.md); [llms.txt](https://docs.bland.ai/llms.txt); [Changelog search](https://docs.bland.ai/changelog/09_02_2025); [Billing](https://docs.bland.ai/platform/billing.md)
- Web Agent SDK: `npm install @blandsdk/client` (Node 18+, React 18+); server mints single-use session tokens via `admin.sessions.create({ agentId })`; React hook `useWebchat({ agentId, getToken })` returns `state, start, stop, webchat`; events `open, message, update, closed`. V1 "Web Agents" API: Create/Update/Authorize Web Agent Call/Delete/List. — [Web Agent SDK](https://docs.bland.ai/sdks/web-agent-sdk.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Live Translation API: "speech-to-speech translation over a single WebSocket"; 23 languages, any pair; `source_language`, `target_language`, `audio_protocol` (`pcm16` default | `twilio_ulaw`), `sample_rate` 8–48 kHz in / 16 kHz out; billed per connected minute rounded up; max 3 concurrent sessions per org, 30-min cap. Live translation on warm transfers (enterprise) dated **2025-09-02**. — [Live Translation](https://docs.bland.ai/tutorials/translation.md); [Changelog 2025-09-02](https://docs.bland.ai/changelog/09_02_2025.md)
- Bland Speech (standalone TTS product): HTTP synth, WebSocket realtime, OpenAI-compatible `/audio/speech`, Speech Studio, migration guides from ElevenLabs/Cartesia/Deepgram/PlayHT/Resemble/Google/Polly. — [llms.txt](https://docs.bland.ai/llms.txt)

### Inferences
- For a small-business product, the important takeaways are that Bland's SMS is enterprise-gated and A2P-dependent, so "missed-call textback"-type features are not self-serve on Bland below enterprise (except the Agent Phone Plan's unlimited US/CA SMS, see Pricing).

### Gaps
- Web Agent SDK page does not state whether browser audio is WebRTC or WebSocket, nor browser support.
- WhatsApp appears only as a `channel` enum value; no dedicated page found.

---

## 9. Voices and languages

### Takeaway
Bland runs its own TTS engines (BTTS_V2 launched 2026-01-20, BTTS_V3 current default), three curated presets (Karen/Matthew/River) plus shared "creator" voices (some with per-character fees), single-sample ~10-second instant cloning in 17+ languages, per-voice `consistency`/`expressiveness` settings, and 50 language codes on calls including auto-switching modes.

### Cited Findings
- Presets: **Karen** (`29158307-9893-4149-8a75-bc9ce313d64e`, "Mature female, General American, nasal and deadpan, moderate pace. Suits support lines and IVR prompts."), **Matthew** (`1d4dc605-071b-4eee-81b3-099b2894d0d1`, "Mature male, General American."), **River** (`2f29fdbb-c55e-4add-9c7c-93437ebf379d`, "Light and playful, moderate pace."). "Shared voices are published by other creators ... Some carry a per-character creator fee on top of the standard rate." Engines: BTTS_V3 (current default), BTTS_V2 ("less predictable control effects"). — [Choosing a Voice](https://docs.bland.ai/tts/voices.md)
- List Voices fields: `id, name, description, public, tags, user_id, voice_id, service` (`BTTS, BTTS_V2, BTTS_V3, LEGACY`), `finetuned, is_creator_voice, ratings, total_ratings, average_rating, my_rating, creator_display_name`. Endpoints: list/get/settings/config/rename/rate/delete, shared voices, add library voice, clone, samples CRUD, TTS models list. — [List Voices](https://docs.bland.ai/api-v1/get/voices.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Clone Voice: `name` (1–30 chars, unique), `audio_samples` (exactly 1 file, "Roughly 10 seconds is ideal", WAV recommended, ≤10 MB), `gender`, `description`, `isBTTS_V3`/`isBTTS_V2`; "17+ languages"; response `data.voice_id`. Requirements: "One clean sample of about ten seconds", "No background noise, music, or reverb", "At least 100 ms of silence at each end". — [Clone Voice](https://docs.bland.ai/api-v1/post/clone.md); [Choosing a Voice](https://docs.bland.ai/tts/voices.md)
- Voice Settings: `consistency` (V1 0–1 float; V2 0–64 int), `expressiveness` (0–1), `boost_language_consistency` (V3 only: "adds language-consistency prompting at the cost of some flexibility for code-switching"); per-request `controls` object overrides. — [Update Voice Settings](https://docs.bland.ai/api-v1/post/voices-id-settings.md); [Choosing a Voice](https://docs.bland.ai/tts/voices.md)
- Voice limits by plan: Start 1 voice, Build 5, Scale 15, Enterprise unlimited; Speech product: 1 instant clone before first top-up, 10 after a one-time $5 top-up; professional clones "unlimited drafts", 1 live. — [Pricing](https://www.bland.ai/pricing); [Billing](https://docs.bland.ai/platform/billing.md); [Speech Limits](https://docs.bland.ai/speech/limits.md)
- BTTS V2 launch **2026-01-20**: "New expressive text-to-speech voices with support for 17 languages and experimental support for 10 additional languages". Proprietary TTS "trained on millions of hours of conversational audio" (2025 recap). — [Changelog 2026-01-20](https://docs.bland.ai/changelog/01_20_2026.md); [2025 recap](https://www.bland.ai/blog/2025-bland-product-recap)
- Languages: see §1 list (50 codes); `babel-*` = on-the-fly switching (experimental), `fluent` = auto-detect + switch, `auto` = EN/ES detect. Korean is supported as `ko` / `ko-KR`. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- Performance tags in prompts: `[say angrily]`, `[say warmly]`, `[say excitedly]`, `[laughs]`, `[sighs]`. — [Sounding human](https://docs.bland.ai/platform/sounding-human.md)

### Inferences
- Bland has fully internalised TTS (no ElevenLabs pass-through), which underpins its "no token charges / no provider pass-throughs" pricing claim.

### Gaps
- Full curated voice-library size and per-voice language coverage are not enumerated in docs.
- No documented speed/rate control on voice settings (only consistency/expressiveness).

---

## 10. Models / LLM options

### Takeaway
Bland exposes only `base` (default; full feature support) and `turbo` (lowest latency; "excludes transferring, IVR navigation, custom tools") as a `model` field on inbound numbers and `modelOptions.modelName` on pathway nodes; the Send Call API has no `model` field. Enterprise fine-tuning and bring-your-own-LLM were previously documented, but that page now 404s.

### Cited Findings
- Inbound number `model`: string, default `"base"`, allowed `base`, `turbo`. — [Update Inbound Number](https://docs.bland.ai/api-v1/post/inbound-number-update.md)
- Pathway node `modelOptions.modelName`, `modelOptions.temperature`. — [Update Pathway](https://docs.bland.ai/api-v1/post/update_pathways.md)
- Bland University: Base — "The default model, follows scripts/procedures most effectively", supports transfers, IVR navigation, custom tools; Turbo — "The fastest latency possible, supports sophisticated and nuanced conversations", "Limited capabilities currently (excludes transferring, IVR navigation, custom tools)". No "enhanced" model on that page. — [Bland University lesson 4](https://university.bland.ai/modules/1/lesson-4)
- Send Call: "**No `model` parameter exists**"; `temperature` 0–1 default 0.7. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- Trust page: "Zero AI sub-processors in the call path. One DPA covers it" — Bland "runs proprietary models rather than reselling third-party AI". — [Trust & Security](https://www.bland.ai/trust-security)
- Custom LLM: a web-search snippet for `https://docs.bland.ai/enterprise-features/custom-llm` described (a) fine-tuning "using transcripts from successful prior calls" then hosting "with dedicated infrastructure" ("typically takes one week and costs typically under five figures") and (b) "connect to a custom LLM and host that LLM ... Setup typically takes under 24 hours"; **the page returned HTTP 404 on 2026-09-29 and is absent from llms.txt**, so treat as historical/unconfirmed. — [WebSearch snippet for docs.bland.ai/enterprise-features/custom-llm](https://docs.bland.ai/enterprise-features/custom-llm)
- V2 dispositions expose a "Get Model Profile Catalog" endpoint and evaluation judges have "Model selection" — model choice surfaces for analysis, not the live call. — [llms.txt](https://docs.bland.ai/llms.txt); [Evaluations](https://docs.bland.ai/agents/evaluations.md)

### Inferences
- Bland's public positioning has moved from "pick base/enhanced/turbo" toward "one proprietary stack"; the only live-call knobs are base/turbo, temperature, and prompt.

### Gaps
- No current official page confirms BYO-LLM / fine-tuning availability (404). The "enhanced" model referenced in older third-party material is not present in any current doc read.

---

## 11. Enterprise: SSO, RBAC, orgs, compliance, infrastructure, limits

### Takeaway
Enterprise adds SAML 2.0 / OIDC SSO with group→role mapping (admin/operator/prompter/viewer), org APIs with `owner/admin/operator/viewer` permissions and audit logs, isolated per-customer Kubernetes infrastructure with pinned runtime versions and canary releases, SOC 2 Type II / HIPAA (BAA) / GDPR (DPA) / PCI DSS v4.0, and four deployment shapes (managed cloud, customer VPC, on-prem GPU, air-gapped) with EU regional pinning.

### Cited Findings
- SSO: "both OIDC (OpenID Connect) and SAML 2.0 based Single Sign-On (SSO) for enterprise workspaces"; IdPs: Okta, Azure AD/Entra, Google Workspace, Auth0, Ping, OneLogin, ADFS; callback `https://api.bland.ai/authorization/sso/callback/[provider-id]`, SAML ACS `https://api.bland.ai/authorization/sso/saml2/callback/[provider-id]`; role mapping by group name → Admin / Operator / Prompter / Viewer ("Users without matching groups receive the `viewer` role"); "Each email domain can only be configured for one organization". SAML added 2025-09-02. JWT Signature Configuration page exists. — [SSO](https://docs.bland.ai/enterprise-features/SSO.md); [Changelog 2025-09-02](https://docs.bland.ai/changelog/09_02_2025.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Org API: create/delete/get org, members, service versions (get/list/update — pinning runtime), member permissions (`action` ∈ `add|remove|reset|set`, `target`, `permissions` ∈ `"owner"|"admin"|"operator"|"viewer"`), org properties, memberships, billing info, refill info, audit logs. — [Update Member Permissions](https://docs.bland.ai/api-v1/patch/org_member_permissions.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Infrastructure: "Every enterprise customer on Bland runs on their own isolated infrastructure — dedicated compute, dedicated containers, and dedicated resources."; "Each release is pinned to a specific version of the agent runtime."; "zero-downtime rolling deployment"; canary deployments with 1–100% traffic and rule-based routing by phone number/org/agent (changelog 2026-02-16 "[Enterprise] Canary Deployments"). — [Infrastructure & Releases](https://docs.bland.ai/enterprise-features/infrastructure-and-releases.md); [Changelog 2026-02-16](https://docs.bland.ai/changelog/02_16_2026.md)
- Compliance: SOC 2 Type II (independent auditor), HIPAA (self-attested, BAA), GDPR (self-attested, DPA in enterprise contracts), PCI DSS v4.0 (independent QSA, annual); quarterly third-party pen tests and ASV scans; deployment shapes: Bland-managed cloud, "Your VPC" (AWS/GCP/Azure, "no data egress"), On-premise GPU clusters, Air-gapped; "Per-call regional pinning. EU data stays on EU GPUs"; "Encryption at rest and in transit"; PII redaction; zero-retention option. Enterprise page: "SOC 2 Type II, HIPAA, GDPR, PCI DSS", "250+ enterprise customers", "1M+ concurrent calls in production". — [Trust & Security](https://www.bland.ai/trust-security); [Enterprise](https://www.bland.ai/enterprise)
- Enterprise-gated features (per docs): warm transfer, SMS/RCS/iMessage, citations/outcomes, custom guard rails, custom code node, custom dialing pools, canary, SSO, advanced alarm metrics, V2 auth-zone SMS code. — [Warm Transfer](https://docs.bland.ai/tutorials/warm-transfer.md); [Messaging: SMS](https://docs.bland.ai/tutorials/messaging/sms.md); [Citations](https://docs.bland.ai/enterprise-features/citations.md); [Guard Rails](https://docs.bland.ai/tutorials/guard-rails.md); [Custom Code Node](https://docs.bland.ai/enterprise-features/custom-code-node.md); [Alerts](https://docs.bland.ai/tutorials/alerts.md)
- Limits: see plan table in §12; V2 Triggers: "Nothing here is gated by plan, role or permission." — [Triggers](https://docs.bland.ai/agents/triggers.md)
- Static IPs page and Environments (dev/staging/production with per-env variables and checks) exist. — [llms.txt](https://docs.bland.ai/llms.txt); [V2 overview](https://docs.bland.ai/api-v2/overview.md)

### Inferences
- "Sub-accounts" in Bland terms = Organizations + memberships + per-member permissions; there is no documented reseller/white-label sub-account hierarchy.

### Gaps
- No uptime SLA figure published on pages read.
- No numeric data-retention default (days) for transcripts/recordings on standard plans.

---

## 12. Pricing

### Takeaway
Bundled per-minute pricing (LLM+STT+TTS included): Start $0.14/min (free tier, no card), Build $299/mo at $0.12/min, Scale $499/mo at $0.11/min, Enterprise custom; transfers $0.03–0.05/min (free with BYOT); $0.015 minimum per outbound attempt; numbers $15/mo; SMS $0.02/msg; widget $0.01/agent message; an "Agent Phone Plan" at $29.99/mo gives one agent unlimited US/CA minutes and SMS.

### Cited Findings
- Start: "$0.14/min", $0 platform fee (no card), "2 credits + inbound number ($15/mo value)", transfer "$0.05/min", concurrency 10, 100 calls/day, 100/hour, 1 voice, 10 KBs. Build: "$0.12/min", "$299/month", transfer "$0.04/min", concurrency 50, 2,000/day, 1,000/hour, 5 voices, 50 KBs. Enterprise: custom, contracted volume, unlimited voices/KBs, "on-premises/VPC deployment, dedicated engineer, BAA, SSO, and data residency options". All plans include "LLM," "real-time transcription," and "premium voices" with "no token charges". — [Pricing](https://www.bland.ai/pricing)
- Billing page (rates "Effective Dec 5, 2025"): Scale $499, 5,000/day, 1,000/hour, concurrency 100, 15 voice clones, $0.11/min, transfer $0.03/min; "Free when using your own Twilio number"; "Outbound Minimum: $0.015 per call attempt"; "Failed Calls: $0.015 minimum charge"; SMS $0.02; Web Widget $0.01 per agent message; Norm "token-based pricing model"; "Automatic Transition Credits". — [Billing](https://docs.bland.ai/platform/billing.md)
- Agent Phone Plan: "$14.99 for your first month (50% off), then $29.99/month"; "Unlimited voice minutes to US and Canada destinations", "Unlimited SMS to US and Canada destinations", "One US local number, provisioned automatically"; limits 1 concurrent call, 20 calls/hour, 50/day, 1,000 call minutes/day, 60-min max per outbound call, 20 texts/hour, 100/day; "Built for one agent doing one thing at a time"; not for Enterprise accounts. — [Agent Phone Plan](https://docs.bland.ai/platform/agent-phone-plan.md)
- Phone number "$15/mo. subscription". — [Purchase Phone Number](https://docs.bland.ai/api-v1/post/inbound-purchase.md)
- Live translation billed per connected minute, rounded up (19 s = 1 min), rate varies by tier. — [Live Translation](https://docs.bland.ai/tutorials/translation.md)
- Analyze Call: "0.003 credits, plus 0.0015 credits per call". — [Analyze Call](https://docs.bland.ai/api-v1/post/calls-id-analyze.md)
- Speech product one-time "$5 top-up" unlocks 5 concurrent generations / 10 instant clones. — [Speech Limits](https://docs.bland.ai/speech/limits.md)
- Free trial: Start plan "no card required" with "2 credits". — [Pricing](https://www.bland.ai/pricing)

### Inferences
- The Agent Phone Plan is Bland's direct play at the "one AI receptionist for a small business" segment — flat $29.99/mo, unlimited US/CA minutes + SMS, 1 concurrent call — and is the most relevant price point to benchmark an SMB receptionist against.

### Gaps
- Local dialing add-on price and voice-clone pricing are not stated.
- International per-minute rates are not published on pages read.

---

## 13. Integrations

### Takeaway
Native integrations are exposed as Tool `integration` types (`rest_api`, `custom-code`, `bland-sms`, `slack`, `salesforce`, `hubspot`, `calendly`, `cal-com-v2`, `notion`), Trigger sources (Salesforce and HubSpot object events), Knowledge syncs (Notion, Google Docs), BYO Twilio, SIP, Amazon-Connect-style transfers, an official Zapier app (4 triggers / 208 actions / 115 queries), an MCP server + coding-agent plugins, and a CLI. No Make.com or GoHighLevel native app was found.

### Cited Findings
- Tool integrations enum: `bland-sms, custom-code, slack, salesforce, rest_api, hubspot, calendly, cal-com-v2, notion`. — [Create Tool v2](https://docs.bland.ai/api-v2/post/tools.md)
- "Integrations Platform - Released December 8, 2025. Connects to Salesforce, Notion, Cal.com, and Calendly for automated lead creation and meeting booking." — [2025 recap](https://www.bland.ai/blog/2025-bland-product-recap)
- Cal.com tool: API key; "Schedule Meeting" action. — [Integration Tools](https://docs.bland.ai/tutorials/tools/integration-tools.md)
- Triggers (beta **2026-01-20**): "Visual automation builder with drag-and-drop interface, integration with Salesforce and Notion, scheduling options, and mock data testing"; 14 native events (Post-call webhook, Call started, Inbound call received, Voicemail detected, Warm/Cold transfer started, Pathway node reached, SMS received, Post-SMS webhook, Batch completed, Eval completed, Knowledge gap detected, Tool success/failure) + Salesforce/HubSpot object created/updated (cases, leads, opportunities, companies, contacts, deals, meetings, tasks, tickets); actions Call, SMS, Webhook, Slack message, Custom code; conditions with AND/OR; timing Immediate / business hours / custom schedule (calls only). — [Changelog 2026-01-20](https://docs.bland.ai/changelog/01_20_2026.md); [Triggers](https://docs.bland.ai/agents/triggers.md)
- Knowledge syncs: Notion, Google Docs. — [Knowledge](https://docs.bland.ai/agents/knowledge.md)
- Zapier: official "Bland AI" app with triggers "Batch Completed", "Call Completed", "Inbound Call Completed", "New SMS Conversation Message"; "208 functions" and "115 query operations". — [Zapier Bland AI](https://zapier.com/apps/bland-ai/integrations)
- Make.com: `https://www.make.com/en/integrations/bland-ai` returned 404; GoHighLevel: only third-party connectors (Integrately) found, no Bland docs page. — [Make.com (404)](https://www.make.com/en/integrations/bland-ai); [Integrately Bland+GHL](https://integrately.com/integrations/bland-ai/gohighlevel)
- Telephony: BYO Twilio (custom accounts API), SIP trunks (all orgs since 2026-03-23), number porting APIs. — [Custom Twilio](https://docs.bland.ai/tutorials/custom-twilio.md); [Changelog 2026-03-23](https://docs.bland.ai/changelog/03_23_2026.md); [llms.txt](https://docs.bland.ai/llms.txt)
- Developer surfaces: Bland MCP Server, "Bland plugin" (Norm) for Claude Code / Cursor / Codex / VS Code / Claude Desktop / Windsurf / Gemini CLI; CLI; Web Agent SDK; "Personal AI Agents" MCP integrations (Grok Bot, Meta Muse, OpenClaw, Instinct, Poke). — [llms.txt](https://docs.bland.ai/llms.txt)
- Alerts can notify Slack / PagerDuty via custom tool. — [Alerts](https://docs.bland.ai/tutorials/alerts.md)

### Inferences
- Google Calendar is *not* a first-party integration; calendar booking is via Cal.com / Calendly tools or the generic webhook-based Scheduling Node.

### Gaps
- No documented HubSpot/Salesforce action list (only the integration enum and trigger events).
- No official Make.com or GoHighLevel connector confirmed.

---

## 14. Features directly adoptable by a small-business "AI receptionist + voicemail transcription" product

### Takeaway
The most transferable Bland patterns are: the flat call-config vocabulary (greeting-wait, interruptibility levels, AMD action enum incl. leave-message-and-SMS), `transfer_list` department routing, `fallback_number`, Scheduling Node's slot-webhook + repeat-back loop, `summary_prompt` + `dispositions`, contact-scoped memory, missed-call/voicemail Triggers (Voicemail detected → SMS/call), inbound blocked-number rules, HMAC-signed post-call webhooks, and the $29.99 "Agent Phone Plan" packaging.

### Cited Findings
- Voicemail → SMS follow-up in one field: `voicemail.action: "leave_message_and_sms"` + `voicemail.sms {message, from}`. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md)
- Trigger event "Voicemail detected" and "Inbound call received" can fire SMS / Call / Webhook / Slack / Custom code actions with business-hours timing. — [Triggers](https://docs.bland.ai/agents/triggers.md)
- Department routing: `transfer_list` `{default, sales, support, billing...}`; `fallback_number` "Forwards calls during maintenance windows". — [Send Call](https://docs.bland.ai/api-v1/post/calls.md); [Update Inbound Number](https://docs.bland.ai/api-v1/post/inbound-number-update.md)
- Appointment booking: Scheduling Node ("Get Available Slots Webhook", loop condition "the agent must explicitly repeat the date and time back to the user, and the user must agree", outputs `chosen_datetime`); Cal.com / Calendly tools. — [Scheduling Node](https://docs.bland.ai/enterprise-features/scheduling-node.md); [Create Tool v2](https://docs.bland.ai/api-v2/post/tools.md)
- Call summary customisation: `summary_prompt` (≤2000 chars); outcome tags: `dispositions`; structured Q&A: Analyze Call `goal` + `questions`. — [Send Call](https://docs.bland.ai/api-v1/post/calls.md); [Analyze Call](https://docs.bland.ai/api-v1/post/calls-id-analyze.md)
- Caller memory across calls: facts / rolling summary / open items / entities, keyed by phone number; MEMORY tab in call logs. — [Memory](https://docs.bland.ai/tutorials/memories.md)
- Pre-ring context injection: Inbound Session (`request_data`, 1-hour TTL). — [Create Inbound Session](https://docs.bland.ai/api-v1/post/inbound-session.md)
- Spam/abuse control: inbound Blocked Numbers (global vs per-number, reason, active toggle). — [Blocked Numbers](https://docs.bland.ai/tutorials/blocked-numbers.md)
- Compliance defaults: TCPA "AI disclosure", "Recording disclosure", "Self introduction", "Opt out" guard rails on all plans with 30 s window and End call / Transfer / Move-to-node actions. — [Guard Rails](https://docs.bland.ai/tutorials/guard-rails.md)
- Post-call contract for email/CRM push: `summary`, `disposition_tag`, `variables`, `recording_url`, `recording_expiration`, `answered_by`, `call_ended_by`, `transferred_to`, `price`, signed with `X-Webhook-Signature`. — [Post Call Webhooks](https://docs.bland.ai/tutorials/post-call-webhooks.md); [Webhook Signing](https://docs.bland.ai/tutorials/webhook-signing.md)
- Ops alerting for a small team: alert on "Call length" / "API errors" with Email or an outbound phone call notification. — [Alerts](https://docs.bland.ai/tutorials/alerts.md)
- Packaging: Agent Phone Plan $29.99/mo, one number, unlimited US/CA minutes + SMS, 1 concurrent call. — [Agent Phone Plan](https://docs.bland.ai/platform/agent-phone-plan.md)
- Quality tuning knobs: `keywords` (business/product names), `pronunciation_guide`, `background_track: "office"`, `interruptibility` 0–4, adaptive resumption. — [Sounding human](https://docs.bland.ai/platform/sounding-human.md); [Agent Speech](https://docs.bland.ai/tutorials/agent-speech.md)
- Corrected transcript (delayed, with confidence scores) — relevant to a voicemail-transcription product. — [Post Call Webhooks](https://docs.bland.ai/tutorials/post-call-webhooks.md)

### Inferences
- Bland has no dedicated "voicemail-box transcription" product (it transcribes *its own* calls); the in-house IMAP-voicemail → transcript pipeline is not something Bland competes with directly — only the "AI answers instead of voicemail" side overlaps.
- A "missed-call textback" is achievable on Bland only by composing Triggers + SMS (enterprise) or the Agent Phone Plan's SMS; it is not a packaged feature.

### Gaps
- No Bland feature for emailing call summaries natively (webhook → your own email is the documented route).

---

## 15. Dated changelog items (2025–2026)

### Takeaway
Docs changelog entries exist roughly biweekly from May 2025 through Aug 2026; the notable 2026 items are BTTS V2 voices + Triggers beta + KB editing (Jan 20), Norm + canary deployments + pathway blocks (Feb 16), tools-in-nodes + SIP for all (Mar 23), and adaptive resumption + node-scoped interruptibility (Aug 3).

### Cited Findings
- **2026-08-03** — "Adaptive resumption and node-scoped interruptibility". — [Changelog](https://docs.bland.ai/changelog/08_03_2026.md)
- **2026-03-23** — Tools on Pathway Nodes; Standards custom messages; Web Widget translation button; "SIP trunks now available to all organizations (entitlement requirement removed)". — [Changelog](https://docs.bland.ai/changelog/03_23_2026.md)
- **2026-02-16** — Norm; "[Enterprise] Canary Deployments"; Pathway Blocks; edge dragging; markdown toggle; citation testing redesign; widget webhook event-frequency toggle; new home dashboard. — [Changelog](https://docs.bland.ai/changelog/02_16_2026.md)
- **2026-01-20** — "BTTS V2 Voice Launch" (17 languages + 10 experimental); "Triggers and Automations [Beta]"; Knowledge Base Editing; call-log export; request data on personas; URL-encoded webhook support; widget test request data. — [Changelog](https://docs.bland.ai/changelog/01_20_2026.md)
- **2025-12-08** — Integrations Platform (Salesforce, Notion, Cal.com, Calendly). — [2025 recap](https://www.bland.ai/blog/2025-bland-product-recap)
- **2025-12-05** — new per-minute rates effective. — [Billing](https://docs.bland.ai/platform/billing.md)
- **2025-12-01** — Node Level Testing (Historical Call Testing, User Input Permutations, Pinned Calls); call log mini player; "[Enterprise] Run past calls against new citation variables"; "[Enterprise] Enabled Node.js compatibility for Custom Code nodes". — [Changelog](https://docs.bland.ai/changelog/12_01_2025.md)
- **2025-09-02** — "Live Translation for Warm Transfers [Enterprise]" (23 languages); "Multiple Knowledge Bases" per node; live listen re-implemented; SAML SSO; SMS timeout reliability. — [Changelog](https://docs.bland.ai/changelog/09_02_2025.md)
- Other entry dates found via search (not read in full): 2025-05-12, 2025-06-30, 2025-08-04, 2025-08-18, 2025-09-08, 2025-10-13. — [Search: docs.bland.ai changelog](https://docs.bland.ai/changelog/09_08_2025)
- 2025 in review: SMS support, Web Widgets, Integrations Platform, Citation Schema Builder, proprietary TTS, Personas, KB improvements, Guard Rails, Analytics dashboard with latency alarms. — [2025 recap](https://www.bland.ai/blog/2025-bland-product-recap)

### Inferences
- The changelog cadence slows after March 2026 (only one entry between Mar 23 and Sep 29, 2026, on the index page read), consistent with effort moving to the V2 Agents product whose docs do not carry dated entries.

### Gaps
- The changelog index page rendered only its latest entry, so entries between 2026-03-23 and 2026-08-03 (if any) were not captured; entries before May 2025 were not enumerated.
- `changelog/*.md` pages do not cross-link, so completeness of the 2025 list is not guaranteed.
