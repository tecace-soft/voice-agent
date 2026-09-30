# Bland AI — Dashboard UX and Developer Experience (as of 2026-09-29)

Scope: how a Bland user builds, tests, launches, monitors and iterates on an AI phone agent; screens, flows, editors and feedback loops. Sources are Bland's own docs (docs.bland.ai), marketing site, changelog, Bland University, and a few third-party reviews (all of which are written by competitors and are flagged as such). API parameters and telephony internals are out of scope.

Reading guide: "Cited Findings" are documented facts with a source. "Inferences" are my reading of those facts. Anything from the legacy Pathways/Personas docs is marked **[legacy]** because Bland is mid-migration to a new "Agents" product (see the first section) and those screens are scheduled to disappear after 2026-11-15.

---

## Context: product architecture and timeline (affects every answer below)

### Takeaway
Bland currently has two overlapping product generations. The legacy generation is "Conversational Pathways" (visual flow builder) + "Personas" (bundle of voice/prompt/pathways/numbers) + "Call Logs"; the new generation (announced September 2026) is a unified "Agent" with a builder, three environments, Conversations, Testbed, Evaluations and Dispatch. New accounts created after 2026-09-18 only see the new system; legacy pathways are force-migrated or archived after 2026-11-15.

### Cited Findings
- The docs welcome page frames the product in six sections: Get Started ("Set up an agent, give it a number, and make your first call."), Build ("Give your agents the knowledge, tools, and instructions they need."), Monitor ("See every conversation across phone, SMS, web, and email, plus analytics and alerts."), Improve ("Test changes, roll them out with confidence, and make your agents better."), AI/MCP/SDKs, and For Enterprises — [Welcome to Bland](https://docs.bland.ai/welcome-to-bland)
- "Agents are the successor to conversational pathways: the same powerful conversation engine, with a new architecture." Migration was announced September 2026 with a hard deadline of November 15, 2026; after that, pathways still handling traffic are auto-migrated and the rest archived. Accounts created after September 18, 2026 are already on the new system — [Migrate to agents](https://docs.bland.ai/platform/migrate-to-agents)
- "Migration is additive. The migration will only create new agents; your existing assets will not be disrupted." Nothing switches until you promote the new agent to production — [Migrate to agents](https://docs.bland.ai/platform/migrate-to-agents)
- Mapping table: Conversational pathways -> Agents (or pathways inside agents); Personas -> Agents; Global prompt ("golden node") -> Agent system prompt in settings; Call logs -> Conversations (Monitor section); Triage/Alerts -> Issues/Alerts — [Migrate to agents](https://docs.bland.ai/platform/migrate-to-agents)
- Three self-serve migration paths in the dashboard: "Migrate as is" (direct copy), "Migrate and upgrade" (simulates conversations to optimise behaviour), "Migrate on your own" (drive it from a coding agent via the `norm@bland` MCP plugin). Enterprise accounts get a Bland partner to assist — [Migrate to agents](https://docs.bland.ai/platform/migrate-to-agents)
- The docs index (llms.txt) lists the new-generation pages under "Agents: Build": Agent builder, Tools, Knowledge, Conversations, Testbed, Dispatch, Triggers, SIP, Environments, Evaluations, Migrate to agents; and the legacy pages under "Core Bland Features" / "Advanced Features": Conversational Pathways, Call Logs, Testbed (pathway), Scenarios, Standards, Evals, Guard Rails, Alerts, Personas, Memory, etc. — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt)
- Most recent changelog entry is August 3, 2026 ("Adaptive resumption and node-scoped interruptibility"); the changelog does not yet contain an entry for the Agents launch — [Changelog](https://www.bland.ai/changelog)
- Bland markets itself as an "enterprise voice AI platform for phone agents" for regulated industries (healthcare, insurance, financial services, logistics), with a "Try for free" self-serve CTA and "Book a demo" sales path; "Standard timeline: 30 days from discovery to production" with a Forward Deployed Engineer team building the first agent — [bland.ai](https://www.bland.ai/)

### Inferences
- Anything a product team benchmarks against Bland today should target the Agents product (builder + environments + Conversations + Testbed + Evaluations). The Pathways canvas UX still matters because "pathways" survive as a sub-object inside an agent, but the Personas screens and the legacy Call Logs table are on a two-month sunset clock.
- The docs are unusually explicit about "building is not shipping" (see Environments); this is a deliberate UX stance that recurs across onboarding, builder, and dispatch pages.

### Gaps
- No changelog entry or blog post for the Agents launch itself was found; the only dated evidence is the migration doc (Sept 2026 announcement, Sept 18 cutover for new accounts).

---

## Onboarding: what a new user does first

### Takeaway
Onboarding is a four-item checklist on the dashboard home: create a blank agent, talk to it from the browser or have Bland call your phone, promote to production, then read the transcript/decision log of that call. No phone number, plan or purchase is needed to reach the first test conversation; a number is obtained afterwards in Dispatch (one free number per new org, or $15/mo, or bring Twilio). An example agent ("Norma") ships in every workspace as a reference, not a template.

### Cited Findings
- Step 1: click "New agent" (top right), choose "Blank agent" ("starts from nothing, which is what you want here"), "Give it a name and a job, then Create agent". "The other options import an existing pathway or persona" — [Build your first agent](https://docs.bland.ai/build-your-first-agent)
- The example agent "Norma" is "the example agent that ships with a new workspace" — "She's there as an example: an agent to look at, not to build on." — [Build your first agent](https://docs.bland.ai/build-your-first-agent)
- Step 2 "Talk to it" offers two modes: "'Talk in browser' uses your computer's microphone. It asks for permission, then listens." and "'Call me' rings a number you type into Your phone number." "Nothing you do here needs a phone number, a plan or a purchase." — [Build your first agent](https://docs.bland.ai/build-your-first-agent)
- Step 3 "Promote to production": "An agent that has not been promoted to production cannot take a call from anyone else." — [Build your first agent](https://docs.bland.ai/build-your-first-agent)
- Step 4 "See what happened": the view shows "the transcript, what the agent decided at each turn, and the recording", and it is the same view used for all later calls — [Build your first agent](https://docs.bland.ai/build-your-first-agent)
- The checklist appears on the main dashboard and again on the agent's own page after creation — [Build your first agent](https://docs.bland.ai/build-your-first-agent)
- Phone numbers are attached after onboarding in Dispatch; three acquisition routes: free number (one per new organization), purchase ($15/month for US/Canada), or Twilio integration. UI buttons: Activate, Buy number, Confirm purchase, Connect Twilio, Import numbers, Configure. Assignment is a dropdown labelled "Not assigned to an agent"; the agent must be published to production after attachment — [Dispatch](https://docs.bland.ai/agents/dispatch)
- Self-serve plans: Start (Free, $0.14/min, 100 calls/day, 10 concurrent), Build ($299, $0.12/min, 2,000 calls/day, 50 concurrent), Scale ($499, $0.11/min, 5,000/day, 100 concurrent), Enterprise custom. Billing dashboard at app.bland.ai/dashboard/pay shows "current credit balance, usage history, and purchase options" — [Billing & Plans](https://docs.bland.ai/platform/billing)
- A separate self-serve "Agent Phone Plan" ($14.99 first month, then $29.99/month) gives "one US local number, provisioned automatically", unlimited US/CA voice minutes and SMS, but is capped at one concurrent call, 20 calls/hour, 50/day; it targets "autonomous agents and bots needing their own phone number" and can be subscribed to "via the dashboard's billing page or through agent onboarding" — [Agent Phone Plan](https://docs.bland.ai/platform/agent-phone-plan)
- Marketing homepage has an interactive "Try a call" widget with Healthcare / Insurance / Financial Services demo personas and a "Try for free" CTA — [bland.ai](https://www.bland.ai/)
- The AI receptionist solution page offers both "Start building" (app.bland.ai/signup) and "Talk to our team about your call volumes" (book-a-demo) — [AI receptionist](https://www.bland.ai/solutions/ai-receptionist)
- Bland University (university.bland.ai) is a 7-module course: Introduction; Basic Operations (Making Calls, Knowledge Bases, Intro to Pathways, Inbound/Outbound Numbers); Deep-Dive Into Pathways; Advanced Features (Custom Tools, Web Agents, Twilio, Batch); Call Monitoring, Analytics and Optimization; Correcting Pathway and Prompt Issues; A Customer Service System — [Bland University](https://university.bland.ai/) **[legacy content: modules are pathway/persona era]**
- Past webinar recordings include "Getting Started with Bland: Your First Voice Agent" (April 10, 2026, "A hands-on walkthrough of building, testing, and deploying your first AI voice agent") and "Pathways Deep Dive: Advanced Conversation Design" (March 15, 2026, "conditional logic, API calls, and A/B testing") — [Webinars](https://www.bland.ai/webinars)
- Competitor review (Coval, Feb 2026): "Sign up takes minutes. Write ten lines of code to send your first call. Configure a basic agent in 20-30 minutes." — [Coval review](https://www.coval.ai/blog/bland-ai-review-2026-features-pricing-and-when-to-use-it/)
- Competitor review (Lindy, Nov 2025): "Setup takes effort if you're not technical. Expect to work with APIs to get it running"; "Even small changes, like editing flows or setting up routing, require technical support" — [Lindy review](https://www.lindy.ai/blog/bland-ai-review) **[predates Agents and Norm; likely outdated]**

### Inferences
- The onboarding pattern worth copying: a persistent checklist (home + agent page) whose first reward is a real conversation within minutes, with zero purchase friction, and whose third step forces the user to learn the draft/production distinction before they can share a number.
- "Call me" (Bland dials the user's own phone) plus "Talk in browser" (WebRTC mic) covers both non-technical users who trust a phone and users without a phone handy.
- The example agent as a read-only reference (not a template) is a deliberate choice: it avoids users shipping a demo prompt by accident.
- There are no industry templates in the new-agent dialog; the only "starting points" are blank or import-from-legacy. Norm (see later) is Bland's substitute for templates.

### Gaps
- Free signup credit amount is not documented on the billing page (it only mentions an automatic credit for existing orgs during the December 2025 pricing transition).
- Whether the "New agent" dialog also offers "Build with Norm" or templates is not stated in the docs beyond "Blank agent" and import options.

---

## Agent builder (new) and Conversational Pathways builder (legacy) UX

### Takeaway
The new Agent builder is a three-region screen: agent sidebar, a central panel with Prompt and Settings tabs, and a right column toggling between Graph (visual diagram) and Testing. Tools and knowledge are attached by typing `@name` inline in the prompt. Structured "pathways" (the legacy flow canvas) are opt-in sub-objects that only run when a routing condition fires. The legacy Pathways canvas is a node/edge flowchart with six node types, a rich node editing panel (prompt vs static text, condition, variable extraction, loop condition, global node, decision guide), and a built-in Test panel with text chat, voice chat and real call modes plus message-branching.

### Cited Findings (new Agent builder)
- Layout: "Sidebar" (agent-specific sections), "Central Panel" with two tabs Prompt and Settings, "Right Column" toggling Graph and Testing; top bar has Agent and Guardrails tabs, and an environment selector (Development/Staging/Production) at top right — [Agent builder](https://docs.bland.ai/agents/agent-builder)
- Two stacked rich-text fields: Prompt ("describes goals and execution approach 'on this node'") and System prompt ("sets personality and tone 'on every node'"). Guidance: "Write in plain language. Describe the job, the order things should happen in, and what the agent should do when the caller goes sideways." — [Agent builder](https://docs.bland.ai/agents/agent-builder)
- Tools and knowledge are referenced with `@` syntax (e.g. `@check-calendar`); "Building a tool without tagging it fails silently." Both sections show "View all" and "Create/Upload" buttons under the Prompt field — [Agent builder](https://docs.bland.ai/agents/agent-builder)
- "Variables to extract" is a key-value list; the UI warns "Each one costs a little response time. Extract what you will use. Skip what you will not." Pre-call "request data" lives in Settings — [Agent builder](https://docs.bland.ai/agents/agent-builder)
- Three pathway types inside an agent: Prompt (single focused instruction), Pathway (custom flow "with placed steps and drawn connections; supports custom code and webhooks"), Authentication zone (identity-verification gate). Each needs a Routing condition; "Creating a pathway does not make it run." Pathways open in canvas mode with editable nodes and edges — [Agent builder](https://docs.bland.ai/agents/agent-builder)
- Settings tab: Display name, Voice and languages, Channels, Memory (on by default; writes to contact records), Metadata, Advanced (recording toggle, context management, image sending) — [Agent builder](https://docs.bland.ai/agents/agent-builder)
- Guardrails tab: four built-in TCPA guardrails (AI disclosure, recording disclosure, self-introduction, opt-out), all off by default; custom guardrails are enterprise-only; actions: end call, transfer, or jump to a step — [Agent builder](https://docs.bland.ai/agents/agent-builder)
- Testing panel tabs: Manual ("Real-time conversation with debug logs") and Simulation ("Runs saved test cases with judge scoring") — [Agent builder](https://docs.bland.ai/agents/agent-builder)
- Publishing: Publish (Development -> Staging, choose patch/minor/major version) then Promote (Staging -> Production). "An agent that has not been promoted to Production will not answer calls." If evaluations are configured, publishing runs them first — [Agent builder](https://docs.bland.ai/agents/agent-builder)
- Changelog, April 13, 2026, "Multiplayer Pathways": real-time collaboration "with live cursors, avatars, and change diff reviews" — [Changelog](https://www.bland.ai/changelog)
- Changelog, April 30, 2026, "GitHub Integration for Pathway Versions": git-based review of pathway changes in a repository — [Changelog](https://www.bland.ai/changelog)
- Changelog, March 11, 2026: "Persistent save banners for unsaved changes" added to pathways — [Changelog](https://www.bland.ai/changelog)

### Cited Findings (legacy Pathways canvas) **[legacy; sunset after 2026-11-15]**
- Nodes connect by dragging from the purple circle at the bottom of one node to the top of another, producing a dotted line with a "New Pathway" button in the middle; "Add new Node" button is top-left — [Conversational Pathways](https://docs.bland.ai/tutorials/pathways)
- Six node types: Default (prompt or fixed text), Transfer Call, End Call, Knowledge Base, Wait for Response, Webhook (with pre/post dialogue) — [Conversational Pathways](https://docs.bland.ai/tutorials/pathways)
- Node panel fields: Prompt; Static Text toggle (verbatim); Condition (e.g. "You must get the date, time, and number of guests"); Extract Variables from Call Info (name, type, description); Loop Condition; Global Node toggle; Enable Forwarding; Decision Guide (example user inputs mapped to expected pathways); Agent speech for End/Transfer with "AI-composed" toggle and fallback line — [Conversational Pathways](https://docs.bland.ai/tutorials/pathways)
- Edge labels are natural-language conditions, e.g. "user has a question about the restaurant's hours or location" — [Conversational Pathways](https://docs.bland.ai/tutorials/pathways)
- "Test" button opens three modes: Text Chat (tracks node progression with timestamps), Voice Chat (voice/language selection, pronunciation guides, interruption blocking), Send Call (real phone call). "Branching" lets you edit any user message to explore alternatives without restarting. Expanded call logs show variable extraction, loop-condition likelihood scores, route decisions, interruption events, webhook execution (URL, status, response time, payload). "Unit Testing" creates reusable test cases from historical calls with LLM-graded Pass/Fail — [Conversational Pathways](https://docs.bland.ai/tutorials/pathways)
- Versions: "A pathway is the container your phone numbers and API calls point at. Its ID stays the same for its whole life." Editing creates a draft; publishing saves a new version and promotes it; staging promotion and per-call version pinning exist — [Conversational Pathways](https://docs.bland.ai/tutorials/pathways)
- Templates: "To immediately start playing around with Conversational Pathways, you can use one of our templates." A "Restaurant Reservation" template with a Loom video walkthrough is named — [Conversational Pathways](https://docs.bland.ai/tutorials/pathways)
- Generate-from-prompt exists as an API: `POST /v1/pathway/generate` takes a "detailed pathway generation prompt" (100–8,000 chars for non-enterprise), returns a `jobId`, polled via `GET /v1/pathway/generate/status/{job_id}`. The API page does not mention a dashboard button — [Generate Pathway](https://docs.bland.ai/api-v1/post/pathway-generate)
- Changelog, April 6, 2026 and March 23, 2026: code, custom tools, tool chains and webhooks can now run inline on Default nodes "without separate dedicated nodes" — [Changelog](https://www.bland.ai/changelog)
- The legacy pathways doc still says the Knowledge Base node accepts pasted text with "PDF/Vector DB integrations 'coming soon'" — [Conversational Pathways](https://docs.bland.ai/tutorials/pathways) **[stale: the Knowledge page documents PDF/DOCX/website ingestion]**

### Inferences
- The new builder inverts the legacy model: prompt-first with an optional graph, rather than graph-first. The Graph tab in the right column is a read-mostly diagram; structure is added only where a routing condition justifies it ("lazy structure").
- Inline `@tool` / `@knowledge` mentions inside the prompt is the key editor pattern: attachment and placement-in-conversation happen in one gesture. The docs' warning that untagged tools "fail silently" suggests the UI does not yet validate this.
- The legacy Test panel's "branching" (edit a prior user turn and fork) is a strong iteration pattern; it reappears in the new Testbed as single-turn replay.
- The "Generate pathway" concept has been absorbed into Norm; the raw API remains for programmatic use.

### Gaps
- No screenshots are embedded in the agent-builder or pathways docs; canvas affordances like zoom, minimap, keyboard shortcuts, undo, and node search are not documented.
- The docs do not say whether the new builder's Graph tab is editable or read-only.

---

## Prompt-based agents: editor, prompt guide, personas, variables and dynamic data

### Takeaway
Bland's prompt model is "Prompt (this node) + System prompt (every node)" in rich-text fields, with `{{variable}}` interpolation for request data, CSV columns, built-ins (`{{lastUserMessage}}`, `{{now_utc}}`, `{{from}}`...) and per-environment `{{env.KEY}}`. The prompt guide is about voice realism (write like a transcript, contractions, fillers, bracketed performance tags). "Persona" was the legacy bundle object (voice + global prompt + pathways + knowledge + numbers + versions); in the new product it is simply the agent.

### Cited Findings
- Built-in variables available everywhere: `{{lastUserMessage}}`, `{{prevNodePrompt}}`, `{{now_utc}}`, `{{from}}`, `{{to}}`, `{{call_id}}`, `{{voice_id}}`; custom variables come from the Extract Variables panel, `request_data`, or webhook responses — [Conversational Pathways](https://docs.bland.ai/tutorials/pathways)
- Batch CSV columns become `{{column_name}}` in prompts; example: "Hi {{customer_name}}, just checking in to see if you'd like to schedule your next {{service}}. We're available as early as {{date}}." Column names cannot contain spaces — [Batch Calls](https://docs.bland.ai/tutorials/batch-calls)
- Per-environment variables resolve via `{{env.KEY}}`; a key with no value in the running environment "fails the call before it starts" (no fallback); values can be marked Secret — [Environments](https://docs.bland.ai/agents/environments)
- Global prompt concept: legacy "Global Prompt for All Nodes" and "Global Nodes" (accessible from any node, auto-return to origin) — [Conversational Pathways](https://docs.bland.ai/tutorials/pathways); mapped to "Agent system prompt in settings" in the new product — [Migrate to agents](https://docs.bland.ai/platform/migrate-to-agents)
- Prompting guide "Making calls sound human": write prompts "as transcripts, not polished prose"; core block: "Talk like a person on a phone, not like written copy. Use contractions. You are allowed to sound slightly imperfect, and you should: the occasional 'um' or 'uh', a false start you correct mid-sentence, a thought that trails off."; avoid semicolons, nested clauses, "moreover"/"utilize", and recontextualising phrases like "just to confirm"; performance tags like `[say warmly]`, `[laughs]`, `[sighs]` max two per line; test rule: "Read every line aloud. If it sounds like an essay, rewrite it." — [Making calls sound human](https://docs.bland.ai/platform/sounding-human)
- Legacy Persona builder has five sections: General (name, role, description, voice picker, language, background soundscape such as "Office-style soundscape", modality toggles), Behavior (Global Prompt, Wait for Greeting toggle, Interruption Threshold slider, "+ Add routing" for pathways), Knowledge ("Connect from library"), Analysis & Webhooks (Generate Summary toggle with custom prompt, Data Extraction [Enterprise], Outcomes selector, Evaluations dropdown, Webhook URL + Events + "Test Webhook" button), and Version Management (draft vs production, "Changes Ready to Promote", field-level diffs, "Promote to Production", "Reset Draft", "Version History") — [Personas](https://docs.bland.ai/tutorials/personas) **[legacy]**
- Persona builder includes "a testing modal where you can start web calls with yourself" in the right sidebar — [Personas](https://docs.bland.ai/tutorials/personas) **[legacy]**
- Changelog, July 21, 2026: interruptibility (five levels from "Block interruptions" to "Always interrupt") and resumption speed (Slow/Medium/Fast), settable per node, on inbound numbers, or in the Send Call API — [Changelog](https://www.bland.ai/changelog)
- Changelog, April 13, 2026, "Persona Authentication": mid-conversation identity verification via SMS codes, identity questions, or API — [Changelog](https://www.bland.ai/changelog)
- Memory is on by default in agent Settings and writes to contact records; disabling stops future extraction but keeps existing data — [Agent builder](https://docs.bland.ai/agents/agent-builder). Changelog July 6, 2026: memory syncs to HubSpot/Salesforce at the contact level after every call and message — [Changelog](https://www.bland.ai/changelog)

### Inferences
- The two-field split (node prompt vs system prompt) is a simple, teachable mental model for non-engineers: "what to do now" vs "who you are".
- Bland's prompt guidance is voice-specific (disfluencies, tags) rather than generic prompt engineering; a receptionist product could ship a similar "read it aloud" checklist and a tag palette.
- Field-level diffs before promotion (legacy Persona) and "change diff reviews" (multiplayer pathways) indicate Bland treats prompt edits like code review.

### Gaps
- No documented in-editor prompt linting, token counter, or prompt-template library beyond Norm.

---

## Testing and QA tooling

### Takeaway
Bland has the deepest testing stack of the platforms I have seen documented: (1) Manual test (browser mic / call-me / text chat) with live debug logs; (2) Testbed, which replays a single turn from a real conversation N times and reports answer stability; (3) Evaluations = LLM "judges" x simulated "test cases" x runs, wired as required checks that gate publish/promote; (4) legacy agent-to-agent Scenarios with nine caller-persona templates, ten assertion types, flakiness detection, production gates, and a "Tornado" auto-fix loop; (5) Evals workbench for batch-grading historical calls. Latency-per-turn is visible in Metrics and the audio waveform, and tool-call payloads appear in expanded logs.

### Cited Findings
- Builder Testing panel: Manual ("Real-time conversation with debug logs; used during development") and Simulation ("Runs saved test cases with judge scoring") — [Agent builder](https://docs.bland.ai/agents/agent-builder)
- Testbed: "Testbed takes a single moment from a real conversation and runs it again." "Testbed does not replay the call. It re-runs one turn." Opened from a conversation (test-tube icon), from a transcript turn (hover menu: Dialogue, Route, Loop condition, Variable extraction), from an event row, or from the Conversations list (empty picker). The middle pane shows the exact messages sent; you can edit Instructions, Context, Caller input and choose a run count. Results group identical answers with `count/total` badges and mark whether each group matches the original — "a stability reading rather than a pass or a fail." Push-change is disabled if the agent changed since the conversation — [Testbed](https://docs.bland.ai/agents/testbed)
- Evaluations = judges + test cases + runs. Judge editor sections: Judge mode (Transcript or Audio), Context, Judge task, Verdicts (with the hoped-for outcome), Advanced (model, retries); "The button reads Create judge the first time and Update afterwards." Test cases can be created from scratch or via "Generate based on production calls" (analyses up to 50 real calls); fields: title, prompt, labels, max turns (default 20), start node, request data. Manual runs: "A run you start here is stored in your browser, not on Bland" — [Evaluations](https://docs.bland.ai/agents/evaluations)
- Pass rule: a judge passes when matching verdicts are "half or more" of conversations; inconclusive verdicts are excluded; odd counts (3 or 5) avoid ties. Up to five judges and five test cases attach to staging as required checks ("Req'd" checkbox; advisory = report-only). The promotion gate dims on failure. UI: Validate > Judges / Test cases / Runs tabs, New judge, New test case, Save as draft, version picker — [Evaluations](https://docs.bland.ai/agents/evaluations)
- Environments: required evaluations gate both publish-to-staging and promotion; failure shows a "Publish blocked" toast; "A blocked publish is not a rollback"; promotion also blocks if configuration changed after the last evaluation — [Environments](https://docs.bland.ai/agents/environments)
- Legacy Scenarios (in the pathway editor, "Scenarios" button in the top toolbar; panel split into Gates and Tests): create from nine templates (Voicemail, Call Screener, Angry Caller, Belligerent Caller, Confused Caller, Happy Path, Edge Case, Custom...), "Generate from Call Log", or manually. Fields: Scenario Name, Test Caller Persona prompt, "Bland Tone Scoring" toggle ("empathy, conciseness, flow, back-channeling"), Assertions, max turns, `start_node_id`, request-data overrides. Ten assertion types: LLM_JUDGE, BLAND_TONE, VARIABLE_EXTRACTED, NODE_REACHED, NODES_VISITED, WEBHOOK_TRIGGERED, REGEX_MATCH, STRING_CHECK, CUSTOM_LLM, TRAVERSAL_MATCH — [Scenarios](https://docs.bland.ai/tutorials/scenarios) **[legacy pathway editor]**
- Scenario execution: Run (single), Run All (batch with pass/fail, score %, assertion breakdown), Simulation Sets (same scenario N times; "flakiness detection — scenarios flagged as unreliable"), Tornado mode (runs tests, analyses failures, "generates a fix plan (prompt changes, node config updates, flow changes)", applies to a forked version, re-runs until pass; one session per pathway). Results show transcript + captured variables, tone scores, AI reasoning; "Norm analysis" proposes prompt_change / node_config / flow_change / tone_improvement. "Production Gate" toggle: "these scenarios must pass before a pathway version can be promoted to production." Analytics: Basic (pass/fail rate, avg score) and Enhanced (Health Score, Reliability Score, Trend Analysis, Node Failure Heatmap, Weakest Link, Sankey Flow) — [Scenarios](https://docs.bland.ai/tutorials/scenarios)
- Changelog, April 13, 2026 "Agent-to-Agent Testing": "Create scenarios from pre-built templates or from scratch, each defining a caller persona." — [Changelog](https://www.bland.ai/changelog)
- Evals workbench (dashboard "Evals"): eval agents are LLM judges, each grading "one quality of every call" with pass/fail or 2–5 graded levels, target levels, weight 0–100; modality text or audio. Workbench setups are "a saved, named, versioned bundle of attached agents, their weights and targets, a pass threshold, a run mode". Experiments accept up to 5,000 call IDs and 50 agents; the builder shows "selected calls, attached agents and their weights and targets, and the live results grid"; the verdict drawer shows "each agent's selected level, written reasoning, and quoted evidence next to the call transcript"; analysis shows per-agent success rate and a histogram of weighted scores. Shipped templates: Hallucination Detection, Resolution, Conversational Quality, Bland Tone, Audio Quality, Discovery, Issue Understanding, Objection Handling, Scheduling Clarity, Appointment Booked. Cost estimate endpoint previews evaluation count, tokens and cost. "An experiment freezes the exact agent version it ran" — [Evals](https://docs.bland.ai/tutorials/evals); changelog May 28, 2026 — [Changelog](https://www.bland.ai/changelog)
- Legacy pathway Test panel modes (Text Chat / Voice Chat / Send Call), branching, expanded logs and "Unit Testing" from historical calls — [Conversational Pathways](https://docs.bland.ai/tutorials/pathways)
- Changelog, March 11, 2026 "Pathway Testbed": "Interactive testing environment for individual nodes with custom inputs, variable extraction review, and integrated standards testing" — [Changelog](https://www.bland.ai/changelog)
- A/B: the API has agent "Experiments" endpoints (create/list/update/stop) — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt); the Pathways webinar covers "A/B testing" — [Webinars](https://www.bland.ai/webinars)
- Norm can "replay a real call's recorded state against your draft at a specific node" using Test Bed, and "Norm Fix" from Triage "reproduces failures, applies drafts, and verifies solutions" — [Norm](https://docs.bland.ai/tutorials/norm)
- Competitor critique (Coval): testing "doesn't test how agents perform with diverse user speech patterns, background noise, or unexpected phrasing" — [Coval review](https://www.coval.ai/blog/bland-ai-review-2026-features-pricing-and-when-to-use-it/) **[competitor selling eval tooling; partly contradicted by the audio-mode judges documented above]**

### Inferences
- The recurring loop is: real call -> flag turn -> Testbed/Scenario generated from that call -> fix in draft -> eval gate -> promote. Every debugging entry point starts from a real conversation, not from a blank test form.
- "Stability reading" (N reruns, grouped answers) rather than binary pass/fail is a distinctive and cheap pattern for LLM non-determinism; it would translate directly to a receptionist dashboard ("re-run this turn 5x").
- Storing manual eval runs in the browser (not server-side) is a documented rough edge; a team copying the pattern should persist runs.
- The Scenarios feature (gates, Tornado) is documented only for the legacy pathway editor; the new Evaluations page is simpler (judges/test cases/runs). It is unclear how much of Scenarios carries over.

### Gaps
- No screenshots of Testbed/Evaluations screens in the docs; the exact layout of the results grid is not shown.
- The dashboard UX for A/B "Experiments" (API exists) is not documented on any page I could find.

---

## Call logs / call (conversation) details page

### Takeaway
The conversation detail is a right-side panel over a live list, with a Transcript/Detail/Logs timeline, a pinned recording player with a waveform annotated by decision (green) and extraction (amber) markers, per-turn "expanded logs" (node chosen, prompt, loop-condition likelihood, chosen vs alternative routes, extracted variables, webhook status codes, custom code), and a collapsible right column (Metadata incl. cost/duration/summary, Variables, Citations with quoted evidence, Notes & Review status, Outcomes, Pathway/QC tags, Webhook & Tools with resend, Guardrails, Memory, Metrics). Every voice row has a Flag button that files a triage Issue; transcript search and translation are per-conversation, not list-wide.

### Cited Findings (new Conversations screen)
- "every call, every message thread, every web chat, in one list you can filter, read, and export." Default Chronological view; alternative Threaded view groups by contact. Columns: 20 total, 11 visible by default (ID, Status, Channel, Length e.g. "4:12" or "9 msgs", Contact, Direction, Agent, Started; toggleable To, From, Dispositions, QC tags, Error, Batch ID...). "Load more" pagination — [Conversations](https://docs.bland.ai/agents/conversations)
- Search box "Searches the rows already loaded, across the contact's number, the contact's name, the pathway name, and the conversation ID" — it does not search transcripts. Filters: Agent selector, Call source (Live / Simulated / All), condition builder (Status, Direction, Escalation, QC tags, Contact), saved filters, saved-view chips ("Failed & No-Answer", "Escalated"). Sort via a Sort button (Started / Last activity; column headers are not clickable) — [Conversations](https://docs.bland.ai/agents/conversations)
- Detail: "a panel opens on the right. The page behind it stays live, so you can keep working the list." Sections: event strip (top), timeline with three modes Transcript / Detail / Logs, recording player pinned at bottom, timeline search. Hover actions per turn: Raw LLM context, Edit node (opens builder), Open turn in Testbed, Report transcription issue — [Conversations](https://docs.bland.ai/agents/conversations)
- Right column (collapsible): Metadata (ID, channel, direction, agent, start/end, duration, cost, message count, summary), Notes (voice only), Memory, Pathway Tags, QC Tags, Variables, Citations, Guardrails & Alerts, Metrics. Controls: Copy Conversation ID, Copy all Logs (raw JSON), Copy transcript (text channels), Flag (voice), Testbed icon, drag-to-resize, prev/next chevrons — [Conversations](https://docs.bland.ai/agents/conversations)
- Flagging "either opens a new issue, which takes a name, a severity, a description and a note, or adds the call to one that already exists"; multi-select uses "Add to Issue" in a bottom toolbar — [Conversations](https://docs.bland.ai/agents/conversations)
- Export modal: "The export is not what is on your screen. It runs on the server, over the date range you pick, and it keeps only the filters the server knows about: call source, agent, channel, and batch." Options: calls or message threads (no web-chat export), date range default 30 days max 180, timezone, email delivery, exclude columns; transcripts excluded by default — [Conversations](https://docs.bland.ai/agents/conversations)
- Contacts tab: per-person profile with custom schema, Memory, Agents, Timeline, CRM, Raw; "CRM sync" via HubSpot/Salesforce OAuth — [Conversations](https://docs.bland.ai/agents/conversations)

### Cited Findings (legacy Call Logs page) **[legacy; maps to Conversations]**
- Table columns: Actions (play/download), ID, Channel, Direction (Inbound/Outbound/Proxy), To, From, Pathway, Duration, Issues, Status, Created, Tags, Version, Transferred To, Batch ID, Review Status, Memory, Recording, Error. Quick filters: Full Conversations, Voicemails, Assigned to Me, Warm Transfers, Unassigned; time range last hour to 30 days; advanced conditions across Call Details / Pathway / Data / Quality / Other; saved filters "shared across your organization"; search by Call ID; CSV export by email (timezone, up to 180 days, exclude columns incl. transcript and citation variables) — [Call Logs](https://docs.bland.ai/tutorials/call-logs)
- Detail: transcript with speaker labels, timestamps and "a sticky header tracking the current node"; hover actions to flag quality issues, edit node, open testbed; transcript search and translation toggle. "Expand all logs" reveals per turn: node chosen, prompt, loop condition with likelihood scores, routing decisions "showing chosen and alternative routes", variable extraction, webhook responses with status codes, custom code execution — [Call Logs](https://docs.bland.ai/tutorials/call-logs)
- Audio player: "play/pause, skip forward and back, a speed selector, and a download button", sync-scrolling to the transcript; waveform shows pathway tags, decision markers (green) and extraction markers (amber) — [Call Logs](https://docs.bland.ai/tutorials/call-logs)
- Context panel: Metadata (Call Details, Duration & Cost, Participants, Configuration, Pathway, Alerts, AI Summary); Variables; Citations ("variable name, extracted value, and expandable sources with quoted transcript text and timestamps"); Notes & Review (threaded notes; status Pending Review / In Progress / Completed / Not Needed); Outcomes; Pathway Tags; Webhook & Tools (with resend); Guardrails; Memory; Metrics ("agent quality, transcription, response time, silence, noise, sentiment, engagement, repetition, interruptions, and word count"); Request Data (original API payload) — [Call Logs](https://docs.bland.ai/tutorials/call-logs)
- A "Get Corrected Transcript" endpoint exists — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt); the dashboard docs do not describe a correction UI beyond "Report transcription issue" — [Conversations](https://docs.bland.ai/agents/conversations)
- Changelog, April 6, 2026: call-log filterable fields added (Dialed At, Outcomes, Transferred To) — [Changelog](https://www.bland.ai/changelog)
- Changelog, April 30, 2026 "Triage": "Flag any call for triage from the call detail view to create an issue with severity, owner, assignee." — [Changelog](https://www.bland.ai/changelog)
- Competitor critique (Coval): "Manually reviewing calls doesn't scale when you're making thousands daily." — [Coval review](https://www.coval.ai/blog/bland-ai-review-2026-features-pricing-and-when-to-use-it/)

### Inferences
- The strongest pattern is "explain every turn": the transcript is annotated with the model's routing decision, alternatives considered and likelihood scores, and every turn has a one-click path into the editor or the Testbed. This closes the loop between monitoring and iteration.
- Waveform markers colour-coded by event type and synced transcript scrolling make audio review faster than a plain player; this is cheap to replicate.
- The right-side slide-over panel (list stays live, prev/next chevrons) is the chosen review ergonomics rather than a full-page detail route.
- Review workflow fields (Review Status, threaded Notes, Flag-to-Issue with severity/owner/assignee) show Bland expects a human QA team, not just an owner.

### Gaps
- Per-turn latency numbers are implied by "response time" in Metrics but the docs do not show the exact latency display (e.g. ms per turn).
- The Citations, Variables, Guardrails & Alerts and Metrics sections are described as "empty section" on the new Conversations page, i.e. still being ported; their final content is unknown.

---

## Analytics dashboard

### Takeaway
Analytics is thin in the self-serve docs. The documented analytics product is the April 2026 "Analytics Dashboards Overhaul" (Enterprise-only): user-built panels (KPI tiles, line/bar/pie, tables, scatter) with aggregation/columns/filters/date range, a plain-language "generate panel with AI" form with live preview, view/edit modes, and one global date range. Scenario/eval analytics (pass rates, health scores, node failure heatmap) are documented separately. There is no documented default "answered rate / transfer rate / drop-off" dashboard.

### Cited Findings
- Analytics Dashboards Overhaul [Enterprise], April 30, 2026: panels as "KPI tiles, line charts, bar charts, pie charts, tables, or scatter plots"; "Build your own panels with full control over aggregation, columns, filters, and date ranges"; generate panels by describing them, e.g. "Daily call volume per pathway for the last 30 days", and "the form populates itself with a live preview before you save"; "view and edit modes to safely browse a dashboard"; "apply a single global date range across every panel on the board"; two screenshots of the dashboard and panel builder — [Analytics overhaul changelog](https://bland.ai/changelog/2026-04-30-analytics-dashboards-overhaul); [Changelog](https://www.bland.ai/changelog)
- The Conversations page "contains no dedicated analytics section"; aggregate numbers appear only as per-contact message/agent counts — [Conversations](https://docs.bland.ai/agents/conversations)
- Norm answers plain-English analytics questions ("How many calls failed yesterday?") "and receive visualizations or numerical answers" — [Norm](https://docs.bland.ai/tutorials/norm)
- Legacy scenario analytics: Basic (pass rate, failure rate, average score over configurable windows) and Enhanced (Health Score, Reliability Score, Trend Analysis, Node Failure Heatmap, Weakest Link, Sankey Flow) — [Scenarios](https://docs.bland.ai/tutorials/scenarios)
- Evals analysis view: per-agent success rate and a distribution histogram of weighted call scores — [Evals](https://docs.bland.ai/tutorials/evals)
- Bland University Module 5 lesson 1 describes analytics as capabilities ("Gain instant insights about your call campaign performance", "View latency and performance details", sentiment analysis, information extraction) without screens — [University M5 L1](https://university.bland.ai/modules/5/lesson-1) **[legacy]**
- Marketing: "Analytics - Call transcription, scoring, and searchability" — [bland.ai](https://www.bland.ai/)
- Competitor description (Coval): analytics tracks "call volume, success rates, duration, and outcomes aggregated across campaigns" with filtering "by time period, campaign, or pathway", but "doesn't help you understand why specific conversations failed or identify subtle quality patterns" — [Coval review](https://www.coval.ai/blog/bland-ai-review-2026-features-pricing-and-when-to-use-it/)
- The MCP server exposes "structured call analytics" queries — [MCP overview](https://docs.bland.ai/integrations/mcp/overview)

### Inferences
- Bland's bet is "ask for the chart" (Norm / AI panel generation) rather than a curated KPI dashboard. For an SMB receptionist product, a fixed, opinionated dashboard (answered rate, after-hours volume, bookings made, transfers) would be a differentiator versus Bland's blank-canvas approach.
- Sankey flow / node failure heatmap for pathway drop-off exists only in the testing analytics, not for production traffic, per the docs.

### Gaps
- No documented list of available metric columns/aggregations in the panel builder, no default dashboard, no sharing/scheduling of dashboards.
- Whether any analytics dashboard exists on Start/Build/Scale plans (non-enterprise) is not documented.

---

## Live call features

### Takeaway
Live monitoring is an "Active" tab (All-agents scope) showing in-progress calls with a running duration ticker and a live transcript on click; listen-in is an org-level setting. Human takeover is documented for web chat/SMS threads ("Take over / Return to agent / End") but not as barge-in/whisper on voice; voice handoff is via warm transfer. Stop/transfer/listen exist as API endpoints.

### Cited Findings
- "The Active tab (All agents only) displays real-time calls with: ID, status, live duration ticker, from/to numbers, and objective. Clicking a row shows live transcript. Listen-in capability depends on organization setting." — [Conversations](https://docs.bland.ai/agents/conversations)
- Message-thread / web-chat panel has "Take over / Return to agent / End" options and a Retry for failed messages — [Conversations](https://docs.bland.ai/agents/conversations)
- API endpoints exist for Stop Active Call, Listen to Active Call, Stop All Active Calls, Transfer Active Call, List Active Calls, and an Event Stream — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt)
- Changelog, April 30, 2026: "Warm transfers now support running pathways on proxy agents" — [Changelog](https://www.bland.ai/changelog); a Warm Transfer tutorial exists — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt)
- Marketing "Observability - Real-time call monitoring and QA" — [bland.ai](https://www.bland.ai/)

### Inferences
- Bland's live view is monitoring-first (see transcript, listen), not intervention-first; humans join a voice call via transfer, not by barging into the AI leg.
- "Manual hangup" from the dashboard is not documented as a button; only the Stop API is documented.

### Gaps
- No documentation of whisper/coach mode, dashboard hang-up button, or supervisor barge-in for voice.

---

## Inbound configuration UX

### Takeaway
Inbound setup in the new product is: Dispatch > Phone numbers (org-wide inventory; activate free number / buy / connect Twilio / import) -> assign a number to an agent via dropdown -> configure per-agent Channels (Calls tab: max duration, recording, voicemail handling; Messages tab per-number, enterprise; Web chat widget). Voice settings apply to all of an agent's numbers. Business hours are documented only as a timing option on Triggers, not as an inbound-routing setting.

### Cited Findings
- Dispatch: "A caller dials your main line and the agent picks up, or you hand it a list of four hundred numbers and it starts dialing." Number inventory at "All agents" scope; Channels section inside an agent with three tabs: Calls (maximum duration, recording, voicemail handling), Messages (SMS/RCS/iMessage; enterprise; per-number), Web chat (embedded widget). "Voice settings apply to every number the agent has. Messaging settings are saved separately for each number." SIP is a second tab under Phone numbers — [Dispatch](https://docs.bland.ai/agents/dispatch)
- Legacy per-number fields taught by Bland University: prompt, pathway_id ("The most commonly used parameter"), voice, first_sentence, wait_for_greeting, interruption_threshold, transfer_phone_number, transfer_list (route "to a set of phone numbers" for departments), webhook, keywords (boosted in transcription) — [University M2 L4](https://university.bland.ai/modules/2/lesson-4) **[legacy, API-oriented]**
- Legacy inbound numbers dashboard: assign a persona in the configuration column; "Pathway override combining persona with specific routing"; one persona across multiple numbers — [Personas](https://docs.bland.ai/tutorials/personas) **[legacy]**
- Changelog, April 13, 2026: "Voice pool configuration for inbound numbers" — [Changelog](https://www.bland.ai/changelog)
- Guardrails tab: built-in TCPA guardrails (AI disclosure, recording disclosure, self-introduction, opt-out) off by default; actions end call / transfer / jump to step — [Agent builder](https://docs.bland.ai/agents/agent-builder)
- Blocked numbers: a Blocked Numbers tutorial and block-rule API exist — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt)
- Triggers' call actions offer timing "Immediately, Business hours, or Custom schedule with timezone" — [Triggers](https://docs.bland.ai/agents/triggers)
- Marketing (AI receptionist): "Bland answers when your team is closed or every line is busy, so no caller lands in voicemail."; "picks up in under a second"; "warm-transfer complex calls to your team with full context"; "A caller who starts on the phone can finish by text without repeating themselves." — [AI receptionist](https://www.bland.ai/solutions/ai-receptionist)

### Inferences
- Bland separates "number inventory" (org) from "how the agent behaves on a channel" (agent), which keeps per-number config minimal. An SMB receptionist would need to add what Bland lacks here: business-hours schedules, greeting per number, and fallback/overflow rules as first-class fields.
- After-hours/overflow coverage is a marketing promise, apparently implemented at the telephony/forwarding level rather than as a dashboard schedule.

### Gaps
- No documented business-hours, holiday, greeting-per-number, or fallback-destination settings screen for inbound numbers in the new product. (The legacy Personas page mentions greeting/voicemail/transfer at a high level only.)

---

## Batch / campaign UX

### Takeaway
Batches are a three-step wizard inside an agent (Recipients CSV -> Script/agent + max duration -> Review & send) with `phone_number` as the only required column and every other column becoming a `{{variable}}`; the batch list shows status progression (Initializing -> Validating -> Dispatching -> In Progress -> Completed / Completed Partial / Failed) with a jump to Conversations filtered by batch and a Stop button. Throttling is governed by plan concurrency caps, not a per-batch control.

### Cited Findings
- New Dispatch batches: "Create Batch", "Start calling", "Stop Batch"; wizard steps 1 Recipients (CSV with validation), 2 Script (agent selection, instructions, 1–120 minute max duration), 3 Review & send (preview, name). CSV up to 125 MB, no row limit; `phone_number` must be exact and include country code; other columns available as `{{column_name}}`. List shows Status, Name, Batch ID, Created; icon buttons filter Conversations or stop queued calls. "Batches inside an agent are calls only: the SMS option is not there." — [Dispatch](https://docs.bland.ai/agents/dispatch)
- Legacy Batch Calls page: "Create Batch Call" leads to "a configuration screen similar to the normal call creation flow, with the addition of a CSV upload step"; an image titled "Batch Call CSV Conversion" shows the column-mapping UI where each column can be marked as request data or "map them to any other call configuration setting"; statuses include "In Progress Chunked" for large batches and "Waiting for Scheduled Calls"; "Invalid or blank numbers will be skipped automatically and reported in the error logs"; optional `status_webhook` POSTs once per phase; "Use the Call Logs page (filtered by batch ID) to inspect each call's transcript, outcome, and variables." — [Batch Calls](https://docs.bland.ai/tutorials/batch-calls)
- Plan caps that effectively throttle campaigns: Start 100 calls/day, 10 concurrent; Build 2,000/day, 1,000/hour, 50 concurrent; Scale 5,000/day, 100 concurrent — [Billing & Plans](https://docs.bland.ai/platform/billing)
- Triggers can fire on "Batch completed" — [Triggers](https://docs.bland.ai/agents/triggers)

### Inferences
- The CSV-column-to-variable convention (no mapping step needed when column names are already prompt variables) is the simplest possible personalization UX; the legacy page shows an explicit mapping screen for advanced cases.
- Results are not a separate "campaign report"; the pattern is "batch = a filter on Conversations", which avoids building a second analytics surface.

### Gaps
- Scheduling a batch for a future time and per-batch throttling/retry settings are not documented in the dashboard (only "Waiting for Scheduled Calls" status hints at scheduling).

---

## Knowledge base UX

### Takeaway
Knowledge sources come from file upload (PDF/TXT/CSV/JSON/DOCX, 10 MB each, 10 at a time), pasted text (up to 1M chars), website ("Discover from a site" reads the sitemap and pre-selects everything; or paste URLs), and read-only Notion/Google Docs sync. Each source type has a tailored editor, websites have "Sync now" and daily auto-sync with a "Stale" badge after 7 days, and a "Source testing" panel shows the generated queries, gap evaluation and ranked retrieved chunks for a question. A visual "Knowledge Map" (May 2026) colour-codes sources and questions by coverage.

### Cited Findings
- Files: "PDF, TXT, CSV, JSON and DOCX files, up to 10 MB each and 10 files at a time"; "drag files in, or click to pick them"; each file is its own source but they "share the description you typed" — [Knowledge](https://docs.bland.ai/agents/knowledge)
- Text tab: "paste content directly, up to one million characters", must be named; for "things that live nowhere else yet: a policy someone wrote in a message, a price list" — [Knowledge](https://docs.bland.ai/agents/knowledge)
- Website tab: "'Discover from a site' takes a domain, reads its sitemap, and comes back with everything it found, all selected." or paste URLs "one or many at once, separated by spaces or commas" (the list becomes one source). "Sync now" plus optional daily auto-sync; marked "Stale" if auto-sync is on but has not synced in over 7 days — [Knowledge](https://docs.bland.ai/agents/knowledge)
- Integrations: Notion or Google Docs; integration sources are "read-only in Bland" — [Knowledge](https://docs.bland.ai/agents/knowledge)
- Editors by type: text = full-width editor; PDF/DOCX = original document beside extracted text; CSV = grid; website = URL list with sync controls — [Knowledge](https://docs.bland.ai/agents/knowledge)
- "Source testing" lets users "ask a question and see what the agent would retrieve": generated queries, gap evaluation, retrieved chunks ranked by relevance score — [Knowledge](https://docs.bland.ai/agents/knowledge)
- Attach by checking rows on the agent's Knowledge page or typing `@` in the prompt; a floppy-disk save icon persists changes — [Knowledge](https://docs.bland.ai/agents/knowledge)
- Changelog, May 7, 2026 "Knowledge Base Updates": "Visual Knowledge Map showing sources and questions as connected nodes, color-coded by coverage status" — [Changelog](https://www.bland.ai/changelog)
- Triggers include a "knowledge gap detected" event — [Triggers](https://docs.bland.ai/agents/triggers)
- A "Chat with Knowledge Base Item" API and "Discover Sitemap URLs" API exist — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt)

### Inferences
- "Discover from a site, everything pre-selected" is the lowest-effort onboarding for an SMB (paste your website, done); pairing it with a stale badge and gap detection turns KB maintenance into a passive feed.
- Retrieval testing that exposes the generated queries and a "gap" verdict is more diagnostic than a plain "ask a question" box.

### Gaps
- Chunking/size limits per website source and the maximum number of sources per agent are not documented.

---

## Notifications: alerts, triggers, webhooks, post-call summaries

### Takeaway
Three mechanisms: (1) Alerts = threshold monitors on call metrics or custom plain-language conditions with INFO/WARNING/CRITICAL tiers and delivery by email, outbound phone call, or "custom tools" (Slack, PagerDuty, webhooks); (2) Triggers = event -> conditions -> action automations (14 native events, actions: Call, SMS, Webhook, Slack message, Custom code) with a two-pane builder, dynamic `{{field.path}}` binding, a Test mode and a Runs tab; (3) post-call webhooks with resend from the call detail and a "Test Webhook" button in legacy Persona settings. Per-call AI summaries exist (Generate Summary toggle); no built-in "email me a summary after each call" is documented except via Triggers/webhooks.

### Cited Findings
- Alerts: "Each alert is a configuration that combines three things" — a condition, severity levels with thresholds, and delivery targets. Built-in metrics on all plans: call length, API errors; enterprise: latency, transcription score, silence count, sentiment score, low engagement ratio, user interruption count; custom plain-language conditions can reference citation variables, disposition fields and pathway tags to "alert on business outcomes, not just system metrics." Tiers INFO/WARNING/CRITICAL each with operator/value, percentage-of-calls trigger, lookback window (10 min – 24 h), minimum call count. Channels: Email, Phone (outbound voice call with custom caller ID and spoken message), Custom tools (Slack, PagerDuty, webhooks). Alerts dashboard shows Active/Inactive, OK/Triggered with severity badge, last trigger time — [Alerts](https://docs.bland.ai/tutorials/alerts); changelog April 30, 2026 — [Changelog](https://www.bland.ai/changelog)
- Triggers: "A trigger watches for something to happen and acts on it." 14 native events (post-call webhook, call started, inbound call received, voicemail detected, warm/cold transfer started, pathway node reached, SMS received, post-SMS webhook, batch completed, evaluation completed, knowledge gap detected, tool success, tool failure) plus Salesforce/HubSpot create/update events. Actions: Call, SMS, Webhook, Slack message, Custom code (JavaScript). Builder: canvas left with three stacked cards (Trigger, Conditions, Action) — "The canvas is a picture, not an editor." — and a step editor on the right with a Test button. Conditions: field from payload, operators incl. change detection, All/Any logic, timing (Immediately / Business hours / Custom schedule with timezone). Static/Event toggle per field and "Insert field" injecting `{{field.path}}`. Test modes: "Conditions only" (default) and "Full test" (real charges). Runs tab shows firing time, outcome, retries (calls retry up to 5x; webhooks do not). Badges "Ready" / "Setup required". Known rough edge: "If a required field is missing, Save does nothing: no message, no error, and the button stays enabled." — [Triggers](https://docs.bland.ai/agents/triggers)
- Call detail has a "Webhook & Tools (with resend capability)" section — [Call Logs](https://docs.bland.ai/tutorials/call-logs); API has Create/Get/Resend Post Call Webhook and Webhook Signing docs — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt)
- Legacy Persona "Analysis & Webhooks" screen: Generate Summary toggle with custom prompt, Outcomes selector for automatic disposition, Webhook URL field, Events dropdown, "Test Webhook" button — [Personas](https://docs.bland.ai/tutorials/personas) **[legacy]**
- CLI: "Forward Bland webhooks to your local dev server without ngrok" with `bland listen --forward-to http://localhost:3000/webhook` — [CLI](https://docs.bland.ai/sdks/cli)
- Marketing: 20+ pre-built connectors including Slack, Zapier, HubSpot, Salesforce — [bland.ai](https://www.bland.ai/)

### Inferences
- Bland splits "something is wrong" (Alerts, statistical, ops audience) from "something happened" (Triggers, per-event, business audience). A receptionist dashboard could ship a handful of pre-baked Triggers ("new lead -> SMS owner", "voicemail -> email") rather than the blank builder.
- The Triggers "Test with editable JSON payload / simulate field changes" and "Runs" history are the webhook-testing UX; there is no in-dashboard request inspector for outbound webhooks beyond resend.

### Gaps
- No documented SMS notification channel for Alerts, and no documented "post-call summary email" preset.

---

## Developer experience

### Takeaway
DX is API-first with a large REST surface (v1 + a newer v2 for agents/tools/batches), a Node CLI (`bland-cli`, device-code auth, YAML pathways with push/pull/validate, `bland eval`, webhook forwarding), a browser `@blandsdk/client` Web Agent SDK with a server-minted session-token pattern, a remote MCP server (`https://api.bland.ai/v1/mcp`, 120 req/min/org) and a `norm@bland` plugin for Claude Code/Cursor/etc. API reference pages carry an "Error Codes Reference" accordion; no "try it" playground, no multi-language snippets, no OpenAPI link, no Postman collection and no sandbox keys are documented. Official Python (`pip install bland`) and npm SDKs appear to exist but their pages could not be verified.

### Cited Findings
- Welcome page: "Reach Bland from your own code or your coding agent with SDKs, MCP, and API references." — [Welcome to Bland](https://docs.bland.ai/welcome-to-bland)
- CLI: `npm install -g bland-cli` (Node 18+); `bland auth login --device` or `--key`; profiles in `~/.config/bland-cli/config.json`; `bland call send +1555... --task "..." --voice Karen`; `bland pathway init` creates YAML pathways with push/pull/validate and interactive tests; `bland eval`; promote versions; `--json` for jq; `bland listen --forward-to ...` for local webhook forwarding; bundled MCP server plus remote MCP at `https://api.bland.ai/v1/mcp` — [CLI](https://docs.bland.ai/sdks/cli)
- Web Agent SDK: "Embed a Bland voice agent into any web application (React, Vanilla JS, or Node)"; npm `@blandsdk/client`; "Your server creates a single-use session token using the Admin SDK. That token is handed to the browser."; React `useWebchat` hook with `agentId` and `getToken`, `start()`/`stop()`; events open/message/update/closed — [Web Agent SDK](https://docs.bland.ai/sdks/web-agent-sdk)
- MCP: "Connect coding agents and compatible personal AI agents to your Bland account over MCP." Tools cover placing calls, inspecting transcripts/recordings, creating/versioning/deploying v2 agents, compile-checking pathway graphs, querying analytics, running LLM evals, searching docs. Bearer API key; "The key's organization scopes every tool"; destructive operations require confirmation; "120 requests per minute per organization". Clients: Claude Code, Claude Desktop, Cursor, Codex, VS Code, Windsurf, Gemini CLI, plus personal agents (Grok Bot, Meta Muse, OpenClaw, Instinct, Poke) — [MCP overview](https://docs.bland.ai/integrations/mcp/overview); [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt)
- Agent onboarding API (start/poll/approve) and "Headless agent onboarding" let a bot obtain an API key and phone number on the Agent Phone Plan — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt); [Agent Phone Plan](https://docs.bland.ai/platform/agent-phone-plan)
- API reference page (Send Call): structured as Overview, Headers, Body Parameters grouped (Basic, Model, Dispatch, Knowledge, Audio, Voicemail, Analysis, Post Call), Response, and an "Error Codes Reference" accordion by category (authentication, rate limiting, validation, business logic, service). Rate-limit messages quoted: "Calls can only be sent every 10 seconds to the same number." and "Rate limit exceeded for newly created accounts." Auth: "Send it as `Bearer YOUR_API_KEY`. A bare `Authorization: YOUR_API_KEY` with no prefix is also accepted." No multi-language code samples, no try-it playground, no OpenAPI link on the page — [Send Call](https://docs.bland.ai/api-v1/post/calls)
- The docs site publishes `llms.txt` (full page index in Markdown, every page also served as `.md`) — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt)
- Environments API supports branches (create/rebase/merge), deployments, rollback, per-environment variables and checks — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt); changelog April 30, 2026 "GitHub Integration for Pathway Versions" — [Changelog](https://www.bland.ai/changelog)
- Search snippets describe an official "Bland AI Python Library" with `pip install bland`, sync and async httpx clients, and npm packages under the `blandai` account (`bland-client-js-sdk`, `bland-voice`) — [PyPI bland](https://pypi.org/project/bland); [npm ~blandai](https://www.npmjs.com/~blandai) **[unverified: the PyPI page failed to load during this research; versions/dates unknown]**
- Competitor review (Coval): "You can send your first AI phone call with ten lines of code." — [Coval review](https://www.coval.ai/blog/bland-ai-review-2026-features-pricing-and-when-to-use-it/)
- Competitor review (Lindy): lacks "a no-code builder"; "You can't see pricing unless you book a demo" — [Lindy review](https://www.lindy.ai/blog/bland-ai-review) **[Nov 2025; pricing is now public on the billing page]**
- Search-result snippet (attributed to a 2026 review, likely zeeg.me): "you'll quickly outgrow Norm in its current version, and you'll likely end up using Claude Code to help you build pathways" — [zeeg.me review](https://zeeg.me/en/blog/post/bland-ai-review) **[snippet only; not verified by direct fetch]**

### Inferences
- Bland's 2026 DX strategy is "coding-agent-native": llms.txt, `.md` mirrors of every page, a remote MCP server, a plugin for Claude Code, and a migration path driven by coding agents. Comparable teams should at minimum publish llms.txt and an MCP server.
- The lack of a try-it console and multi-language snippets is offset by the CLI (`bland call send`) as the fastest "hello world".
- No sandbox/test API key is documented; the free Start plan and "Call me" browser testing serve as the sandbox.

### Gaps
- Official Python/Node SDK versions, generators and GitHub URLs could not be verified (PyPI page failed to load). No Postman collection or OpenAPI download was found. Global API rate limits (beyond the MCP 120 rpm and per-number 10 s) are not documented on the pages fetched. No YouTube channel content or Reddit threads were retrievable via search.

---

## Norm (AI builder) — build/edit/debug from a prompt

### Takeaway
Norm (launched March 25, 2026) is Bland's answer to templates and wizards: a chat assistant in the dashboard sidebar, embedded in the pathway editor, on iMessage, and inside Claude Code, that builds and edits agents/pathways/personas, replays calls in the Testbed, answers analytics questions, and proposes fixes for flagged calls — always in a draft/commit/link safety model with diffs.

### Cited Findings
- "describe what you want in plain English, and Norm builds, edits, tests, and debugs your agents." Four locations: Norm Chat in the dashboard, an embedded assistant panel in the Pathway Editor (scoped to the open pathway), iMessage at +1 (321) 424-0172, and Claude Code via the Bland plugin. Image in docs: "The Norm chat interface in the Bland dashboard" (3024x1589) — [Norm](https://docs.bland.ai/tutorials/norm)
- Capabilities: creates pathways, modifies agents, wires personas with voices/knowledge/call config ("edits each through the right interface rather than hand-writing raw config"); replays "real call's recorded state against your draft at a specific node" via Test Bed; answers "How many calls failed yesterday?" with charts or numbers; "Norm Fix" from Triage reproduces failures, applies drafts and verifies; "/" skills incl. custom org workflows — [Norm](https://docs.bland.ai/tutorials/norm)
- Safety model: Draft (fork a working version while production continues) -> Commit (persist as a version, not live) -> Link (persona relink activates it on live traffic) — [Norm](https://docs.bland.ai/tutorials/norm)
- Launch post (March 25, 2026; updated Sept 1, 2026): example "Build me a full scheduling agent and integrate with my Cal.com."; Norm generates "the prompt, persona, agent, pathways, validation conditions, extraction rules, and API integrations"; "all updates happen in a protected branch"; users see "diffs between the original and updated prompts" and can "simulate agent-on-agent calls to stress-test before deploying"; "You describe what you want. Norm builds it. That's it." — [Norm launch post](https://www.bland.ai/blog/norm-build-voice-agents-from-prompt)
- Marketing: "Tell Norm what you want to build. No voice AI experience needed" — [bland.ai](https://www.bland.ai/)
- Changelog, May 7, 2026: "Type / in Norm chat to trigger any skill or to create a new one." — [Changelog](https://www.bland.ai/changelog)
- Docs tips: anchor on real call IDs when debugging, be specific about scope, ask Norm to explain before editing, convert repeated instructions into custom skills — [Norm](https://docs.bland.ai/tutorials/norm)

### Inferences
- For non-technical users, Norm replaces both the "template gallery" and the "setup wizard"; the product bet is that a conversation plus diff review beats forms.
- The draft -> commit -> link pattern with visible diffs is the UX that makes an AI editor safe on a live phone line; any receptionist product adding "AI edit my agent" should copy the diff-and-promote gate.

### Gaps
- Plan availability of Norm (free vs paid) is not stated; no screenshots beyond the one docs image were described.

---

## Non-technical / small-business UX and industry templates

### Takeaway
Bland's documented self-serve path is generic (blank agent + Norm), not industry-templated. The only named template is the legacy "Restaurant Reservation" pathway; scenario and eval templates exist for testing, not for agents. Marketing targets enterprise/regulated verticals with a 30-day FDE-led deployment, while the AI-receptionist page pitches SMB outcomes (after-hours coverage, booking, warm transfer, SMS continuation) without industry packs. Competitor reviews consistently rate Bland as developer-oriented.

### Cited Findings
- New-agent dialog: "Blank agent" or import an existing pathway/persona — [Build your first agent](https://docs.bland.ai/build-your-first-agent)
- Legacy pathway templates: "Restaurant Reservation" with a Loom walkthrough — [Conversational Pathways](https://docs.bland.ai/tutorials/pathways)
- Scenario templates (Voicemail, Angry Caller, Happy Path...) — [Scenarios](https://docs.bland.ai/tutorials/scenarios); eval templates (Hallucination Detection, Appointment Booked, Scheduling Clarity...) — [Evals](https://docs.bland.ai/tutorials/evals)
- AI receptionist page: booking ("check availability in your calendar or booking system on the call, then book, reschedule, or confirm"), after-hours, warm transfer, SMS continuation; "Most deployments go live in 30 days or less"; "IHFA built its first agent in about a week."; no industry templates named — [AI receptionist](https://www.bland.ai/solutions/ai-receptionist)
- Marketing: solutions pages for ai-receptionist, customer-service, outbound-sales, lead-qualification, ivr-replacement and an /industries page; verticals named are healthcare, insurance, financial services, logistics — [bland.ai](https://www.bland.ai/)
- Self-serve Start plan is free with 100 calls/day — [Billing & Plans](https://docs.bland.ai/platform/billing)
- Lindy (competitor, Nov 2025): "Setup can be complex for non-technical users"; praise: "Call quality and voice realism are outstanding", "Almost no delay" — [Lindy review](https://www.lindy.ai/blog/bland-ai-review)
- Coval (competitor, Feb 2026): "Configure a basic agent in 20-30 minutes." — [Coval review](https://www.coval.ai/blog/bland-ai-review-2026-features-pricing-and-when-to-use-it/)
- Homepage "Try a call" demo personas are Healthcare, Insurance, Financial Services — [bland.ai](https://www.bland.ai/)

### Inferences
- There is a clear opening for an SMB receptionist product to differentiate with industry starter kits (dental, HVAC, restaurant) and an opinionated setup wizard, since Bland offers neither in the documented self-serve flow.
- Bland's SMB story is delivered by Norm and by the FDE team, not by the dashboard.

### Gaps
- The /industries page and any marketplace/community template gallery were not fetched; no evidence of an in-app template gallery was found in docs, changelog, or University.

---

## Cross-cutting UX patterns worth adopting (synthesis)

### Takeaway
The patterns that recur across Bland's screens are: (a) draft/staging/production with eval gates and one-click rollback; (b) every real conversation is a test fixture (Testbed, generate-test-case-from-calls, flag-to-issue); (c) per-turn decision transparency in the transcript; (d) inline `@` attachment of tools/knowledge in the prompt; (e) AI assistant (Norm) that edits via diffs in a protected branch; (f) coding-agent-native DX (llms.txt, MCP, CLI).

### Cited Findings
- Environments: "A call runs the production version by default."; unpinned production returns HTTP 400 `AGENT_ENV_UNPINNED`; first publish "skips staging. There is no menu, just one button."; Promote "points production at the version staging is holding. Nothing is copied and nothing is rebuilt."; Rollback lists prior versions — [Environments](https://docs.bland.ai/agents/environments)
- Legacy Persona version control shows "Changes Ready to Promote" with field-level diffs — [Personas](https://docs.bland.ai/tutorials/personas)
- Test cases "Generate based on production calls" (up to 50) — [Evaluations](https://docs.bland.ai/agents/evaluations); Scenarios "Generate from Call Log" — [Scenarios](https://docs.bland.ai/tutorials/scenarios); Testbed opens from any transcript turn — [Testbed](https://docs.bland.ai/agents/testbed)
- Transcript hover actions: Raw LLM context, Edit node, Open turn in Testbed, Report transcription issue — [Conversations](https://docs.bland.ai/agents/conversations)
- `@check-calendar` inline tagging; "Building a tool without tagging it fails silently." — [Agent builder](https://docs.bland.ai/agents/agent-builder)
- Norm Draft -> Commit -> Link — [Norm](https://docs.bland.ai/tutorials/norm)
- Documented rough edges: manual eval runs stored in the browser — [Evaluations](https://docs.bland.ai/agents/evaluations); Triggers Save silently does nothing when a required field is missing — [Triggers](https://docs.bland.ai/agents/triggers); Conversations search does not cover transcripts and column headers are not sortable — [Conversations](https://docs.bland.ai/agents/conversations); env variables have no cross-environment fallback and fail the call — [Environments](https://docs.bland.ai/agents/environments)

### Inferences
- Bland's docs are candid about sharp edges, which itself is a DX pattern (a "Common issues" block on each feature page).
- For an AI-receptionist dashboard aimed at SMBs, the highest-leverage borrowings are the onboarding checklist with "Call me", the draft/production gate with visible diff, per-turn "why" in the transcript, and website-sitemap knowledge ingestion; the enterprise-grade eval/judge machinery can be simplified to a few preset judges (e.g. "Appointment Booked", "Caller frustrated").

### Gaps
- No first-hand screenshots or video of the current (post-September 2026) Agents dashboard were obtainable; all screen descriptions are from text docs and changelog entries. YouTube and Reddit sources returned nothing usable in search.
