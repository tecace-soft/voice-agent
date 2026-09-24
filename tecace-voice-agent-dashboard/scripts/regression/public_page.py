"""The prospect's page, opened in a browser: /c/<id> and its two sub-pages.

The bug this whole arrangement replaces was invisible to every other check here — the Share tab's
link looked right, and opening it landed on the dashboard's Overview because nothing served /c/<id>.
So this one does the thing a prospect does: it opens the link.

What it proves:
  * /c/<id> renders the business's own page, not the dashboard — no sidebar, no sign-in;
  * the page carries the business's data and none of the operator's;
  * the scenarios and pricing links are real navigations that land on real pages;
  * a link that is not a demo, and a paused demo, meet the quiet "not available" page;
  * the call button is there and dials /demo/public/session (stopped short of a real call: the
    fake answers with an SDP no browser can complete, which is as far as this can go offline);
  * the document never asks for the dashboard's own bundle.

Run (one at a time — these scripts share ports):  python scripts/regression/public_page.py
"""

from __future__ import annotations

import json
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
BACKEND_PORT = 8897
APP_PORT = 4181
DEMO_ID = "pr0SPct1"
PAUSED_ID = "cedar42"  # researching in the fixture, so it is the "not available" case too


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
    """A static server that mirrors vercel.json: /c/* -> c.html, everything else -> index.html."""
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
        # The rewrites, in vercel.json's order.
        return os.path.join(ROOT, "c.html" if clean.startswith("/c/") else "index.html")
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
        with tempfile.TemporaryDirectory(prefix="public-page-") as tmp:
            out = Path(tmp) / "app"
            build(out)
            server = serve(out)
            base = f"http://127.0.0.1:{APP_PORT}"
            try:
                with sync_playwright() as p:
                    # Edge, and a fake microphone — the same as demos_e2e.py, for the same two
                    # reasons: it is the Chromium that is installed here, and pressing call asks for
                    # a mic that a headless run has to be given.
                    browser = p.chromium.launch(channel="msedge", args=[
                        "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
                    page = browser.new_page()
                    errors: list[str] = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    requested: list[str] = []
                    page.on("request", lambda r: requested.append(r.url))

                    # ---- the demo page
                    page.goto(f"{base}/c/{DEMO_ID}", wait_until="networkidle")
                    body = page.inner_text("body")
                    check("the demo page shows the business", "Harbor Dental" in body, body[:200])
                    check("...and its receptionist by name", "Alex" in body)
                    check("...with a call button", page.get_by_role("button", name=re.compile("call", re.I)).count() >= 1)
                    check("...and the demo disclaimer", "has not endorsed it" in body)

                    # It is NOT the dashboard.
                    check("no dashboard chrome: no sidebar", page.locator(".sidebar").count() == 0)
                    check("no dashboard chrome: no sign-in", "Sign in" not in body, body[:200])

                    # Nothing the operator keeps about the prospect.
                    for secret in ("Met at the expo", "dana@harbordental.example", "Dana"):
                        check(f"the page does not carry {secret!r}", secret not in body)

                    # The document loaded the public bundle, never the dashboard's.
                    loaded = [u for u in requested if u.endswith(".js")]
                    check("it loads the public entry's chunk",
                          any("/assets/c-" in u for u in loaded), str(loaded))
                    check("...and never the dashboard's",
                          not any("/assets/index-" in u for u in loaded), str(loaded))

                    # ---- the scenarios page, reached by its own link
                    page.get_by_text(re.compile("see all .* scenarios", re.I)).first.click()
                    page.wait_for_load_state("networkidle")
                    check("the scenarios link lands on the scenarios page",
                          page.url.endswith(f"/c/{DEMO_ID}/scenarios"), page.url)
                    scenarios = page.inner_text("body")
                    check("...which names the business", "Harbor Dental" in scenarios)
                    check("...and offers the way back", "Back to the demo" in scenarios)

                    page.get_by_text("Back to the demo").first.click()
                    page.wait_for_load_state("networkidle")
                    check("...and the way back works", page.url.rstrip("/").endswith(f"/c/{DEMO_ID}"), page.url)

                    # ---- pricing
                    page.goto(f"{base}/c/{DEMO_ID}/pricing", wait_until="networkidle")
                    pricing = page.inner_text("body")
                    check("the pricing page renders its plans", "Solo" in pricing, pricing[:200])

                    # ---- the unavailable cases
                    page.goto(f"{base}/c/{PAUSED_ID}", wait_until="networkidle")
                    check("a demo that is not ready is the quiet page",
                          "isn't available" in page.inner_text("body"), page.inner_text("body")[:200])

                    page.goto(f"{base}/c/nosuchdemo1", wait_until="networkidle")
                    check("an unknown id is the quiet page",
                          "isn't available" in page.inner_text("body"))

                    page.goto(f"{base}/c/not%2Fan%2Fid", wait_until="networkidle")
                    check("an id that is not one never reaches the backend",
                          "isn't available" in page.inner_text("body"))

                    # ---- and the dashboard is still the dashboard
                    page.goto(f"{base}/", wait_until="networkidle")
                    check("/ is still the dashboard", "Sign in" in page.inner_text("body"),
                          page.inner_text("body")[:200])

                    # ---- pressing call dials the public session route
                    calls = [u for u in requested if "/demo/public/session" in u]
                    page.goto(f"{base}/c/{DEMO_ID}", wait_until="networkidle")
                    page.context.grant_permissions(["microphone"])
                    page.get_by_role("button", name=re.compile("call", re.I)).first.click()
                    page.wait_for_timeout(2500)
                    dialled = [u for u in requested if "/demo/public/session" in u]
                    check("pressing call dials /demo/public/session",
                          len(dialled) > len(calls), str(dialled))
                    check("...and the page view was tracked",
                          any("/demo/public/track" in u for u in requested))

                    check("no page errors", not errors, "; ".join(errors[:3]))
                    browser.close()
            finally:
                server.terminate()
    finally:
        backend.shutdown()

    print()
    if check.failed:
        print(f"{check.failed} CHECK(S) FAILED")
        return 1
    print("ALL PUBLIC PAGE CHECKS PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
