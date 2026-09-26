"""What a demo-stage customer sees when they sign in, in a browser.

The rule this checks is "a demo customer sees only the demo": one item in the rail, their own record
and no other, none of the operator's controls on it, and no way to reach the rest by typing a URL.

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
                          [l for l in labels if l and "Sign out" not in l] == ["My receptionist"],
                          str(labels))
                    for gone in ("Overview", "All runs", "Business information", "Accounts",
                                 "Answered calls", "Customers", "CRM", "Send feedback"):
                        check(f"...no {gone!r} in the rail", gone not in labels, str(labels))

                    # ---- their own tabs, and not the operator's
                    for tab in ("Knowledge", "Prompt", "Schedule"):
                        check(f"the {tab} tab is theirs",
                              page.get_by_role("tab", name=tab).count() == 1)
                    for tab in ("Activity", "Sources", "Share"):
                        check(f"the {tab} tab is not",
                              page.get_by_role("tab", name=tab).count() == 0)

                    # ---- none of the operator's controls
                    check("no live switch", page.get_by_label("Toggle the demo link").count() == 0)
                    check("no re-research", page.get_by_role("button", name="Re-research").count() == 0)
                    check("no demo-time menu", "Add time" not in body, body[:300])
                    check("no test-call panel — the allowance lives on their own demo link",
                          "Test call" not in body, body[:300])
                    check("but they can save their own corrections",
                          page.get_by_role("button", name="Save", exact=True).count() >= 1)

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

                    # ---- their way out of the demo: Start onboarding (last — it moves the account)
                    page.goto(f"{base}/", wait_until="networkidle")
                    page.wait_for_timeout(700)
                    body = page.inner_text("body")
                    check("they are offered onboarding",
                          page.get_by_role("button", name="Start onboarding").count() == 1, body[:300])
                    check("...and see their customer ID", "CUST-0001" in body, body[:300])
                    page.get_by_role("button", name="Start onboarding").click()
                    dialog = page.get_by_role("dialog")
                    dialog.wait_for()
                    check("the confirmation says it can't be undone",
                          "can't be undone" in dialog.inner_text(), dialog.inner_text()[:200])
                    dialog.get_by_role("button", name="Start onboarding").click()
                    try:
                        page.wait_for_function("location.hash.startsWith('#/business')", timeout=8000)
                        landed = True
                    except Exception:
                        landed = False
                    check("confirming lands them on their business information", landed,
                          page.evaluate("location.hash"))
                    check("...having asked the backend to move them",
                          any(a.startswith("POST ") and a.endswith(f"/demo/customers/{OWN_ID}/onboard")
                              for a in asked))
                    page.wait_for_timeout(700)
                    labels = [b.inner_text().strip() for b in rail.get_by_role("button").all()]
                    check("the demo-only rail is gone", "My receptionist" not in labels, str(labels))
                    check("...and Business information is in it",
                          any("Business information" in l for l in labels), str(labels))

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
