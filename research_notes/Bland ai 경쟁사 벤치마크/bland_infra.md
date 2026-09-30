# Bland AI — telephony, media, inference and call-harness infrastructure

Research date: 2026-09-29. All docs.bland.ai / bland.ai / status.bland.ai pages were fetched live on that date unless a publication date is given. Confidence labels used throughout: **documented** (Bland's own docs/status page/API reference), **Bland marketing claim** (bland.ai marketing pages, blog, investor material — first-party but unaudited), **reported by X** (third party), **inferred** (my reasoning from the above). Competitor blogs (Retell, Telnyx, ElevenLabs) are flagged as such wherever cited.

Note on method limits: reddit.com is blocked for my crawler, web.archive.org is not fetchable, and the Baseten case study page now returns 404 on both `baseten.co` and `www.baseten.co` (only its title and search-snippet text survive). Gaps below reflect that.

---

## Key question 1 — Telephony: Twilio, BYOT, SIP/BYOC, carriers, numbers, international

### Takeaway
Bland exposes three telephony on-ramps: (1) Bland-provisioned numbers ($15/mo, US/CA self-serve), (2) "Bring Your Own Twilio" (BYOT) via an `encrypted_key` derived from your Twilio Account SID + Auth Token, and (3) an enterprise-gated SIP trunking layer with Bland-operated regional SIP/SRTP edges (`us2|ca2|asia2|eu2.sip.bland.ai`). Bland never names the carrier behind its own numbers; a competitor (Telnyx) asserts Bland "routes calls through Twilio and SIP partners", while Bland's marketing says it "owns its telephony and AI stack". The SIP edge is documented and real; the PSTN carrier behind Bland-owned numbers is not documented.

### Cited Findings

**BYOT (Bring Your Own Twilio) — documented**
- Users connect a Twilio account by supplying the Twilio **Account SID** ("starts with AC, 34 characters") and **Auth Token** ("32 characters"), in the Bland dashboard under Add-ons → BYOT ("Generate New Key") or via the API; Bland returns an `encrypted_key` that "is only shown once" — [Custom Twilio tutorial](https://docs.bland.ai/tutorials/custom-twilio); [Create Encrypted Key API](https://docs.bland.ai/api-v1/post/accounts)
- Twilio numbers appear under Add-ons → BYOT and can be imported individually via dashboard or API; "once imported, these numbers can be used for both inbound and outbound calls through Bland's infrastructure" — [Custom Twilio tutorial](https://docs.bland.ai/tutorials/custom-twilio)
- Send Call parameter `encrypted_key` (string): "A special key for using a BYOT (Bring Your Own Twilio) account. Only required for sending calls from your own Twilio account." Parameter `from` (string): "Specify a phone number to call from that you own or have uploaded from your Twilio account." — [Send Call API reference](https://docs.bland.ai/api-v1/post/calls)
- The tutorial says the key must be sent "alongside the Authorization header" and that if `from` is omitted "Bland will automatically select one"; "International calling permissions for imported numbers are inherited from the Twilio account they came from" (enable destination countries in Twilio Geo Permissions first); later updates to imported numbers "require including the encrypted_key parameter or requests may fail" — [Custom Twilio tutorial](https://docs.bland.ai/tutorials/custom-twilio)
- Related endpoints: Delete Encrypted Key, Upload Inbound Phone Numbers, Delete Inbound Phone Number — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt)
- Bland's Twilio integration page lists four capabilities: Twilio Studio Flow integration, inbound call routing "from Twilio to Bland", hand-off back to Studio Flow, and BYOT. The Studio Flow deployment "uses a twiml-redirect widget added to Studio Flow, named `bland_widget`, pointing to Bland's incoming URL with an encrypted key"; Bland says it takes "SIP credentials or API tokens" and "never stores account passwords" — [Bland + Twilio integration page](https://www.bland.ai/integrations/twilio)

**Bland-provisioned numbers — documented**
- "Purchase a new phone number (inbound/outbound)" at "$15/mo. subscription using your stored payment method"; countries: "US and Canada are available; other nations require contacting support"; select a three-digit area code (default 415) or request an exact number; the doc "does not specify whether numbers are provisioned through Twilio, Bland's own carrier, or another provider" — [Purchase number API](https://docs.bland.ai/api-v1/post/inbound-purchase)

**SIP trunking / BYOC — documented, enterprise-gated**
- "Bland provides inbound and outbound SIP connectivity" via reusable **trunks** (provider details, endpoints, auth), supporting E.164 PSTN numbers and non-E.164 identifiers (extensions/DIDs); GUI wizard or API; "All `/v1/sip` endpoints are protected by an entitlement check. Your organization must have the `SIP` entitlement enabled — contact support." — [SIP Integration (enterprise)](https://docs.bland.ai/enterprise-features/SIP-integration)
- Provider catalog listed: Vonage, Asterisk, FreePBX, 3CX, Cisco UCM/CUBE, RingCentral, Microsoft Teams ("requires certified SBC; direct connection unsupported"), generic SIP. "No specific mentions of Twilio, Telnyx, or Bandwidth" on that page — [SIP Integration](https://docs.bland.ai/enterprise-features/SIP-integration)
- Regional signalling endpoints, each "TLS 1.2 or higher, TCP port 5061 only", 2 signalling IPs + 4 media IPs per region: `us2.sip.bland.ai`, `ca2.sip.bland.ai`, `asia2.sip.bland.ai`, `eu2.sip.bland.ai`; media "SRTP using AES_CM_128_HMAC_SHA1_80" on "UDP ports 16384 to 32768"; auth "IP-based (default) or SIP REGISTER digest auth"; Let's Encrypt ISRG Root X1 CA required — [SIP Integration](https://docs.bland.ai/enterprise-features/SIP-integration); [Agents → SIP](https://docs.bland.ai/agents/sip)
- SIP methods: INVITE, ACK, BYE, CANCEL, OPTIONS, REFER; DTMF via RFC 2833 (RTP telephone-event); transfers via SIP REFER, new INVITE, or warm transfer (consult call then join) — [Agents → SIP](https://docs.bland.ai/agents/sip)
- Full SIP API surface: config, attach/detach, discover endpoint (DNS/port probing/codec detection), generate password, test call + status, firewall IPs, outbound setup, trunk health, call logs, advanced config, and **number porting** (portability check, LOA/port document upload, initiate/list/cancel; "Typical timeline: 7–14 business days") — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt); [SIP Integration](https://docs.bland.ai/enterprise-features/SIP-integration)
- Outbound over SIP uses the ordinary `/v1/calls` endpoint with a SIP-attached number in `from`; no `sip_uri`/SIP-header parameters are documented on Send Call — [Agents → SIP](https://docs.bland.ai/agents/sip)

**Who carries Bland's own PSTN traffic — contested**
- Bland marketing: "Bland owns its telephony and AI stack. Not a wrapper around third-party APIs." and "Self-hosted AI infrastructure. Not dependent on third-party voice API providers." — [bland.ai/ai-information](https://www.bland.ai/ai-information) (Bland marketing claim)
- Telnyx (competitor): "Self-hosted AI inference on dedicated GPU clusters Bland operates, with telephony routed through Twilio and SIP partners." and "Bland self-hosts AI but routes calls through Twilio, so every call inherits someone else's network." — [Telnyx "best Bland alternative" page](https://telnyx.com/the-best-bland-alternative) (competitor marketing, undated, no evidence shown)
- Retell (competitor) characterises Bland telephony as "Own numbers or bring your own Twilio" — [Retell benchmark blog](https://www.retellai.com/blog/retell-vs-bland-vs-vapi-vs-elevenlabs) (competitor)
- Twilio co-founder Jeff Lawson is a named angel investor in Bland's Series A (Aug 2024) and Series C (Jun 2026) — [Scale VP Series A press](https://www.scalevp.com/press/bland-ai-emerges-from-stealth-with--16m-series-a-led-by-scale-venture-partners); [raising.fi Series C summary](https://raising.fi/news/bland-series-c-june-2026)

### Inferences
- The only carrier Bland has first-class tooling for is Twilio (encrypted credentials, number import, Studio Flow TwiML redirect widget). Combined with the Telnyx/Retell characterisations and Jeff Lawson's investment, it is likely (not documented) that Bland's own US/CA numbers are provisioned and terminated via Twilio (or a Twilio-like CPaaS) and that "own telephony stack" refers to Bland's SIP edge and media handling rather than carrier ownership. Confidence: medium.
- The Studio Flow integration being a **TwiML redirect** to a Bland "incoming URL" (rather than `<Connect><Stream>` Media Streams) suggests Bland answers Twilio calls with its own TwiML endpoint; whether Bland then bridges via `<Dial><Sip>` to its SIP edge or via Media Streams is not documented. Confidence: low.
- The SIP layer (TLS-only signalling, SRTP-only media, per-region static IPs, OPTIONS pings, auto-discovery, porting) is a genuine, Bland-operated SBC/media edge in four regions — this is the part of "telephony" Bland demonstrably owns.
- International coverage: self-serve numbers are US/CA only; international is via BYOT (inheriting Twilio geo-permissions), SIP trunking (bring your own carrier), or "contact support".

### Gaps
- No Bland document names the carrier(s) behind Bland-owned numbers, STIR/SHAKEN attestation level, or whether Bland-owned numbers are Twilio-hosted.
- No documented per-country number catalogue or international pricing page found.
- Whether BYOT calls traverse Media Streams, `<Dial><Sip>`, or Twilio Elastic SIP Trunking into Bland's edge is not documented.

---

## Key question 2 — Media path: SIP/RTP vs WebSocket, codecs, media servers, regions, "own infrastructure"

### Takeaway
For SIP customers the media path is documented: SRTP/RTP over UDP into Bland-operated regional media IPs with codec negotiation (PCMU, PCMA, Opus, G.722, G.729 optional). Bland's compute footprint is AWS (us-west-2, ca-central-1, ap-southeast-2, eu-west-1) behind Cloudflare — documented via its static-IP page and status page. Bland's realtime TTS renders at 48 kHz PCM natively and can emit 8 kHz μ-law, implying wideband synthesis with downsampling at the telephony edge. How media flows for Bland-owned/Twilio-hosted numbers is not documented.

### Cited Findings
- SIP media: codecs "PCMU (G.711 μ-law), PCMA (G.711 A-law), Opus, G.722" plus "G.729 via advanced configuration"; SRTP `AES_CM_128_HMAC_SHA1_80`; UDP 16384–32768; four regions each with 4 static media IPs — [SIP Integration](https://docs.bland.ai/enterprise-features/SIP-integration); [Agents → SIP](https://docs.bland.ai/agents/sip)
- Outbound HTTP (webhooks/tools) egress is "based on your organization's residency" from: Oregon (us-west-2) 44.246.155.79, 54.190.223.101; Canada Central (ca-central-1) 3.98.29.197, 52.60.150.249; Sydney (ap-southeast-2) 13.210.163.103, 3.105.64.237; Ireland (eu-west-1) 34.248.58.192, 54.73.237.185; plus Cloudflare egress proxies 104.28.1.169/32, .170/32, .204/32, .205/32; "SIP signaling and media use separate IPs" — [Static IPs](https://docs.bland.ai/platform/static-ips)
- Status page components are grouped by region: US (API, "AWS ec2-us-west-2", "Cloudflare Load Balancing and Monitoring"), Asia Pacific (API, "AWS ec2-ap-southeast-2"), Canada (API, "AWS ec2-ca-central-1") — [status.bland.ai](https://status.bland.ai/); mirrored by [StatusGator's component list](https://statusgator.com/services/bland)
- Realtime TTS audio configurations documented: "48 kHz PCM s16le" ("each second of mono audio is 96,000 bytes") and "8 kHz mu-law" ("each second is 8,000 bytes"); "48 kHz PCM explicitly recommended as the native rendering rate" — [Realtime TTS concepts](https://docs.bland.ai/tts/realtime-concepts); [Bland Speech welcome](https://docs.bland.ai/tts/welcome)
- Product page deployment options: "Dedicated infrastructure, never shared. Bland Cloud, your VPC, or air-gapped on your hardware."; "AWS · GCP · Azure — Bland runs inside your network. No customer audio leaves."; regions "US, EU, and APAC. Per-region deployment for sovereign workloads."; "Bland Cloud Multi-region · SOC 2 II · HIPAA — Default for most teams." — [bland.ai/product](https://www.bland.ai/product) (Bland marketing claim)
- Enterprise doc: "Every enterprise customer on Bland runs on their own isolated infrastructure — dedicated compute, dedicated containers, and dedicated resources" — "real, provisioned Kubernetes pods exclusive to each organization (not logical partitions)", "no noisy neighbors"; zero-downtime rolling updates "without dropping calls" — [Infrastructure & Releases](https://docs.bland.ai/enterprise-features/infrastructure-and-releases)
- Contrast — Twilio Media Streams: payload "must be encoded `audio/x-mulaw` with a sample rate of `8000`", mono, base64, no file headers; `mark` (playback-complete tracking) and `clear` (empties buffered audio) exist only on bidirectional streams — [Twilio Media Streams WebSocket messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages)

### Inferences
- Bland's production compute is on AWS EC2 in four regions fronted by Cloudflare (documented IPs + status components). The "1M+ concurrent" and "dedicated GPU" claims are not tied to any named GPU cloud in current material; the earlier Baseten case study (see Q3) shows at least part of inference was once on a third-party inference platform.
- Because SIP media terminates on Bland-operated IPs in the same AWS regions where its API and (presumably) models run, the audio path is: carrier/PBX → Bland SBC (SRTP) → co-located STT/LLM/TTS → back out, i.e. one media hop and no intermediate WebSocket relay. A Twilio Media Streams pipeline instead has carrier → Twilio media server → WSS (8 kHz μ-law, base64) → your server → OpenAI Realtime (another WSS hop) → back — at least two extra serialization hops and a fixed narrowband codec.
- TTS rendered at 48 kHz and downsampled to 8 kHz μ-law at the edge means Bland's synthesis quality is not codec-limited until the last hop; Opus/G.722 on SIP trunks preserve wideband end-to-end.
- No document mentions jitter buffers, packet-loss concealment, or audio pacing; these are presumably handled inside the SBC/media layer (standard for RTP stacks) but are undocumented.

### Gaps
- Media path for Bland-owned and BYOT numbers (SIP vs Media Streams) is not documented.
- No named media-server technology (FreeSWITCH/Kamailio/rtpengine/custom) found in docs, blogs, or job posts.
- No jitter-buffer, PLC, or pacing documentation.

---

## Key question 3 — Inference stack: self-hosted models, own STT/LLM/TTS, GPUs, latency claims, model options, 2025–2026 announcements

### Takeaway
Bland claims (consistently since 2025) proprietary STT ("Babel"), LLM and TTS ("BTTS", now "Bland Speech v3") that run on its own/dedicated GPUs, with "under 400 ms" end-to-end latency. Documented technical detail exists for STT (A100s, custom CUDA kernels, micro-batching, sub-100 ms TTFT) and TTS (decoder-only transformer over SNAC audio tokens, trained in-house). A now-deleted Baseten case study shows Bland previously ran inference on Baseten to get from ~3 s to <400 ms. Third-party observers put real-world latency at ~700–900 ms; no independent, repeated-run benchmark of Bland exists.

### Cited Findings

**"Own the stack" claims (first-party)**
- "Proprietary models (transcription, LLM, TTS)"; "Bland built every layer of the voice AI stack"; "Customer data never touches OpenAI, Anthropic, or any third-party provider"; "End-to-end latency: Under 400ms" — [Bland vs Retell comparison page](https://www.bland.ai/compare/bland-vs-retell) (Bland marketing claim)
- "Sub-second response time. Optimized for natural conversation pacing."; "1 million+ simultaneous call capacity."; "40+ languages supported natively"; "Bland does not share customer call data with third-party AI model providers." — [bland.ai/ai-information](https://www.bland.ai/ai-information) (Bland marketing claim)
- Granet (interview, 2026-04-06): "Every layer you outsource adds latency and adds risk."; Bland hosts "its own transcription, inference (LLM), and text-to-speech systems"; "Most voice AI platforms are resellers"; "Responses need to come back in under 400 milliseconds."; enterprise deployment "in their own VPC or on-premises" — [Unite.ai interview](https://www.unite.ai/isaiah-n-granet-co-founder-and-ceo-of-bland-interview-series/)
- Series C blog (2026-06-16): "we build our own models, in-house, purpose-built for voice"; "Voice conversations have quirks – latency, interruptions, curveballs – that those models just weren't designed for."; "3.5+ million calls weekly" — [Series C blog](https://www.bland.ai/blog/series-c)
- SiliconANGLE (2026-06-16): "Bland runs on voice models it built itself. Customers cannot swap in models from other providers."; "Owning the models lets Bland tune for the messy parts of a live call, such as latency, interruptions and ambiguity."; "A typical Bland call runs 30 to 45 minutes."; "upward of 3.5 million calls a week" and "more than 175 million" last year — [SiliconANGLE](https://siliconangle.com/?p=772354)
- Emergence Capital (Series B memo, 2025-01-29): platform is "Fully self-hosted" and meets "HIPAA and GDPR" — [Emergence Capital](https://www.emcap.com/thoughts/ai-that-speaks-volumes-why-were-backing-bland)
- Series B announcement (Jan 2025): "Bland built its infrastructure in-house to deliver a low-latency, secure, and highly customizable platform capable of handling millions of simultaneous calls" — [Bland Series B blog](https://www.bland.ai/blog/bland-raises-a-40m-series-b)
- Product page shows a metrics widget: "p50 latency 380ms" (production) / "p50 latency 365ms" (canary), completion "98.4%" / "99.1%", with call counts — [bland.ai/product](https://www.bland.ai/product) (Bland marketing; likely illustrative, not verifiable)

**STT — Bland Babel (documented technical blog)**
- Blog "Bland Babel", published 2025-02-13 (updated 2026-05-21), author Isaiah Granet: multilingual STT run on "NVIDIA A100 GPUs" with "custom CUDA kernels", exploitation of "1.5 TB/s HBM2" bandwidth and "dynamic micro-batching"; "sub-100ms Time To First Token (TTFT)" with "first recognizable text emerging in just a few hundred milliseconds end-to-end"; noise handling via "dynamic Signal-to-Noise Ratio (SNR) estimation" and "aggressive noise suppression for low-SNR scenarios"; code-switching and parallel language-ID inference; future goal of "embedding-level integration" of STT into LLM inference — [Bland Babel blog](https://www.bland.ai/blog/bland-babel-ai-transcription-optimization)
- Send Call default `language: "babel-en"` — "Optimizes every part of our API for that language - transcription, speech, and other inner workings."; `keywords` "will be boosted in the transcription engine" — [Send Call](https://docs.bland.ai/api-v1/post/calls)

**TTS — BTTS / Bland Speech (documented)**
- Blog 2025-06-04 (updated 2026-05-21), Granet: "decoder-only transformer" that "directly predicts audio tokens from text input using a SNAC ... tokenizer"; "trained in-house" on proprietary "two-channel conversational audio"; few-shot cloning with 3–6 examples; style markers such as `<excited>`, `<calm>`; no latency figures disclosed — [New TTS announcement](https://www.bland.ai/blog/new-tts-announcement)
- Product changelog: 2026-03-11 standalone TTS product launched; 2026-04-30 "BTTS Experimental Voice Cloning" with "48 kHz high quality audio with broad multilingual support"; 2026-07-21 "Agent Speech Timing: Interruptibility & Resumption Speed"; 2026-08-03 "Adaptive resumption and node-scoped interruptibility" — [bland.ai/changelog](https://www.bland.ai/changelog); [docs changelog 2026-08-03](https://docs.bland.ai/changelog/08_03_2026)
- Realtime TTS API: `WSS /v2/tts/ws`, `POST /v2/tts`, OpenAI-compatible `POST /audio-speech`; "BTTS_V3 voice model mentioned for optimal performance"; billed per character — [Bland Speech welcome](https://docs.bland.ai/tts/welcome)
- Third-party model listings: "Bland Speech v3" released 2026-08-05, proprietary; claims "trained on 100M+ real phone conversations", keeps "breaths, hesitations, and fillers", tops "Audio Realism Bench at 1365 Elo" — [benchlm.ai](https://www.benchlm.ai/models/bland-speech-v3); [anotherwrapper comparison](https://anotherwrapper.com/tools/llm-pricing/speech-models/compare/bland-speech-v3/turbo-v2) (aggregators repeating Bland's claims)
- Status page incident 2026-09-25: "BTTS V3 voice generation experienced failures causing 'delayed or missing agent audio'" in two windows (8:10 PM–2:00 AM PT and 6:25–8:35 AM PT); "affected service was restarted at 8:20 AM, resolving the problem by 8:35 AM PT" — [status.bland.ai](https://status.bland.ai/)

**LLM**
- Only first-party statements exist: "Proprietary models (transcription, LLM, TTS)" ([Bland vs Retell](https://www.bland.ai/compare/bland-vs-retell)); Retell describes Bland's LLM as "Plan-gated" ([Retell benchmark blog](https://www.retellai.com/blog/retell-vs-bland-vs-vapi-vs-elevenlabs), competitor). No architecture, size, base model, or hosting detail published.

**Model selector (`model` parameter)**
- Bland University lesson: Base model "follows scripts/procedures most effectively", "Supports all features and capabilities", "Best for custom tools"; Turbo "The fastest latency possible", "Extremely realistic conversation capabilities", "Limited capabilities currently (excludes transferring, IVR navigation, custom tools)", "Turbo is not always a better selection than Base"; the section is titled "Three Bland Phone Models" but only Base and Turbo are described — [Bland University module 1 lesson 4](https://university.bland.ai/modules/1/lesson-4)
- Search snippet (PyPI `bland` client docs): models "base, enhanced, and turbo"; "the enhanced model offers much faster latency and supports complex conversations"; example `model="enhanced"` — [PyPI bland 0.2.1](https://pypi.org/project/bland/0.2.1) (snippet only; not fetched)
- "Bland Turbo" launched on Product Hunt 2024-01-08: "Send or receive up to 500,000+ phone calls simultaneously", "Responds at human level speed" — [hunted.space launch record](https://hunted.space/product/bland-ai/launches/bland-turbo)
- The Send Call reference fetched 2026-09-29 did **not** list a `model` parameter in the extracted parameter set — [Send Call](https://docs.bland.ai/api-v1/post/calls)

**Baseten (third-party inference platform) — documented, but page removed**
- Case study titled "Bland AI breaks latency barriers with record-setting speed using Baseten" (executive quoted: Isaiah Granet) is still listed on an aggregator — [casestudies.com Baseten listing](https://www.casestudies.com/company/baseten); the original [baseten.co/customers/blandai](https://baseten.co/customers/blandai) returns 404 (checked 2026-09-29, both hosts)
- Surviving snippet text: "under 400 milliseconds latency, 50x growth in usage, and 100% uptime to date"; "Initially, response delays were as high as three seconds"; "unless they could get AI responses under 400 milliseconds, the experience wouldn't be good enough"; "usage growing by 50x in just five months" — search snippet for [baseten.co/customers/blandai](https://baseten.co/customers/blandai) (undated; content consistent with the Jan-2024 Turbo era)

**Third-party latency observations (all competitor or aggregator sources)**
- Retell benchmark blog: "Bland does not appear in Cekura published cohorts, and we found no repeated-run independent benchmark covering it"; "Hands-on review from Cekura puts Bland latency in the 700 to 900ms range" (flagged as "a reviewer observation rather than a harness result"); Bland "runs self-hosted models on dedicated GPUs" — [Retell benchmark blog](https://www.retellai.com/blog/retell-vs-bland-vs-vapi-vs-elevenlabs) (competitor)
- Retell "Vapi vs Bland": Bland "claims sub-400ms (Turbo mode) with a measured range of 700ms to 1,500ms and up to 2,500ms in stress tests" — [Retell Vapi-vs-Bland blog](https://www.retellai.com/blog/vapi-vs-bland) (competitor; methodology not shown)
- Retell "Bland AI reviews": "800ms average latency", voices "robotic" — [Retell reviews blog](https://www.retellai.com/blog/bland-ai-reviews) (competitor editorial, no platform reviews quoted)

### Inferences
- The Baseten case study is the strongest evidence that "self-hosted on our own GPUs" was, at least during 2024, "hosted on a dedicated inference platform"; its removal plus the 2025 Babel blog naming A100s and custom kernels suggests Bland has since internalised serving. Whether GPUs are Bland-owned bare metal or rented cloud GPUs is not documented (the "bare metal" phrasing surfaced only in a search summary with no traceable source — treat as unverified).
- The `model: base|turbo|enhanced` selector appears to be legacy (2024–2025); by mid-2026 the public Send Call reference no longer surfaces it, consistent with a single in-house model line. Confidence: medium (extraction could have omitted it).
- Bland's "under 400 ms" is an internal target/p50 marketing figure; the only external observations cluster at 700–900 ms, which is roughly what a well-tuned OpenAI Realtime pipeline also achieves. The differentiator Bland sells is variance and control (co-location, dedicated pods, version pinning), not a categorically lower floor.
- The 2026-09-25 incident shows Bland's failure mode for "choppy/missing audio" was TTS-service starvation — a useful diagnostic analogue: missing/late audio frames on the outbound leg often come from the synthesis stage, not the network.

### Gaps
- No public detail on the LLM (size, base, fine-tuning, serving stack) or on GPU ownership/location.
- No first-party latency methodology or p95/p99 figures; no independent repeated-run benchmark of Bland found.
- Exact date and full text of the Baseten case study unavailable (page removed; archive not fetchable).
- Earlier third-party providers (ElevenLabs/Deepgram/OpenAI in 2023–2024) are widely assumed but I found no primary source confirming which vendors Bland used before its in-house models.

---

## Key question 4 — Turn-taking harness: interruptions, endpointing, greeting, background track, noise, barge-in cut-off

### Takeaway
Bland's harness (as of Aug 2026) exposes: `interruptibility` (0–4, default 2) for barge-in yielding with acknowledgement-vs-interruption classification and word-boundary stops; `interruption_threshold` (default 500) for end-of-turn patience; adaptive "Resumption" that learns each caller's pacing (up to ~2.5 s patience, re-adapts within ~15 s); `wait_for_greeting`, `first_sentence`, `block_interruptions`, `background_track`, `noise_cancellation` (default true), `keywords`, `pronunciation_guide`. Nothing about jitter buffers, packet loss, or audio smoothing is documented.

### Cited Findings
- `interruption_threshold` (number, default 500): "Adjusts how patient the AI is when waiting for the user to finish speaking. Lower values mean the AI will respond more quickly." — [Send Call](https://docs.bland.ai/api-v1/post/calls)
- `interruptibility` (integer, default 2): "Controls how readily the AI stops speaking when the caller talks over it. A higher value yields more easily; a lower value holds the turn." — [Send Call](https://docs.bland.ai/api-v1/post/calls)
- Levels: `4` Always interrupt ("Any caller speech stops the agent"), `3` Easy ("only brief acknowledgments are spoken through"), `2` Balanced (default; "distinguishes acknowledgments from real interruptions"), `1` Difficult ("Treats more speech as acknowledgment; suits noisy environments"), `0` Block ("Agent ignores caller speech while speaking"); settable on Send Call, inbound number config, or per Pathway node (Advanced options) — [Agent Speech tutorial](https://docs.bland.ai/tutorials/agent-speech)
- Barge-in mechanics: "The agent doesn't cut off immediately—it finishes the current word while determining whether the caller is interrupting or acknowledging."; "Short acknowledgments are spoken through entirely"; "Long acknowledgments trigger a pause, then the agent resumes exactly where it stopped"; "The agent always stops at a word boundary. It never cuts off mid-word." — [Agent Speech tutorial](https://docs.bland.ai/tutorials/agent-speech)
- Resumption/endpointing: "adaptive and requires no configuration"; "The agent measures each caller's pace and matches it automatically."; fast callers get "near-instant responses", deliberate callers get "patience up to approximately 2.5 seconds"; adapts "within about 15 seconds if a caller changes pace" — [Agent Speech tutorial](https://docs.bland.ai/tutorials/agent-speech); changelog 2026-07-21 added a "Resumption Speed setting (Slow, Medium, Fast)" and 2026-08-03 "Adaptive resumption and node-scoped interruptibility" — [bland.ai/changelog](https://www.bland.ai/changelog)
- `block_interruptions` (boolean, default false): "When set to true, the AI will not respond or process interruptions from the user." — [Send Call](https://docs.bland.ai/api-v1/post/calls)
- `wait_for_greeting` (boolean, default false): "By default, the agent starts talking as soon as the call connects. When wait_for_greeting is set to true, the agent will wait for the call recipient to speak first before responding." `first_sentence` (string): "Makes your agent say a specific phrase or sentence for it's first response." — [Send Call](https://docs.bland.ai/api-v1/post/calls)
- `background_track` (string, default null): "Select an audio track that you'd like to play in the background during the call. The audio will play continuously when the agent isn't speaking." `noise_cancellation` (boolean, default true): "Toggles noise filtering or suppression in the audio stream to filter out background noise." — [Send Call](https://docs.bland.ai/api-v1/post/calls)
- Other harness parameters: `voicemail` object ("detect voicemails more intelligently using AI"), `precall_dtmf_sequence` (0-9,*,#, `w` = 0.5 s pause), `ignore_button_press`, `pronunciation_guide`, `keywords`, `max_duration` (default 30 min), `temperature` (default 0.7), `timezone` — [Send Call](https://docs.bland.ai/api-v1/post/calls)
- Changelog 2025-05-02: "Optimized noise cancellation for clearer conversations"; "enhanced call interruption handling during webhooks"; "Transcription connection issues resolved" — [docs changelog 2025-05-02](https://docs.bland.ai/changelog/05_02_2025)
- TTS-side cancellation primitive (standalone realtime TTS API, same engine family): a new `context_id` on `speak` "immediately preempts the active turn"; `cancel` "stops synthesis without replacement text ready"; preempted turns return `utterance_end` with reason `preempted`; "Clients must discard unplayed audio locally after preemption"; Bland "accumulates the deltas, detects useful speech boundaries, and releases text to synthesis" (no manual flush thresholds); "Exactly one turn is active at a time" — [Realtime TTS concepts](https://docs.bland.ai/tts/realtime-concepts)
- STT-side noise handling: "dynamic SNR estimation with adaptive frequency analysis and aggressive noise suppression for low-SNR scenarios" — [Bland Babel blog](https://www.bland.ai/blog/bland-babel-ai-transcription-optimization)

### Inferences
- Bland's `interruption_threshold` is an **end-of-turn silence patience** knob (units not stated in the fetched extract; the default 500 and "lower = responds more quickly" imply milliseconds), not a barge-in sensitivity — barge-in is `interruptibility`. Teams porting OpenAI Realtime's `turn_detection.silence_duration_ms` / `threshold` should map them to these two separately.
- The "acknowledgement vs interruption" classification and "always stop at a word boundary" imply the harness (a) keeps a word-timestamped playout map of TTS audio so it can stop at boundaries and resume "exactly where it stopped", and (b) runs a short classifier on the caller's overlapping speech before deciding to cut. This is a deliberate trade of ~one word of extra latency on barge-in for fewer false cuts — the opposite of the immediate `clear` + `response.cancel` pattern common in Twilio + OpenAI Realtime pipelines.
- `background_track` "plays continuously when the agent isn't speaking" doubles as comfort noise; it masks small gaps that would otherwise be perceived as cut-outs.
- The absence of any jitter/PLC documentation is expected: those live in the SIP/RTP media layer and are not user-tunable.

### Gaps
- Units and permitted range of `interruption_threshold` not shown in the fetched extract.
- Details of the acknowledgement classifier, endpointing model, and how STT partials drive the LLM (streaming vs. finalised) are undocumented.
- No documentation of jitter buffers, packet-loss concealment, or outbound audio pacing.

---

## Key question 5 — Reliability: status page, uptime, incidents, rate limits, concurrency, regions, compliance, dedicated deployment

### Takeaway
Bland runs a public status page (status.bland.ai) with components per region on AWS + Cloudflare; the only incident retrievable was a 2026-09-25 BTTS V3 audio outage. Enterprise customers get isolated Kubernetes pods, version-pinned releases, rolling updates and canary routing. Compliance: SOC 2 Type II, HIPAA BAA, GDPR DPA, PCI DSS v4.0. Documented rate limits exist only for the standalone speech API (concurrency slots); call-API concurrency limits are not published.

### Cited Findings
- Status page: "All Systems Operational"; components grouped US / Asia Pacific / Canada (API, AWS EC2 regions, Cloudflare LB); 90-day uptime link present but percentages not rendered in the fetched content; single retrievable incident 2026-09-25 (BTTS V3, "delayed or missing agent audio") — [status.bland.ai](https://status.bland.ai/)
- StatusGator began monitoring Bland on 2026-06-26; one user report ("not placing calls", Texas) on 2026-07-01; 0 reports in the last 24 h — [StatusGator](https://statusgator.com/services/bland)
- Dedicated infra and release control: per-customer "real, provisioned Kubernetes pods"; "Your infrastructure stays on the version you've selected until you decide to move forward. No surprise upgrades"; rolling updates that don't drop calls; canary at "1%, 25%, 50%, 100%" or by phone number/org/agent — [Infrastructure & Releases](https://docs.bland.ai/enterprise-features/infrastructure-and-releases)
- Compliance/security: "SOC 2 Type II", "HIPAA BAA", "GDPR DPA", "PCI DSS v4.0" (all marked audited); "AES-256 at rest. TLS 1.3 in transit. HSM-backed keys."; "PII redaction in transcripts. Configurable retention." — [bland.ai/product](https://www.bland.ai/product) (Bland marketing claim); enterprise page: "1M+ concurrent calls in production", "250+ enterprise customers" — [bland.ai/for-enterprises](https://bland.ai/for-enterprises)
- Speech API limits: "1 concurrent generation" before first top-up, "5 concurrent generations" after $5 top-up, across WebSocket, HTTP and shared links; over-limit returns HTTP 429 "You're at 5 concurrent generations. Email tts@bland.ai to raise your limit."; described as "not ordinary rate limiting" (capacity reservation) — [Speech limits](https://docs.bland.ai/speech/limits)
- Static egress IPs per residency region + Cloudflare proxies; allowlist both "to avoid intermittent 403 errors" — [Static IPs](https://docs.bland.ai/platform/static-ips)
- Enterprise SSO and JWT signature configuration pages exist — [docs.bland.ai/llms.txt](https://docs.bland.ai/llms.txt)
- A search snippet attributed "99.99% uptime" to the enterprise page, but the fetched page did not contain that figure — unverified.

### Inferences
- The status page's incident list being effectively empty before Sept 2026 more likely reflects a recently launched/reset status page (StatusGator only began tracking in June 2026) than a clean history.
- The status components (EC2 per region + Cloudflare, no telephony-provider component) suggest Bland does not publicly surface carrier-side incidents; telephony degradation would appear (if at all) under "API".

### Gaps
- No published call-API rate limits or per-plan call concurrency; no SLA document; no historical uptime percentages retrievable; no 2024–2025 incident history.

---

## Key question 6 — Company/engineering signals: blogs, talks, funding, jobs, repos

### Takeaway
Bland's engineering narrative is consistent and CEO-driven (Isaiah Granet authors the technical blogs): "every layer you outsource adds latency", in-house STT/LLM/TTS, dedicated infrastructure. Funding: $16M Series A (Aug 2024, Scale VP), $40M Series B (Jan 2025, Emergence), $50M Series C (Jun 2026, Dell Technologies Capital), >$100M total. No telephony-specific job posts (SIP/FreeSWITCH/media server) or public infra repos were found.

### Cited Findings
- Series A: $16M led by Scale Venture Partners, total $22M, angels Max Levchin, Piotr Dąbkowski, Jeff Lawson (Aug 2024) — [Scale VP press](https://www.scalevp.com/press/bland-ai-emerges-from-stealth-with--16m-series-a-led-by-scale-venture-partners); [VentureBeat](https://venturebeat.com/ai/bland-ai-scores-16m-to-automate-enterprise-phone-calls-with-agents)
- Series B: $40M led by Emergence Capital, total $65M; "pre-seed to Series B in under ten months"; customers named Cleveland Cavaliers, Better.com — [Bland Series B blog](https://www.bland.ai/blog/bland-raises-a-40m-series-b); [Emergence memo 2025-01-29](https://www.emcap.com/thoughts/ai-that-speaks-volumes-why-were-backing-bland)
- Series C: $50M led by Dell Technologies Capital with HubSpot Ventures, Archerman, Tribeca, Emergence, Upfront, Scale, YC, Levchin, Dąbkowski, Lawson; closed 2026-06-16; use: "expand its research, grow its engineering team and scale its platform into more regulated industries" — [SiliconANGLE](https://siliconangle.com/?p=772354); [raising.fi](https://raising.fi/news/bland-series-c-june-2026); [Bland Series C blog](https://www.bland.ai/blog/series-c)
- CEO technical blogs: Babel STT (2025-02-13), new TTS engine (2025-06-04) — [Babel](https://www.bland.ai/blog/bland-babel-ai-transcription-optimization); [TTS](https://www.bland.ai/blog/new-tts-announcement)
- Interviews: Unite.ai (2026-04-06) — "Most voice AI platforms are resellers"; data "pass[ing] through infrastructure you can't audit"; sub-400 ms target — [Unite.ai](https://www.unite.ai/isaiah-n-granet-co-founder-and-ceo-of-bland-interview-series/). Search snippets attribute to Granet that Bland "stopped using OpenAI, Anthropic, and other models and decided to build their own using open-source technology" and that early latency "was four to five seconds" — [Alejandro Cremades podcast page](https://alejandrocremades.com/isaiah-granet/) (snippet only, page not fetched)
- Computer Weekly column "Human parity is the wrong benchmark for voice AI" exists but returned HTTP 403 — [Computer Weekly](https://www.computerweekly.com/blog/CW-Developer-Network/Bland-co-founder-Human-parity-is-the-wrong-benchmark-for-voice-AI) (not retrievable)
- Jobs: a generic "Senior Software Engineer" posting describes working "across their stack"; no SIP/FreeSWITCH/Kamailio/media-server role found in search — [voiceaispace listing](https://www.voiceaispace.com/jobs/133f5826-2f26-4e6a-a3af-1753dde04451)
- Marketing "alternative" pages exist against Deepgram and ElevenLabs, signalling Bland positions its STT and TTS as standalone competitors — [Bland vs Deepgram](https://www.bland.ai/alternatives/deepgram); ElevenLabs' counter-page [ElevenLabs vs Bland](https://elevenlabs.io/blog/elevenlabs-vs-blandai) (competitor)

### Inferences
- Piotr Dąbkowski (ElevenLabs co-founder) and Jeff Lawson (Twilio co-founder) as repeat angels is consistent with Bland having started on ElevenLabs + Twilio and later internalising TTS; it does not confirm current vendor relationships.
- Dell Technologies Capital leading the Series C aligns with the "air-gapped on your hardware" / on-prem enterprise pitch.

### Gaps
- No engineering talks, conference slides, or public GitHub infrastructure repos found; no telephony-specific job postings found.

---

## Key question 7 — How peers describe their telephony layer (standard vs Bland-specific)

### Takeaway
Every major peer offers (a) platform-provided numbers on the platform's own carrier accounts and (b) SIP trunking / number import from Twilio, Telnyx, Vonage and others. Bland-specific elements are the Twilio-credential BYOT flow (`encrypted_key`), first-class number porting into Bland, and the Twilio Studio Flow TwiML widget; SIP-edge features (TLS/SRTP, regional endpoints, G.711/G.722/Opus) are industry standard.

### Cited Findings
- **Vapi**: free numbers are on "Vapi's own carrier accounts" ("no account number or port-out PIN"), "use US area codes and support US national calling only", "inbound only", one per account; BYO SIP trunk supports "Plivo, Telnyx, Zadarma" plus custom BYO; endpoints `sip.vapi.ai` (44.229.228.186/32, 44.238.177.138/32) and `sip.eu.vapi.ai` (63.182.83.170/32); "Keep the API region and SIP host in the same region" — [Vapi free telephony](https://docs.vapi.ai/free-telephony); [Vapi BYO SIP trunk](https://docs.vapi.ai/advanced/sip/sip-trunk); [Vapi SIP](https://docs.vapi.ai/advanced/sip)
- **Retell**: import numbers from "Twilio, Telnyx, and Vonage" via elastic SIP trunking ("The recommended option"); `sip:sip.retellai.com`; transports TCP (recommended), UDP, TLS, mTLS; codecs "PCMU, PCMA, G.722(HD)" + SRTP; IP blocks 18.98.16.120/30, 3.42.144.0/23, 153.57.128.0/18; dial within 5 minutes of Register Phone Call — [Retell custom telephony](https://docs.retellai.com/deploy/custom-telephony); Retell prices telephony at "$0.015/min or own SIP" — [Retell benchmark blog](https://www.retellai.com/blog/retell-vs-bland-vs-vapi-vs-elevenlabs)
- **ElevenLabs Agents**: SIP trunking "compatible with most standard SIP trunk providers including Twilio, Vonage, RingCentral, Sinch, Infobip, Telnyx, Exotel, Plivo, Bandwidth"; "outputs and receives audio using the PCMU or PCMA (G.711, 8kHz) or G.722 (16kHz) codecs"; TLS 1.2+; `sip-static.rtc.elevenlabs.io` and residency endpoints `sip-static.rtc.<region>.residency.elevenlabs.io`; concurrency by plan with optional call queueing — [ElevenLabs SIP trunking](https://elevenlabs.io/docs/agents-platform/phone-numbers/sip-trunking)
- **Synthflow**: SIP "available only on the Enterprise plan"; Tier 1 native integrations "Twilio, Telnyx, RingCentral, Vonage"; elastic SIP trunking recommended; BYON/PBX (3CX, Asterisk) — [Synthflow SIP](https://docs.synthflow.ai/about-sip); [Synthflow telephony](https://docs.synthflow.ai/about-telephony)
- **Bland** (for comparison): SIP enterprise-gated; regional `*.sip.bland.ai`; TLS 5061 only; SRTP only; PCMU/PCMA/Opus/G.722(/G.729); porting into Bland; BYOT via Twilio credentials — [SIP Integration](https://docs.bland.ai/enterprise-features/SIP-integration); [Custom Twilio](https://docs.bland.ai/tutorials/custom-twilio)

### Inferences
- Standard across the category: regional SIP edges on AWS-class IPs, G.711/G.722 (+Opus at Bland), SRTP/TLS, Twilio/Telnyx/Vonage import. Bland's stricter posture (TLS-only, SRTP-only, no UDP signalling) and its porting/discovery tooling are more "carrier-grade" than Vapi/Retell's docs, but not architecturally different.
- None of the peers, including Bland, document owning carrier interconnects; all sit behind CPaaS/carrier partners for PSTN.

### Gaps
- Vapi's Twilio/Vonage import pages and SIP networking (codec/TLS) page were not fetched (404 on the URL tried; referenced pages exist).

---

## Key question 8 — What Bland does differently from an OpenAI Realtime + Twilio Media Streams pipeline (synthesis for the engineering team)

### Takeaway
The material differences are (1) where media terminates (Bland: its own SIP/SRTP edge co-located with inference; you: Twilio media server → WSS relay → your server → OpenAI WSS), (2) codec/sample-rate path (Bland: wideband synthesis at 48 kHz, Opus/G.722 possible on SIP; you: fixed 8 kHz μ-law both ways), (3) an in-house TTS with explicit preemption/boundary-detect buffering and word-boundary barge-in, and (4) per-tenant isolated pods with version pinning and canaries. Bland still has TTS-driven audio outages, so "own stack" is not a guarantee.

### Cited Findings
- Twilio Media Streams constraints: `audio/x-mulaw` at 8000 Hz mono base64; `mark`/`clear` only on bidirectional streams — [Twilio docs](https://www.twilio.com/docs/voice/media-streams/websocket-messages)
- Bland SIP media: SRTP into regional media IPs; codecs PCMU/PCMA/Opus/G.722 — [SIP Integration](https://docs.bland.ai/enterprise-features/SIP-integration)
- Bland TTS: native 48 kHz PCM, 8 kHz μ-law output option; `context_id` preemption; "accumulates the deltas, detects useful speech boundaries, and releases text to synthesis" — [Realtime TTS concepts](https://docs.bland.ai/tts/realtime-concepts)
- Bland barge-in: word-boundary stops, acknowledgement classification, adaptive endpointing up to ~2.5 s — [Agent Speech](https://docs.bland.ai/tutorials/agent-speech)
- Bland isolation: dedicated Kubernetes pods, version pinning, rolling + canary releases — [Infrastructure & Releases](https://docs.bland.ai/enterprise-features/infrastructure-and-releases)
- Bland hosting: AWS us-west-2 / ca-central-1 / ap-southeast-2 / eu-west-1 + Cloudflare — [Static IPs](https://docs.bland.ai/platform/static-ips); [status.bland.ai](https://status.bland.ai/)
- Bland incident 2026-09-25: TTS (BTTS V3) failures → "delayed or missing agent audio" — [status.bland.ai](https://status.bland.ai/)
- Reported real-world Bland latency 700–900 ms (competitor-attributed reviewer observation) vs Bland's "under 400ms" claim — [Retell benchmark blog](https://www.retellai.com/blog/retell-vs-bland-vs-vapi-vs-elevenlabs); [Bland vs Retell](https://www.bland.ai/compare/bland-vs-retell)

### Inferences
- Hop count and serialization: a Twilio Media Streams pipeline base64-encodes 8 kHz μ-law over WSS to your server and then re-frames to OpenAI Realtime over a second WSS; each hop adds buffering and a point where a slow event loop, GC pause, or backpressure produces gaps that the phone hears as choppiness. Bland's SIP path has one RTP termination adjacent to inference and no text/JSON re-encoding of audio.
- Outbound pacing: Twilio expects a steady real-time μ-law stream; bursts followed by starvation (e.g., forwarding OpenAI audio deltas as they arrive, or blocking while awaiting the next delta) produce cut-outs. Bland's TTS protocol explicitly separates synthesis from delivery ("text still buffered ... without delivering a frame is not billed"), which implies a playout buffer between synthesis and the wire — the pattern to replicate is a jitter/playout buffer that emits fixed 20 ms frames regardless of upstream burstiness.
- Barge-in: immediate `clear` on any VAD trigger causes false cuts on backchannels ("uh-huh"); Bland's default behaviour spends ~one word deciding. A short classification window plus word-boundary stopping reduces both perceived cut-outs and talk-over.
- Region alignment: Bland pins compute and SIP edge per residency region; a Twilio + OpenAI pipeline should likewise pin Twilio's media region, your server, and the OpenAI endpoint to one geography (Vapi documents the same "same region" rule for its SIP host and API).
- Telephony carrier is not the differentiator: Bland is reported (by competitors) to ride Twilio/SIP partners for PSTN, so switching carriers is unlikely to fix intermittent choppiness on its own; the media-termination point, pacing, and TTS supply stability are.

### Gaps
- Bland does not publish its internal audio pipeline (frame sizes, buffer depths, how STT partials gate LLM/TTS), so the above is inferred from its external protocol surface and the standard behaviour of RTP/SIP stacks.
- The Twilio page fetched did not state frame duration; Twilio's 20 ms/160-byte framing is well known but not cited here.
