"""Environment-backed configuration, validated once at load.

This app is an experimental alternative to the Retell voice agent: it runs the TecAce
lead-callback conversation on the OpenAI Realtime API, bridged to the phone network with
Twilio Media Streams. It reuses the SAME shared backend `/agent/*` tools the Retell agent
uses (check availability, book, callback, mark outcome) — it just owns the voice layer itself.

Nothing is required at import time, so the process starts even with a partial .env; the
entrypoints surface what's missing via `Config.missing()`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# src/openai_agent/config/settings.py -> project root is four levels up.
PROJECT_ROOT = Path(__file__).resolve().parents[3]

load_dotenv(PROJECT_ROOT / ".env")


class ConfigError(RuntimeError):
    """A required setting is missing or malformed."""


def _optional(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip() or default


@dataclass(frozen=True)
class Config:
    # ---- The media-stream server ----
    port: int
    # Public host Twilio's <Stream> connects back to (no scheme), e.g. an ngrok host:
    # "abc123.ngrok-free.app". The outbound TwiML builds wss://<host>/media-stream from it.
    public_host: str
    # ---- Shared backend tools (same service the Retell agent calls) ----
    backend_url: str
    agent_tools_secret: str  # sent as the x-agent-secret header
    # ---- OpenAI Realtime ----
    openai_api_key: str
    openai_model: str
    openai_voice: str
    openai_transcribe_model: str
    # ---- OpenAI GPT-Live ----
    # Set (e.g. "gpt-live-1") to run every call on GPT-Live instead of Realtime; blank = Realtime,
    # exactly as before. GPT-Live is a different API, not just a different model, so it has its own
    # bridge (realtime/live_bridge.py). While it is set, openai_model, openai_transcribe_model and
    # the vad_* settings are unused.
    openai_live_model: str
    # The text model GPT-Live delegates tool calls to.
    openai_live_backend_model: str
    # That model's reasoning effort; "default" = don't send one.
    openai_live_reasoning_effort: str
    # How loud speech must be before the model treats it as the caller talking, and how long a
    # pause must run before it treats their turn as finished. Tunable because the right values
    # depend on the room the caller is standing in, which we cannot know from here.
    # "semantic_vad" judges whether the audio is the caller ADDRESSING the assistant, which is the
    # only turn detection that can tell them apart from the room. "server_vad" is loudness only.
    vad_type: str
    vad_eagerness: str
    vad_threshold: float
    vad_prefix_padding_ms: int
    vad_silence_ms: int
    # ---- Twilio (telephony) ----
    twilio_account_sid: str
    twilio_auth_token: str
    twilio_from_number: str
    # ---- Webhook / stream authentication ----
    # Verify the X-Twilio-Signature on incoming webhooks. Default OFF so turning it on is a
    # deliberate, reversible step: the signature is computed over the URL as TWILIO built it, and
    # behind a reverse proxy a misconfigured PUBLIC_HOST rejects every real call. Switch it on,
    # place one test call, and leave it on.
    validate_twilio_signature: bool
    # A shared secret appended to the media-stream WebSocket path. Without one, anyone who can
    # reach the server can open a WebSocket and run up an OpenAI Realtime session on our key.
    # Blank = no secret required (the pre-existing behavior).
    stream_secret: str
    # ---- Inbound call screening (all optional; unset = outbound-only, exactly as before) ----
    # The colleague a booking request is warm-transferred to.
    human_number: str
    # The company's public main line. Used as the transfer's caller ID (so the handoff doesn't
    # reach the colleague as an unknown, spam-scored number) and as the fallback dial target when
    # the app itself is down. Falls back to twilio_from_number if unset.
    main_line: str
    business_name: str
    agent_name: str
    business_hours: str
    # Optional override for the spoken facts in the inbound prompt, so a different client can be
    # served without a code change.
    business_facts: str
    # Where to ask which customer a dialled number belongs to (transcribe-backend). A DIFFERENT
    # service from backend_url, which is backend-app and serves the booking tools — two URLs and
    # two keys because they are two services, and one credential should not open the other.
    # Unset = every inbound call is answered neutrally.
    # A carrier forwarding a landline to us can demand a keypress before it bridges the caller
    # ("press 1 to accept"). Sent only on calls that ARRIVED FORWARDED, so a direct call never
    # hears a tone. Blank = never send one.
    forward_accept_digit: str
    # When to press, from the moment the media stream opens. The prompt starts a beat after the
    # stream does, so pressing instantly can land before anything is listening.
    forward_accept_delay: float
    forward_announcement_seconds: float
    # DTMF that TWILIO generates, in the TwiML, before the stream starts. 'w' is a half-second
    # wait. Empty disables it.
    forward_accept_twiml_digits: str
    # The old in-band method: tones we synthesise and push through the media stream. Off by
    # default now — see the comment where it is used.
    forward_accept_inband: bool
    # How many times the in-band press is sent, and the gap between them. Both are pure latency:
    # the greeting cannot start until the last press has gone out and the prompt has stopped.
    forward_accept_attempts: int
    forward_accept_gap: float
    business_config_url: str
    agent_config_key: str
    open_hour: int
    close_hour: int
    # Say "this call is recorded" in the inbound greeting. Default ON: the transcript IS persisted,
    # and Washington is a two-party-consent state. Turn off only on legal advice.
    disclose_recording: bool
    # How long a transferred call rings the colleague before the caller is handed back to the
    # agent. Load-bearing: with no keypress on the whisper, a phone that rolls to voicemail will
    # swallow the caller, so this must stay UNDER that phone's rollover time.
    transfer_ring_seconds: int
    # The inbound agent's opening line. `{business}` and `{agent}` are substituted.
    greeting: str
    # ---- Runtime ----
    # How often the poller re-reads the queue WITHOUT being told to. With push notifications this
    # is only a safety net (a lost notification, a restart mid-deploy), so it is deliberately long:
    # every cycle wakes the Neon compute, and an idle drumbeat is what used to keep it billing 24
    # hours a day. Immediate work arrives by notification, not by polling.
    poll_interval: float
    # Port the poller's notification endpoint listens on (separate process from the media-stream
    # server, so a separate port).
    poller_port: int
    timezone: str  # business timezone for spoken dates (matches the backend's SCHEDULE_TIMEZONE)
    request_timeout: float

    @classmethod
    def load(cls) -> Config:
        return cls(
            port=int(_optional("PORT", "5050")),
            public_host=_optional("PUBLIC_HOST").replace("https://", "").replace("wss://", "").rstrip("/"),
            backend_url=_optional("BACKEND_URL").rstrip("/"),
            agent_tools_secret=_optional("AGENT_TOOLS_SECRET"),
            openai_api_key=_optional("OPENAI_API_KEY"),
            # gpt-realtime-2.1 = higher capability (best alphanumeric read-back, interruptions,
            # latency); gpt-realtime-2.1-mini = cheaper, reasoning + tool use at the mini price.
            openai_model=_optional("OPENAI_MODEL", "gpt-realtime-2.1"),
            # gpt-realtime voices include natural ones like "marin" and "cedar"; "alloy" always works.
            openai_voice=_optional("OPENAI_VOICE", "alloy"),
            # Transcribes the CALLER only (the agent's own words come back with its audio).
            # whisper-1 is markedly worse on 8kHz phone audio, which is all we ever feed it.
            # Set OPENAI_TRANSCRIBE_MODEL=whisper-1 to go back if this model ever misbehaves.
            openai_transcribe_model=_optional("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe"),
            openai_live_model=_optional("OPENAI_LIVE_MODEL"),
            # gpt-5.6-terra is OpenAI's recommended delegate; gpt-5.6-luna is the cheaper one.
            openai_live_backend_model=_optional("OPENAI_LIVE_BACKEND_MODEL", "gpt-5.6-terra"),
            # Low, because every tool answer waits on it and that wait is silence on the phone.
            # "default" sends no effort at all, leaving it to the model.
            openai_live_reasoning_effort=_optional("OPENAI_LIVE_REASONING_EFFORT", "low"),
            # 0.5 is the API default and is tuned for someone speaking into a headset in a quiet
            # room. On a speakerphone in an open office it also hears the room, so the agent gets
            # interrupted by conversations that were never aimed at it. Raised — the caller's own
            # voice is far louder at their handset than anyone else's in the room, so this
            # separates them cleanly. Lower it if genuine quiet speech starts being missed.
            # semantic_vad with low eagerness: it waits for the caller to actually be finished and
            # is far less willing to treat nearby conversation as a turn. Set VAD_TYPE=server_vad
            # to go back to pure loudness detection (the settings below then apply).
            vad_type=_optional("VAD_TYPE", "semantic_vad"),
            # "low" waits longest before deciding a caller has finished, which is what stopped the
            # room interrupting the agent — but it is also a silence after every turn, and worst
            # after a one-word answer like a name, where "have they finished?" is most ambiguous.
            # "medium" keeps semantic turn detection (the part that tells the caller from the room)
            # without the wait. Move to "high" for snappier still, at the cost of the agent
            # answering half-finished sentences; back to "low" if the room starts cutting in again.
            vad_eagerness=_optional("VAD_EAGERNESS", "medium"),
            vad_threshold=float(_optional("VAD_THRESHOLD", "0.8")),
            vad_prefix_padding_ms=int(_optional("VAD_PREFIX_PADDING_MS", "300")),
            # How long the caller must be silent before their turn is considered over. The API
            # default (500ms) is shorter than an ordinary mid-sentence pause, so the agent answers
            # a half-finished thought and talks over the rest of it.
            vad_silence_ms=int(_optional("VAD_SILENCE_MS", "700")),
            twilio_account_sid=_optional("TWILIO_ACCOUNT_SID"),
            twilio_auth_token=_optional("TWILIO_AUTH_TOKEN"),
            twilio_from_number=_optional("TWILIO_FROM_NUMBER") or _optional("TWILIO_PHONE_NUMBER"),
            validate_twilio_signature=_optional("VALIDATE_TWILIO_SIGNATURE", "false").lower()
            in ("1", "true", "yes", "on"),
            stream_secret=_optional("STREAM_SECRET"),
            human_number=_optional("HUMAN_TRANSFER_NUMBER"),
            main_line=_optional("MAIN_LINE_NUMBER"),
            business_name=_optional("BUSINESS_NAME", "TecAce"),
            agent_name=_optional("AGENT_NAME", "Tess"),
            business_hours=_optional("BUSINESS_HOURS", "Monday to Friday, 9 AM to 6 PM Pacific"),
            business_facts=_optional("BUSINESS_FACTS"),
            forward_accept_digit=_optional("FORWARD_ACCEPT_DIGIT", "1"),
            forward_accept_delay=float(_optional("FORWARD_ACCEPT_DELAY_SECONDS", "1.0")),
            # How long after the accept digit the carrier's announcement may still be playing.
            # Until it stops, everything on the line is the CARRIER talking to us, not the caller —
            # the caller is not even bridged yet. Raise it if "This is a forwarded call" still
            # reaches the transcript; lower it if the greeting feels slow on forwarded calls.
            # Short, because Twilio now presses the accept key BEFORE the stream opens — the
            # announcement is normally finished by the time we are listening at all. This only
            # covers its tail, and every second of it is a second the caller waits in silence.
            forward_announcement_seconds=float(_optional("FORWARD_ANNOUNCEMENT_SECONDS", "1.0")),
            # Wait 1s, press 1, wait 1s, press again. Twilio plays this to completion BEFORE the
            # stream opens, so its length is silence the caller sits through — the single largest
            # remaining part of the gap. Trimmed from a 2s first wait: the second press still lands
            # at ~2.3s, which is where the press that worked used to be, so the late case is still
            # covered while the early case now gets in a second sooner. Lengthen it again if a
            # forwarded call ever goes unanswered.
            forward_accept_twiml_digits=_optional("FORWARD_ACCEPT_TWIML_DIGITS", "ww1ww1"),
            forward_accept_inband=_optional("FORWARD_ACCEPT_INBAND", "false").lower()
            in ("1", "true", "yes"),
            forward_accept_attempts=max(1, int(_optional("FORWARD_ACCEPT_ATTEMPTS", "2"))),
            forward_accept_gap=float(_optional("FORWARD_ACCEPT_GAP_SECONDS", "1.5")),
            business_config_url=_optional("BUSINESS_CONFIG_URL").rstrip("/"),
            agent_config_key=_optional("AGENT_CONFIG_KEY"),
            open_hour=int(_optional("BUSINESS_OPEN_HOUR", "9")),
            close_hour=int(_optional("BUSINESS_CLOSE_HOUR", "18")),
            disclose_recording=_optional("DISCLOSE_RECORDING", "true").lower()
            in ("1", "true", "yes", "on"),
            transfer_ring_seconds=int(_optional("TRANSFER_RING_SECONDS", "15")),
            greeting=_optional("INBOUND_GREETING"),
            poll_interval=float(_optional("POLL_INTERVAL_SECONDS", "1800")),
            poller_port=int(_optional("POLLER_PORT", "5060")),
            timezone=_optional("TIMEZONE", "America/Los_Angeles"),
            request_timeout=float(_optional("REQUEST_TIMEOUT_SECONDS", "30")),
        )

    @property
    def stream_url(self) -> str:
        """The wss:// URL Twilio streams call audio to.

        Defined in ONE place because three separate callers build it — the outbound TwiML, the
        inbound /incoming webhook, and the post-transfer recovery TwiML. If the path secret and
        those three ever disagree, calls connect to a socket that immediately rejects them.
        """
        path = "/media-stream" + (f"/{self.stream_secret}" if self.stream_secret else "")
        return f"wss://{self.public_host}{path}"

    def insecure_endpoints(self) -> list[str]:
        """Public surfaces currently accepting unauthenticated traffic. Warned about at startup;
        never fatal, so an existing deployment keeps working after an upgrade."""
        gaps: list[str] = []
        if not self.validate_twilio_signature:
            gaps.append("VALIDATE_TWILIO_SIGNATURE (webhooks accept unsigned requests)")
        if not self.stream_secret:
            gaps.append("STREAM_SECRET (anyone reaching /media-stream can open a Realtime session)")
        return gaps

    def missing_for_server(self) -> list[str]:
        """Settings the media-stream server needs to run a call."""
        gaps: list[str] = []
        if not self.openai_api_key:
            gaps.append("OPENAI_API_KEY")
        if not self.backend_url:
            gaps.append("BACKEND_URL")
        return gaps

    def missing_for_inbound(self) -> list[str]:
        """Settings the inbound screening path needs on top of the server's own.

        Not fatal: without these the agent still answers and can still take a message — it just
        cannot warm-transfer a booking to a person, which is the whole point of screening. The
        entrypoint warns rather than refusing to start.
        """
        gaps: list[str] = []
        if not self.public_host:
            gaps.append("PUBLIC_HOST")
        if not self.human_number:
            gaps.append("HUMAN_TRANSFER_NUMBER")
        if not (self.main_line or self.twilio_from_number):
            gaps.append("MAIN_LINE_NUMBER")
        if not (self.twilio_account_sid and self.twilio_auth_token):
            gaps.append("TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN")
        return gaps

    def missing_for_outbound(self) -> list[str]:
        """Settings needed to place an outbound call."""
        gaps: list[str] = []
        if not self.twilio_account_sid:
            gaps.append("TWILIO_ACCOUNT_SID")
        if not self.twilio_auth_token:
            gaps.append("TWILIO_AUTH_TOKEN")
        if not self.twilio_from_number:
            gaps.append("TWILIO_FROM_NUMBER")
        if not self.public_host:
            gaps.append("PUBLIC_HOST")
        return gaps
