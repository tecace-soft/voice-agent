"""External capabilities the intake agent calls: Gemini, Hermes, and the voice."""

from .cal import CalClient, CalError
from .gemini import GeminiTools
from .google_forms import GoogleFormsClient, GoogleFormsError
from .hermes import HermesAuthError, HermesChat, HermesSession, status
from .sheets import SheetsClient, SheetsError
from .voice import ElevenLabsVoice, VoiceError

__all__ = [
    "GeminiTools",
    "HermesAuthError",
    "HermesChat",
    "HermesSession",
    "status",
    "GoogleFormsClient",
    "GoogleFormsError",
    "ElevenLabsVoice",
    "VoiceError",
    "SheetsClient",
    "SheetsError",
    "CalClient",
    "CalError",
]
