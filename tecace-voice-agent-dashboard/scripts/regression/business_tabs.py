"""The Business tab's Knowledge and Prompt tabs, opened in a browser.

They are the demo prospects' own editors rendering a real customer's profile, so what this checks is
that the same controls are there, that they save to the business endpoints (not the demo ones), and
that the two styling systems keep out of each other's way — the page around them is the transcribe
stylesheet and the tabs are Tailwind scoped to `.tw`.

Run (one at a time — these scripts share ports):  python scripts/regression/business_tabs.py
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
BACKEND_PORT = 8896
APP_PORT = 4182
SAM = "sam@samsdental.example"


class Checks:
    def __init__(self) -> None:
        self.failed = 0

    def __call__(self, name: str, ok: bool, detail: str = "") -> None:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f"   -- {detail}"))
        if not ok:
            self.failed += 1


def build(out: Path) -> None:
    import os

    print(f"  building the app -> {out}")
    result = subprocess.run(
        ["npm", "run", "build", "--", "--outDir", str(out), "--emptyOutDir"],
        cwd=APP_ROOT, capture_output=True, text=True, shell=True,
        env={**os.environ, "BACKEND_URL": f"http://127.0.0.1:{BACKEND_PORT}"},
    )
    if result.returncode != 0:
        raise SystemExit(f"build failed:\n{result.stdout[-4000:]}\n{result.stderr[-4000:]}")


def serve(out: Path):
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
        with tempfile.TemporaryDirectory(prefix="business-tabs-") as tmp:
            out = Path(tmp) / "app"
            build(out)
            server = serve(out)
            base = f"http://127.0.0.1:{APP_PORT}"
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")
                    ctx = browser.new_context()
                    # Signed in as the customer whose business this is, the way the app does it.
                    ctx.add_init_script(
                        "localStorage.setItem('transcribe.token', 'tok-user')"
                    )
                    page = ctx.new_page()
                    errors: list[str] = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    sent: list[tuple[str, str, str]] = []
                    page.on(
                        "request",
                        lambda r: sent.append((r.method, r.url, r.post_data or "")),
                    )

                    page.goto(f"{base}/#/business", wait_until="networkidle")
                    page.wait_for_timeout(600)
                    body = page.inner_text("body")
                    check("the Business page still loads", "Sam's Dental" in body, body[:200])

                    # ---- the two tabs are there, and they are the demo's
                    check("there is a Knowledge tab", page.get_by_role("tab", name="Knowledge").count() == 1)
                    check("there is a Prompt tab", page.get_by_role("tab", name="Prompt").count() == 1)

                    # ---- Knowledge: the demo editor's own fields, holding this business's data
                    for label, value in [
                        ("Business name", "Sam's Dental"),
                        ("Category", "Dental practice"),
                        ("Address", "12 Wharf St, Portland, ME"),
                        ("Phone", "+1 207 555 0142"),
                    ]:
                        field = page.get_by_label(label, exact=True).first
                        check(f"Knowledge: {label} holds the profile",
                              field.input_value() == value, f"{label}={field.input_value()!r}")

                    check("Knowledge: the hours rows are the week",
                          page.get_by_label("Day", exact=True).count() == 7,
                          str(page.get_by_label("Day", exact=True).count()))
                    check("Knowledge: the services are rows, not a sentence",
                          page.get_by_label("Service name", exact=True).count() == 3)
                    check("Knowledge: the policies are named fields",
                          page.get_by_label("Cancellation", exact=True).count() == 1)
                    check("Knowledge: the caller questions are there",
                          page.get_by_label("Question", exact=True).count() == 1)
                    check("Knowledge: highlights are one per line",
                          "Same-week appointments" in page.get_by_label("Highlights, one per line").input_value())

                    # ---- editing a field and saving hits the BUSINESS endpoint, not the demo one
                    phone = page.get_by_label("Phone", exact=True).first
                    phone.fill("+1 207 555 0199")
                    page.get_by_role("button", name="Save", exact=True).first.click()
                    page.wait_for_timeout(900)
                    saves = [s for s in sent if s[0] == "PUT" and "/business/knowledge" in s[1]]
                    check("Knowledge: Save PUTs /business/knowledge", len(saves) == 1, str(saves)[:200])
                    if saves:
                        payload = json.loads(saves[0][2] or "{}")
                        check("...carrying the whole profile, with the edit in it",
                              payload.get("profile", {}).get("phone") == "+1 207 555 0199"
                              and payload["profile"].get("name") == "Sam's Dental",
                              str(payload)[:200])
                    check("...and never the demo's own endpoint",
                          not any("/demo/" in s[1] for s in sent), str([s[1] for s in sent if "/demo/" in s[1]]))

                    # ---- Prompt: the three boxes, and what is NOT there
                    page.get_by_role("tab", name="Prompt").click()
                    page.wait_for_timeout(400)
                    for label in ("Voice prompt", "Backend prompt", "Greeting"):
                        check(f"Prompt: the {label} box is there",
                              page.get_by_label(label, exact=True).count() == 1)
                    check("Prompt: the receptionist name is editable",
                          page.get_by_label("Receptionist name", exact=True).count() == 1)
                    check("Prompt: Rebuild from data is offered",
                          page.get_by_role("button", name=re.compile("rebuild", re.I)).count() >= 1)
                    prompt_body = page.inner_text("body")
                    check("Prompt: no call-sound controls — a real call is already a phone call",
                          "Call sound" not in prompt_body and "Phone line" not in prompt_body)

                    # ---- editing a prompt marks it edited and saves to the business endpoint
                    page.get_by_label("Greeting", exact=True).fill("Open with: hello from Sam's.")
                    page.get_by_role("button", name="Save", exact=True).first.click()
                    page.wait_for_timeout(900)
                    prompt_saves = [s for s in sent if s[0] == "PUT" and "/business/prompts" in s[1]]
                    check("Prompt: Save PUTs /business/prompts", len(prompt_saves) == 1, str(prompt_saves)[:160])
                    if prompt_saves:
                        payload = json.loads(prompt_saves[0][2] or "{}")
                        check("...with the edited greeting",
                              "hello from Sam's" in payload.get("prompts", {}).get("greeting", ""),
                              str(payload)[:200])
                        check("...and rebuild off",
                              payload.get("rebuild") is not True, str(payload)[:120])
                    page.wait_for_timeout(400)
                    check("...and the page then says the prompts were edited by hand",
                          "edited by hand" in page.inner_text("body"))

                    # ---- Rebuild from data sends rebuild, and no prompts
                    page.get_by_role("button", name=re.compile("rebuild", re.I)).first.click()
                    page.wait_for_timeout(900)
                    rebuilds = [s for s in sent if s[0] == "PUT" and "/business/prompts" in s[1]][1:]
                    check("Rebuild: sends rebuild true", bool(rebuilds)
                          and json.loads(rebuilds[-1][2] or "{}").get("rebuild") is True,
                          str(rebuilds)[:160])
                    check("...and does NOT send the old text back as a hand edit",
                          bool(rebuilds) and "prompts" not in json.loads(rebuilds[-1][2] or "{}"),
                          str(rebuilds)[:160])

                    # ---- the two styling systems
                    scoped = page.evaluate(
                        """() => {
                          const tab = document.querySelector('.tw [role=tab]');
                          const card = document.querySelector('.card');
                          return {
                            tabInTw: Boolean(tab),
                            cardOutsideTw: Boolean(card) && !card.closest('.tw'),
                          };
                        }"""
                    )
                    check("the tabs render inside the .tw boundary", scoped["tabInTw"] is True)
                    check("...and the page's own cards stay outside it", scoped["cardOutsideTw"] is True)

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
    print("ALL BUSINESS TAB CHECKS PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
