"""Client for the self-hosted Nous Research Hermes Agent app.

This deployment is the Hermes Agent web application (FastAPI), not an
OpenAI-compatible model server. Two transports, both discovered by reverse-
engineering the dashboard SPA:

1. REST management API — cookie session. POST credentials to
   /auth/password-login, then send the session cookie on every /api/* call.
   Used for status, config, env, model info. See HermesSession.
2. Live agent chat — a WebSocket at /api/ws authenticated by a short-lived
   ticket (POST /api/auth/ws-ticket), speaking JSON-RPC 2.0. The turn is driven
   by `session.create` then `prompt.submit`; the reply streams back as `event`
   notifications (message.delta / message.complete). See HermesChat.
"""

from __future__ import annotations

import asyncio
import http.cookiejar
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

import websockets

from ..config import Config


class HermesAuthError(RuntimeError):
    """Login failed or the session is not valid."""


class HermesSession:
    """A logged-in session against the Hermes Agent web API."""

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._server = cfg.hermes_server_url
        self._api = cfg.hermes_api_base
        self._jar = http.cookiejar.CookieJar()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self._jar)
        )

    # -- transport -------------------------------------------------------

    def _call(self, url: str, *, method: str = "GET", body: Any = None) -> tuple[int, str, str]:
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with self._opener.open(request, timeout=self._cfg.request_timeout) as response:
                return (
                    response.status,
                    response.headers.get("content-type", ""),
                    response.read().decode("utf-8", "replace"),
                )
        except urllib.error.HTTPError as exc:
            return exc.code, exc.headers.get("content-type", ""), exc.read().decode("utf-8", "replace")

    # -- auth ------------------------------------------------------------

    def login(self) -> None:
        if not self._cfg.hermes_username or not self._cfg.hermes_password:
            raise HermesAuthError(
                "HERMES_USERNAME / HERMES_PASSWORD are not set in .env."
            )
        status, _ctype, text = self._call(
            f"{self._server}/auth/password-login",
            method="POST",
            body={
                "provider": self._cfg.hermes_auth_provider,
                "username": self._cfg.hermes_username,
                "password": self._cfg.hermes_password,
            },
        )
        if status >= 400:
            raise HermesAuthError(f"login failed [{status}]: {text[:300]}")
        if not any(c.name for c in self._jar):
            raise HermesAuthError("login returned no session cookie")

    def get_json(self, path: str) -> Any:
        """GET an /api path (leading slash optional) and parse JSON."""
        url = path if path.startswith("http") else f"{self._api}/{path.lstrip('/')}"
        status, ctype, text = self._call(url)
        if status == 401:
            raise HermesAuthError(f"{url} is unauthenticated — call login() first")
        if "json" not in ctype:
            raise RuntimeError(f"{url} returned {ctype or 'unknown type'}, not JSON")
        return json.loads(text)

    def post_json(self, path: str, body: Any) -> Any:
        url = path if path.startswith("http") else f"{self._api}/{path.lstrip('/')}"
        status, ctype, text = self._call(url, method="POST", body=body)
        if status == 401:
            raise HermesAuthError(f"{url} is unauthenticated — call login() first")
        if status >= 400:
            raise RuntimeError(f"{url} failed [{status}]: {text[:300]}")
        if "json" not in ctype:
            raise RuntimeError(f"{url} returned {ctype or 'unknown type'}, not JSON")
        return json.loads(text)

    # -- env management --------------------------------------------------

    def reveal_env(self, key: str) -> str:
        """Return the plaintext value of a server env var (e.g. GOOGLE_API_KEY)."""
        result = self.post_json("env/reveal", {"key": key})
        return result.get("value", "")

    def set_env(self, key: str, value: str) -> Any:
        """PUT an env var on the server. Used to fix the Gemini key, for example."""
        status, ctype, text = self._call(
            f"{self._api}/env", method="PUT", body={"key": key, "value": value}
        )
        if status >= 400:
            raise RuntimeError(f"set_env {key} failed [{status}]: {text[:200]}")
        return json.loads(text) if "json" in ctype else text

    def model_info(self) -> dict[str, Any]:
        return self.get_json("model/info")

    def ws_ticket(self) -> str:
        result = self.post_json("auth/ws-ticket", {})
        return result["ticket"]

    def cookie_header(self) -> str:
        return "; ".join(f"{c.name}={c.value}" for c in self._jar)


class HermesChat:
    """One live chat turn against the Hermes agent over its WebSocket API.

    JSON-RPC 2.0 over ws://<host>/api/ws?ticket=<t>. A turn is:
    session.create -> prompt.submit -> stream `event` notifications until
    message.complete. Reasoning ("thinking"/"reasoning") deltas are ignored;
    only the assistant's message text is collected.
    """

    def __init__(self, session: HermesSession) -> None:
        self._session = session
        self._cfg = session._cfg

    def _ws_url(self, ticket: str) -> str:
        host = self._cfg.hermes_server_url.split("://", 1)[1]
        scheme = "wss" if self._cfg.hermes_server_url.startswith("https") else "ws"
        return f"{scheme}://{host}/api/ws?ticket={urllib.parse.quote(ticket)}"

    async def ask_async(self, text: str, *, timeout: float = 90.0) -> str:
        """Send one prompt, return the agent's completed message text."""
        self._session.login()
        ticket = self._session.ws_ticket()
        url = self._ws_url(ticket)
        headers = {"Cookie": self._session.cookie_header()}

        async with websockets.connect(url, additional_headers=headers) as ws:
            session_id = await self._create_session(ws)
            await ws.send(json.dumps({
                "jsonrpc": "2.0", "id": "prompt", "method": "prompt.submit",
                "params": {"session_id": session_id, "text": text},
            }))
            return await self._collect_reply(ws, timeout)

    async def _create_session(self, ws: Any) -> str:
        await ws.send(json.dumps({
            "jsonrpc": "2.0", "id": "create", "method": "session.create",
            "params": {"close_on_disconnect": True, "source": "tool"},
        }))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == "create":
                if "error" in msg:
                    raise RuntimeError(f"session.create failed: {msg['error']}")
                return msg["result"]["session_id"]

    async def _collect_reply(self, ws: Any, timeout: float) -> str:
        parts: list[str] = []
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
            msg = json.loads(raw)
            if msg.get("method") != "event":
                continue
            params = msg["params"]
            etype = params.get("type")
            if etype == "message.delta":
                parts.append(params.get("payload", {}).get("text", ""))
            elif etype == "message.complete":
                # message.complete carries the full text; prefer it if we have
                # no streamed deltas (e.g. a non-streamed error reply).
                full = params.get("payload", {}).get("text", "")
                return "".join(parts) if parts else full

    def ask(self, text: str, *, timeout: float = 90.0) -> str:
        """Synchronous wrapper around ask_async."""
        return asyncio.run(self.ask_async(text, timeout=timeout))


def status(cfg: Config) -> dict[str, Any]:
    """Unauthenticated /api/status — useful for a liveness/gateway check."""
    session = HermesSession(cfg)
    return session.get_json("status")
