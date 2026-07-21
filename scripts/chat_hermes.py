"""Interactive voice chat with the Hermes agent.

    python scripts/chat_hermes.py            # type a message, hear Hermes reply
    python scripts/chat_hermes.py --no-voice # text only, no audio

Each message is sent to Hermes over its WebSocket; the reply is printed and
(with voice on) spoken aloud through your speakers in the configured ElevenLabs
voice — no file is saved and no player window opens.

Note: every turn is an independent Hermes session — there is no cross-turn
memory yet. This is a connectivity + voice check, not a stateful conversation.

Commands:  :quit  or  :q  to exit.
"""

from __future__ import annotations

import sys

from voice_agent.config import Config, ConfigError
from voice_agent.tools.hermes import HermesAuthError, HermesChat, HermesSession
from voice_agent.tools.voice import ElevenLabsVoice, VoiceError


def main(argv: list[str]) -> int:
    try:
        cfg = Config.load()
    except ConfigError as exc:
        print(f"config error: {exc}")
        return 1

    use_voice = "--no-voice" not in argv
    session = HermesSession(cfg)
    try:
        session.login()
    except HermesAuthError as exc:
        print(f"could not log in to Hermes: {exc}")
        return 1

    chat = HermesChat(session)
    voice = ElevenLabsVoice(cfg) if use_voice else None

    print(f"connected to Hermes ({cfg.hermes_model} via the server).")
    print(f"voice: {'on — ' + cfg.elevenlabs_voice_id if use_voice else 'off'}")
    print("type a message and press Enter. :quit to exit.\n")

    while True:
        try:
            text = input("you    > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if text in {":quit", ":q"}:
            return 0
        if not text:
            continue

        try:
            reply = chat.ask(text).strip()
        except Exception as exc:  # keep the session alive on a bad turn
            print(f"       (Hermes error: {type(exc).__name__}: {exc})")
            continue

        print(f"hermes > {reply}")

        if voice:
            try:
                voice.speak(reply)  # plays through the speakers, blocks until done
            except VoiceError as exc:
                print(f"       (voice error: {exc})")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
