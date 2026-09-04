"""The heart of the call: relay audio between Twilio and the OpenAI Realtime API, and run tools.

Flow of one call:
  1. Twilio connects the media stream and sends a "start" event carrying the streamSid and the
     lead's details (passed as <Stream> parameters — see outbound.py).
  2. We open a Realtime session, configured with instructions rendered for THIS lead + the tools.
  3. Two loops run concurrently: caller audio → OpenAI, and OpenAI audio/events → caller. Tool
     calls the model makes are executed against the backend and fed back.
Both sides speak G.711 μ-law, so audio bytes pass straight through (base64) with no conversion.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from ..config import Config
from ..telephony import transfer
from ..telephony.outbound import is_machine
from ..tools.business_config import fetch_business_config, post_inbound_call
from ..tools.agent_tools import INBOUND_TOOL_SCHEMAS, ToolExecutor
from . import amd
from . import dtmf
from .instructions import build_instructions
from .instructions_inbound import build_instructions as build_instructions_inbound
from .instructions_neutral import build_instructions_neutral
from .instructions_mini import build_instructions as build_instructions_mini
from .session import build_session_update

log = logging.getLogger(__name__)

_OPENAI_WS = "wss://api.openai.com/v1/realtime?model={model}"

# If Twilio never echoes our hang-up mark (it normally does within a second or two), close anyway
# after this long so a finished call can't hold the line — and the meter — open.
_HANGUP_FALLBACK_SECONDS = 12

# A voicemail message can legitimately run 10–15s; give it plenty of room to finish before the
# safety timer would force a hang-up (which would cut the message off mid-sentence).
_VOICEMAIL_BACKSTOP_SECONDS = 30


async def _open_realtime(cfg: Config):
    """Open the Realtime connection.

    A coroutine wrapper, not `asyncio.create_task(websockets.connect(...))` — connect() returns a
    `connect` object that is awaitable but is NOT a coroutine, and create_task rejects it outright.
    """
    return await websockets.connect(
        _OPENAI_WS.format(model=cfg.openai_model),
        additional_headers={"Authorization": f"Bearer {cfg.openai_api_key}"},
    )


async def _accept_forwarded_call(twilio_ws: WebSocket, cfg: Config, state: dict) -> None:
    """Press the digit a forwarding carrier is waiting for, then let the agent greet.

    Some carriers answer OUR leg first and play "this is a forwarded call, press 1 to accept" —
    the real caller is not bridged until a digit arrives, and they hear ringing until it does. The
    agent has no fingers, so it presses for them.

    Sent TWICE. The prompt may not be listening for the first one (it starts a beat after the
    stream opens, and cut-through varies by carrier), and a second press on a call that is already
    bridged is a short beep rather than a problem. Better a stray beep than a caller left ringing.

    Only ever runs on a call that arrived forwarded — `forwarded_from` set by /incoming — so a
    direct caller never hears a tone.
    """
    digit = cfg.forward_accept_digit.strip()
    frames = dtmf.tone_frames(digit)
    # Everything heard from now until the announcement stops belongs to the CARRIER, not the
    # caller — who is still hearing ringing and has not been bridged. Held across the digit and
    # for a beat after, because the prompt keeps talking until it registers the press.
    attempts = cfg.forward_accept_attempts
    tone_seconds = len(frames) * dtmf.FRAME_MS / 1000
    state["forward_guard_until"] = (
        time.monotonic()
        + cfg.forward_accept_delay
        + cfg.forward_accept_gap * (attempts - 1)
        + tone_seconds * attempts
        + cfg.forward_announcement_seconds
    )
    for attempt in range(1, attempts + 1):
        await asyncio.sleep(cfg.forward_accept_delay if attempt == 1 else cfg.forward_accept_gap)
        if state.get("closing"):
            return
        for frame in frames:
            await twilio_ws.send_json(
                {"event": "media", "streamSid": state["stream_sid"], "media": {"payload": frame}}
            )
            # Paced at real time: a DTMF detector expects the tone to arrive as it would be spoken,
            # and some reject a burst that lands all at once.
            await asyncio.sleep(dtmf.FRAME_MS / 1000)
        log.info(
            "sent DTMF %r to accept the forwarded call (attempt %d of %d)", digit, attempt, attempts
        )


async def run_bridge(twilio_ws: WebSocket, cfg: Config) -> None:
    await twilio_ws.accept()

    # Open the model connection FIRST. It needs nothing from Twilio, so it has no reason to queue
    # behind the start event — that handshake and this one can happen at the same time, and every
    # millisecond of them is silence on the caller's line.
    _connecting = asyncio.create_task(_open_realtime(cfg))

    # 1. Wait for Twilio's "start" event — it carries the streamSid, the call's SID (for AMD), and
    #    the lead's context.
    stream_sid, call_sid, params = await _await_start(twilio_ws)
    if not stream_sid:
        # Nothing to bridge. Close the connection opened above rather than leaking a Realtime
        # session for a call that never started.
        try:
            await (await _connecting).close()
        except Exception:  # noqa: BLE001 — best effort; the call is already gone
            pass
        return
    # Which KIND of call is this? Outbound (we dialed a lead we already know) and inbound (a
    # stranger dialed the company's main line) are different jobs, so they get different rules and
    # different tools. The parameter is set by the /incoming webhook; anything without it — every
    # outbound call, unchanged — falls through to the outbound path below.
    is_inbound = str(params.get("direction", "")).strip().lower() == "inbound"

    # INVARIANT: nothing between the connection task above and the `async with` below may raise,
    # or the socket is orphaned. fetch_business_config catches everything and returns None (a
    # backend outage must not take the phone line down), and the rest is string formatting.
    business = None  # set on the inbound path once we know whose call this is
    caller = str(params.get("caller", ""))
    is_mini = "mini" in cfg.openai_model.lower()

    if is_inbound:
        dialled = str(params.get("dialled", ""))
        log.info(
            "inbound call started from %r to %r (transfer_failed=%r)",
            caller or "unknown",
            dialled or "unknown",
            params.get("transfer_failed"),
        )

        # Whose business is this? One agent answers for several customers, so the number that was
        # dialled decides which one. None means we could not tell — unassigned number, or the
        # dashboard is unreachable — and then the agent must NOT fall back to the .env business,
        # because that would read one customer's facts to another customer's caller. It answers
        # neutrally instead: helpful, honest, and incapable of saying anything false about a company.
        business = await fetch_business_config(cfg, dialled)
        if business is None:
            log.warning("answering %r neutrally — no business identified", dialled or "unknown")
            instructions = build_instructions_neutral(
                caller=caller,
                timezone=cfg.timezone,
                disclose_recording=cfg.disclose_recording,
            )
        else:
            # Every business-specific value comes from the LOOKUP, not from cfg. The .env
            # business settings are now only the outbound agent's and a local-dev convenience —
            # reading them here is what would put one customer's facts in another's call.
            instructions = build_instructions_inbound(
                caller=caller,
                business_name=business.business_name,
                # The customer's choice when they've made one, ours otherwise. It is their
                # business the caller thinks they've reached, so the name answering for it is
                # theirs to pick.
                agent_name=business.agent_name or cfg.agent_name,
                business_hours=business.hours_text,
                business_facts=business.facts,
                open_hour=business.open_hour,
                close_hour=business.close_hour,
                timezone=cfg.timezone,
                transfer_failed=str(params.get("transfer_failed", "")).lower() in ("yes", "true", "1"),
                disclose_recording=cfg.disclose_recording,
                greeting=business.greeting or cfg.greeting,
                transfer_topics=business.transfer_topics,
                can_transfer=bool(business.transfer_number),
            )
        # A business with nobody to transfer to doesn't get the tool at all. Telling the model not
        # to offer it is necessary but not sufficient — removing it means a model that tries anyway
        # simply cannot, rather than reaching a dead end mid-call.
        tools = INBOUND_TOOL_SCHEMAS
        if business is not None and not business.transfer_number:
            tools = [t for t in INBOUND_TOOL_SCHEMAS if t.get("name") != "transfer_to_human"]
    else:
        log.info(
            "call started for lead_name=%r intake_id=%r",
            params.get("lead_name"),
            params.get("intake_id"),
        )
        # 2. Render instructions + tools for this specific lead. The smaller "mini" model uses its
        #    own shorter, more prescriptive prompt (instructions_mini.py); the full model uses
        #    instructions.py.
        build = build_instructions_mini if is_mini else build_instructions
        instructions = build(
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
        tools = None  # the outbound default set
    executor = ToolExecutor(cfg, intake_id=params.get("intake_id", ""))

    # 3. Configure the Realtime session on the connection opened above.
    state = {
        "stream_sid": stream_sid,
        "response_active": False,
        # Has the agent spoken any audio since the lead last talked? Used to refuse a
        # "silent" end_call (hanging up with no goodbye) and force a farewell first.
        "spoke_since_user": False,
        # A hang-up the model asked for that's waiting on a goodbye being spoken first.
        "hangup_pending": False,
        # Set once we've begun closing, so the hang-up can't fire twice.
        "closing": False,
        # True while leaving a voicemail: barge-in is suppressed (no live person to yield to, and
        # the machine's own audio must not cut the message or cancel the hang-up).
        "leaving_voicemail": False,
        # In-flight tool tasks, kept referenced so they aren't garbage-collected.
        "_tool_tasks": set(),
        # Running transcript of the call: [speaker, text] slots, in the order the words were
        # SPOKEN. A caller slot is reserved when they stop speaking and filled when their
        # transcription arrives, which is why these are mutable lists rather than tuples.
        "transcript": [],
        # item_id -> index of the transcript slot awaiting that caller turn's words.
        "pending_lead_turns": {},
        # Whether this call is on the mini model — used to apply mini-only tweaks (e.g. a verbatim
        # farewell) WITHOUT changing anything for the full realtime model.
        "is_mini": is_mini,
        # What the call resulted in, inferred from the tools the agent used (booked / callback /
        # declined / wrong_number …); None if nothing conclusive happened.
        "outcome": None,
        # Monotonic start time, for the call duration in the summary.
        "started": time.monotonic(),
        # ---- inbound-only (all inert on an outbound call) ----
        # INBOUND ONLY: has the agent said anything yet? Until it has, the caller has heard
        # nothing and therefore cannot have replied — so anything "heard" in that window is line
        # noise, a carrier's forwarding announcement, or Whisper inventing a phrase from silence
        # ("Bye-bye" and "Thank you" are its favourites). Both the audio and any transcript of it
        # are dropped until the greeting starts.
        #
        # Never applied outbound: that agent deliberately stays SILENT until the lead speaks first,
        # so gating on "have we spoken" there would drop the lead's hello and hang the call.
        "greeted": False,
        # Monotonic deadline before which nothing on the line is the caller: a forwarding carrier
        # is still playing "press 1 to accept". 0.0 on every call that did not arrive forwarded.
        "forward_guard_until": 0.0,
        "is_inbound": is_inbound,
        "caller": caller,
        "call_sid": call_sid,
        # This customer's own person to put callers through to. Empty on an outbound call, and on
        # an inbound one where the business hasn't given us a number — the agent is then told it
        # cannot transfer, rather than offering something that would fail.
        "human_number": business.transfer_number if business else "",
        # The reason string for a transfer the agent asked for, held while its hold line plays
        # out; the redirect fires on the mark echo. None when no transfer is in flight.
        "transfer_pending": None,
        # Messages taken from callers we could not transfer; appended to the call log at end.
        "messages": [],
        # Who the caller said they were, captured when they said it. Separate from `messages`
        # because most callers give a name and never leave a message — reading the name only off a
        # message meant every other call was filed as anonymous despite the name being right there
        # in the transcript.
        "caller_name": "",
    }
    # Register for this call's answering-machine-detection result (delivered by the /amd webhook).
    # Outbound only: AMD answers "did a machine pick up the call WE placed?", which is
    # meaningless inbound — a human already dialed us — so we neither arm it nor watch it there.
    amd_queue = amd.register(call_sid) if not is_inbound else None
    try:
        async with await _connecting as openai_ws:
            # The names this particular call will contain. The business's own name is the one the
            # transcriber gets wrong most, because it is the one word it has never heard.
            vocabulary = [cfg.agent_name]
            if business:
                # The chosen name too — an invented or unusual assistant name is exactly the kind
                # of word the transcriber has never heard and will otherwise rewrite.
                vocabulary += [
                    business.agent_name,
                    business.business_name,
                    business.user_name,
                    business.website,
                ]
            await openai_ws.send(
                json.dumps(build_session_update(cfg, instructions, tools, vocabulary))
            )
            # Kept so the session can be rebuilt if the model rejects semantic turn detection.
            state["_session"] = (instructions, tools, vocabulary)
            # INBOUND ONLY: we are answering a ringing phone, so the agent has to speak first. The
            # outbound agent deliberately stays silent until the lead says "hello", so this is
            # gated — without the gate an outbound lead would be talked over on pickup, and without
            # the call an inbound caller would hear dead air until they spoke first.
            # A forwarding carrier may be holding the caller behind "press 1 to accept". Press it
            # and wait BEFORE greeting: a greeting spoken into that prompt reaches nobody, and the
            # caller hears ringing throughout. Direct calls skip this entirely.
            forwarded_from = str(params.get("forwarded_from", ""))
            if is_inbound and forwarded_from:
                # Twilio already played the accept digits before this stream opened, so by now the
                # announcement is normally over. The guard covers its tail: whatever is still on
                # the line is the carrier finishing its sentence, not the caller.
                state["forward_guard_until"] = time.monotonic() + cfg.forward_announcement_seconds
                # The in-band press is kept as a fallback for a carrier that ignores the TwiML
                # digits, but is OFF by default: on a call that IS already bridged it puts an
                # audible beep in the real caller's ear.
                if cfg.forward_accept_inband and cfg.forward_accept_digit.strip():
                    log.info("call arrived forwarded from %s — sending the in-band accept digit",
                             forwarded_from)
                    await _accept_forwarded_call(twilio_ws, cfg, state)
                # Only the IN-BAND press needs to finish before we speak — the digit is going up
                # this same stream, and a greeting mixed into it reaches nobody. Twilio's TwiML
                # press happened before this stream even opened, so on that path there is nothing
                # to wait for: the guard below still keeps the announcement's tail out of the
                # model's ears, but it no longer sits the caller in silence first.
                if cfg.forward_accept_inband:
                    remaining = state.get("forward_guard_until", 0.0) - time.monotonic()
                    if remaining > 0:
                        await asyncio.sleep(remaining)
                # Whatever was buffered during the prompt is the announcement, not speech.
                await openai_ws.send(json.dumps({"type": "input_audio_buffer.clear"}))

            if is_inbound:
                await openai_ws.send(json.dumps({"type": "response.create"}))
            # Watch for the AMD result in the background: if it's a machine, have the agent leave a
            # voicemail and end the call. Does nothing for a live person.
            watcher = (
                asyncio.create_task(_watch_amd(amd_queue, openai_ws, twilio_ws, state))
                if amd_queue is not None
                else None
            )
            relays = [
                asyncio.create_task(_caller_to_model(twilio_ws, openai_ws, cfg, state)),
                asyncio.create_task(_model_to_caller(twilio_ws, openai_ws, state, executor, cfg)),
            ]
            try:
                # 4. Relay both directions until EITHER side ends.
                #
                # asyncio.wait, not gather. gather waits for BOTH, and the two directions do not end
                # together: when the caller hangs up, the Twilio side returns immediately while the
                # model side is still blocked reading from OpenAI, which knows nothing about it. The
                # bridge then sat there holding an open Realtime session until OpenAI timed it out —
                # the call never finalized, the transcript was never written, and the stale session
                # took the next call down with it.
                done, pending = await asyncio.wait(relays, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                # Let the cancellations settle before the `async with` closes the socket underneath
                # them, and swallow the CancelledError we just caused.
                await asyncio.gather(*pending, return_exceptions=True)
                # A relay that ended by raising still has to surface, or a real failure would look
                # exactly like a normal hang-up.
                for task in done:
                    if task.exception() is not None:
                        raise task.exception()  # noqa: RSE102 — re-raise the original
            finally:
                for task in relays:
                    task.cancel()
                if watcher is not None:
                    watcher.cancel()
    except Exception as exc:  # noqa: BLE001 — surface, don't crash the server
        log.warning("bridge ended: %s", exc)
    finally:
        amd.unregister(call_sid)
        await _finalize_call(state, params, executor, cfg)


def _record(state: dict, speaker: str, text: str | None) -> None:
    """Append a completed turn to the running transcript and log it as it happens."""
    line = (text or "").strip()
    if not line:
        return
    state["transcript"].append([speaker, line])
    log.info("%s: %s", speaker.upper(), line)


def _reserve_lead_turn(state: dict, item_id: str) -> None:
    """Hold the caller's place in the transcript at the moment they stopped speaking.

    The caller's words are transcribed by a SEPARATE pass that finishes whenever it finishes —
    often after the agent has already heard the audio, thought, and replied. Appending on arrival
    therefore files the caller's question AFTER the answer to it, and the saved transcript reads as
    if the agent volunteered facts nobody asked for and the caller talked to themselves.

    So the slot is claimed here, in true conversational order (this event fires when their speech
    segment closes), and filled in later when the words arrive.
    """
    if not item_id or item_id in state["pending_lead_turns"]:
        return
    state["transcript"].append(["lead", ""])
    state["pending_lead_turns"][item_id] = len(state["transcript"]) - 1


def _fill_lead_turn(state: dict, item_id: str, text: str | None) -> None:
    """Put the caller's words into the slot reserved when they spoke."""
    line = (text or "").strip()
    slot = state["pending_lead_turns"].pop(item_id, None)
    if slot is None:
        # No reservation — the commit was missed or gated. Late and out of order beats lost.
        _record(state, "lead", line)
        return
    state["transcript"][slot][1] = line
    if line:
        log.info("LEAD: %s", line)


# The agent greeting the caller by name — "Hi Michael,", "Thanks Dana." It does this naturally and
# almost always, which makes it a better signal than anything the caller said: the model has already
# done the work of deciding which word was the name.
_ADDRESSED = re.compile(
    r"\b(?i:hi|hello|hey|thanks|thank you|nice to meet you|good to meet you)[,!]?\s+"
    r"([A-Z][a-zA-Z\u2019'-]{1,20})\b"
)
# Words that follow a greeting and are emphatically not names.
_NOT_A_NAME = {
    "there", "again", "everyone", "folks", "all", "sir", "madam", "ma", "you", "so", "much",
    "for", "and", "ok", "okay", "yes", "no", "well", "sure", "good", "great",
}


def _name_from_transcript(turns: list[tuple[str, str]]) -> str:
    """Recover the caller's name from what was said, when the tool call never came.

    note_caller is the intended route and this is the safety net, because a model that is mid
    conversation does not reliably stop to make a silent tool call — and a transcript that plainly
    reads "Caller: Michael." above a record saying nobody gave a name is indefensible.

    The rule is deliberately narrow: the AGENT must have addressed someone by name, AND that name
    must also appear in something the CALLER said. Either signal alone misfires — the agent says
    "Hi there", or the caller mentions a third party — but a word the agent used to address them
    that the caller also uttered is, in practice, their name.
    """
    said_by_caller = " ".join(text for who, text in turns if who != "agent").lower()
    if not said_by_caller:
        return ""
    for who, text in turns:
        if who != "agent":
            continue
        for candidate in _ADDRESSED.findall(text):
            if candidate.lower() in _NOT_A_NAME:
                continue
            # The cross-check: the caller has to have said it too.
            if re.search(rf"\b{re.escape(candidate.lower())}\b", said_by_caller):
                return candidate
    return ""


def _turns(state: dict) -> list[tuple[str, str]]:
    """The transcript as completed turns, dropping slots whose words never arrived.

    An empty slot is a caller segment we reserved but never got words for — VAD tripping on line
    noise, or a transcription that failed. It is not a silent turn the caller took, so it must not
    appear as one.
    """
    return [(who, text) for who, text in state["transcript"] if text]


def _note_outcome(state: dict, name: str, args: dict, result: str) -> None:
    """Infer the call's outcome from the tool the agent just used successfully."""
    try:
        data = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        data = {}
    if name == "book_appointment" and data.get("booked"):
        state["outcome"] = "booked"
    elif name == "schedule_callback" and data.get("scheduled"):
        state["outcome"] = "callback"
    elif name == "mark_outcome":
        outcome = (args.get("outcome") or "").strip()
        if outcome:
            state["outcome"] = outcome  # wrong_number / declined / unreachable
    elif name == "note_caller":
        # Deliberately does NOT touch state["outcome"]: learning who is calling says nothing about
        # how the call ended, and treating it as an outcome would relabel ordinary calls.
        got = (args.get("caller_name") or "").strip()
        if got:
            state["caller_name"] = got
    elif name == "take_message" and data.get("recorded"):
        # Inbound only. There is no intake row to hang this on (a stranger called us), so keep it
        # on the call and let _finalize_call write it out with the transcript.
        state["messages"].append(args)
        state["outcome"] = "message"


_OUTCOME_SUMMARY = {
    "booked": "Booked a consultation.",
    # Inbound screening outcomes.
    "transferred": "Transferred the caller to a person.",
    "transfer_failed": "Tried to transfer but nobody was available.",
    "message": "Took a message for the team.",
    "callback": "Asked to be called back later.",
    "declined": "Not interested — declined.",
    "wrong_number": "Wrong number.",
    "unreachable": "Could not reach the lead.",
    "voicemail": "Left a voicemail.",
}


def _fmt_duration(seconds: float) -> str:
    total = int(seconds)
    return f"{total // 60}m {total % 60}s"


def _summary(state: dict) -> str:
    """A one-line summary: what happened + how long the call took."""
    base = _OUTCOME_SUMMARY.get(state.get("outcome") or "", "Call ended with no clear outcome.")
    return f"{base} ({_fmt_duration(time.monotonic() - state.get('started', time.monotonic()))})"


def _log_call_end(state: dict, params: dict) -> None:
    """When the call ends, log the whole transcript in one block for easy review."""
    turns = _turns(state)
    lead = params.get("lead_name") or "?"
    if not turns:
        log.info("call ended (lead %s) — no transcript captured", lead)
        return
    block = "\n".join(f"  {who.upper()}: {text}" for who, text in turns)
    log.info("call ended (lead %s) — %s — %d turns:\n%s", lead, _summary(state), len(turns), block)


async def _finalize_call(
    state: dict, params: dict, executor: ToolExecutor, cfg: Config | None = None
) -> None:
    """At call end: log the transcript, then persist it (+ summary) to the backend per lead."""
    _log_call_end(state, params)
    turns = _turns(state)
    if not turns:
        return
    transcript_text = "\n".join(f"{who.upper()}: {text}" for who, text in turns)
    for msg in state.get("messages", []):
        transcript_text += (
            "\n\n--- MESSAGE TAKEN ---"
            f"\nName: {msg.get('caller_name') or '(not given)'}"
            f"\nCallback: {msg.get('callback_number') or state.get('caller') or '(not given)'}"
            f"\nRegarding: {msg.get('message') or '(not given)'}"
        )
    await executor.record_call_log(transcript_text, _summary(state))

    # INBOUND ONLY: also send the call to the dashboard, where the customer reads it the way they
    # read a transcribed voicemail. An outbound lead callback belongs to an intake and already has
    # a home; this is for the calls that arrive out of nowhere.
    if cfg is not None and state.get("is_inbound") and params.get("dialled"):
        # The first message the agent took, if any. take_message asks for the name and reads the
        # callback number back to confirm it, so these are CONFIRMED rather than guessed — which
        # is the thing a voicemail recording can never give us.
        msg = (state.get("messages") or [{}])[0]
        # Worked out ONCE, and logged, so a call that files as anonymous says which of the three
        # routes was tried and what each gave. Without this the only symptom is a blank field in
        # the dashboard, which cannot distinguish "the model never called note_caller" from "this
        # build does not have the fallback" from "the transcript genuinely had no name".
        recovered = _name_from_transcript(turns)
        caller_name = msg.get("caller_name") or state.get("caller_name") or recovered or ""
        log.info(
            "caller name: message=%r tool=%r transcript=%r -> %r",
            msg.get("caller_name") or "",
            state.get("caller_name") or "",
            recovered,
            caller_name,
        )
        await post_inbound_call(
            cfg,
            {
                "dialled": params.get("dialled", ""),
                "caller": state.get("caller") or "",
                # Sent so the backend can spot a carrier that presents the FORWARDING line as the
                # caller — if the two match, the caller ID is not the caller's.
                "forwardedFrom": params.get("forwarded_from", ""),
                # A name confirmed for a MESSAGE is the most deliberate one, so it wins; then the
                # one the agent recorded as it heard it; then, if it never made that call, the one
                # the conversation itself shows.
                "callerName": caller_name,
                "callbackNumber": msg.get("callback_number") or "",
                "request": msg.get("message") or "",
                "summary": _summary(state),
                "outcome": state.get("outcome") or "",
                "callbackRequested": bool(state.get("messages")),
                "durationSeconds": int(time.monotonic() - state.get("started", time.monotonic())),
                "turns": [
                    # "lead" is the outbound word for the other party; the dashboard says "caller".
                    {"speaker": "agent" if who == "agent" else "caller", "text": text}
                    for who, text in turns
                ],
            },
        )


async def _await_start(twilio_ws: WebSocket) -> tuple[str, str, dict]:
    """Read Twilio events until the 'start' arrives; return (streamSid, callSid, customParameters)."""
    try:
        while True:
            evt = json.loads(await twilio_ws.receive_text())
            if evt.get("event") == "start":
                start = evt.get("start", {})
                return (
                    start.get("streamSid", ""),
                    start.get("callSid", ""),
                    (start.get("customParameters") or {}),
                )
            if evt.get("event") == "stop":
                return "", "", {}
    except WebSocketDisconnect:
        return "", "", {}


_VOICEMAIL_INSTRUCTION = (
    "You've reached the person's voicemail, not a live person. Leave a brief spoken message in the "
    "language the person spoke to you (English if you haven't heard them speak): say you're Tess "
    "from TecAce, following up on the "
    "consultation they requested, and that you'll try again soon. Do NOT ask questions or wait for "
    "a reply, and do NOT mention email. Keep it under 15 seconds and speak only the message."
)


async def _send_voicemail_response(openai_ws) -> None:
    """Drive a response whose only job is to speak the voicemail message."""
    await openai_ws.send(
        json.dumps({"type": "response.create", "response": {"instructions": _VOICEMAIL_INSTRUCTION}})
    )


async def _watch_amd(queue: asyncio.Queue, openai_ws, twilio_ws: WebSocket, state: dict) -> None:
    """Wait for Twilio's answering-machine-detection result. If a machine answered, cut whatever
    the agent was saying, have it leave a voicemail, and end the call. Does nothing for a human."""
    try:
        answered_by = await queue.get()
    except asyncio.CancelledError:
        return
    if not is_machine(answered_by) or state.get("closing") or state.get("hangup_pending"):
        return
    log.info("AMD says voicemail (%s) — leaving a message, then hanging up", answered_by)
    state["outcome"] = "voicemail"
    state["leaving_voicemail"] = True  # suppress barge-in for the rest of the call
    state["hangup_pending"] = True
    state["spoke_since_user"] = False
    # Cut any half-spoken greeting to the machine, cancel whatever's in flight (best-effort — if
    # nothing is active OpenAI just logs an error), give it a beat to settle, then leave the
    # voicemail. We don't rely on response-state tracking here since it can drift.
    await twilio_ws.send_json({"event": "clear", "streamSid": state["stream_sid"]})
    await openai_ws.send(json.dumps({"type": "response.cancel"}))
    await asyncio.sleep(0.4)
    await _send_voicemail_response(openai_ws)

    async def _backstop() -> None:
        # Long enough that a full voicemail message finishes first; only fires if it truly stalls.
        await asyncio.sleep(_VOICEMAIL_BACKSTOP_SECONDS)
        if state.get("hangup_pending"):  # message never completed — end anyway
            await _drain_and_close(twilio_ws, state)

    state["hangup_backstop"] = asyncio.create_task(_backstop())


async def _caller_to_model(twilio_ws: WebSocket, openai_ws, cfg: Config, state: dict) -> None:
    """Forward the caller's audio to the model."""
    try:
        while True:
            evt = json.loads(await twilio_ws.receive_text())
            e = evt.get("event")
            if e == "media":
                # Nothing the caller could say yet — they have not heard us. Covers the silence a
                # transcriber turns into phantom speech, and the carrier's forwarding
                # announcement, which keeps playing AFTER the agent has greeted and so outlives
                # the `greeted` gate on its own.
                if state.get("is_inbound") and not state.get("greeted"):
                    continue
                if time.monotonic() < state.get("forward_guard_until", 0.0):
                    continue
                await openai_ws.send(
                    json.dumps({"type": "input_audio_buffer.append", "audio": evt["media"]["payload"]})
                )
            elif e == "mark":
                mark_name = (evt.get("mark") or {}).get("name")
                # The agent asked to hang up; Twilio echoes our "endcall" mark once it has played
                # all the audio queued before it (i.e. the goodbye finished). Now close the stream,
                # which ends the <Connect><Stream> and hangs up the call.
                if mark_name == "endcall":
                    await twilio_ws.close()
                    break
                # INBOUND ONLY: the same drain trick, but for a handoff instead of a hang-up. We
                # wait for the echo so the caller actually HEARS "let me put you through" before
                # the audio path is torn out from under them. Then redirect — and do NOT close the
                # socket: closing would end the <Connect> and drop the call we are trying to save.
                # Twilio tears the stream down itself once the redirect lands, and the "stop" event
                # below ends this loop cleanly.
                if mark_name == "transfer":
                    await _do_transfer(cfg, openai_ws, state)
                    continue
            elif e == "stop":
                break
    except WebSocketDisconnect:
        pass
    finally:
        await openai_ws.close()


async def _model_to_caller(
    twilio_ws: WebSocket, openai_ws, state: dict, executor: ToolExecutor, cfg: Config
) -> None:
    """Forward the model's audio to the caller and handle tool calls + barge-in."""
    try:
        async for raw in openai_ws:
            evt = json.loads(raw)
            t = evt.get("type")

            if t == "response.output_audio.delta":
                # The FIRST chunk is the only honest measure of the gap a caller sits through.
                # The transcript log fires when the agent stops talking, which is that gap plus the
                # length of the greeting — reading it as latency overstates it by several seconds.
                if not state["greeted"]:
                    log.info(
                        "first audio to the caller %.1fs after the stream opened",
                        time.monotonic() - state.get("started", time.monotonic()),
                    )
                state["spoke_since_user"] = True
                state["greeted"] = True
                await twilio_ws.send_json(
                    {"event": "media", "streamSid": state["stream_sid"], "media": {"payload": evt["delta"]}}
                )
            elif t == "response.created":
                state["response_active"] = True
            elif t == "response.done":
                state["response_active"] = False
                # INBOUND ONLY: the hold line ("let me put you through") has finished — drain it to
                # the caller, then hand off. Outbound never sets transfer_pending, so this branch is
                # unreachable there and the hang-up path below is untouched.
                if state.get("transfer_pending") and state.get("spoke_since_user"):
                    await _drain_and_transfer(twilio_ws, openai_ws, cfg, state)
                # If a hang-up is pending and the agent just spoke (its farewell / voicemail),
                # close now — we don't wait for the model to call end_call a second time.
                elif state.get("hangup_pending") and state.get("spoke_since_user"):
                    await _drain_and_close(twilio_ws, state)
            elif t == "input_audio_buffer.speech_started":
                # While leaving a voicemail there's no live person to yield to — the machine's own
                # audio must NOT cut our message or cancel the hang-up. Ignore it.
                if state.get("leaving_voicemail"):
                    continue
                # The forwarding announcement is not a person interrupting. Worse, the "clear"
                # below flushes Twilio's outbound buffer — which is where our accept digit is
                # still queued. Barging in on the carrier's own prompt therefore DELETES the tone
                # we are sending it, the press never registers, and the caller rings forever.
                if time.monotonic() < state.get("forward_guard_until", 0.0):
                    continue
                # The lead started talking. Reset the "agent has spoken" flag so a goodbye is
                # required again before we'll hang up, and cancel any pending hang-up — they have
                # more to say. Also barge-in: flush what we're playing and stop the current
                # response so it doesn't talk over them.
                state["spoke_since_user"] = False
                state["hangup_pending"] = False
                await twilio_ws.send_json({"event": "clear", "streamSid": state["stream_sid"]})
                if state["response_active"]:
                    await openai_ws.send(json.dumps({"type": "response.cancel"}))
            elif t == "response.output_audio_transcript.done":
                # What the AGENT just said (transcribed from its own audio).
                _record(state, "agent", evt.get("transcript"))
            elif t == "input_audio_buffer.committed":
                # The caller's speech segment just closed. Claim their place in the transcript NOW,
                # while we know where it belongs — the words themselves arrive later, out of order.
                if not (state.get("is_inbound") and not state.get("greeted")):
                    _reserve_lead_turn(state, evt.get("item_id", ""))
            elif t == "conversation.item.input_audio_transcription.completed":
                # What the LEAD just said (transcribed from their audio) — unless the agent has not
                # spoken yet, in which case they cannot have said anything and this is a
                # hallucination or the carrier's prompt. Logged, not silently binned, so a real
                # mis-gate is visible rather than mysterious.
                if state.get("is_inbound") and not state.get("greeted"):
                    log.info("ignoring %r heard before the greeting", evt.get("transcript"))
                    state["pending_lead_turns"].pop(evt.get("item_id", ""), None)
                else:
                    _fill_lead_turn(state, evt.get("item_id", ""), evt.get("transcript"))
            elif t == "response.function_call_arguments.done":
                if evt.get("name") == "end_call":
                    await _handle_end_call(twilio_ws, openai_ws, evt, state)
                elif evt.get("name") == "transfer_to_human":
                    # Handled by the bridge, not the executor: a transfer is call plumbing (it
                    # replaces the running TwiML), exactly like end_call is.
                    await _handle_transfer(twilio_ws, openai_ws, evt, state, cfg)
                else:
                    # Run the tool WITHOUT blocking this receive loop: while the backend request is
                    # in flight, events that arrive (the response finishing, or the lead saying
                    # "okay") get handled in order rather than piling up and cancelling the tool's
                    # own reply once it's created. Keep a reference so the task isn't GC'd.
                    task = asyncio.create_task(
                        _handle_tool_call(twilio_ws, openai_ws, evt, executor, state)
                    )
                    state["_tool_tasks"].add(task)
                    task.add_done_callback(state["_tool_tasks"].discard)
            elif t == "error":
                err = evt.get("error") or {}
                text = f"{err.get('message', '')} {err.get('param', '')}".lower()
                # A model that does not accept semantic_vad would otherwise leave the session with
                # NO turn detection at all — the agent would never hear a turn end and the call
                # would be dead air. Rebuild it once on plain server_vad rather than lose the call.
                if not state.get("_vad_fell_back") and any(
                    k in text for k in ("turn_detection", "semantic_vad", "eagerness")
                ):
                    state["_vad_fell_back"] = True
                    log.warning(
                        "semantic turn detection rejected (%s) — falling back to server_vad",
                        err.get("message"),
                    )
                    built = state.get("_session")
                    if built:
                        await openai_ws.send(
                            json.dumps(
                                build_session_update(cfg, *built, force_server_vad=True)
                            )
                        )
                else:
                    log.warning("openai error: %s", err)
    except WebSocketDisconnect:
        pass
    except websockets.ConnectionClosed:
        pass


def _farewell_instruction(state: dict) -> str:
    """The per-response instruction that makes the model speak the farewell — and ONLY that. Kept
    out of the model's own composition on purpose: left to itself it narrates ("let me wrap this
    up…") or skips the farewell. Tailored to the outcome so a booked call looks forward to the
    consultation while a wrong number / decline just signs off warmly."""
    # INBOUND ONLY: the outbound farewells talk about "your consultation" and speak for a team
    # that called YOU — both wrong for a stranger who rang the main line. Checked first so neither
    # outbound branch below is reachable on an inbound call.
    if state.get("is_inbound"):
        return (
            "The call is over. Speak a short, warm sign-off to the caller, in the language they "
            "last spoke to you (translate the example if that language is not English). Thank them "
            'for calling and wish them a good day — for example: "Thanks for calling. Have a great '
            'day — goodbye!" Output ONLY the spoken words: do NOT announce or describe it, and do '
            "NOT say things like 'let me wrap this up'."
        )

    booked = state.get("outcome") == "booked"

    # MINI ONLY: the mini model won't reliably compose the farewell (it narrates "let me wrap this
    # up…"), so give it the exact words to say verbatim. The full model is untouched (below).
    if state.get("is_mini"):
        line = (
            "We look forward to talking with you. Have a wonderful day. Goodbye."
            if booked
            else "Thanks so much. Have a wonderful day. Goodbye."
        )
        return (
            "The call is over. Say EXACTLY the following, word for word, and NOTHING else — no "
            'preamble, no "let me wrap this up", no announcing it. Say it in the language the lead '
            f'last spoke to you — translate it if that language is not English. The line: "{line}"'
        )

    # FULL MODEL — unchanged behavior.
    if booked:
        core = (
            'On behalf of the team (use "we", not "I"), tell them we are looking forward to '
            "speaking with them at their consultation, then wish them a wonderful day and say "
            'goodbye — for example: "We are looking forward to speaking with you at your '
            'consultation. Have a wonderful day — goodbye!"'
        )
    else:
        core = (
            "Warmly wish them a wonderful day and say goodbye — for example: "
            '"Thanks so much. Have a wonderful day — goodbye!"'
        )
    return (
        "The call is ending now. Speak a short, warm farewell to the person, in the language the "
        "lead last spoke to you (translate the example if that language is not English). "
        + core
        + " Output ONLY the spoken farewell words — do NOT announce or describe it, and do NOT say "
        "things like 'let me wrap this up' or 'let me close things out'. Just say the farewell."
    )


async def _handle_end_call(twilio_ws: WebSocket, openai_ws, evt: dict, state: dict) -> None:
    """End the call. We ALWAYS deliver the farewell ourselves via a tight per-response instruction,
    then hang up once it plays — so the model can't narrate the goodbye, water it down, or skip it.
    The agent's only job is to CALL end_call when the conversation is genuinely over; the farewell
    wording and the hang-up are handled here.

    We ack the tool, then drive a farewell-only response. Its response.done triggers the drain (see
    _model_to_caller), and a backstop timer closes the line even if that farewell never comes.
    """
    call_id = evt.get("call_id", "")
    await openai_ws.send(
        json.dumps(
            {
                "type": "conversation.item.create",
                "item": {"type": "function_call_output", "call_id": call_id, "output": '{"ok": true}'},
            }
        )
    )
    # Already ending (a second end_call, or one fired during the farewell) — don't double up.
    if state.get("hangup_pending") or state.get("closing"):
        return

    log.info("end_call — delivering the farewell, then hanging up")
    state["hangup_pending"] = True
    # Anything the model may have said in THIS turn shouldn't count as the farewell: reset the flag
    # so the drain waits for the farewell response's audio (below), not this turn's response.done.
    state["spoke_since_user"] = False
    await openai_ws.send(
        json.dumps({"type": "response.create", "response": {"instructions": _farewell_instruction(state)}})
    )

    async def _backstop() -> None:
        await asyncio.sleep(_HANGUP_FALLBACK_SECONDS)
        if state.get("hangup_pending"):  # farewell never completed — end anyway
            await _drain_and_close(twilio_ws, state)

    state["hangup_backstop"] = asyncio.create_task(_backstop())


async def _drain_and_close(twilio_ws: WebSocket, state: dict) -> None:
    """Play out the buffered goodbye, then hang up. Idempotent (guarded by 'closing').

    Sends Twilio a "mark"; Twilio finishes playing everything queued and echoes it back (handled in
    _caller_to_model), which closes the stream and ends the <Connect><Stream> — i.e. hangs up. A
    fallback timer guarantees the hang-up even if the echo never arrives.
    """
    if state.get("closing"):
        return
    state["closing"] = True
    state["hangup_pending"] = False
    await twilio_ws.send_json(
        {"event": "mark", "streamSid": state["stream_sid"], "mark": {"name": "endcall"}}
    )

    async def _fallback() -> None:
        await asyncio.sleep(_HANGUP_FALLBACK_SECONDS)
        try:
            await twilio_ws.close()
        except Exception:  # noqa: BLE001 — best-effort backstop
            pass

    # Keep a reference on state so the task isn't garbage-collected before it fires.
    state["hangup_fallback"] = asyncio.create_task(_fallback())


# ---------------------------------------------------------------------------
# INBOUND ONLY — warm transfer to a human.
#
# Everything below is unreachable on an outbound call: nothing sets `transfer_pending` there, and
# `transfer_to_human` is not in the outbound tool set at all.
# ---------------------------------------------------------------------------

# If the hold line never finishes (the caller talked over it and the response was cancelled), hand
# off anyway rather than leaving them listening to nothing.
_TRANSFER_FALLBACK_SECONDS = 12

# Spoken to the caller immediately before the handoff, when the model called transfer_to_human
# without saying anything first. Same reasoning as the farewell: left to itself the model either
# narrates the transfer or says nothing, and silence right before the audio path is torn out reads
# as a dropped call.
_TRANSFER_HOLD_INSTRUCTION = (
    "You are about to put this caller through to a colleague. Say ONE short line telling them so, "
    "in the language they last spoke to you, and NOTHING else — no question, no recap of what they "
    'said. For example: "Of course — let me put you through to someone who can help. One moment." '
    "Then stop."
)

# The caller is still on the line and the handoff never happened. Recover in-conversation instead
# of leaving them in silence.
_TRANSFER_FAILED_INSTRUCTION = (
    "The transfer did not go through, and the caller is still on the line with you. Apologize once "
    "in ONE short sentence, then offer to take a message and ask for their name — in the language "
    "they last spoke to you. For example: \"Sorry about that — nobody's free right now. Can I take "
    'a message? May I start with your name?"'
)


async def _handle_transfer(
    twilio_ws: WebSocket, openai_ws, evt: dict, state: dict, cfg: Config
) -> None:
    """The agent asked to hand the caller to a person.

    Mirrors _handle_end_call: ack the tool, make sure the caller HEARS a hold line, and let the
    drain do the rest. What differs is the ending — a hang-up closes the socket, a transfer must
    emphatically not (see _caller_to_model).
    """
    call_id = evt.get("call_id", "")
    try:
        args = json.loads(evt.get("arguments") or "{}")
    except json.JSONDecodeError:
        args = {}
    await openai_ws.send(
        json.dumps(
            {
                "type": "conversation.item.create",
                "item": {"type": "function_call_output", "call_id": call_id, "output": '{"ok": true}'},
            }
        )
    )
    # One handoff attempt per call: a second is either the model repeating itself, or a retry after
    # a failure the caller has already been apologized to for.
    if state.get("transfer_pending") or state.get("transfer_done") or state.get("closing"):
        return

    reason = (args.get("reason") or "").strip() or "Caller would like to book something."
    log.info("transfer_to_human — %s", reason)
    state["transfer_pending"] = reason

    # If the model already spoke this turn, that WAS the hold line (the prompt asks for it before
    # the tool call) — just drain it. Otherwise force one, and hand off when it lands.
    if state.get("spoke_since_user"):
        await _drain_and_transfer(twilio_ws, openai_ws, cfg, state)
        return

    await openai_ws.send(
        json.dumps({"type": "response.create", "response": {"instructions": _TRANSFER_HOLD_INSTRUCTION}})
    )

    async def _backstop() -> None:
        await asyncio.sleep(_TRANSFER_FALLBACK_SECONDS)
        if state.get("transfer_pending") and not state.get("transfer_marked"):
            await _drain_and_transfer(twilio_ws, openai_ws, cfg, state)

    state["transfer_backstop"] = asyncio.create_task(_backstop())


async def _drain_and_transfer(
    twilio_ws: WebSocket, openai_ws, cfg: Config, state: dict
) -> None:
    """Play out the buffered hold line, then hand off. Idempotent (guarded by 'transfer_marked').

    Same mark-and-echo trick as _drain_and_close: Twilio finishes playing everything queued and
    echoes the mark back, and _caller_to_model performs the redirect on the echo.
    """
    if state.get("closing") or state.get("transfer_marked"):
        return
    state["transfer_marked"] = True
    await twilio_ws.send_json(
        {"event": "mark", "streamSid": state["stream_sid"], "mark": {"name": "transfer"}}
    )

    async def _fallback() -> None:
        # The echo normally lands in about a second. If it never does, transfer anyway — the
        # alternative is a caller holding on a line nobody is going to pick up.
        await asyncio.sleep(_TRANSFER_FALLBACK_SECONDS)
        await _do_transfer(cfg, openai_ws, state)

    state["transfer_fallback"] = asyncio.create_task(_fallback())


async def _do_transfer(cfg: Config, openai_ws, state: dict) -> None:
    """Redirect the live call to the human. Idempotent (guarded by 'transfer_done')."""
    if state.get("transfer_done"):
        return
    state["transfer_done"] = True
    ok = await transfer.redirect_to_human(
        cfg,
        call_sid=state.get("call_sid", ""),
        reason=state.get("transfer_pending") or "",
        caller=state.get("caller", ""),
        human_number=state.get("human_number", ""),
    )
    if ok:
        state["outcome"] = "transferred"
        return
    # The redirect never went out (no SID, no configured number, Twilio refused). The caller is
    # still connected to us, so recover in conversation rather than dropping them.
    log.warning("transfer failed — falling back to taking a message")
    state["transfer_pending"] = None
    state["outcome"] = "transfer_failed"
    state["spoke_since_user"] = False
    await openai_ws.send(
        json.dumps(
            {"type": "response.create", "response": {"instructions": _TRANSFER_FAILED_INSTRUCTION}}
        )
    )


# MINI ONLY: mini won't reliably confirm a scheduled callback and then call end_call on its own,
# so once the callback is booked we drive this single "confirm the time + goodbye" response and
# hang up ourselves. The full model handles its own callback ending (see instructions.py) and never
# reaches this path.
_CALLBACK_CONFIRM_INSTRUCTION = (
    "A callback was just scheduled. In ONE short sentence, tell the lead you'll call them back at "
    'the clock time from the tool result (say the actual time, e.g. "9:30 AM", not a relative '
    'amount like "in 5 minutes"), then say goodbye — for example: "Okay, I\'ll call you back at '
    '9:30 AM. Goodbye!" Say only that.'
)


def _scheduled_ok(result: str) -> bool:
    """True if a schedule_callback result confirms the callback was set."""
    try:
        return bool(json.loads(result).get("scheduled"))
    except (json.JSONDecodeError, TypeError, AttributeError):
        return False


async def _handle_tool_call(
    twilio_ws: WebSocket, openai_ws, evt: dict, executor: ToolExecutor, state: dict
) -> None:
    name = evt.get("name", "")
    call_id = evt.get("call_id", "")
    try:
        args = json.loads(evt.get("arguments") or "{}")
    except json.JSONDecodeError:
        args = {}
    log.info("tool call: %s %s", name, args)
    result = await executor.run(name, args)
    _note_outcome(state, name, args, result)
    # Feed the result back.
    await openai_ws.send(
        json.dumps(
            {
                "type": "conversation.item.create",
                "item": {"type": "function_call_output", "call_id": call_id, "output": result},
            }
        )
    )

    # Mini-only: after a callback is scheduled, drive one confirm-and-goodbye response and hang up
    # (its response.done triggers the drain), since mini won't call end_call itself here.
    if state.get("is_mini") and name == "schedule_callback" and _scheduled_ok(result):
        state["hangup_pending"] = True
        state["spoke_since_user"] = False
        await openai_ws.send(
            json.dumps(
                {"type": "response.create", "response": {"instructions": _CALLBACK_CONFIRM_INSTRUCTION}}
            )
        )

        async def _backstop() -> None:
            await asyncio.sleep(_HANGUP_FALLBACK_SECONDS)
            if state.get("hangup_pending"):
                await _drain_and_close(twilio_ws, state)

        state["hangup_backstop"] = asyncio.create_task(_backstop())
        return

    await openai_ws.send(json.dumps({"type": "response.create"}))
