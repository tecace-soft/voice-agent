"""External capabilities: the shared backend API and the post-call email notifier."""

from .backend import BackendClient, BackendError
from .notify import EmailNotifier

__all__ = ["BackendClient", "BackendError", "EmailNotifier"]
