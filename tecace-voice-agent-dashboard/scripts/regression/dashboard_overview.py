"""Dashboard › Overview, opened in a browser: the receptionist's calls at a glance.

The Demo Overview's page for one business: Calls, Minutes, Callbacks requested and this month's talk
time, calls per day, and the recent calls, read from `/calls` and `/usage/minutes` (never `/demo/`).
It is where an account lands on sign-in. A customer sees their own business and no picker; an admin gets every business (with a Business
column) and can pick one, which goes into the address as `?customer=`.

Run (one at a time — these scripts share ports):  python scripts/regression/dashboard_overview.py
Screenshots:  python scripts/regression/dashboard_overview.py --shots <dir>
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
BACKEND_PORT = 8895
APP_PORT = 4185


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
        return os.path.join(ROOT, "index.html")
    def log_message(self, *a):
        pass
# Stated explicitly: a Windows registry that maps .js to text/plain makes Edge refuse every module.
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


def heads(main) -> list[str]:
    return [t.strip() for t in main.locator("thead th").all_inner_texts()]


def check_page(check: Checks, page, who: str, theme: str, sent: list[str], shots: Path | None) -> None:
    tag = f"[{who}, {theme}]"
    main = page.locator("main.content")
    text = main.inner_text()

    group = page.locator('.sidebar-group[data-group="dashboard"]')
    check(f"{tag} the Dashboard group is first in the rail, with Overview",
          group.count() == 1 and "Overview" in group.inner_text()
          and page.locator(".sidebar > .sidebar-group").first.get_attribute("data-group") == "dashboard")
    check(f"{tag} its Overview is the active item", group.locator(".nav-item.is-active").count() == 1)
    crumbs = page.locator(".crumbs").inner_text().split()
    check(f"{tag} the breadcrumb says Dashboard / Overview", crumbs == ["Dashboard", "/", "Overview"], str(crumbs))
    check(f"{tag} no voicemail mailbox picker or Refresh",
          page.locator(".mailbox-picker").count() == 0 and page.get_by_role("button", name="Refresh").count() == 0)
    check(f"{tag} it renders inside the .tw boundary", main.locator(".tw").count() == 1)
    for title in ("Calls", "Minutes", "Callbacks requested", "Talk time this month", "Calls per day",
                  "Recent calls"):
        check(f"{tag} shows {title!r}", title in text, text[:300])
    for gone in ("Customers", "Top customers", "Tested"):
        check(f"{tag} leaves out the Demo card {gone!r}", gone not in text)
    # (The rail's setup-requests badge reads /demo/ for an admin on every page; the page itself must not.)
    check(f"{tag} reads /calls and /usage/minutes, not the Demo analytics",
          any("/calls" in u for u in sent) and any("/usage/minutes" in u for u in sent)
          and not any("/demo/analytics" in u for u in sent), str(sent))
    check(f"{tag} the chart drew", main.locator("canvas").count() == 1)
    row = main.locator("tbody tr").filter(has_text="Jordan Lee")
    check(f"{tag} the recent call is listed with its request and outcome",
          row.count() == 1 and "Callback" in row.inner_text() and "Book a cleaning" in row.inner_text())
    check(f"{tag} talk time is this month's, with last month beside it",
          "50 minutes last month" in text, text[:400])

    picker = page.get_by_role("combobox", name="Which business to show")
    if who == "customer":
        check(f"{tag} a customer has no business picker", picker.count() == 0)
        check(f"{tag} and no Business column",
              "Business" not in heads(main))
        return
    check(f"{tag} an admin starts on every business",
          picker.count() == 1 and "Every business" in picker.inner_text())
    check(f"{tag} with a Business column naming the owner",
          "Business" in heads(main)
          and "Sam Customer" in row.inner_text(), row.inner_text())
    if shots:
        page.screenshot(path=str(shots / "dashboard-overview-admin-all.png"), full_page=True)
    sent.clear()
    picker.click()
    page.get_by_role("option", name="Sam Customer").click()
    page.wait_for_timeout(600)
    check(f"{tag} picking a business puts it in the address", "customer=sam%40tecace.com" in page.url, page.url)
    check(f"{tag} and reads that business's calls", any("/calls?userId=u-sam" in u for u in sent), str(sent))
    check(f"{tag} one business drops the Business column",
          "Business" not in heads(main))
    check(f"{tag} and says whose it is", "Sam Customer's receptionist" in main.inner_text())


def main() -> int:
    shots = Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
    check = Checks()
    backend = fake_backend.start(BACKEND_PORT)
    try:
        with tempfile.TemporaryDirectory(prefix="dashboard-overview-") as tmp:
            out = Path(tmp) / "app"
            build(out)
            server = serve(out)
            base = f"http://127.0.0.1:{APP_PORT}"
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")
                    for token, who, theme in (("tok-user", "customer", "light"), ("tok-admin", "admin", "light"),
                                              ("tok-user", "customer", "dark")):
                        # The clock is frozen at fake_backend.NOW so the fixtures fall in the period.
                        # Chart.js times its animation off that clock too, so a screenshot shows the
                        # chart's first frame (a flat line); the checks read the numbers, not pixels.
                        ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce",
                                                  timezone_id="America/Los_Angeles", locale="en-US")
                        ctx.add_init_script(f"localStorage.setItem('transcribe.token', '{token}');"
                                            f"localStorage.setItem('theme', '{theme}');")
                        page = ctx.new_page()
                        page.clock.set_fixed_time(fake_backend.NOW)
                        errors: list[str] = []
                        page.on("pageerror", lambda e: errors.append(str(e)))
                        sent: list[str] = []
                        page.on("request", lambda r: sent.append(r.url))
                        # Signing in with no address asked for lands here (the default view).
                        page.goto(f"{base}/", wait_until="networkidle")
                        page.wait_for_timeout(400)
                        check(f"[{who}, {theme}] a fresh sign-in lands on #/dashboard",
                              page.url.endswith("#/dashboard"), page.url)
                        page.goto(f"{base}/#/dashboard", wait_until="networkidle")
                        page.wait_for_timeout(600)
                        check_page(check, page, who, theme, sent, shots)
                        check(f"[{who}, {theme}] no page errors", not errors, str(errors))
                        if shots:
                            page.screenshot(path=str(shots / f"dashboard-overview-{who}-{theme}.png"), full_page=True)
                        ctx.close()
                    browser.close()
            finally:
                server.terminate()
    finally:
        backend.shutdown()
    if check.failed:
        print(f"{check.failed} CHECK(S) FAILED")
        return 1
    print("ALL DASHBOARD OVERVIEW CHECKS PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
