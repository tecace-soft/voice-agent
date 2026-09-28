"""Signing up and getting in, in a browser: /start, the sign-in page's links, invite links.

What it proves:
  * /start is its own document (never the dashboard's bundle), and says how to reach us when this
    deployment can't send email (sign-up closed);
  * with sign-up open: the business's details, the emailed code (a wrong one refused), the build
    screen, and "Go to my receptionist" landing in the dashboard signed in, on their demo;
  * the sign-in page offers "Forgot password?" and "Create your AI receptionist" only when the
    backend can send email, and the forgot flow says a link is on its way;
  * an invite link (#/welcome?token=…) greets the person, takes the token out of the address bar,
    and signs them in once they choose a password; an expired one says so.

Runs against fake_backend.py (code always SIGNUP_CODE). One at a time — these scripts share ports:
    python scripts/regression/signup.py
"""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import fake_backend  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND_PORT = 8896
APP_PORT = 4182


class Checks:
    def __init__(self) -> None:
        self.failed = 0

    def __call__(self, name: str, ok: bool, detail: str = "") -> None:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"   -- {detail}"))
        if not ok:
            self.failed += 1


def build(out: Path) -> None:
    print(f"  building the app -> {out}")
    result = subprocess.run(
        ["npm", "run", "build", "--", "--outDir", str(out), "--emptyOutDir"],
        cwd=APP_ROOT,
        capture_output=True,
        text=True,
        shell=True,
        env={**__import__("os").environ, "BACKEND_URL": f"http://127.0.0.1:{BACKEND_PORT}"},
    )
    if result.returncode != 0:
        raise SystemExit(f"build failed:\n{result.stdout[-4000:]}\n{result.stderr[-4000:]}")


def serve(out: Path):
    """A static server that mirrors vercel.json: /c/* -> c.html, /start -> start.html, else index.html."""
    script = f'''
import http.server, os, socketserver
ROOT = {str(out)!r}
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)
    def translate_path(self, path):
        clean = path.split("?")[0].split("#")[0]
        target = os.path.join(ROOT, clean.lstrip("/"))
        if os.path.isfile(target):
            return target
        if clean.startswith("/c/"):
            return os.path.join(ROOT, "c.html")
        if clean.rstrip("/") == "/start":
            return os.path.join(ROOT, "start.html")
        return os.path.join(ROOT, "index.html")
    def log_message(self, *a):
        pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", {APP_PORT}), H) as httpd:
    httpd.serve_forever()
'''
    proc = subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.DEVNULL)
    for _ in range(80):
        try:
            import urllib.request

            urllib.request.urlopen(f"http://127.0.0.1:{APP_PORT}/index.html", timeout=0.4).read()
            return proc
        except Exception:
            time.sleep(0.1)
    proc.terminate()
    raise SystemExit("the static server never came up")


def main() -> int:
    check = Checks()
    backend = fake_backend.start(BACKEND_PORT)
    try:
        with tempfile.TemporaryDirectory(prefix="signup-") as tmp:
            out = Path(tmp) / "app"
            build(out)
            server = serve(out)
            base = f"http://127.0.0.1:{APP_PORT}"
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")
                    page = browser.new_page()
                    errors: list[str] = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    requested: list[str] = []
                    page.on("request", lambda r: requested.append(r.url))

                    # ---- no email here: sign-up closed, and the sign-in page offers neither link
                    fake_backend.SIGNUP_OPEN = False
                    page.goto(f"{base}/start", wait_until="networkidle")
                    body = page.inner_text("body")
                    check("/start without email says sign-up isn't open, and how to reach us",
                          "isn't open here yet" in body and "Contact us" in body, body[:300])
                    loaded = [u for u in requested if u.endswith(".js")]
                    check("/start loads its own entry, never the dashboard's",
                          any("/assets/start-" in u for u in loaded)
                          and not any("/assets/index-" in u for u in loaded), str(loaded))
                    page.goto(f"{base}/", wait_until="networkidle")
                    login = page.inner_text("body")
                    check("sign-in without email: no Forgot password, no sign-up link",
                          "Forgot password?" not in login and "Create your AI receptionist" not in login, login[:300])

                    # ---- sign-up open
                    fake_backend.SIGNUP_OPEN = True
                    page.goto(f"{base}/start", wait_until="networkidle")
                    page.get_by_label("Business name").wait_for(timeout=5000)
                    check("/start shows the sign-up form", page.get_by_role("heading", name="Create your receptionist").count() == 1)
                    page.get_by_label("Business name").fill("Rae's Noodles")
                    page.get_by_label("Website or Google Maps link").fill("raesnoodles.example")
                    page.get_by_label("Your name").fill("Rae Park")
                    page.get_by_label("Work email").fill("rae@noodles.example")
                    page.get_by_label("Password").fill("short")
                    page.get_by_role("button", name="Create my receptionist").click()
                    page.wait_for_timeout(300)
                    # The field's own minlength stops the form (the browser's message), before any request.
                    check("a short password is refused before anything is sent",
                          not fake_backend.SIGNUPS and page.get_by_label("Code").count() == 0)
                    page.get_by_label("Password").fill("a-good-password-1")
                    page.get_by_role("button", name="Create my receptionist").click()
                    page.get_by_label("Code").wait_for(timeout=5000)
                    sent = fake_backend.SIGNUPS[-1] if fake_backend.SIGNUPS else {}
                    check("...which sends the business and a website with https://",
                          sent.get("kind") == "start"
                          and sent.get("business", {}).get("websiteUrl") == "https://raesnoodles.example"
                          and sent.get("business", {}).get("businessName") == "Rae's Noodles", str(sent))
                    check("the code step names the address it went to", "rae@noodles.example" in page.inner_text("body"))
                    page.get_by_label("Code").fill("000000")
                    page.get_by_role("button", name="Continue").click()
                    page.wait_for_timeout(500)
                    check("a wrong code is refused", "isn't right" in page.inner_text("body"))
                    page.get_by_label("Code").fill(fake_backend.SIGNUP_CODE)
                    page.get_by_role("button", name="Continue").click()
                    page.get_by_text("Your receptionist is ready").wait_for(timeout=10000)
                    check("the right code builds the receptionist", True)
                    check("...and asked for the research run",
                          any(u.endswith("/auth/signup/research") for u in requested))
                    page.get_by_role("button", name="Go to my receptionist").click()
                    page.wait_for_url(re.compile(r"/#?/?"), timeout=5000)
                    page.get_by_text("My receptionist").first.wait_for(timeout=10000)
                    check("'Go to my receptionist' lands in the dashboard, signed in, on their demo",
                          page.locator(".sidebar").count() == 1)

                    # ---- the sign-in page with email: both links, and the forgot flow
                    page.evaluate("() => localStorage.removeItem('transcribe.token')")
                    page.goto(f"{base}/", wait_until="networkidle")
                    login = page.inner_text("body")
                    check("sign-in with email offers Forgot password and the sign-up link",
                          "Forgot password?" in login and "Create your AI receptionist" in login, login[:300])
                    check("...and the sign-up link goes to /start",
                          page.get_by_role("link", name="Create your AI receptionist").get_attribute("href") == "/start")
                    page.get_by_role("button", name="Forgot password?").click()
                    page.get_by_label("Email").fill("dana@harbordental.example")
                    page.get_by_role("button", name="Send reset link").click()
                    page.wait_for_timeout(500)
                    check("forgot password says a link is on its way, whoever asks",
                          "a link to set a new password is on its way" in page.inner_text("body"))

                    # ---- an invite link
                    # A link is opened fresh, not as a hash change on a page already open.
                    page.goto("about:blank")
                    page.goto(f"{base}/#/welcome?token=expired-token", wait_until="networkidle")
                    page.wait_for_timeout(500)
                    check("an expired link says so", "This link has expired" in page.inner_text("body"))
                    page.goto("about:blank")
                    page.goto(f"{base}/#/welcome?token={fake_backend.LINK_TOKEN}", wait_until="networkidle")
                    page.get_by_text("Welcome, Dana Reed").wait_for(timeout=5000)
                    check("an invite link greets them by name", True)
                    check("...and the token leaves the address bar", "token=" not in page.url, page.url)
                    page.get_by_label("New password").fill("dana-password-1")
                    page.get_by_label("Type it again").fill("dana-password-2")
                    page.get_by_role("button", name="Save and sign in").click()
                    page.wait_for_timeout(300)
                    check("mismatched passwords are refused", "don't match" in page.inner_text("body"))
                    page.get_by_label("Type it again").fill("dana-password-1")
                    page.get_by_role("button", name="Save and sign in").click()
                    page.get_by_text("My receptionist").first.wait_for(timeout=10000)
                    check("choosing a password signs them in", page.locator(".sidebar").count() == 1)
                    check("the sidebar offers Change password",
                          page.locator(".sidebar-user .user-password").count() == 1)

                    check("no page errors", not errors, "; ".join(errors[:3]))
                    browser.close()
            finally:
                server.terminate()
    finally:
        fake_backend.SIGNUP_OPEN = False
        backend.shutdown()

    print()
    if check.failed:
        print(f"{check.failed} CHECK(S) FAILED")
        return 1
    print("ALL SIGNUP CHECKS PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
