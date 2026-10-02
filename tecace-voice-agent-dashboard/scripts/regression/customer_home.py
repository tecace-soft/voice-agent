"""A customer's Home, stage by stage, and the self-serve way out of the demo, in a browser.

What it proves:
  * a demo-stage customer's Home offers one Request setup; it asks for a plan and a card (test
    mode), refuses a bad card on the field, and on confirm the account is in onboarding at once:
    no admin, no "waiting for us" — the rail changes and the Home is the setup checklist, with the
    step that is ours (the number, Go live) marked as ours;
  * the request carried the plan and the card, and the admin's Approve was never called;
  * Billing is in the rail at every stage: the plan can be changed, the card replaced (refused on
    the field when it is wrong), and it says nothing is charged before the line is live;
  * once the line is live, Home shows the line as on, what callers got (answered, booked, messages,
    put through), who needs a reply, and the free trial's end date.

Runs against fake_backend.py. One at a time — these scripts share ports:
    python scripts/regression/customer_home.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import time
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import fake_backend  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND_PORT = 8891
APP_PORT = 4189
OWN_ID = "pr0SPct1"  # Harbor Dental, the demo Dana's account is linked to


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
        cwd=APP_ROOT,
        capture_output=True,
        text=True,
        shell=True,
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
        return target if os.path.isfile(target) else os.path.join(ROOT, "index.html")
    def log_message(self, *a):
        pass
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


def rail_labels(page) -> list[str]:
    rail = page.get_by_role("navigation", name="Dashboard sections")
    return [b.inner_text().strip() for b in rail.get_by_role("button").all()
            if b.inner_text().strip() and "Sign out" not in b.inner_text() and "Changelog" not in b.inner_text()]


def main() -> int:
    check = Checks()
    # A fresh demo-stage account every run: the fake is stateful for the process.
    fake_backend.DEMO_CUSTOMER.update(status="demo", request=None, declined=None, liveAt=None)
    fake_backend.BILLING.clear()
    backend = fake_backend.start(BACKEND_PORT)
    try:
        with tempfile.TemporaryDirectory(prefix="customer-home-") as tmp:
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
                    sent: list[tuple[str, str, str]] = []
                    page.on("request", lambda r: sent.append((r.method, r.url, r.post_data or "")))

                    # ---- demo: one way out, and it asks for a plan and a card
                    page.goto(f"{base}/", wait_until="networkidle")
                    page.wait_for_timeout(1000)
                    check("a demo customer lands on their Home", page.locator("main h1").first.inner_text().strip() == "Harbor Dental")
                    check("...with Billing in the rail", rail_labels(page) == ["Overview", "Call activity", "Settings", "Billing"],
                          str(rail_labels(page)))
                    page.get_by_role("button", name="Request setup").first.click()
                    dialog = page.get_by_role("dialog")
                    dialog.wait_for(timeout=5000)
                    check("Request setup starts with a plan", "Choose a plan" in dialog.inner_text()
                          and dialog.get_by_role("radio").count() == 3, dialog.inner_text()[:200])
                    check("...the recommended one preselected", dialog.get_by_role("radio", name="Standard").get_attribute("aria-checked") == "true")
                    dialog.get_by_role("button", name="Continue").click()
                    check("then a card, in test mode", "Test mode" in dialog.inner_text() and "Nothing is charged until your line is live" in dialog.inner_text(),
                          dialog.inner_text()[:300])
                    dialog.get_by_label("Card number").fill("4242 4242 4242 4241")
                    dialog.get_by_label("Expiry").fill("12/31")
                    dialog.get_by_label("Security code").fill("123")
                    dialog.get_by_label("Name on card").fill("Dana Reed")
                    dialog.get_by_role("button", name="Continue").click()
                    dialog.get_by_role("button", name="Start setup").click()
                    page.wait_for_timeout(600)
                    check("a card the backend refuses is sent back to the card step, on the field",
                          "doesn't look right" in dialog.inner_text() and dialog.get_by_label("Card number").count() == 1,
                          dialog.inner_text()[:300])
                    dialog.get_by_label("Card number").fill("4242 4242 4242 4242")
                    dialog.get_by_role("button", name="Continue").click()
                    text = dialog.inner_text()
                    check("the confirm step says the plan, the card and when the first bill is",
                          "Standard" in text and "ending 4242" in text and "14 days after your line goes live" in text, text[:400])
                    dialog.get_by_role("button", name="Start setup").click()

                    # ---- onboarding, at once
                    page.get_by_role("heading", name="Let's get Alex on your line").wait_for(timeout=8000)
                    page.wait_for_timeout(600)
                    check("the account is in onboarding: Home is the setup checklist", "#/dashboard" in page.url and "of 6 done" in page.inner_text("main"), page.url)
                    labels = rail_labels(page)
                    check("...and the rail is a customer's, Billing included",
                          "Business information" in labels and "Billing" in labels and "Call activity" not in labels, str(labels))
                    main = page.inner_text("main")
                    check("the step that is ours says so", "We switch your number on" in main and "TecAce" in main, main[:600])
                    check("...the test call opens the studio's test console, and the line is off",
                          page.locator("main a[href='#/business/test']").count() == 1 and "Not switched on" in main, main[:600])
                    check("...and the plan is on the Home", "Standard plan" in main and "Nothing is charged until your line is live" in main, main[:800])
                    # The last one: the first carried the card the backend refused.
                    request = next(((m, u, b) for m, u, b in reversed(sent) if u.endswith("/request-onboarding")), None)
                    check("the request carried the plan and the card",
                          request is not None and '"plan":"standard"' in request[2] and '"number":"4242424242424242"' in request[2],
                          str(request)[:300])
                    check("...and nobody approved it", not [u for _, u, _ in sent if u.endswith("/onboard")])

                    # ---- Billing
                    page.get_by_role("navigation", name="Dashboard sections").get_by_role("button", name="Billing").click()
                    page.get_by_role("heading", name="Billing").wait_for(timeout=5000)
                    page.wait_for_timeout(500)
                    text = page.inner_text("main")
                    check("Billing shows the plan, the card and that nothing is charged yet",
                          "Not charged yet" in text and "•••• 4242" in text and "Test mode" in text, text[:500])
                    page.get_by_role("radio", name="Business").click()
                    page.get_by_text("Plan changed to Business.").wait_for(timeout=5000)
                    check("the plan can be changed", page.get_by_role("radio", name="Business").get_attribute("aria-checked") == "true")
                    page.get_by_role("button", name="Change card").click()
                    dialog = page.get_by_role("dialog")
                    dialog.get_by_label("Card number").fill("1234 5678 9012 3456")
                    dialog.get_by_label("Expiry").fill("01/30")
                    dialog.get_by_label("Security code").fill("999")
                    dialog.get_by_role("button", name="Save card").click()
                    page.wait_for_timeout(500)
                    check("a wrong card is refused on the field", "doesn't look right" in dialog.inner_text(), dialog.inner_text()[:200])
                    dialog.get_by_label("Card number").fill("5555 5555 5555 4444")
                    dialog.get_by_role("button", name="Save card").click()
                    page.get_by_text("Card saved.").wait_for(timeout=5000)
                    check("...and a good one replaces it", "•••• 4444" in page.inner_text("main"))

                    # ---- live (the fake's line goes live by hand: readiness there is Sam's, not Dana's)
                    fake_backend.DEMO_CUSTOMER["status"] = "production"
                    fake_backend.DEMO_CUSTOMER["liveAt"] = fake_backend.iso(fake_backend.NOW - timedelta(days=3))
                    # A fresh load: the signed-in account is read once per load (/auth/me).
                    page.goto(f"{base}/#/dashboard")
                    page.reload(wait_until="networkidle")
                    page.wait_for_timeout(1200)
                    main = page.inner_text("main")
                    check("a live customer's Home says the line is on", "Line is on" in main, main[:300])
                    for title in ("Calls answered", "Booked", "Messages for you", "Put through"):
                        check(f"...shows {title!r}", title in main, main[:600])
                    check("...and the trial's end", "Free trial until" in main, main[:400])
                    check("...who needs a reply", "Needs a reply" in main and "Jordan Lee" in main, main[:800])
                    check("...reading /calls, not the demo analytics",
                          any(u.endswith("/calls") for _, u, _ in sent) and not any("/demo/analytics" in u for _, u, _ in sent))
                    page.get_by_role("navigation", name="Dashboard sections").get_by_role("button", name="Billing").click()
                    page.get_by_role("heading", name="Billing").wait_for(timeout=5000)
                    page.wait_for_timeout(500)
                    text = page.inner_text("main")
                    check("Billing is on the free trial, with the first bill named",
                          "Free trial" in text and "First bill" in text and "Minutes this month" in text, text[:500])

                    check("no page errors", not errors, "; ".join(errors[:3]))
                    browser.close()
            finally:
                server.terminate()
    finally:
        backend.shutdown()
        fake_backend.DEMO_CUSTOMER.update(status="demo", request=None, declined=None, liveAt=None)
        fake_backend.BILLING.clear()

    print()
    print("ALL CUSTOMER HOME CHECKS PASS" if check.failed == 0 else f"{check.failed} CHECK(S) FAILED")
    return 0 if check.failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
