"""The Business page's Guided setup, opened in a browser.

The consultant interview (src/settings/sections/GuidedSetupSection.tsx) with the settings board
beside it (src/settings/setup/SetupBoard.tsx), against fake_backend.py's scripted consultant: its
opening line, then a first answer that adds transfer `setup-t1` to the call-settings draft. What
this checks is the flow a business walks — the Business page offering the interview to an account
being set up, starting it, a turn held in flight (the composer locked, an optimistic bubble), the
reply landing in the chat and on the board (the card lit, then not), the draft the consultant wrote
showing in the real Transfers section without the dashboard saving it again, the conversation
surviving a trip to that section, the test console behind the board, the unavailable state, Start
over, and the `.tw` boundary.

Two things are staged in-process before the fake starts: `USER` is promoted to pre-production (so
readiness says the account is being set up and the page offers the interview), and the fake's own
consultant (`fake_backend.setup_turn`) is what answers.

Run (one at a time — these scripts share ports):  python scripts/regression/guided_setup.py
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).parent))

import fake_backend  # noqa: E402
from demos_e2e import fulfill_json  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND_PORT = 8895
APP_PORT = 4186
BACKEND = f"http://127.0.0.1:{BACKEND_PORT}"
ANSWER = "Sam takes billing questions on (206) 555-0100, weekdays 9 to 5"
MENU_ITEMS = 13


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
        # UTF-8 stated: Vite prints "✓" and "—", which a non-UTF-8 console codepage can't decode.
        cwd=APP_ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", shell=True,
        env={**os.environ, "BACKEND_URL": BACKEND},
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
# registry says .js is text/plain makes Edge refuse every module script (see README).
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
    # Readiness then reports pre-production, which is the page's `onboarding` flag: the one account
    # state the "Set up with a guided interview" line is offered in.
    fake_backend.USER["status"] = "pre-production"
    backend = fake_backend.start(BACKEND_PORT)
    try:
        with tempfile.TemporaryDirectory(prefix="guided-setup-") as tmp:
            out = Path(tmp) / "app"
            build(out)
            server = serve(out)
            base = f"http://127.0.0.1:{APP_PORT}"
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")
                    ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
                    ctx.add_init_script("localStorage.setItem('transcribe.token', 'tok-user')")
                    page = ctx.new_page()
                    errors: list[str] = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    sent: list[tuple[str, str, str]] = []
                    page.on("request", lambda r: sent.append((r.method, r.url, r.post_data or "")))
                    # Start over asks with confirm(); a dialog nobody answers would hang the page.
                    page.on("dialog", lambda d: d.accept())

                    def hits(method: str, path: str) -> list[tuple[str, str, str]]:
                        return [x for x in sent if x[0] == method and urlparse(x[1]).path == path]

                    def demo_hits() -> list[str]:
                        return [x[1] for x in sent if "/demo/" in x[1]]

                    nav = page.locator("nav[aria-label='Receptionist settings']")
                    board = page.locator("[data-board='settings']")
                    log = page.locator("main [role='log']")
                    composer = page.locator("[aria-label='Your answer']")
                    cta = page.get_by_role("button", name="Set up with a guided interview")

                    # ---- 1–2. the Business page offers the interview to an account being set up
                    page.goto(f"{base}/#/business", wait_until="networkidle")
                    page.wait_for_timeout(600)
                    check("Business page: offers the guided interview",
                          "Set up with a guided interview" in page.inner_text("body"),
                          page.inner_text("body")[:300])
                    reads = hits("GET", "/business/setup")
                    check("Business page: one GET /business/setup", len(reads) == 1, str(reads))
                    check("Business page: nothing went to /demo/", not demo_hits(), str(demo_hits()))

                    cta.click()
                    page.wait_for_timeout(500)
                    check("the line opens #/business/guided-setup",
                          page.url.endswith("#/business/guided-setup"), page.url)
                    check("menu: Guided setup is there",
                          nav.get_by_role("button", name="Guided setup").count() == 1)
                    items = nav.locator("ul > li > button").count()
                    check(f"menu: {MENU_ITEMS} items", items == MENU_ITEMS, str(items))
                    check("the settings board is in the side panel",
                          board.count() == 1
                          and page.locator("aside[aria-label='Settings board'] [data-board='settings']").count() == 1,
                          str(board.count()))
                    board_text = board.inner_text() if board.count() else ""
                    check("board: nothing published yet", "Nothing published yet" in board_text, board_text[:300])
                    check("board: no transfers yet", "Nobody to put callers through to yet" in board_text,
                          board_text[:300])
                    check("the line is gone while the section is open", cta.count() == 0)

                    # ---- 3. start
                    page.get_by_role("button", name="Start the interview").click()
                    log.wait_for(timeout=5000)
                    page.wait_for_timeout(300)
                    starts = hits("POST", "/business/setup/turn")
                    check("Start POSTs /business/setup/turn with an empty message",
                          len(starts) == 1 and json.loads(starts[0][2] or "{}") == {"message": ""}, str(starts))
                    check("the consultant opens with the transfers question",
                          "who should callers be put through to" in log.inner_text(), log.inner_text()[:300])
                    focused = page.evaluate("document.activeElement?.getAttribute('aria-label')")
                    check("the composer has focus", focused == "Your answer", str(focused))

                    # ---- 4. a turn held in flight
                    held: list = []

                    def hold_turn(route):
                        # The CORS preflight goes on to the fake, which answers it with the headers
                        # the browser needs; only the POST itself is held.
                        if route.request.method == "POST":
                            held.append(route)
                        else:
                            route.fallback()

                    turn_url = re.compile(r".*/business/setup/turn$")
                    page.route(turn_url, hold_turn)
                    composer.fill(ANSWER)
                    composer.press("Enter")
                    for _ in range(50):
                        if held:
                            break
                        page.wait_for_timeout(100)
                    check("the answer was sent (and held)", len(held) == 1, str(len(held)))
                    check("in flight: the composer is disabled", composer.is_disabled())
                    check("in flight: the consultant is thinking",
                          page.get_by_text("The consultant is thinking").is_visible())
                    mine = log.locator("div.items-end", has_text=ANSWER)
                    check("in flight: an optimistic 'You' bubble with the answer",
                          mine.count() >= 1 and "You" in mine.first.inner_text(), log.inner_text()[-300:])
                    check("in flight: Send is disabled", page.locator("[aria-label='Send']").is_disabled())
                    if held:
                        held_body = json.loads(held[0].request.post_data or "{}")
                        held[0].continue_()
                    else:
                        held_body = {}
                    page.unroute(turn_url, hold_turn)

                    # ---- 5. the reply, in the chat and on the board
                    try:
                        log.get_by_text("Done — Sam").wait_for(timeout=5000)
                    except Exception:
                        pass
                    card = board.locator("[data-card='transfer:setup-t1']")
                    lit = board.locator("[data-highlight]").count()
                    check("the card the reply touched is lit",
                          lit >= 1 and card.count() == 1 and card.get_attribute("data-highlight") is not None,
                          f"lit={lit} card={card.count()}")
                    check("the turn carried the answer", held_body == {"message": ANSWER}, str(held_body))
                    check("the reply is in the chat", "Done — Sam" in log.inner_text(), log.inner_text()[-300:])
                    check("the change is listed under the reply",
                          page.locator("main").get_by_text("Added transfer: Sam", exact=True).count() == 1)
                    transfers_chip = page.evaluate(
                        """() => {
                          const li = [...document.querySelectorAll('ol[aria-label="Topics"] li')]
                            .find((el) => el.textContent.trim() === 'Transfers');
                          return li ? { cls: li.className, tick: Boolean(li.querySelector('svg')) } : null;
                        }"""
                    )
                    check("the Transfers topic reads done",
                          bool(transfers_chip) and "text-primary" in transfers_chip["cls"] and transfers_chip["tick"],
                          str(transfers_chip))
                    card_text = card.inner_text() if card.count() else ""
                    for want in ("Sam", "(206) 555-0100", "Weekdays 9am–5pm",
                                 "Asks for the caller's name and the reason for the call first"):
                        check(f"board card: {want}", want in card_text, card_text[:300])
                    page.wait_for_timeout(2600)
                    check("the light goes out after two seconds", board.locator("[data-highlight]").count() == 0)
                    check("board: draft, not published", "Draft — not published yet" in board.inner_text())
                    publish = page.locator("header.topbar").get_by_role("button", name="Publish", exact=True)
                    check("the top bar's Publish is enabled", publish.count() == 1 and publish.is_enabled(),
                          str(publish.count()))
                    in_tw = page.evaluate(
                        """() => ({
                          log: Boolean(document.querySelector('main [role="log"]')?.closest('.tw')),
                          aside: Boolean(document.querySelector('aside[aria-label="Settings board"]')?.closest('.tw')),
                        })"""
                    )

                    # ---- 6. Edit opens the real section, which holds what the consultant wrote
                    board.locator("section[aria-labelledby='board-transfers']").get_by_role(
                        "button", name="Edit", exact=True).click()
                    page.wait_for_timeout(500)
                    check("Edit opens #/business/transfers", page.url.endswith("#/business/transfers"), page.url)
                    main_text = page.inner_text("main")
                    check("Transfers: lists Sam on (206) 555-0100",
                          "Sam" in main_text and "(206) 555-0100" in main_text, main_text[:400])
                    puts = hits("PUT", "/business/call-settings")
                    check("the dashboard never saved the draft itself (the consultant wrote it)",
                          not puts, str(puts))
                    nav.get_by_role("button", name="Guided setup").click()
                    page.wait_for_timeout(400)
                    check("back on Guided setup, the conversation is still there",
                          log.count() == 1 and "Done — Sam" in log.inner_text())

                    # ---- 7. the test console behind the board
                    board.get_by_role("button", name="Test call").click()
                    page.wait_for_timeout(300)
                    console = page.locator("[role='group'][aria-label='Test console']")
                    check("Test call shows the test console",
                          console.count() == 1 and console.is_visible() and board.count() == 0,
                          f"console={console.count()} board={board.count()}")
                    page.get_by_role("button", name="Back to the settings board").click()
                    page.wait_for_timeout(300)
                    check("Back returns to the board", board.count() == 1 and board.is_visible())

                    # ---- 8. the consultant switched off on this server
                    empty = json.loads(json.dumps(fake_backend.EMPTY_CALL_SETTINGS))

                    def unavailable(route):
                        if route.request.method == "GET":
                            fulfill_json(route, 200, {"session": None, "draft": empty, "dirty": False,
                                                      "available": False, "unavailableReason": "no_openai_key"})
                        else:
                            route.fallback()

                    setup_url = re.compile(r".*/business/setup(\?.*)?$")
                    page.route(setup_url, unavailable)
                    check("still on #/business/guided-setup before the reload",
                          page.url.endswith("#/business/guided-setup"), page.url)
                    page.reload(wait_until="networkidle")
                    page.wait_for_timeout(600)
                    main_text = page.inner_text("main")
                    check("unavailable: says it isn't switched on", "Not switched on for this server" in main_text,
                          main_text[:400])
                    check("unavailable: no Start the interview",
                          page.get_by_role("button", name="Start the interview").count() == 0)
                    check("unavailable: the board still renders",
                          board.count() == 1 and "Sam" in board.inner_text())
                    page.unroute(setup_url, unavailable)

                    # ---- 9. Start over
                    page.reload(wait_until="networkidle")
                    page.wait_for_timeout(600)
                    check("reloaded: the interview is back", log.count() == 1 and "Done — Sam" in log.inner_text())
                    page.get_by_role("button", name="Start over").first.click()
                    page.wait_for_timeout(700)
                    check("Start over POSTs /business/setup/reset", len(hits("POST", "/business/setup/reset")) == 1)
                    check("Start over: back to the empty state",
                          "Set up by talking it through" in page.inner_text("main"))
                    check("Start over: the draft stays on the board", "Sam" in board.inner_text())
                    # The line hides while Guided setup is open; it comes back anywhere else.
                    nav.get_by_role("button", name="Transfer calls").click()
                    page.wait_for_timeout(400)
                    check("Start over: the Business page offers the interview again", cta.count() == 1)

                    # ---- 10. the .tw boundary, errors, and nothing to /demo/
                    check("the chat renders inside .tw", in_tw["log"], str(in_tw))
                    check("the board's side panel renders inside .tw", in_tw["aside"], str(in_tw))
                    check("no page errors", not errors, "; ".join(errors[:3]))
                    check("nothing went to /demo/", not demo_hits(), str(demo_hits()))
                    browser.close()
            finally:
                server.terminate()
    finally:
        backend.shutdown()

    print()
    if check.failed:
        print(f"{check.failed} CHECK(S) FAILED")
        return 1
    print("ALL GUIDED SETUP CHECKS PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
