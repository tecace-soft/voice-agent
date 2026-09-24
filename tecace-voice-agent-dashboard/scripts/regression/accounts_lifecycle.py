"""The Accounts page's customer lifecycle, opened in a browser.

What it checks is that the three controls are three separate decisions and that each one goes to its
own endpoint: linking an account to the Demos customer it grew out of, moving it along the stages,
and the one-time copy of that demo into the customer's own Business information. The copy is the one
that matters — it is the only thing that ever reads one record and writes the other, and after it the
two are unrelated.

Run (one at a time — these scripts share ports):  python scripts/regression/accounts_lifecycle.py
"""

from __future__ import annotations

import json
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
APP_PORT = 4183


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
        with tempfile.TemporaryDirectory(prefix="accounts-lifecycle-") as tmp:
            out = Path(tmp) / "app"
            build(out)
            server = serve(out)
            base = f"http://127.0.0.1:{APP_PORT}"
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")
                    ctx = browser.new_context()
                    # Admin only: stage is not a customer's decision about themselves.
                    ctx.add_init_script("localStorage.setItem('transcribe.token', 'tok-admin')")
                    page = ctx.new_page()
                    errors: list[str] = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    sent: list[tuple[str, str, str]] = []
                    page.on("request", lambda r: sent.append((r.method, r.url, r.post_data or "")))

                    page.goto(f"{base}/#/accounts", wait_until="networkidle")
                    page.wait_for_timeout(600)
                    body = page.inner_text("body")
                    check("the Accounts page still loads", "Ada Admin" in body, body[:200])

                    # ---- the column, and what an unplaced account reads as
                    check("there is a Stage column",
                          page.get_by_role("columnheader", name="Stage").count() == 1)
                    check("an account nobody has placed reads as not placed, not as a stage",
                          body.count("Not placed") == 2, body[:300])

                    # ---- the panel opens from the row, not from a page of its own
                    row = page.get_by_role("row").filter(has_text="Sam Customer")
                    row.get_by_role("button", name="Stage").click()
                    page.wait_for_timeout(300)
                    panel = page.get_by_role("group", name="Lifecycle for Sam Customer")
                    check("the row opens a lifecycle panel", panel.count() == 1)
                    check("...offering the Demos customers to link to",
                          panel.get_by_label("Demo customer", exact=True).count() == 1)
                    check("...and the four stages",
                          len(panel.get_by_label("Stage", exact=True).locator("option").all()) == 4)

                    # ---- the copy is refused until there is something to copy FROM
                    copy_button = panel.get_by_role("button", name="Copy demo into their business")
                    check("the copy is offered but disabled while nothing is linked",
                          copy_button.count() == 1 and copy_button.is_disabled())

                    # ---- linking goes to its own endpoint, and says which demo
                    options = panel.get_by_label("Demo customer", exact=True).locator("option")
                    names = [o.inner_text() for o in options.all()]
                    check("the demo list came from the Demos section", len(names) > 1, str(names))
                    panel.get_by_label("Demo customer", exact=True).select_option(index=1)
                    page.wait_for_timeout(700)
                    links = [s for s in sent if s[0] == "POST" and s[1].endswith("/business")]
                    check("linking POSTs /auth/users/<id>/business", len(links) == 1, str(links)[:200])
                    if links:
                        check("...naming the demo customer, and only that",
                              list(json.loads(links[0][2] or "{}")) == ["businessId"],
                              links[0][2][:120])
                        check("...at the account it was opened on", "u-sam" in links[0][1], links[0][1])

                    # ---- the stage is its own decision, at its own endpoint
                    page.wait_for_timeout(300)
                    panel = page.get_by_role("group", name="Lifecycle for Sam Customer")
                    panel.get_by_label("Stage", exact=True).select_option("production")
                    page.wait_for_timeout(700)
                    stages = [s for s in sent if s[0] == "POST" and s[1].endswith("/status")]
                    check("changing the stage POSTs /auth/users/<id>/status", len(stages) == 1,
                          str(stages)[:200])
                    if stages:
                        check("...carrying the stage alone — linking is not re-sent with it",
                              json.loads(stages[0][2] or "{}") == {"status": "production"},
                              stages[0][2][:120])
                    page.wait_for_timeout(300)
                    check("...and the table shows it",
                          "Production" in page.get_by_role("row")
                          .filter(has_text="Sam Customer").first.inner_text())

                    # ---- the copy itself
                    panel = page.get_by_role("group", name="Lifecycle for Sam Customer")
                    copy_button = panel.get_by_role("button", name="Copy demo into their business")
                    check("the copy is offered once a demo is linked", not copy_button.is_disabled())
                    copy_button.click()
                    page.wait_for_timeout(800)
                    copies = [s for s in sent if s[0] == "POST" and s[1].endswith("/promote")]
                    check("the copy POSTs /auth/users/<id>/promote", len(copies) == 1,
                          str(copies)[:200])
                    after = page.inner_text("body")
                    check("...and the page says the two are separate from here on",
                          "the two are separate" in after, after[:300])

                    # ---- what the panel promises, in the page's own words
                    check("the panel says the copy happens once",
                          "Copying happens once" in after)

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
    print("ALL ACCOUNTS LIFECYCLE CHECKS PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
