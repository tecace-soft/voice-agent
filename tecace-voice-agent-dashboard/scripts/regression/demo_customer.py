"""What a demo-stage customer sees when they sign in, in a browser.

The rule this checks is "a demo customer sees only the demo": one item in the rail, their own record
and no other, none of the operator's controls on it, and no way to reach the rest by typing a URL.
Inside it, their receptionist's settings are a read-only preview: every section, nothing editable,
examples where nothing is set up yet, and an example call pointing at their own demo link.

The backend refuses all of it for that account as well — `routes/tenancy.pg.test.ts` is where that is
proved. What can only be checked here is that the dashboard does not OFFER what would be refused,
because an offer that fails is worse than no offer: it reads as a broken product.

Run (one at a time — these scripts share ports):  python scripts/regression/demo_customer.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import fake_backend  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND_PORT = 8898
APP_PORT = 4184
OWN_ID = "pr0SPct1"      # Harbor Dental — the record their account is linked to
OTHER_ID = "cedar42"     # Cedar Bakery — another prospect, none of their business


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
# Stated explicitly: SimpleHTTPRequestHandler otherwise asks the OS, and a Windows machine whose
# registry says .js is text/plain makes Edge refuse every module script — an app that never renders,
# with nothing on the page to say why. These entries win over the OS lookup.
for ext, kind in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css"),
                  (".html", "text/html"), (".svg", "image/svg+xml"), (".png", "image/png"),
                  (".mp4", "video/mp4"), (".json", "application/json")):
    H.extensions_map[ext] = kind
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
        with tempfile.TemporaryDirectory(prefix="demo-customer-") as tmp:
            out = Path(tmp) / "app"
            build(out)
            server = serve(out)
            base = f"http://127.0.0.1:{APP_PORT}"
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")
                    ctx = browser.new_context()
                    ctx.add_init_script("localStorage.setItem('transcribe.token', 'tok-demo')")
                    page = ctx.new_page()
                    errors: list[str] = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    asked: list[str] = []
                    page.on("request", lambda r: asked.append(f"{r.method} {r.url}"))
                    refused: list[str] = []
                    page.on(
                        "response",
                        lambda r: refused.append(f"{r.status} {r.url}") if r.status in (401, 403) else None,
                    )

                    # Straight to the dashboard root: whatever the default view is, theirs is their own.
                    page.goto(f"{base}/", wait_until="networkidle")
                    page.wait_for_timeout(1200)
                    body = page.inner_text("body")
                    check("their own business is on screen", "Harbor Dental" in body, body[:300])
                    check("...and the breadcrumb says what it is",
                          "My receptionist" in body, body[:200])

                    # ---- the rail
                    rail = page.get_by_role("navigation", name="Dashboard sections")
                    labels = [b.inner_text().strip() for b in rail.get_by_role("button").all()]
                    check("the rail offers their receptionist and nothing else",
                          [l for l in labels if l and "Sign out" not in l and "Changelog" not in l] == ["Overview", "Call activity", "Settings"],
                          str(labels))
                    for gone in ("All runs", "Business information", "Accounts",
                                 "Answered calls", "Transcripts", "Customers", "CRM", "Send feedback"):
                        check(f"...no {gone!r} in the rail", gone not in labels, str(labels))

                    # ---- their Overview (the landing): how the demo has been used
                    main = page.inner_text("main")
                    check("they land on their Overview", page.locator("main h1").first.inner_text().strip() == "Overview",
                          main[:200])
                    check("...with the demo's numbers and calls per day",
                          "Link opens" in main and "Calls per day" in main and "Recent calls" in main, main[:400])
                    check("...and what it couldn't answer", "No price list for implants" in main, main[:400])

                    # ---- Call activity: their calls, read-only, our tests left out
                    rail.get_by_role("button", name="Call activity").click()
                    page.get_by_role("heading", name="Call activity").wait_for()
                    page.wait_for_timeout(500)
                    check("Call activity lists their calls",
                          page.get_by_role("button", name="Open call details").count() >= 1)
                    check("...without the operator's Test switch or Analyze",
                          page.get_by_role("switch").count() == 0
                          and page.get_by_role("button", name="Analyze").count() == 0)
                    check("...and without our own test calls", "your own test" not in page.inner_text("main"))

                    # ---- their settings: every section, as a read-only preview
                    rail.get_by_role("button", name="Settings").click()
                    page.locator("#settings-section-title").wait_for()
                    page.wait_for_timeout(700)
                    body = page.inner_text("body")
                    # No tabs: Activity, Sources and Share are the operator's, and Settings is all that's left.
                    for tab in ("Activity", "Sources", "Share", "Settings"):
                        check(f"no {tab} tab", page.get_by_role("tab", name=tab).count() == 0)
                    check("the settings open on Business information",
                          page.locator("#settings-section-title").inner_text().strip() == "Business information")
                    check("...showing what the receptionist knows",
                          page.get_by_label("Business name", exact=True).count() == 1)
                    check("...read-only: the fields can't be edited",
                          page.get_by_label("Business name", exact=True).is_disabled())
                    check("...and it says so, in one line with Request setup", "A preview of your receptionist, read only." in body and "Request setup" in body, body[:400])
                    # Read off the menu itself, wherever it is shown at this width: the side menu, or
                    # the picker's options once it is opened.
                    menu = page.locator("nav[aria-label='Receptionist settings']")
                    if menu.is_visible():
                        offered = menu.inner_text()
                    else:
                        page.get_by_label("Settings section").click()
                        page.get_by_role("option").first.wait_for()
                        offered = " ".join(o.inner_text() for o in page.get_by_role("option").all())
                        page.keyboard.press("Escape")
                    for section in ("Business information", "Transfer calls", "Text a link", "Take a message",
                                    "Test & improve", "Launch instructions"):
                        check(f"...the menu previews {section!r} too", section in offered, offered[:200])

                    # A section with nothing set up shows examples of what it can do, and no way to add.
                    page.goto(f"{base}/#/demos/prospects/{OWN_ID}/text-link", wait_until="networkidle")
                    page.wait_for_timeout(700)
                    main = page.inner_text("main")
                    check("Text a link: examples stand in for an empty list",
                          "Examples of what you can set up" in main and "Example" in main, main[:400])
                    check("...with a sample call", "How it sounds on a call" in main, main[:400])
                    check("...and no Add button", page.get_by_role("button", name="Add a link").count() == 0)

                    # ---- none of the operator's controls
                    check("no live switch", page.get_by_label("Toggle the demo link").count() == 0)
                    check("no re-research", page.get_by_role("button", name="Re-research").count() == 0)
                    check("no demo-time menu", "Add time" not in body, body[:300])
                    check("no test-call panel — the allowance lives on their own demo link",
                          "Test call" not in page.inner_text("body"))
                    check("...an example call instead, pointing at their demo page",
                          page.locator(f"a[href$='/c/{OWN_ID}']").count() == 1)
                    check("no Save: nothing here is theirs to change yet",
                          page.get_by_role("button", name="Save", exact=True).count() == 0)

                    # ---- the URL is not a way out
                    for hash_path, why in [
                        ("#/overview", "the voicemail dashboard"),
                        ("#/business", "the Business section"),
                        ("#/accounts", "the accounts page"),
                        ("#/demos/prospects", "the prospect list"),
                        ("#/demos/pipeline", "the CRM"),
                        (f"#/demos/prospects/{OTHER_ID}", "another prospect"),
                    ]:
                        page.goto(f"{base}/{hash_path}", wait_until="networkidle")
                        page.wait_for_timeout(700)
                        text = page.inner_text("body")
                        check(f"{hash_path} does not reach {why}",
                              "Harbor Dental" in text and "My receptionist" in text, text[:200])

                    # Their own record is what every one of those landed on, so nothing in this run
                    # should have been refused — the dashboard never asked for what it may not have.
                    check("nothing the page asked for was refused",
                          not refused, "; ".join(refused[:3]))
                    check("...and it never asked for the accounts list",
                          not [a for a in asked if a.endswith("/auth/users")],
                          str([a for a in asked if a.endswith("/auth/users")]))
                    check("...nor for another prospect's record",
                          not [a for a in asked if OTHER_ID in a],
                          str([a for a in asked if OTHER_ID in a]))
                    check("...and it did read its own",
                          any(f"/demo/customers/{OWN_ID}" in a for a in asked))
                    check("...and changed nothing: no PATCH was sent",
                          not [a for a in asked if a.startswith("PATCH ")],
                          str([a for a in asked if a.startswith("PATCH ")]))

                    # ---- their way out of the demo: they ASK to be set up (phase gates). An admin
                    # approves; until then they stay in the demo (last — it changes the account).
                    page.goto(f"{base}/", wait_until="networkidle")
                    page.wait_for_timeout(700)
                    body = page.inner_text("body")
                    check("they are offered a setup request, not a way to move themselves",
                          page.get_by_role("button", name="Request setup").count() == 1
                          and page.get_by_role("button", name="Start onboarding").count() == 0,
                          body[:300])
                    check("...and see their customer ID", "HADE-0001" in body, body[:300])
                    page.get_by_role("button", name="Request setup").click()
                    dialog = page.get_by_role("dialog")
                    dialog.wait_for()
                    dialog.get_by_label("Anything we should know? (optional)").fill("Start next month")
                    dialog.get_by_role("button", name="Send request").click()
                    page.wait_for_timeout(900)
                    requests = [a for a in asked
                                if a.startswith("POST ") and a.endswith(f"/demo/customers/{OWN_ID}/request-onboarding")]
                    check("sending asks the backend at /request-onboarding", len(requests) == 1,
                          str([a for a in asked if a.startswith("POST ")]))
                    check("...and never tries to onboard itself",
                          not [a for a in asked if a.endswith("/onboard")])
                    after = page.inner_text("body")
                    check("the card then says the request is in", "Setup requested" in after, after[:300])
                    labels = [b.inner_text().strip() for b in rail.get_by_role("button").all()]
                    check("...and they are still in the demo-only view", "Settings" in labels and "Accounts" not in labels,
                          str(labels))

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
    print("ALL DEMO CUSTOMER CHECKS PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
