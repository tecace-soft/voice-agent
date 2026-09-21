"""A stand-in for voiceagent_promo's API, for the Demos end-to-end check (demos_e2e.py).

Mirrors the real routes the dashboard uses, as they behave in the promo repo @ f482848:
- POST /api/admin/login {password} -> 200 {ok} + httpOnly admin_session cookie, or 401 {error};
  a body that isn't parsable JSON (an empty one included) -> 400 {error: "Invalid request body."}
- DELETE /api/admin/login -> 200 {ok}, clears the cookie
- every other /api/admin/* needs the cookie, else 401 {error: "Not signed in."} (its middleware)
- GET /api/admin/health -> 503 JSON (the promo's "config incomplete" answer — still signed in)
- GET /api/admin/customers -> {customers: [...]}; GET /api/admin/customers/<id> -> {customer, ...}
  or 404 {error: "Customer not found."}
Every response this fake sends is JSON, as the promo's are for the routes above — but two known
gaps from the real thing: the real promo answers an unknown route with Next's own HTML 404 page,
where this fake is more lenient and still answers JSON; and the real login cookie carries `Secure`
under NODE_ENV=production, which this fake omits (the harness only ever runs over plain http, where
a Secure cookie would just get silently dropped). No state beyond the browser's cookie.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

PORT = 8898
PASSWORD = "letmein"
COOKIE = "admin_session"
TOKEN = "valid-session"

PROSPECTS = [
    {"id": "pr0SPct1", "businessName": "Harbor Dental", "status": "ready",
     "profile": {"name": "Harbor Dental", "category": "Dentist"}},
    {"id": "cedar42", "businessName": "Cedar Bakery", "status": "researching",
     "profile": {"name": "", "category": ""}},
]


class _Server(ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict, cookie: str | None = None) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)

    def _signed_in(self) -> bool:
        raw = self.headers.get("cookie", "")
        pairs = dict(p.strip().split("=", 1) for p in raw.split(";") if "=" in p)
        return pairs.get(COOKIE) == TOKEN

    def _body_bytes(self) -> bytes:
        length = int(self.headers.get("content-length") or 0)
        return self.rfile.read(length) if length else b""

    def _handle(self, method: str) -> None:
        path = urlparse(self.path).path
        if path == "/api/admin/login" and method == "POST":
            raw = self._body_bytes()
            try:
                body = json.loads(raw)  # an empty body fails too, as the promo's request.json() does
                if not isinstance(body, dict):
                    raise ValueError("login body must be a JSON object")
            except ValueError:
                self._send(400, {"error": "Invalid request body."})
                return
            if body.get("password") == PASSWORD:
                self._send(200, {"ok": True},
                           f"{COOKIE}={TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800")
            else:
                self._send(401, {"error": "Wrong password."})
            return
        if path == "/api/admin/login" and method == "DELETE":
            self._send(200, {"ok": True}, f"{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
            return
        if path.startswith("/api/admin/") and not self._signed_in():
            self._send(401, {"error": "Not signed in."})
            return
        if path == "/api/admin/health" and method == "GET":
            self._send(503, {"ok": False, "version": "fake", "onVercel": False, "checks": {}})
            return
        if path == "/api/admin/customers" and method == "GET":
            self._send(200, {"customers": PROSPECTS})
            return
        prefix = "/api/admin/customers/"
        if path.startswith(prefix) and method == "GET":
            wanted = unquote(path[len(prefix):])
            match = next((p for p in PROSPECTS if p["id"] == wanted), None)
            if match is None:
                self._send(404, {"error": "Customer not found."})
            else:
                self._send(200, {"customer": match, "stats": {}, "calls": [], "events": [], "notes": []})
            return
        self._send(404, {"error": f"No fake for {method} {path}"})

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler naming
        self._handle("GET")

    def do_POST(self):  # noqa: N802
        self._handle("POST")

    def do_DELETE(self):  # noqa: N802
        self._handle("DELETE")

    def log_message(self, *_args):
        pass


def start(port: int = PORT) -> ThreadingHTTPServer:
    server = _Server(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


if __name__ == "__main__":
    srv = start()
    print(f"fake promo on http://127.0.0.1:{PORT} (password {PASSWORD!r}) — Ctrl+C to stop")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        srv.shutdown()
