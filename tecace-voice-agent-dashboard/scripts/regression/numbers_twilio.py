"""The agent's numbers against Twilio, opened in a browser: the Numbers page and the Go live panel.

What it checks is that the admin can see what Twilio knows about each number and act on it from the
dashboard — sync the account, see which numbers have their webhooks in order, repair one, buy one,
release one — and that an account being set up can be given a number from the Go live checklist itself
rather than on a separate page first. Every action is checked at the wire: which endpoint, which body.

Run (one at a time — these scripts share ports):  python scripts/regression/numbers_twilio.py
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
BACKEND_PORT = 8896
APP_PORT = 4184


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


def posts(sent, suffix: str):
    return [s for s in sent if s[0] == "POST" and s[1].split("?")[0].endswith(suffix)]


def main() -> int:
    check = Checks()
    backend = fake_backend.start(BACKEND_PORT)
    try:
        with tempfile.TemporaryDirectory(prefix="numbers-twilio-") as tmp:
            out = Path(tmp) / "app"
            build(out)
            server = serve(out)
            base = f"http://127.0.0.1:{APP_PORT}"
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")
                    ctx = browser.new_context()
                    ctx.add_init_script("localStorage.setItem('transcribe.token', 'tok-admin')")
                    page = ctx.new_page()
                    errors: list[str] = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    sent: list[tuple[str, str, str]] = []
                    page.on("request", lambda r: sent.append((r.method, r.url, r.post_data or "")))

                    # ================= the Numbers page =================
                    page.goto(f"{base}/#/numbers", wait_until="networkidle")
                    page.wait_for_timeout(600)
                    body = page.inner_text("body")
                    check("the Numbers page still loads", "Agent phone numbers" in body, body[:200])

                    # ---- what Twilio knows, per number
                    check("there is a Type column", page.get_by_role("columnheader", name="Type").count() == 1)
                    check("there is a Webhooks column", page.get_by_role("columnheader", name="Webhooks").count() == 1)
                    rows = page.locator("main.content tbody tr")
                    sam = rows.filter(has_text="(425) 555-0100")
                    pool = rows.filter(has_text="(425) 555-0199")
                    hand = rows.filter(has_text="(888) 555-0123")
                    check("a configured number reads as configured", "Configured" in sam.inner_text(), sam.inner_text()[:200])
                    check("a drifted number says its webhooks are out of date", "Out of date" in pool.inner_text(),
                          pool.inner_text()[:200])
                    check("a hand-registered number says so", "Registered by hand" in hand.inner_text(),
                          hand.inner_text()[:200])
                    check("...and can only be deleted, not released",
                          hand.get_by_role("button", name="Delete").count() == 1
                          and hand.get_by_role("button", name="Release").count() == 0)
                    check("a managed number can be released, not deleted",
                          pool.get_by_role("button", name="Release").count() == 1
                          and pool.get_by_role("button", name="Delete").count() == 0)
                    console = rows.filter(has_text="(425) 555-0177")
                    check("a number bought in the Twilio console can't be released from here",
                          console.get_by_role("button", name="Release").is_disabled(), console.inner_text()[:200])
                    check("an out-of-date number says what is wrong with it",
                          "No call status reports" in pool.inner_text(), pool.inner_text()[:200])
                    check("the table offers to configure every out-of-date number at once",
                          page.get_by_role("button", name="Configure 1 out of date").count() == 1)

                    # ---- sync
                    page.get_by_role("button", name="Sync from Twilio").click()
                    page.wait_for_timeout(700)
                    syncs = posts(sent, "/business/numbers/sync")
                    check("Sync POSTs /business/numbers/sync", len(syncs) == 1, str(syncs)[:200])
                    after = page.inner_text("body")
                    check("...and says what it found, naming the number Twilio doesn't have",
                          "(888) 555-0123" in after and "not in Twilio" in after, after[:400])
                    # A .card has no padding of its own; a message that isn't inset sits on the card's edge.
                    note_box = page.get_by_role("status").first.bounding_box()
                    title_box = page.get_by_text("Agent phone numbers", exact=True).bounding_box()
                    check("...in a message lined up with the card's title, not on its edge",
                          bool(note_box and title_box) and abs(note_box["x"] - title_box["x"]) < 2,
                          f"note x={note_box and note_box['x']} title x={title_box and title_box['x']}")

                    # ---- configure repairs the drifted one
                    pool.get_by_role("button", name="Configure").click()
                    page.wait_for_timeout(700)
                    configures = posts(sent, "/business/numbers/n-2/configure")
                    check("Configure POSTs /business/numbers/<id>/configure", len(configures) == 1, str(configures)[:200])
                    pool = page.locator("main.content tbody tr").filter(has_text="(425) 555-0199")
                    check("...and the row reads as configured", "Configured" in pool.inner_text(), pool.inner_text()[:200])

                    # ---- buying: kind, area code, search, pick
                    buy = page.get_by_role("group", name="Buy a number")
                    check("there is a Buy a number card", buy.count() == 1)
                    buy.get_by_label("Toll-free", exact=False).check()
                    buy.get_by_role("button", name="Search").click()
                    page.wait_for_timeout(700)
                    searches = [s for s in sent if s[0] == "GET" and "/business/numbers/available" in s[1]]
                    check("Search GETs /business/numbers/available for the kind", len(searches) == 1
                          and "type=tollfree" in searches[0][1], str(searches)[:200])
                    result = buy.get_by_role("listitem").filter(has_text="(833) 555-0142")
                    check("...and lists what Twilio sells", result.count() == 1, buy.inner_text()[:300])
                    result.get_by_role("button", name="Buy").click()
                    page.wait_for_timeout(800)
                    buys = posts(sent, "/business/numbers/buy")
                    check("Buy POSTs /business/numbers/buy", len(buys) == 1, str(buys)[:200])
                    if buys:
                        sent_body = json.loads(buys[0][2] or "{}")
                        check("...naming the exact number picked, with a request id against double clicks",
                              sent_body.get("phoneNumber") == "+18335550142" and bool(sent_body.get("requestId")),
                              buys[0][2][:200])
                    bought = page.locator("main.content tbody tr").filter(has_text="(833) 555-0142")
                    check("...and the new number joins the table, configured and unassigned",
                          bought.count() == 1 and "Configured" in bought.inner_text()
                          and "Not assigned" in bought.inner_text(), bought.inner_text()[:200] if bought.count() else "no row")

                    # ---- release wants the number typed back
                    pool.get_by_role("button", name="Release").click()
                    page.wait_for_timeout(300)
                    confirm = page.get_by_label("Type the number to release it")
                    check("Release asks for the number to be typed back", confirm.count() == 1)
                    confirm.fill("+14255550199")
                    page.get_by_role("button", name="Release number").click()
                    page.wait_for_timeout(800)
                    releases = posts(sent, "/business/numbers/n-2/release")
                    check("Release POSTs /business/numbers/<id>/release with the typed number", len(releases) == 1
                          and json.loads(releases[0][2] or "{}") == {"confirm": "+14255550199"}, str(releases)[:200])
                    check("...and the number leaves the table",
                          page.locator("main.content tbody tr").filter(has_text="(425) 555-0199").count() == 0)

                    # ---- a released number is kept in sight, and can be bought back
                    released = page.get_by_role("list", name="Released numbers")
                    page.get_by_text("Released numbers", exact=True).click()
                    page.wait_for_timeout(200)
                    gone = released.get_by_role("listitem").filter(has_text="(425) 555-0199")
                    check("the released number is listed under Released numbers", gone.count() == 1,
                          released.inner_text()[:200] if released.count() else "no list")
                    gone.get_by_role("button", name="Buy back").click()
                    page.wait_for_timeout(800)
                    buybacks = [s for s in posts(sent, "/business/numbers/buy") if "+14255550199" in s[2]]
                    check("Buy back POSTs /business/numbers/buy for that exact number", len(buybacks) == 1,
                          str(posts(sent, "/business/numbers/buy"))[:300])
                    check("...and the number is back in the table",
                          page.locator("main.content tbody tr").filter(has_text="(425) 555-0199").count() == 1)

                    # ---- un-assign Sam, so the Go live panel has something to do
                    sam = page.locator("main.content tbody tr").filter(has_text="(425) 555-0100")
                    sam.get_by_role("combobox").select_option("")
                    page.wait_for_timeout(700)
                    unassigns = posts(sent, "/business/numbers/n-1/assign")
                    check("un-assigning POSTs /business/numbers/<id>/assign with userId null",
                          len(unassigns) == 1 and json.loads(unassigns[0][2] or "{}") == {"userId": None},
                          str(unassigns)[:200])

                    # ================= the Go live panel =================
                    page.goto(f"{base}/#/accounts", wait_until="networkidle")
                    page.wait_for_timeout(600)
                    row = page.get_by_role("row").filter(has_text="Sam Customer")
                    row.get_by_role("button", name="Stage").click()
                    page.wait_for_timeout(300)
                    panel = page.get_by_role("group", name="Lifecycle for Sam Customer")
                    panel.get_by_label("Stage", exact=True).select_option("pre-production")
                    page.wait_for_timeout(800)
                    panel = page.get_by_role("group", name="Lifecycle for Sam Customer")
                    checklist = panel.get_by_label("Go live checklist")
                    check("an account being set up shows the Go live checklist", checklist.count() == 1)
                    listed = checklist.inner_text() if checklist.count() else ""
                    check("...with the number unticked", "A phone number is assigned" in listed, listed[:300])
                    assign = panel.get_by_role("group", name="Assign a number")
                    check("...and offers to assign one right there", assign.count() == 1, listed[:300])
                    check("Go live waits", panel.get_by_role("button", name="Go live").is_disabled())

                    # ---- from the pool
                    options = [o.inner_text() for o in assign.get_by_label("Number from the pool").locator("option").all()]
                    check("the pool lists the unassigned numbers, the bought-back one included",
                          all(any(p in o for o in options) for p in ("(425) 555-0100", "(425) 555-0199", "(833) 555-0142")),
                          str(options))
                    check("...and offers to buy a new one instead",
                          assign.get_by_role("button", name="Buy a new number").count() == 1)
                    assign.get_by_label("Number from the pool").select_option(label=[o for o in options if "(425) 555-0100" in o][0])
                    assign.get_by_role("button", name="Assign", exact=True).click()
                    page.wait_for_timeout(900)
                    assigns = posts(sent, "/business/numbers/n-1/assign")
                    check("Assign POSTs /business/numbers/<id>/assign for this account",
                          len(assigns) == 2 and json.loads(assigns[-1][2] or "{}") == {"userId": "u-sam"},
                          str(assigns)[-200:])
                    panel = page.get_by_role("group", name="Lifecycle for Sam Customer")
                    listed = panel.get_by_label("Go live checklist").inner_text()
                    check("...the checklist re-reads and shows the number", "(425) 555-0100" in listed
                          or "+14255550100" in listed, listed[:300])
                    check("...including that calls to it reach the receptionist",
                          "Calls to the number reach the receptionist" in listed, listed[:300])
                    check("...and Go live is offered", not panel.get_by_role("button", name="Go live").is_disabled())

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
    print("ALL NUMBERS/TWILIO CHECKS PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
