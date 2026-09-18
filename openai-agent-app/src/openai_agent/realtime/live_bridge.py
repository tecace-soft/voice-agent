"""The GPT-Live call bridge — runs every call instead of bridge.py when OPENAI_LIVE_MODEL is set.

The Twilio half of a call is identical on both engines: the same start event, the same prompts,
the same tools and backend, the same marks, AMD, transfer redirect and call record. Those are
borrowed from bridge.py unchanged. What differs is everything said to OpenAI, because GPT-Live has
a different API and is missing several things the Realtime bridge is built on:

  * No `response.done`, so there is no signal that the agent has finished a sentence. Hanging up
    after the farewell (and after a voicemail) waits for the agent's audio to go QUIET instead.
  * No per-response `instructions`. The bridge's farewell, voicemail and "transfer failed" lines are
    appended to the session with `session.instructions.append`.
  * No `response.cancel` / `speech_started`. GPT-Live is full duplex and handles barge-in itself.
    Where the Realtime bridge DROPS audio the model must not hear (the carrier's forwarding
    announcement, a voicemail greeting), this one sends μ-law silence in its place, because GPT-Live
    expects input audio to keep flowing.
  * Tool calls come from the BACKEND model, wrapped in `response.event`. Results go back with
    `response.item.create` + `response.create`.
  * Transcripts arrive as timed fragments of both sides, not as finished turns.

UNVERIFIED on a real call: whether Twilio's playback buffer outlives an interruption. Twilio's own
GPT-Live sample never clears it. The call-end log reports how far audio ran ahead of playback; if
that is seconds rather than a fraction of one, callers will hear the agent keep talking after they
cut in.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import time

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from ..config import Config
from ..telephony import transfer
from ..telephony.outbound import is_machine
from ..tools.agent_tools import INBOUND_TOOL_SCHEMAS, ToolExecutor
from ..tools.business_config import fetch_business_config
from . import amd, greeting_audio
from .bridge import (
    _HANGUP_FALLBACK_SECONDS,
    _SPOKEN_HOLD_LINE,
    _TRANSFER_FAILED_INSTRUCTION,
    _TRANSFER_FALLBACK_SECONDS,
    _VOICEMAIL_BACKSTOP_SECONDS,
    _VOICEMAIL_INSTRUCTION,
    _accept_forwarded_call,
    _await_start,
    _drain_and_close,
    _farewell_instruction,
    _finalize_call,
    _name_from_transcript,
    _note_outcome,
    _turns,
)
from .instructions import build_instructions
from .instructions_inbound import RETURN_GREETING, spoken_greeting
from .instructions_inbound import build_instructions as build_instructions_inbound
from .instructions_neutral import NEUTRAL_GREETING, build_instructions_neutral
from .korean import HANGUL, korean_speech_guide
from .live_session import LIVE_URL, VOICE_PRICE_PER_MINUTE, backend_cost, build_live_session_start

log = logging.getLogger(__name__)

# No agent audio for this long means the closing words have finished generating. The hang-up mark
# then waits for Twilio to finish PLAYING them, so this only has to outlast a pause between words.
_QUIET_SECONDS = 1.5
# How much closing audio must have been heard before quiet counts. Stops a hang-up in the gap
# between whatever the agent was saying and the farewell it was just asked for.
_FAREWELL_MIN_AUDIO = 1.0
# Counted in chunks that contain sound, so the gaps between words don't count — lower than the
# message's length on purpose.
_VOICEMAIL_MIN_AUDIO = 3.0
# Agent audio within this long means it is mid-sentence (usually its own "let me put you through"),
# so a transfer drains that first instead of having Twilio speak a hold line over it.
_RECENTLY_SPOKE_SECONDS = 2.0
# Caller audio that arrives before the session has started is held, not lost — on an outbound call
# it is the lead's "hello?". Capped so a session that never starts cannot grow it without limit.
_MAX_HELD_FRAMES = 150  # 3s of 20ms frames
# An inbound agent greets first; until it does, the caller cannot have said anything. If the
# greeting never comes, stop waiting for it rather than leaving the caller unheard for the call.
# Lowered from 6s: on a real call the agent took 9.8s to say hello — six of them waiting for a
# greeting that was never coming, and the caller said "Hello?" into the silence first.
_GREETING_WAIT_SECONDS = 3.0
# And when asking again does not work either — a call where the model never spoke at all — this is
# how long after that the bridge gives up and speaks the greeting itself. A caller listening to
# silence has no way of knowing anyone picked up.
#
# 1.5s, not 3: with the retry at 3s that puts the rescue at four and a half seconds, and a model
# that is going to greet has always done so inside three. Every second here is a second of someone
# holding a phone to their ear wondering whether the call connected.
_GREETING_RESCUE_SECONDS = 1.5
# How late a scheduled wake-up has to be before it counts as this process having been blocked. Well
# under the gaps being investigated, and far above ordinary scheduling jitter.
_LOOP_LAG_SECONDS = 0.08
_MULAW_SAMPLES_PER_SECOND = 8000
# μ-law byte -> 1 if its amplitude is well above line noise (segment 3 or higher), else 0.
_LOUD_BYTES = bytes(1 if ((0xFF ^ b) >> 4) & 7 >= 3 else 0 for b in range(256))
# Dead air with no backend work in flight. GPT-Live decides for itself whether to delegate, and on
# the first real call it said "let me put you through" and never delegated the transfer — the caller
# sat in silence until they hung up. After this long the agent is reminded to act.
_STUCK_SECONDS = 6.0
# A delegation with no backend response by now is logged: from the outside it looks exactly like
# the model never delegating at all.
_BACKEND_STALL_SECONDS = 15.0
# The agent answered and stopped on a statement — no "anything else?" — and the caller, who cannot
# tell it has finished, says nothing either. The prompt asks for the hand-back, but GPT-Live skips it
# often enough (in a real session: one answer handed back, the next did not) to need a backstop that
# is much sooner than the general dead-air nudge.
_FOLLOWUP_SECONDS = 2.5
# How recently the CALLER must have been heard for the bridge to keep its hands off the session.
# Every nudge is an instruction appended mid-call, and the model acts on it at once: appended while
# someone is asking a question, it answers the nudge instead of the caller. On a real call that cost
# the caller their answer — they asked where the spa was, the agent got as far as "Sure. We're at"
# and then said "Anything else I can help with?" twice, and they had to ask again.
_CALLER_QUIET_SECONDS = 2.0
# How much audio to keep queued at Twilio while the agent speaks. GPT-Live's stream stalls for a
# few hundred milliseconds now and then; with nothing buffered, every stall is a gap the caller
# hears. Measured on a real call: ten gaps, four seconds in total, with the lead never above 0.1s.
# How the agent's audio reaches the caller.
#
# GPT-Live does not send at a steady rate: it bursts, then stalls — measured at up to 576ms of
# nothing in the middle of a sentence, with this process idle throughout. Forwarding each chunk the
# moment it arrives passes those stalls straight to the caller, which is the stutter.
#
# So the bridge holds a reservoir. Twilio is kept topped up to _AUDIO_LEAD_SECONDS of queued audio
# and everything beyond that waits here — and when the stream stalls, the sender keeps feeding
# Twilio out of what it is holding. A burst refills it. The caller hears one continuous voice.
#
# The earlier version injected SILENCE when it noticed the buffer had run dry, which is both too
# late and actively worse: the gap had already started, and padding it made the words that followed
# land later still.
# What makes a stall survivable is having audio in hand BEFORE it happens, and the only way to get
# that is to start a turn slightly late: the first _AUDIO_PRIME_SECONDS of each utterance is held,
# then everything flows. The caller waits that long for the agent to start and never hears the
# stalls inside the sentence, which is the trade the stutter is worth.
_AUDIO_PRIME_SECONDS = 0.5
# If the model sends less than that and stops (a two-word answer), waiting for more would hold a
# finished sentence hostage. This is how long a pause counts as "that is all of it".
_AUDIO_PRIME_PATIENCE = 0.15
# Silence longer than this means the agent has finished speaking, rather than the stream having
# stalled mid-sentence. Comfortably longer than the worst stall measured (576ms).
_AUDIO_TURN_GAP = 1.0
_AUDIO_LEAD_SECONDS = 0.6
_AUDIO_SEND_CHUNK = 0.1
# What the agent is allowed to finish saying once the caller starts talking. Enough to end a word,
# short enough that it is not still explaining something over them.
_AUDIO_INTERRUPT_KEEP = 0.15
# After the caller says they are done: how long the agent gets to end the call itself before the
# bridge does it for them.
_SIGNOFF_GRACE_SECONDS = 4.0
# After the agent tells a caller it is putting them through: how long it gets to actually do it
# before the bridge performs the transfer itself. Short, because the caller has been told to expect
# a person and is listening to nothing until one arrives.
_PROMISE_GRACE_SECONDS = 2.5
# A gap longer than this between the end of what we have sent and the next audio is long enough to
# hear. Below it, ordinary jitter.
_UNDERRUN_SECONDS = 0.06

_GREET_NOW = (
    "The call has just connected. Speak your opening line now, first, without waiting for the "
    "caller to say anything. Then listen."
)
# Sent when an inbound agent was asked to greet and has still said nothing. A greeting request is
# only a request to GPT-Live: a caller coming back from a failed transfer once sat through 17 seconds
# of silence and hung up, although the same prompt greeted promptly when tried on its own.
_GREET_AGAIN = (
    "You have not said anything yet, and the caller is waiting on the line in silence. Say your "
    "opening line from the call flow now, in full, and then listen."
)
_ASK_ANYTHING_ELSE = (
    "You stopped speaking without handing the conversation back, and the caller is waiting in "
    "silence. In one short line, in the language they are speaking, ask whether they need anything "
    "else — phrased differently from however you asked earlier in this call, and never the same "
    "sentence twice. If you were waiting on them for something specific, ask for that instead. If "
    "they have already said goodbye, say a brief warm farewell and end the call instead of asking."
)
# The caller saying they are finished. Deliberately narrow — every phrase here has to be a whole
# turn, or nearly, because ending a call on someone who was still talking is far worse than staying
# on the line a few seconds too long. "Thanks" alone is NOT here: people thank you mid-conversation.
_SIGNED_OFF = re.compile(
    r"^\W*(?:"
    r"(?:okay|ok|alright|right|well|yeah|yep|no|nope|cool|great|perfect|awesome)[,.\s]*)*"
    r"(?:"
    r"that(?:'?s|'?ll be|'?d be| is| was| will be| would be)?\s+(?:all|it|everything|what i needed|great)"
    r"|(?:i'?m|we'?re)\s+(?:all\s+)?(?:good|set|done)"
    r"|no(?:thing)?\s+(?:else|more)(?:\s+(?:thanks|thank you))?"
    r"|(?:good)?bye|bye bye|have a (?:good|great|nice) (?:one|day|night)|take care"
    r")"
    r"[\s,.!]*(?:thanks|thank you|then|bye|goodbye)?[\s,.!]*$",
    re.IGNORECASE,
)


# The agent asking whether the call is done. Only after one of these does a bare "no" mean
# goodbye rather than an answer to whatever else was on the table.
_ASKED_IF_DONE = re.compile(
    r"("
    r"anything else|something else|anything more|anything further"
    r"|anything (?:i|we) can (?:help|do)|what else can (?:i|we)"
    r"|(?:was|is) there anything"
    r"|help you with anything|need anything"
    r")",
    re.IGNORECASE,
)
# A short no. Matched only against a whole turn, and only when the question above was the last
# thing the agent said.
_DECLINED_MORE = re.compile(
    r"^\W*(?:"
    r"(?:okay|ok|alright|right|well|um|uh|yeah|cool|great|perfect|awesome)[,.\s]*)*"
    r"(?:"
    r"no|nope|nah|not (?:right now|at the moment|today|for now)"
    r"|(?:i )?(?:don'?t|do not) think so|(?:i )?think(?: that)?'?s it"
    r"|all good|we'?re good|that should (?:do|be) it|that does it"
    r")"
    r"[\s,.!]*(?:thanks|thank you|thanks so much|then|that'?s it|i'?m good)?[\s,.!]*$",
    re.IGNORECASE,
)


def _last_agent_words(state: dict) -> str:
    """The last thing the agent said, to read the caller's answer against."""
    for fragment in reversed(state["fragments"]):
        speaker, text = fragment[0], fragment[-1]
        if speaker == "agent" and str(text).strip():
            return str(text)
    for speaker, text in reversed(state["transcript"]):
        if speaker == "agent" and text.strip():
            return text
    return ""


def _declined_more(state: dict, heard: str) -> bool:
    """Did the caller just turn down the agent's offer of anything else?

    Context is the whole point. "No" after "do you need anything else?" ends the call; "no" after
    "is that for a day pass or a service?" is an answer, and hanging up on it would be abrupt to
    the point of rudeness.
    """
    if not _DECLINED_MORE.match((heard or "").strip()):
        return False
    return bool(_ASKED_IF_DONE.search(_last_agent_words(state)))


# The agent SAYING it is transferring, as opposed to OFFERING to. The difference decides whether a
# caller gets handed to a stranger they did not ask for, so the offer forms are excluded explicitly:
# "would you like me to put you through?" is a question and must never trigger a transfer.
_PROMISED_TRANSFER = re.compile(
    r"("
    # "let me put you through", "I'll transfer you", "one moment while I put you through",
    # "hold on while I connect you", "I'm going to hand you over"
    r"\b(?:let me|i'?ll|i will|i'?m going to|i am going to|going to|allow me to|while i|"
    r"i'?m about to|i'?m|i am)\s+(?:just\s+|now\s+|quickly\s+)?"
    r"(?:put|get|connect|transfer|pass|hand)\b"
    # "putting you through now", "connecting you to the team"
    r"|\b(?:putting|connecting|transferring|handing)\s+you\b"
    r")",
    re.IGNORECASE,
)
# Asking is not doing. "Would you like me to put you through?" must never transfer anyone, and
# neither must "I CAN put you through to someone who can" — that says what is possible, and the
# caller has not answered yet. Transferring on either would hand a stranger to a stranger.
_ONLY_OFFERING = re.compile(
    r"(would you like|shall i|want me to|do you want|if you'?d like|should i|may i|"
    r"\b(?:i|we)\s+c(?:an|ould)\b)",
    re.IGNORECASE,
)


# The agent telling the caller their message is with the team. On a probe of the leg after a
# failed transfer it said "Got it, someone will call you back about that" and never called
# take_message — the caller rings off believing the team has their request, and nothing was
# written down. Offers are excluded for the same reason as the transfer ones: "shall I take a
# message?" is a question, and the caller has not answered it yet.
_PROMISED_A_MESSAGE = re.compile(
    r"("
    r"(?:i'?ll|i will|let me|i'?ve|i have)\s+(?:just\s+)?"
    r"(?:make a note|note that|pass (?:that|this|it|along)|let the team know|"
    r"get (?:that|this) to the team|add that)"
    r"|(?:someone|somebody|the team|they)\s+(?:will|'ll)\s+"
    r"(?:call|get back|be in touch|reach out|follow up)"
    r"|(?:the team|they)\s+(?:has|have|'ve)\s+(?:got\s+)?your"
    r"|message (?:is|has been) (?:with|passed|noted|recorded)"
    r")",
    re.IGNORECASE,
)


def _promised_a_message(text: str) -> bool:
    """Has the agent told the caller, in so many words, that their message is with the team?"""
    said = (text or "").strip()
    if not said or _ONLY_OFFERING.search(said):
        return False
    return bool(_PROMISED_A_MESSAGE.search(said))


def _promised_a_transfer(text: str) -> bool:
    """Has the agent told the caller, in so many words, that it is putting them through now?"""
    said = (text or "").strip()
    if not said or _ONLY_OFFERING.search(said):
        return False
    return bool(_PROMISED_TRANSFER.search(said))


# A goodbye the agent has ALREADY spoken. Matched on the agent's own turn, to decide whether the
# bridge still needs to supply one. Deliberately generous: a second goodbye stacked on the first is
# a worse outcome than hanging up a beat after the agent's own, and end_call is only ever handled
# once the caller has said they are done.
_SAID_GOODBYE = re.compile(
    r"\b("
    r"good ?bye|bye now|bye bye"
    r"|have a (?:good|great|lovely|wonderful|nice) (?:day|one|evening|afternoon|morning|night)"
    r"|take care|enjoy your (?:day|evening)|have a good rest of your"
    r"|thanks for calling|thank you for calling"
    r")\b",
    re.IGNORECASE,
)


def _said_goodbye(text: str) -> bool:
    """Has the agent already signed off in its own words?"""
    return bool(_SAID_GOODBYE.search((text or "").strip()))


def _sounds_finished(text: str) -> bool:
    """Has the caller said, plainly, that they are done?"""
    return bool(_SIGNED_OFF.match((text or "").strip()))


# Appended the moment a transfer starts. The first version ended at "do not say anything more",
# and on a real call the model answered it — "Sure, hang on" — which is both a stray sentence to the
# caller and the audio that then got cut off by the redirect. An instruction the model can reply to
# is an instruction it will reply to, so this one forbids the reply as well.
_STOP_FOR_TRANSFER = (
    "The caller is being handed to a colleague right now. Stop speaking immediately. No further "
    "words, no goodbye, no 'one moment', and do NOT acknowledge this message — not out loud and "
    "not in text. Say nothing at all from here."
)
_STILL_NEED_THE_MESSAGE = (
    "You just told the caller their message is with the team, but you have not called take_message "
    "— so nothing was recorded and nobody will call them back. Call it NOW, with what they have "
    "already told you as the message and the number they are calling from as callback_number. Do "
    "not ask them to repeat it, do not say anything about this to them, and do not say you are "
    "noting it a second time."
)
# Twice. A third would be the bridge arguing with the model in front of the caller.
_MESSAGE_REMINDER_LIMIT = 2
# How many times the transfer mark is re-issued while the model is still talking. Each round is one
# Twilio round trip, and _TRANSFER_FALLBACK_SECONDS caps the whole wait regardless; this stops a
# model that will not stop talking from holding the caller indefinitely.
_TRANSFER_MARK_LIMIT = 6
_NUDGE = (
    "The line has been silent for several seconds. If you told the caller you would do something "
    "that needs the backend — put them through, take a message, check or book a time, or end the "
    "call — delegate it to the backend now, without repeating what you already said. Otherwise, "
    "carry on the conversation naturally."
)


async def _open_live(cfg: Config):
    """Open the GPT-Live connection (a coroutine, for the same create_task reason as bridge.py)."""
    return await websockets.connect(
        LIVE_URL, additional_headers={"Authorization": f"Bearer {cfg.openai_api_key}"}
    )


async def run_live_bridge(twilio_ws: WebSocket, cfg: Config) -> None:
    await twilio_ws.accept()
    # Opened alongside Twilio's start handshake, as in bridge.py — every millisecond is silence.
    connecting = asyncio.create_task(_open_live(cfg))

    stream_sid, call_sid, params = await _await_start(twilio_ws)
    if not stream_sid:
        try:
            await (await connecting).close()
        except Exception:  # noqa: BLE001 — best effort; the call is already gone
            pass
        return

    is_inbound = str(params.get("direction", "")).strip().lower() == "inbound"
    caller = str(params.get("caller", ""))
    opening = ""
    prerendered: bytes | None = None
    returning = str(params.get("transfer_failed", "")).lower() in ("yes", "true", "1")
    business = None

    # The same prompt and tool selection as run_bridge — see the reasoning there.
    if is_inbound:
        dialled = str(params.get("dialled", ""))
        log.info(
            "inbound call started from %r to %r on call %s (transfer_failed=%r) [live]",
            caller or "unknown", dialled or "unknown", call_sid or "?", params.get("transfer_failed"),
        )
        business = await fetch_business_config(cfg, dialled)
        if business is None:
            log.warning("answering %r neutrally — no business identified", dialled or "unknown")
            instructions = build_instructions_neutral(
                caller=caller, timezone=cfg.timezone, disclose_recording=cfg.disclose_recording
            )
            # The neutral opening, rendered for the same rescue: a caller who reaches a line we
            # cannot identify still deserves to hear that somebody picked up.
            opening = NEUTRAL_GREETING
            greeting_audio.warm(cfg, opening)
        else:
            instructions = build_instructions_inbound(
                caller=caller,
                business_name=business.business_name,
                agent_name=business.agent_name or cfg.agent_name,
                business_hours=business.hours_text,
                business_facts=business.facts,
                # This call is for a customer: with no facts on file the agent must say it doesn't
                # know, NOT recite TecAce's.
                default_facts=False,
                open_hour=business.open_hour,
                close_hour=business.close_hour,
                timezone=cfg.timezone,
                transfer_failed=returning,
                disclose_recording=cfg.disclose_recording and not returning,
                greeting=RETURN_GREETING if returning else (business.greeting or cfg.greeting),
                caller_name=str(params.get("caller_name", "")),
                known_request=str(params.get("known_request", "")),
                transfer_topics=business.transfer_topics,
                house_rules=business.house_rules,
                can_transfer=bool(business.transfer_number) and not returning,
            )
        # The opening line the caller is about to hear. If it has been rendered already (the
        # /incoming webhook starts that while Twilio connects), it is played the instant the stream
        # opens and the model is told what was said instead of being asked to say it — which is the
        # ~2.5s the model needs before its first audible word, spent before the call was answered.
        if business is not None and not returning:
            opening = spoken_greeting(
                greeting=business.greeting or cfg.greeting,
                business_name=business.business_name,
                agent_name=business.agent_name or cfg.agent_name,
                disclose_recording=cfg.disclose_recording,
            )
            # Rendered either way. Played now only where the deployment asked for it; otherwise
            # it waits as the rescue for a model that never says hello — see the nudger.
            greeting_audio.warm(cfg, opening)
            prerendered = greeting_audio.ready(cfg, opening) if cfg.prerendered_greeting else None

        tools = INBOUND_TOOL_SCHEMAS
        if returning or (business is not None and not business.transfer_number):
            tools = [t for t in INBOUND_TOOL_SCHEMAS if t.get("name") != "transfer_to_human"]
    else:
        log.info(
            "call started for lead_name=%r intake_id=%r [live]",
            params.get("lead_name"), params.get("intake_id"),
        )
        instructions = build_instructions(
            lead_name=params.get("lead_name", ""),
            purpose=params.get("purpose", ""),
            requested_date=params.get("requested_date", ""),
            requested_date_iso=params.get("requested_date_iso", ""),
            desired_time=params.get("desired_time", ""),
            desired_time_iso=params.get("dateTime", ""),
            email=params.get("email", ""),
            timezone=cfg.timezone,
            is_callback=str(params.get("is_callback", "")).lower() in ("yes", "true", "1"),
        )
        tools = None
    executor = ToolExecutor(cfg, intake_id=params.get("intake_id", ""))

    state: dict = {
        # ---- read by the helpers borrowed from bridge.py ----
        "stream_sid": stream_sid,
        "call_sid": call_sid,
        "is_inbound": is_inbound,
        "is_mini": False,
        "caller": caller,
        "dialled": str(params.get("dialled", "")),
        "human_number": business.transfer_number if business else "",
        "caller_name": str(params.get("caller_name", "")),
        "outcome": None,
        "messages": [],
        "transcript": [],
        "started": time.monotonic(),
        "closing": False,
        "hangup_pending": False,
        "forward_guard_until": 0.0,
        # ---- live only ----
        "ready": asyncio.Event(),  # set on session.started
        "greeted": False,  # the agent has produced audio
        "opening": opening,  # the words the caller should hear first, for the greeting rescue
        "greet_rescued": False,  # the bridge has already said hello on the model's behalf
        "transfer_marks": 0,  # marks sent while waiting for the agent to stop talking
        "transfer_mark_at": 0.0,
        "transfer_fallback": None,
        "message_taken": False,  # take_message has actually been called on this call
        "message_reminders": 0,
        "model_audio_frames": 0,  # audio the MODEL has sent — see _caller_started_talking
        "greet_deadline": float("inf"),
        "leaving_voicemail": False,
        "transfer_pending": None,
        "_tool_tasks": set(),
        "seen_calls": set(),
        # Transcript fragments: [speaker, start_ms or None, arrival index, text].
        "fragments": [],
        "current_run": None,  # [speaker, text] being logged as it is spoken
        # Agent audio accounting, for hanging up on quiet and for the playback-lead diagnostic.
        "last_audio_at": 0.0,
        "closing_audio": 0.0,
        "closing_event_id": None,
        "play_until": 0.0,
        "max_playback_lead": 0.0,
        "live_closed": False,  # OpenAI's side hung up on us, rather than the call ending normally
        "out": bytearray(),  # the agent's audio, waiting to be fed to Twilio at a steady rate
        "greeting_until": 0.0,  # while set, the bridge's own greeting owns the line
        "sent_at": 0.0,
        "max_loop_lag": 0.0,  # the latest a scheduled wake-up ran — how blocked this process got
        "loop_stalls": 0,
        "max_delta_gap": 0.0,  # the longest OpenAI went without sending audio while the agent spoke
        "last_delta_at": 0.0,
        "underruns": 0,  # times Twilio had nothing left to play while the agent was talking
        "underrun_seconds": 0.0,
        "voice_seconds": None,
        "backend_usage": {"in": 0, "cached": 0, "out": 0, "cost": 0.0, "responses": 0},
        "append_count": 0,
        # ---- delegation visibility and the dead-air nudge ----
        "delegating_since": None,  # monotonic time backend work began; None when none is in flight
        "last_activity_at": 0.0,  # last agent audio, caller words or backend event
        "nudged": False,  # already nudged during this silence
        "last_lead_at": 0.0,  # when the caller was last heard, so nudges never talk over them
        "signed_off_at": None,  # when the caller last said they were done, for the wrap-up backstop
        "greet_retried": False,  # an inbound greeting that never came has been asked for again
        "followup_asked": False,  # already prompted a hand-back for the agent's current turn
        # Appended the first time the caller is heard speaking Korean — see realtime/korean.py.
        "korean_guide": korean_speech_guide(instructions),
        "korean_guided": False,
        "backend_text": {},  # delegation_id -> the backend's reply so far
        "logged_types": set(),
        "fragment_fields_logged": set(),
    }
    amd_queue = amd.register(call_sid) if not is_inbound else None
    try:
        async with await connecting as live_ws:
            if is_inbound and prerendered:
                first_turn = greeting_audio.already_greeted(opening)
            elif is_inbound:
                # Inbound answers a ringing phone, so the order to speak first travels with the
                # session instead of costing a round trip once it is up. _GREET_AGAIN still covers
                # the session that comes up and says nothing anyway.
                first_turn = _GREET_NOW
            else:
                first_turn = ""
            await live_ws.send(json.dumps(build_live_session_start(
                cfg, instructions, tools, greet_now=first_turn,
            )))

            # Said before the model is even connected — this is the whole point of rendering it.
            if is_inbound and prerendered:
                await _play_greeting(twilio_ws, state, prerendered)

            forwarded_from = str(params.get("forwarded_from", ""))
            if is_inbound and forwarded_from:
                state["forward_guard_until"] = time.monotonic() + cfg.forward_announcement_seconds
                if cfg.forward_accept_inband and cfg.forward_accept_digit.strip():
                    log.info("call arrived forwarded from %s — sending the in-band accept digit",
                             forwarded_from)
                    await _accept_forwarded_call(twilio_ws, cfg, state)
                    remaining = state["forward_guard_until"] - time.monotonic()
                    if remaining > 0:
                        await asyncio.sleep(remaining)

            watcher = (
                asyncio.create_task(_watch_amd(amd_queue, live_ws, twilio_ws, state))
                if amd_queue is not None
                else None
            )
            relays = [
                asyncio.create_task(_caller_to_live(twilio_ws, live_ws, cfg, state)),
                asyncio.create_task(_live_to_caller(twilio_ws, live_ws, state, executor, cfg)),
            ]
            nudger = asyncio.create_task(_nudge_when_stuck(twilio_ws, live_ws, state, cfg))
            clock = asyncio.create_task(_watch_the_clock(state))
            sender = asyncio.create_task(_stream_to_caller(twilio_ws, state))
            try:
                # FIRST_COMPLETED, not gather — see run_bridge for why.
                done, pending = await asyncio.wait(relays, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                for task in done:
                    if task.exception() is not None:
                        raise task.exception()  # noqa: RSE102 — re-raise the original
            finally:
                for task in relays:
                    task.cancel()
                nudger.cancel()
                clock.cancel()
                sender.cancel()
                if watcher is not None:
                    watcher.cancel()
    except Exception as exc:  # noqa: BLE001 — surface, don't crash the server
        # With the traceback: "live bridge ended: 'greeted'" told us a KeyError happened and
        # nothing about where, and this path is the one that silently ends a live call.
        log.warning("live bridge ended: %s: %s", type(exc).__name__, exc, exc_info=True)
    finally:
        amd.unregister(call_sid)
        _flush_run(state)
        _sync_transcript(state)
        _log_live_cost(state, cfg)
        await _finalize_call(state, params, executor, cfg)


# ---------------------------------------------------------------------------
# Caller -> GPT-Live
# ---------------------------------------------------------------------------

_silence_cache: dict[int, str] = {}


def _payload_bytes(payload: str) -> int:
    """Decoded length of a base64 payload, without decoding it."""
    return len(payload) * 3 // 4 - payload.count("=")


def _silence_like(payload: str) -> str:
    """μ-law silence the same length as `payload`. 0xFF is digital silence in G.711 μ-law."""
    n = _payload_bytes(payload)
    if n not in _silence_cache:
        _silence_cache[n] = base64.b64encode(b"\xff" * n).decode("ascii")
    return _silence_cache[n]


def _not_the_caller(state: dict) -> bool:
    """Is what is on the line right now something the model must not treat as the caller?"""
    now = time.monotonic()
    return (
        # Inbound, before the greeting: the caller has heard nothing and cannot have replied.
        (state["is_inbound"] and not state["greeted"] and now < state["greet_deadline"])
        # A forwarding carrier finishing its announcement.
        or now < state["forward_guard_until"]
        # A voicemail box's own audio must not interrupt the message being left on it.
        or state["leaving_voicemail"]
    )


async def _caller_to_live(twilio_ws: WebSocket, live_ws, cfg: Config, state: dict) -> None:
    """Forward the caller's audio to GPT-Live, and act on Twilio's mark echoes."""
    held: list[str] = []
    try:
        while True:
            evt = json.loads(await twilio_ws.receive_text())
            e = evt.get("event")
            if e == "media":
                payload = evt["media"]["payload"]
                if _not_the_caller(state):
                    payload = _silence_like(payload)
                if not state["ready"].is_set():
                    held.append(payload)
                    del held[:-_MAX_HELD_FRAMES]
                    continue
                for frame in held:
                    await _send_audio(live_ws, frame)
                held.clear()
                await _send_audio(live_ws, payload)
            elif e == "mark":
                mark_name = (evt.get("mark") or {}).get("name")
                # Same meaning as in bridge.py: the closing words have PLAYED, so hang up.
                if mark_name == "endcall":
                    await twilio_ws.close()
                    break
                # The hold line has played — redirect, and do NOT close (that would drop the call).
                if mark_name == "transfer":
                    # Audio the model sent AFTER this mark went out is queued behind it, so the
                    # mark returning says nothing about that audio. Redirecting now would cut it
                    # off mid-word, which is exactly what the caller heard on the 22:45 call.
                    still_talking = (
                        state["out"] or state["last_audio_at"] > state["transfer_mark_at"]
                    )
                    if still_talking:
                        await _drain_and_transfer(twilio_ws, live_ws, cfg, state)
                        continue
                    await _do_transfer(cfg, live_ws, state)
                    continue
            elif e == "stop":
                break
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await live_ws.send(json.dumps({"type": "session.close"}))
        except Exception:  # noqa: BLE001 — the socket may already be gone
            pass
        await live_ws.close()


async def _send_audio(live_ws, payload: str) -> None:
    await live_ws.send(json.dumps({"type": "session.input_audio.append", "audio": payload}))


# ---------------------------------------------------------------------------
# GPT-Live -> caller
# ---------------------------------------------------------------------------


async def _live_to_caller(
    twilio_ws: WebSocket, live_ws, state: dict, executor: ToolExecutor, cfg: Config
) -> None:
    """Forward the agent's audio to the caller; collect transcripts; run the backend's tool calls."""
    try:
        async for raw in live_ws:
            evt = json.loads(raw)
            t = evt.get("type")

            if t == "session.output_audio.delta":
                # The farewell has played and Twilio's socket is closed, but GPT-Live keeps sending
                # for a moment. Forwarding it raises, and the raise came out of the relay as
                # "live bridge ended: RuntimeError" on a call that had ended properly.
                if state["closing"]:
                    continue
                payload = evt.get("delta") or ""
                # Our own greeting is playing. Anything arriving now is the model's continuous
                # stream — silence, or a greeting it was told not to say — and mixing it into the
                # queue is what made the opening stutter.
                if state["greeting_until"] > time.monotonic():
                    continue
                # Order matters: _note_agent_audio reads last_delta_at to tell a mid-sentence
                # stall from the ordinary quiet between turns, and _note_delta_gap overwrites it.
                _note_agent_audio(state, payload)
                _note_delta_gap(state)
                state["model_audio_frames"] += 1
                # Into the reservoir, and no further: _stream_to_caller is the ONLY thing that
                # writes audio to Twilio. Sending from here as well delivered every chunk twice —
                # once raw at the model's pace and once again as the queue drained — which is what
                # a caller hears as the agent stuttering and repeating itself.
                state["out"].extend(base64.b64decode(payload))
            elif t == "session.started":
                log.info("live session started: %s", (evt.get("session") or {}).get("id", "?"))
                state["ready"].set()
                if state["is_inbound"]:
                    # The order to greet already went with session.start — appending it again here
                    # would only ask twice. The deadline still arms _GREET_AGAIN for the session
                    # that comes up and stays silent.
                    state["greet_deadline"] = time.monotonic() + _GREETING_WAIT_SECONDS
            elif t == "session.input_transcript.delta":
                # The caller talked over the pre-rendered greeting: stop it mid-sentence, as a
                # person would, rather than finishing the introduction into their first question.
                if state["is_inbound"] and not state["greeted"]:
                    log.info("ignoring %r heard before the greeting", evt.get("delta"))
                    continue
                state["last_activity_at"] = time.monotonic()
                state["nudged"] = False  # the caller spoke, so the next silence is a new one
                state["followup_asked"] = False  # ...and the agent's next turn is a new one
                state["last_lead_at"] = time.monotonic()
                await _caller_started_talking(twilio_ws, state)
                _add_fragment(state, "lead", evt)
                # Judged on the caller's WHOLE turn so far, not the fragment that just arrived.
                # GPT-Live splits a sentence wherever it likes: "No that'll" and "be all" came as
                # two events on a real call, neither of which reads as a goodbye on its own, and the
                # caller was left holding the line.
                turn = state["current_run"]
                heard = turn[1] if turn and turn[0] == "lead" else (evt.get("delta") or "")
                # Either they said it outright, or they turned down the agent's own offer of
                # anything else — which is the same thing, and is how most callers actually end a
                # call: the agent asks, and they say "no thanks".
                if _sounds_finished(heard) or _declined_more(state, heard):
                    # Said in so many words. The agent should end the call itself — the prompt says
                    # so — but on a real call it answered "You're welcome" and then sat there while
                    # the caller waited for the line to close. The backstop below closes it.
                    state["signed_off_at"] = time.monotonic()
                    log.info("the caller signalled they are finished: %r", heard.strip())
                if not state["korean_guided"] and HANGUL.search(evt.get("delta") or ""):
                    state["korean_guided"] = True
                    log.info("caller is speaking Korean — adding Korean pronunciation guidance")
                    await _append(live_ws, state, state["korean_guide"])
            elif t == "session.output_transcript.delta":
                _add_fragment(state, "agent", evt)
            elif t == "response.event":
                state["last_activity_at"] = time.monotonic()
                await _on_backend_event(twilio_ws, live_ws, evt, state, executor, cfg)
            elif t == "session.instructions.appended":
                # The closing instruction has landed. Audio from BEFORE this was the agent's
                # previous sentence and must not count toward the farewell having been said.
                if evt.get("client_event_id") and evt.get("client_event_id") == state["closing_event_id"]:
                    state["closing_audio"] = 0.0
            elif t == "session.delegation.created":
                # INFO, not DEBUG: "did the agent delegate at all?" is the first question whenever
                # a tool didn't happen, and it cannot be answered from anything else in the log.
                log.info("agent delegated to the backend (%s)", (evt.get("delegation") or {}).get("id"))
                state["delegating_since"] = state["last_activity_at"] = time.monotonic()
            elif t == "session.usage.updated":
                seconds = (evt.get("usage") or {}).get("seconds")
                if isinstance(seconds, (int, float)):
                    state["voice_seconds"] = seconds
            elif t == "session.closed":
                seconds = (evt.get("usage") or {}).get("seconds")
                if isinstance(seconds, (int, float)):
                    state["voice_seconds"] = seconds
                log.info("live session closed: %s", evt.get("reason"))
                break
            elif t == "error":
                log.warning("live error: %s", evt.get("error") or evt)
            else:
                _log_unexpected(state, "session", evt)
    except RuntimeError as exc:
        # Starlette raises this when the socket is already closed. Only ever seen while hanging up.
        if "close message has been sent" not in str(exc):
            raise
        log.info("the line closed while the agent's last audio was still arriving")
    except WebSocketDisconnect:
        log.info("the caller's end of the stream closed")
    except websockets.ConnectionClosed as closed:
        # THE failure the caller experiences as "it went dead mid-sentence". OpenAI's side hung up,
        # and everything after this is silence until the call is torn down — so it is logged with
        # the close code and with what the agent was doing at the time, which is the difference
        # between "they dropped us" and "we sent something they rejected".
        state["live_closed"] = True
        speaking = state["last_audio_at"] and time.monotonic() - state["last_audio_at"] < 2.0
        log.warning(
            "GPT-Live closed the session after %.0fs (code %s, reason %r) — the caller hears "
            "silence from here%s",
            time.monotonic() - state["started"], getattr(closed.rcvd, "code", "?"),
            getattr(closed.rcvd, "reason", "") or "none given",
            ", and it closed WHILE THE AGENT WAS SPEAKING" if speaking else "",
        )


def _has_sound(payload: str) -> bool:
    """Does this chunk of μ-law audio contain actual sound, rather than silence?

    GPT-Live streams output audio CONTINUOUSLY — silence included, from before the agent says a word
    until the session ends (measured against the real API). Every "is the agent talking?" decision
    in this bridge therefore has to look at the samples, not at whether a chunk arrived: counting
    silent chunks marked the agent as having greeted before it spoke, kept the dead-air nudge from
    ever firing, and would have kept a finished farewell from ever going quiet.
    """
    try:
        raw = base64.b64decode(payload)
    except (ValueError, TypeError):
        return False
    return bool(raw) and raw.translate(_LOUD_BYTES).count(1) * 50 >= len(raw)  # >= 2% loud


def _note_delta_gap(state: dict) -> None:
    """How long OpenAI left us with nothing to forward, mid-utterance."""
    now = time.monotonic()
    last = state["last_delta_at"]
    # Only within a turn: the pause between the agent finishing and starting again is a
    # conversation, not a stall.
    if last and now - last > state["max_delta_gap"] and now - last < 3.0:
        state["max_delta_gap"] = now - last
    state["last_delta_at"] = now


def _note_agent_audio(state: dict, payload: str, *, audible: bool = True) -> None:
    """Account one chunk of agent audio: how long it plays, how far ahead it is, and — only if it
    contains sound — that the agent is speaking."""
    now = time.monotonic()
    seconds = _payload_bytes(payload) / _MULAW_SAMPLES_PER_SECOND
    # A gap the CALLER hears, mid-sentence. Three things have to be true together:
    #   - this chunk continues a turn already in progress. The quiet between the agent finishing
    #     and starting again is a conversation, not a stall, and counting it filled the log with
    #     warnings about calls that sounded fine.
    #   - Twilio has run out, so there was nothing to play.
    #   - and nothing was waiting here either — audio still in the reservoir is not a gap, it is
    #     being paced out on purpose.
    mid_turn = state["last_delta_at"] and now - state["last_delta_at"] < _AUDIO_TURN_GAP
    starved = (
        mid_turn
        and state["play_until"]
        and not state["out"]
        and now - state["play_until"] > _UNDERRUN_SECONDS
    )
    if starved and state["greeted"]:
        state["underruns"] += 1
        state["underrun_seconds"] += now - state["play_until"]
        if state["underruns"] <= 5:
            log.warning("agent audio ran dry for %.0fms — the caller heard a gap",
                        (now - state["play_until"]) * 1000)
    if not audible or not _has_sound(payload):
        return
    if not state["greeted"]:
        state["greeted"] = True
        log.info("agent first spoke %.1fs after the stream opened", now - state["started"])
    state["last_audio_at"] = state["last_activity_at"] = now
    if state["hangup_pending"]:
        state["closing_audio"] += seconds


async def _append(live_ws, state: dict, content: str) -> str:
    """Add a system-level instruction to the live session. Returns its event_id."""
    state["append_count"] += 1
    event_id = f"append_{state['append_count']}"
    await live_ws.send(
        json.dumps(
            {
                "type": "session.instructions.append",
                "event_id": event_id,
                "delegation_id": None,
                "content": content,
            }
        )
    )
    return event_id


def _last_caller_words(state: dict) -> str:
    """What the caller last said, for a transfer reason a colleague can act on."""
    # The fragments are what exists DURING a call; state["transcript"] is assembled from them and
    # is a turn behind until then.
    for fragment in reversed(state["fragments"]):
        speaker, text = fragment[0], fragment[-1]
        if speaker == "lead" and str(text).strip():
            return f"Caller asked: {str(text).strip()[:150]}"
    for speaker, text in reversed(state["transcript"]):
        if speaker == "lead" and text.strip():
            return f"Caller asked: {text.strip()[:150]}"
    return ""


def _log_unexpected(state: dict, where: str, evt: dict) -> None:
    """Make an event the bridge does not handle visible, instead of silently dropping it.

    Anything that looks like a failure is logged every time, in full, as a warning. Everything else
    is logged once per type — enough to learn the protocol from a real call without flooding it.
    """
    t = str(evt.get("type") or "?")
    if "error" in t or "fail" in t:
        log.warning("live %s event %s: %s", where, t, json.dumps(evt)[:1000])
        return
    key = f"{where}:{t}"
    if key not in state["logged_types"]:
        state["logged_types"].add(key)
        log.info("unhandled live %s event %s (logged once): %s", where, t, json.dumps(evt)[:500])


async def _play_greeting(twilio_ws: WebSocket, state: dict, audio: bytes) -> None:
    """Put the rendered greeting into the reservoir, and let the sender deliver it.

    It used to write to Twilio itself, which raced the sender: GPT-Live streams audio continuously —
    silence included — so the sender was interleaving silent chunks between the greeting's own, and
    the caller heard it stutter badly. One queue, one sender, one voice.
    """
    state["greeted"] = True  # the caller HAS been greeted, whatever the model does next
    seconds = len(audio) / _MULAW_SAMPLES_PER_SECOND
    state["out"].extend(audio)
    state["last_delta_at"] = time.monotonic()
    state["greeting_until"] = time.monotonic() + seconds
    state["last_audio_at"] = time.monotonic()
    state["last_activity_at"] = state["last_audio_at"]
    log.info("playing the pre-rendered greeting (%.1fs) — the model did not have to speak it", seconds)
    return


async def _caller_started_talking(twilio_ws: WebSocket, state: dict) -> None:
    """Stop talking over them.

    Anything still held here was composed before they spoke; keeping a moment of it lets the agent
    finish its word, but the rest would be talking over them.

    What is already queued AT Twilio is flushed in one case only: our own pre-rendered greeting. It
    is a fixed recording, not an answer to anything, so cutting it costs nothing. The model's own
    answer is never flushed this way — a caller saying "mm-hm" should not chop off the sentence they
    are agreeing with.
    """
    held = len(state["out"]) / _MULAW_SAMPLES_PER_SECOND
    if held > _AUDIO_INTERRUPT_KEEP:
        del state["out"][int(_AUDIO_INTERRUPT_KEEP * _MULAW_SAMPLES_PER_SECOND):]
        log.info("caller spoke over the agent — dropped %.0fms of held audio",
                 (held - _AUDIO_INTERRUPT_KEEP) * 1000)
    if state["greeting_until"] <= time.monotonic():
        return
    # The line is free again NOW. Leaving the reservation standing would drop the model's reply for
    # the rest of a greeting nobody is hearing any more — the caller asks a question and meets five
    # seconds of silence.
    state["greeting_until"] = time.monotonic() + _AUDIO_INTERRUPT_KEEP
    if state["model_audio_frames"]:
        return
    try:
        await twilio_ws.send_json({"event": "clear", "streamSid": state["stream_sid"]})
    except (WebSocketDisconnect, RuntimeError):
        return  # the caller hung up; the call is already being torn down
    state["play_until"] = time.monotonic()  # Twilio's queue went with it


async def _stream_to_caller(twilio_ws: WebSocket, state: dict) -> None:
    """Feed Twilio from the reservoir, keeping it a fixed distance ahead of what has played.

    Everything the model sends beyond that distance waits here rather than at Twilio, which is what
    makes a stall survivable: while nothing is arriving, this keeps sending.
    """
    step = int(_AUDIO_SEND_CHUNK * _MULAW_SAMPLES_PER_SECOND)
    priming = True  # a new turn: hold the opening until there is a cushion of it in hand
    while not state["closing"]:
        out: bytearray = state["out"]
        if not out:
            # Prime again only when this is genuinely a NEW turn — the model has stopped sending
            # for longer than any stall. Re-priming after a mid-sentence stall would add half a
            # second of silence to a gap the caller has already heard, which is the exact mistake
            # the old silence-padding made.
            if time.monotonic() - state["last_delta_at"] > _AUDIO_TURN_GAP:
                priming = True
            await asyncio.sleep(0.01)
            continue

        if priming and not (state["hangup_pending"] or state["transfer_pending"]):
            held = len(out) / _MULAW_SAMPLES_PER_SECOND
            waited = time.monotonic() - state["last_delta_at"]
            if held < _AUDIO_PRIME_SECONDS and waited < _AUDIO_PRIME_PATIENCE:
                await asyncio.sleep(0.01)
                continue
            priming = False
        queued = state["play_until"] - time.monotonic()
        # Closing words, or a hold line before a transfer: Twilio has to have all of it before the
        # mark that follows, or the caller hears it cut off mid-word.
        emptying = state["hangup_pending"] or state["transfer_pending"]
        if not emptying and queued >= _AUDIO_LEAD_SECONDS:
            # Twilio has enough; hold the rest. Sleeping for what it has beyond the target keeps
            # this loop off the CPU without letting the queue run dry.
            await asyncio.sleep(min(queued - _AUDIO_LEAD_SECONDS + 0.01, 0.05))
            continue
        chunk = bytes(out[:step])
        del out[:step]
        try:
            await twilio_ws.send_json(
                {
                    "event": "media",
                    "streamSid": state["stream_sid"],
                    "media": {"payload": base64.b64encode(chunk).decode("ascii")},
                }
            )
        except (WebSocketDisconnect, RuntimeError):
            return  # the caller hung up; the call is already being torn down
        now = time.monotonic()
        # When Twilio will finish playing everything it has been sent. Silence counts: it occupies
        # the buffer just the same. This is the sender's ledger and nothing else writes to it.
        state["play_until"] = max(state["play_until"], now) + len(chunk) / _MULAW_SAMPLES_PER_SECOND
        state["max_playback_lead"] = max(state["max_playback_lead"], state["play_until"] - now)
        state["sent_at"] = now


async def _watch_the_clock(state: dict) -> None:
    """Measure whether WE are the thing stalling.

    A gap in the agent's audio has two possible causes and they need opposite fixes: OpenAI stopped
    sending for a moment, or this process was too busy to forward what it had. This sleeps in a
    tight loop and records how late each wake-up is — if the loop is healthy while the caller hears
    gaps, the stall is upstream and no amount of buffering here is a cure.
    """
    while not state["closing"]:
        due = time.monotonic() + 0.05
        await asyncio.sleep(0.05)
        late = time.monotonic() - due
        if late > state["max_loop_lag"]:
            state["max_loop_lag"] = late
        if late > _LOOP_LAG_SECONDS:
            state["loop_stalls"] += 1


async def _nudge_when_stuck(twilio_ws: WebSocket, live_ws, state: dict, cfg: Config) -> None:
    """Keep the nudge loop alive for the length of the call.

    Every backstop lives in that loop — the greeting rescue, the sign-off wrap-up, the transfer and
    message promises. An exception in it would end the task without a word and leave the rest of
    the call with none of them, and the caller would simply be left waiting. So anything unexpected
    is logged and the loop is restarted. It wakes twice a second, so a repeated fault costs a log
    line rather than a spin.
    """
    while not state["closing"]:
        try:
            await _nudge_loop(twilio_ws, live_ws, state, cfg)
            return
        except asyncio.CancelledError:
            raise
        except websockets.ConnectionClosed:
            return
        except Exception:  # noqa: BLE001 — a dead nudger is worse than a logged one
            log.exception("the nudge loop hit an error — restarting it so the backstops survive")
            await asyncio.sleep(0.5)


async def _nudge_loop(twilio_ws: WebSocket, live_ws, state: dict, cfg: Config) -> None:
    """Remind the agent to act when the line has gone dead with no backend work in flight.

    GPT-Live alone decides whether to delegate, so an agent can promise a transfer, never delegate
    it, and wait forever. One reminder per silence; the caller speaking starts a new one.
    """
    stall_logged = False
    while not state["closing"]:
        await asyncio.sleep(0.5)
        # The call can end DURING that sleep, and the loop condition was checked before it. Without
        # this, a nudge is appended to a call that is already hanging up — the model answers it and
        # the caller hears a fragment of a new sentence over the goodbye, or after it.
        if state["closing"]:
            return
        now = time.monotonic()
        since = state["delegating_since"]
        if since is not None:
            # Delegated and waiting on the backend: that silence is not the agent's to fix.
            if not stall_logged and now - since >= _BACKEND_STALL_SECONDS:
                stall_logged = True
                log.warning("the backend has not answered %.0fs after the agent delegated", now - since)
            continue
        stall_logged = False
        # Asked twice and still nothing. Say it ourselves — the caller has been listening to an
        # open line since they dialled, and no amount of asking the model has produced a word.
        if (
            state["is_inbound"]
            and not state["greeted"]
            and state["greet_retried"]
            and not state["greet_rescued"]
            and state["greet_deadline"]
            and now >= state["greet_deadline"] + _GREETING_RESCUE_SECONDS
        ):
            audio = greeting_audio.ready(cfg, state["opening"])
            if audio:
                state["greet_rescued"] = True
                log.warning("the agent never greeted — playing the greeting ourselves so the caller "
                            "is not left on an open line")
                await _play_greeting(twilio_ws, state, audio)
                try:
                    await _append(live_ws, state, greeting_audio.already_greeted(state["opening"]))
                except websockets.ConnectionClosed:
                    return
            else:
                # Still rendering, or the speech request failed. Try again on the next tick, and
                # say so once rather than every half second.
                if not state.get("_rescue_waiting"):
                    state["_rescue_waiting"] = True
                    log.warning("the agent has not greeted and no rendered greeting is ready yet")
                greeting_audio.warm(cfg, state["opening"])
            continue

        if state["is_inbound"] and not state["greeted"] and not state["greet_retried"]:
            # Waiting on the greeting. greet_deadline is only set once the session has started.
            if now >= state["greet_deadline"]:
                state["greet_retried"] = True
                state["last_activity_at"] = now  # the regular nudge waits a full silence after this
                log.info(
                    "the agent has not greeted %.0fs after the session started — asking again",
                    _GREETING_WAIT_SECONDS,
                )
                try:
                    await _append(live_ws, state, _GREET_AGAIN)
                except websockets.ConnectionClosed:
                    return
            continue
        busy = state["hangup_pending"] or state["transfer_pending"] or state["_tool_tasks"]
        # Someone is mid-sentence, or has just finished one and is waiting on an answer. Whatever
        # the agent is or is not doing, this is not the moment to append an instruction to it.
        caller_speaking = now - state["last_lead_at"] < _CALLER_QUIET_SECONDS
        # Our own greeting is queued in one go rather than played chunk by chunk, so nothing keeps
        # stamping last_audio_at while it runs. Without this the nudger sees a silent call and
        # prompts the model mid-greeting — the caller hears it start talking over itself.
        if state["greeting_until"] > now:
            state["last_audio_at"] = state["last_activity_at"] = now

        # The caller said they were done and the call is still open. Give the agent a few seconds to
        # say goodbye and call end_call; if it does neither, end the call here. GPT-Live decides for
        # itself whether to delegate, and a caller left holding a line nobody is going to close has
        # to hang up on us — which reads as the assistant not noticing they had finished.
        signed_off = state["signed_off_at"]
        # The grace is there to let the agent get to end_call in its own time. Once it has SAID
        # goodbye there is nothing left to wait for — the caller has heard the last thing they are
        # going to hear, and every further second is dead air on a call both sides know is over.
        run = state["current_run"]
        said_bye = bool(run and run[0] == "agent" and _said_goodbye(run[1]))
        grace = 0.0 if said_bye else _SIGNOFF_GRACE_SECONDS
        wrap_up = (
            # They told us they were done, and the agent has had its grace.
            (signed_off is not None and now - signed_off >= grace)
            # Or the agent said goodbye of its own accord and then just sat there. The words that
            # end a call have been spoken; leaving the line open after them is the call that never
            # ends, and the caller has to hang up on us to get away.
            or (said_bye and now - state["last_audio_at"] >= _SIGNOFF_GRACE_SECONDS)
        )
        if (
            wrap_up
            and not busy
            # They said they were done and then carried on talking. Hanging up on that is the
            # rudest thing this bridge could do, so the same guard applies here.
            and not caller_speaking
            and now - state["last_audio_at"] >= _QUIET_SECONDS
        ):
            state["signed_off_at"] = None
            if signed_off is not None:
                log.info("the caller said they were finished %.0fs ago and the agent has not ended "
                         "the call — wrapping it up", now - signed_off)
            else:
                log.info("the agent said goodbye and left the line open — wrapping it up")
            try:
                await _handle_end_call(twilio_ws, live_ws, "", state)
            except websockets.ConnectionClosed:
                return
            continue
        # The agent told the caller it was putting them through, and then did not. GPT-Live decides
        # for itself whether to delegate, and on a real call it said "Of course, let me put you
        # through, one moment" and simply stopped — the caller waited, heard nothing, and hung up.
        # Saying it is a promise to the caller; this keeps it.
        if (
            run
            and run[0] == "agent"
            and not busy
            and not caller_speaking
            and state["human_number"]
            and not state["transfer_pending"]
            and not state.get("transfer_done")
            and state["last_audio_at"]
            and now - state["last_audio_at"] >= _PROMISE_GRACE_SECONDS
            and _promised_a_transfer(run[1])
        ):
            reason = _last_caller_words(state) or "Caller asked to be put through."
            log.warning("the agent said it was putting the caller through and then did not — "
                        "transferring them")
            try:
                await _handle_transfer(twilio_ws, live_ws, "", {"reason": reason}, state, cfg)
            except websockets.ConnectionClosed:
                return
            continue

        # ...and the same for a message. Saying "someone will get back to you" without calling
        # take_message leaves the caller certain their request is in hand and leaves us with
        # nothing — worse than never having offered, because they will not call again.
        if (
            run
            and run[0] == "agent"
            and not busy
            and not caller_speaking
            and not state["message_taken"]
            and state["message_reminders"] < _MESSAGE_REMINDER_LIMIT
            and state["last_audio_at"]
            and now - state["last_audio_at"] >= _PROMISE_GRACE_SECONDS
            and _promised_a_message(run[1])
        ):
            state["message_reminders"] += 1
            log.warning("the agent told the caller their message was taken and never called "
                        "take_message — reminding it (%d)", state["message_reminders"])
            try:
                await _append(live_ws, state, _STILL_NEED_THE_MESSAGE)
            except websockets.ConnectionClosed:
                return
            continue

        # The agent's turn so far (everything it has said since the caller last spoke) ended on a
        # FINISHED statement, and it has gone quiet. Judged by the transcript's closing punctuation,
        # which GPT-Live writes in every language it speaks. A question hands the turn back already;
        # no punctuation at all means it paused mid-sentence — measured on the real API at over 1.5s
        # ("…and Claude" … "training.") — and must not be talked over.
        if (
            run
            and run[0] == "agent"
            and not busy
            and not state["followup_asked"]
            and not caller_speaking
            and state["last_audio_at"]
            and now - state["last_audio_at"] >= _FOLLOWUP_SECONDS
            and run[1].rstrip().endswith((".", "!", "。", "！"))
            # A goodbye is a finished statement too, and prompting a hand-back after one asks the
            # caller "anything else?" seconds after being told to have a good day. Nor is there
            # anything to hand back to a caller who has already said they are done.
            and signed_off is None
            and not said_bye
        ):
            state["followup_asked"] = True
            log.info("agent stopped on a statement without handing the turn back — prompting a follow-up")
            try:
                await _append(live_ws, state, _ASK_ANYTHING_ELSE)
            except websockets.ConnectionClosed:
                return
            continue
        if (
            (state["greeted"] or state["greet_retried"])
            and not busy
            and not caller_speaking
            and not state["nudged"]
            and now - state["last_activity_at"] >= _STUCK_SECONDS
        ):
            state["nudged"] = True
            log.info(
                "%.0fs of dead air with nothing delegated — reminding the agent to act",
                now - state["last_activity_at"],
            )
            try:
                await _append(live_ws, state, _NUDGE)
            except websockets.ConnectionClosed:
                return


# ---------------------------------------------------------------------------
# Transcript
# ---------------------------------------------------------------------------


def _add_fragment(state: dict, speaker: str, evt: dict) -> None:
    text = evt.get("delta") or ""
    if not text:
        return
    if speaker not in state["fragment_fields_logged"]:
        # The transcript is ordered by start_ms only when every fragment carries it; this shows
        # which side (if either) does not.
        state["fragment_fields_logged"].add(speaker)
        log.info("first %s transcript fragment carries fields %s", speaker, sorted(evt))
    start = evt.get("start_ms")
    frags = state["fragments"]
    frags.append([speaker, start if isinstance(start, (int, float)) else None, len(frags), text])
    # Log turn by turn as it happens, like the Realtime bridge: a run ends when the other side talks.
    run = state["current_run"]
    if run and run[0] == speaker:
        run[1] += text
    else:
        _flush_run(state)
        state["current_run"] = [speaker, text]


def _flush_run(state: dict) -> None:
    run = state.get("current_run")
    if run and run[1].strip():
        log.info("%s: %s", run[0].upper(), " ".join(run[1].split()))
    state["current_run"] = None


def _sync_transcript(state: dict) -> None:
    """Rebuild state["transcript"] from the fragments, in the order the words were spoken.

    Both sides can talk at once, so fragments are ordered by when they STARTED rather than when they
    arrived, then consecutive fragments from the same speaker are joined into one turn.
    """
    frags = state["fragments"]
    if frags and all(f[1] is not None for f in frags):
        frags = sorted(frags, key=lambda f: (f[1], f[2]))
    turns: list[list[str]] = []
    for who, _start, _index, text in frags:
        if turns and turns[-1][0] == who:
            turns[-1][1] += text
        else:
            turns.append([who, text])
    state["transcript"] = [[who, " ".join(text.split())] for who, text in turns]


# ---------------------------------------------------------------------------
# Backend tool calls
# ---------------------------------------------------------------------------


async def _on_backend_event(
    twilio_ws: WebSocket, live_ws, evt: dict, state: dict, executor: ToolExecutor, cfg: Config
) -> None:
    inner = evt.get("event") or {}
    it = inner.get("type")
    if it == "response.output_item.done":
        item = inner.get("item") or {}
        if item.get("type") != "function_call" or item.get("status", "completed") != "completed":
            return
        call_id = item.get("call_id", "")
        if call_id in state["seen_calls"]:
            return
        state["seen_calls"].add(call_id)
        name = item.get("name", "")
        try:
            args = json.loads(item.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        if name == "end_call":
            await _handle_end_call(twilio_ws, live_ws, call_id, state)
        elif name == "transfer_to_human":
            await _handle_transfer(twilio_ws, live_ws, call_id, args, state, cfg)
        else:
            if name == "take_message":
                state["message_taken"] = True
            # Off the receive loop, so the caller's audio keeps flowing while the backend works.
            task = asyncio.create_task(_handle_tool_call(live_ws, call_id, name, args, executor, state))
            state["_tool_tasks"].add(task)
            task.add_done_callback(state["_tool_tasks"].discard)
    elif it == "response.created":
        if state["delegating_since"] is None:
            state["delegating_since"] = time.monotonic()
        log.info("backend is working")
    elif it == "response.output_text.delta":
        key = evt.get("delegation_id") or ""
        state["backend_text"][key] = state["backend_text"].get(key, "") + (inner.get("delta") or "")
    elif it == "response.completed":
        state["delegating_since"] = None
        text = " ".join(state["backend_text"].pop(evt.get("delegation_id") or "", "").split())
        log.info("backend finished%s", f": {text}" if text else " (no text)")
        _record_backend_usage(state, (inner.get("response") or {}).get("usage"), cfg)
    elif it in ("response.failed", "response.incomplete", "error"):
        state["delegating_since"] = None
        state["backend_text"].pop(evt.get("delegation_id") or "", None)
        log.warning("backend %s: %s", it, json.dumps(inner)[:1000])
    else:
        _log_unexpected(state, "backend", inner)


async def _send_tool_output(live_ws, call_id: str, output: str, *, resume: bool = True) -> None:
    # No call_id means nobody asked: the bridge decided to end the call itself, and there is no
    # function call waiting for a result. Sending one anyway is rejected — "Invalid 'item.call_id':
    # empty string" — which is a real error in the log for a call that was ending fine.
    if not call_id:
        return
    await live_ws.send(
        json.dumps(
            {
                "type": "response.item.create",
                "item": {"type": "function_call_output", "call_id": call_id, "output": output},
            }
        )
    )
    if resume:
        await live_ws.send(json.dumps({"type": "response.create"}))


async def _handle_tool_call(
    live_ws, call_id: str, name: str, args: dict, executor: ToolExecutor, state: dict
) -> None:
    log.info("tool call: %s %s", name, args)
    result = await executor.run(name, args)
    _note_outcome(state, name, args, result)
    if state["closing"]:
        return
    try:
        await _send_tool_output(live_ws, call_id, result)
    except websockets.ConnectionClosed:
        pass


async def _handle_end_call(twilio_ws: WebSocket, live_ws, call_id: str, state: dict) -> None:
    """Deliver the farewell ourselves, then hang up once the agent goes quiet.

    The backend is NOT resumed after end_call: left to continue it would compose a goodbye of its
    own, and the caller would hear two.
    """
    await _send_tool_output(live_ws, call_id, '{"ok": true}', resume=False)
    if state["hangup_pending"] or state["closing"]:
        return
    run = state["current_run"]
    if run and run[0] == "agent" and _said_goodbye(run[1]):
        # It has already said it. Asking for another is what put "Have a good day" and then, after
        # the pause while this tool call went to the backend, "Have a good day, goodbye" on the
        # same call. Let its own goodbye finish and hang up on that.
        log.info("end_call — the agent has already said goodbye; hanging up on that one")
        state["hangup_pending"] = True  # the sender stops pacing and empties what it holds
        state["closing_audio"] = 0.0
        state["hangup_task"] = asyncio.create_task(
            _hang_up_when_quiet(
                twilio_ws, state, min_audio=0.0, backstop=_HANGUP_FALLBACK_SECONDS
            )
        )
        return
    log.info("end_call — delivering the farewell, then hanging up")
    await _start_closing(
        twilio_ws, live_ws, state, _farewell_instruction(state),
        min_audio=_FAREWELL_MIN_AUDIO, backstop=_HANGUP_FALLBACK_SECONDS,
    )


async def _start_closing(
    twilio_ws: WebSocket, live_ws, state: dict, instruction: str, *, min_audio: float, backstop: float
) -> None:
    """Ask for the closing words, and hang up once they have been said (or the backstop fires)."""
    state["hangup_pending"] = True
    state["closing_audio"] = 0.0
    state["closing_event_id"] = await _append(live_ws, state, instruction)
    state["hangup_task"] = asyncio.create_task(
        _hang_up_when_quiet(twilio_ws, state, min_audio=min_audio, backstop=backstop)
    )


async def _hang_up_when_quiet(
    twilio_ws: WebSocket, state: dict, *, min_audio: float, backstop: float
) -> None:
    """Stand-in for the Realtime bridge's response.done: the closing words have been generated once
    enough of them has been heard and the agent has then stopped producing audio."""
    asked = time.monotonic()
    while not state["closing"]:
        await asyncio.sleep(0.2)
        now = time.monotonic()
        if (
            state["closing_audio"] >= min_audio
            and not state["out"]  # everything held has reached Twilio
            and now - state["last_audio_at"] >= _QUIET_SECONDS
        ):
            log.info("closing words finished (%.1fs of audio) — hanging up", state["closing_audio"])
            break
        if now - asked >= backstop:
            log.info("closing words not finished after %.0fs — hanging up anyway", backstop)
            break
    await _drain_and_close(twilio_ws, state)


# ---------------------------------------------------------------------------
# Voicemail (outbound) and transfer (inbound)
# ---------------------------------------------------------------------------


async def _watch_amd(queue: asyncio.Queue, live_ws, twilio_ws: WebSocket, state: dict) -> None:
    """If Twilio's AMD says a machine answered, leave the voicemail and hang up."""
    try:
        answered_by = await queue.get()
    except asyncio.CancelledError:
        return
    if not is_machine(answered_by) or state["closing"] or state["hangup_pending"]:
        return
    log.info("AMD says voicemail (%s) — leaving a message, then hanging up", answered_by)
    state["outcome"] = "voicemail"
    # From here the model hears silence instead of the machine, so nothing interrupts the message.
    state["leaving_voicemail"] = True
    await twilio_ws.send_json({"event": "clear", "streamSid": state["stream_sid"]})
    await _start_closing(
        twilio_ws, live_ws, state,
        "Stop whatever you were saying. " + _VOICEMAIL_INSTRUCTION,
        min_audio=_VOICEMAIL_MIN_AUDIO, backstop=_VOICEMAIL_BACKSTOP_SECONDS,
    )


def _still_speaking(state: dict) -> bool:
    """Is the caller still HEARING the agent?

    Not the same question as "did audio arrive recently", which is what this used to ask. Audio
    arrives from the model far faster than it plays — a fifteen-second answer can land in about a
    second and then sit in the reservoir being paced out — so arrival time said the agent had
    finished talking while the caller was still a sentence behind. Acting on that cut a hand-off
    line off mid-word: the caller heard "let me put you through, one mo—" and then the transfer.
    """
    now = time.monotonic()
    return (
        bool(state["out"])  # still queued here
        or state["play_until"] > now  # still queued at Twilio
        or now - state["last_audio_at"] < _RECENTLY_SPOKE_SECONDS  # more may be on its way
    )


async def _handle_transfer(
    twilio_ws: WebSocket, live_ws, call_id: str, args: dict, state: dict, cfg: Config
) -> None:
    """Hand the caller to a person. Mirrors bridge._handle_transfer."""
    await _send_tool_output(live_ws, call_id, '{"ok": true}', resume=False)
    if state["transfer_pending"] or state.get("transfer_done") or state["closing"]:
        return
    reason = (args.get("reason") or "").strip() or "Caller would like to book something."
    named = (args.get("caller_name") or "").strip()
    if named and not state["caller_name"]:
        state["caller_name"] = named
    log.info("transfer_to_human — %s", reason)
    state["transfer_pending"] = reason
    await _append(live_ws, state, _STOP_FOR_TRANSFER)

    if _still_speaking(state):
        # The agent is saying its own hold line — let it finish playing, then hand off. The mark
        # below is queued behind the audio, so it comes back once the caller has heard all of it.
        await _drain_and_transfer(twilio_ws, live_ws, cfg, state)
        return

    # It said it a moment ago and has since gone quiet — usually while the backend worked out the
    # arguments. The caller has been told; saying it again in Twilio's voice is a second, robotic
    # copy of what they just heard, which is how a smooth hand-off turns into an obviously
    # automated one.
    run = state["current_run"]
    if run and run[0] == "agent" and _promised_a_transfer(run[1]):
        log.info("the agent already told the caller it was putting them through — handing off "
                 "without repeating it")
        await _do_transfer(cfg, live_ws, state)
        return

    log.info("transfer requested with no hold line spoken — handing off immediately")
    state["transfer_hold_line"] = _SPOKEN_HOLD_LINE
    await _do_transfer(cfg, live_ws, state)


async def _drain_and_transfer(twilio_ws: WebSocket, live_ws, cfg: Config, state: dict) -> None:
    if state["closing"] or state.get("transfer_done"):
        return
    if state["transfer_marks"] >= _TRANSFER_MARK_LIMIT:
        # It is still talking several rounds later. Waiting longer serves the model, not the
        # caller, who was told they were being put through some time ago.
        log.info("the agent is still speaking after %d marks — handing off anyway",
                 state["transfer_marks"])
        await _do_transfer(cfg, live_ws, state)
        return
    state["transfer_marked"] = True
    state["transfer_marks"] += 1
    state["transfer_mark_at"] = time.monotonic()
    await twilio_ws.send_json(
        {"event": "mark", "streamSid": state["stream_sid"], "mark": {"name": "transfer"}}
    )

    async def _fallback() -> None:
        await asyncio.sleep(_TRANSFER_FALLBACK_SECONDS)
        await _do_transfer(cfg, live_ws, state)

    # One overall cap, not one per mark.
    if state.get("transfer_fallback") is None:
        state["transfer_fallback"] = asyncio.create_task(_fallback())


async def _do_transfer(cfg: Config, live_ws, state: dict) -> None:
    """Redirect the live call to the human. Idempotent. Mirrors bridge._do_transfer."""
    if state.get("transfer_done"):
        return
    state["transfer_done"] = True
    _sync_transcript(state)
    result = await transfer.redirect_to_human(
        cfg,
        call_sid=state["call_sid"],
        reason=state["transfer_pending"] or "",
        caller=state["caller"],
        human_number=state["human_number"],
        dialled=state["dialled"],
        caller_name=state["caller_name"] or _name_from_transcript(_turns(state)),
        hold_line=state.get("transfer_hold_line", ""),
    )
    if result == "ok":
        state["outcome"] = "transferred"
        return
    if result == "call_gone":
        log.info("transfer aborted — the caller had already hung up")
        state["transfer_pending"] = None
        state["outcome"] = "caller_hung_up"
        return
    log.warning("transfer failed — falling back to taking a message")
    state["transfer_pending"] = None
    state["outcome"] = "transfer_failed"
    try:
        await _append(live_ws, state, _TRANSFER_FAILED_INSTRUCTION)
    except websockets.ConnectionClosed:
        pass


# ---------------------------------------------------------------------------
# Cost
# ---------------------------------------------------------------------------


def _record_backend_usage(state: dict, usage, cfg: Config) -> None:
    """Account one backend response's tokens. Never allowed to take a call down."""
    try:
        if not isinstance(usage, dict):
            return
        tokens_in = int(usage.get("input_tokens") or 0)
        cached = int((usage.get("input_tokens_details") or {}).get("cached_tokens") or 0)
        tokens_out = int(usage.get("output_tokens") or 0)
        u = state["backend_usage"]
        u["in"] += tokens_in
        u["cached"] += cached
        u["out"] += tokens_out
        u["cost"] += backend_cost(cfg.openai_live_backend_model, tokens_in, cached, tokens_out)
        u["responses"] += 1
    except Exception as exc:  # noqa: BLE001
        log.warning("could not read backend usage (%s); the call is unaffected", exc)


def _log_live_cost(state: dict, cfg: Config) -> None:
    seconds = state["voice_seconds"]
    estimated = seconds is None
    if estimated:
        seconds = time.monotonic() - state["started"]
    voice = seconds / 60 * VOICE_PRICE_PER_MINUTE
    u = state["backend_usage"]
    cached_pct = u["cached"] / u["in"] * 100 if u["in"] else 0.0
    log.info(
        "call cost (live): voice %ds%s $%.4f + backend %s %d responses, %d in (%.0f%% cached), "
        "%d out $%.4f = $%.4f",
        int(seconds), " (estimated)" if estimated else "", voice, cfg.openai_live_backend_model,
        u["responses"], u["in"], cached_pct, u["out"], u["cost"], voice + u["cost"],
    )
    # The barge-in diagnostic. A caller who interrupts still hears up to this much of the agent,
    # because it is already queued at Twilio. Well under a second is fine; seconds means Twilio's
    # buffer has to be cleared on interruption.
    log.info("agent audio ran up to %.1fs ahead of playback", state["max_playback_lead"])
    if state["live_closed"]:
        log.warning("this call ended because the GPT-Live session closed, not because the "
                    "conversation finished")
    if state["underruns"]:
        log.warning("the agent's audio ran dry %d time(s), %.1fs of gaps in total — the caller "
                    "heard it cut out", state["underruns"], state["underrun_seconds"])
        # Which end was at fault. This process being healthy while the audio stopped means OpenAI
        # stopped sending, and the only defence here is to buffer further ahead.
        log.warning(
            "during those gaps: OpenAI left up to %.0fms between chunks mid-sentence; this process "
            "was late by at most %.0fms (%d wake-ups over %.0fms) — %s",
            state["max_delta_gap"] * 1000, state["max_loop_lag"] * 1000, state["loop_stalls"],
            _LOOP_LAG_SECONDS * 1000,
            "the stalls are upstream" if state["max_loop_lag"] < _LOOP_LAG_SECONDS
            else "THIS PROCESS was blocked; that is ours to fix",
        )
