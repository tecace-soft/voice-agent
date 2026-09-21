"""End-to-end check of the Demos section: proxy, promo cookie, unlock card, record-id routes.

    python scripts/regression/demos_e2e.py      (from tecace-voice-agent-dashboard/)

Builds this app, serves it with `vite preview` (whose proxy sends /promo-api to fake_promo.py),
signs in against fake_backend.py and walks the flow in Edge. Exit 0 = all checks pass,
1 = failures listed, 2 = harness failure. Needs ports 5199, 8898 and 8899 free.
"""

from __future__ import annotations

import os
import re
import socket
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

import fake_backend
import fake_promo
from compare import APP_ROOT, BACKEND_PORT, NEW_PORT, OUT_DIR, HarnessError, build, serve, settle, stop


class Checks:
    def __init__(self) -> None:
        self.failed: list[str] = []

    def __call__(self, name: str, ok: bool, detail: str = "") -> None:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f" ({detail})" if detail and not ok else ""))
        if not ok:
            self.failed.append(name)


def port_in_use(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def restart_promo():
    # Windows can hold the port for a moment after the old server closed; retry briefly.
    for _ in range(20):
        try:
            return fake_promo.start()
        except OSError:
            time.sleep(0.5)
    raise HarnessError(f"couldn't restart the fake promo on port {fake_promo.PORT}")


def open_page(browser, token: str | None, url: str, promo_requests: list[str], page_errors: list[str]):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    init = ["try { localStorage.clear(); } catch (e) {}", "localStorage.setItem('theme', 'light');"]
    if token:
        init.append(f"localStorage.setItem('transcribe.token', '{token}');")
    ctx.add_init_script("\n".join(init))
    page = ctx.new_page()
    page.route("**/favicon.ico", lambda r: r.fulfill(status=204))
    page.on("request", lambda r: promo_requests.append(f"{r.method} {urlparse(r.url).path}")
            if "/promo-" in r.url else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.goto(url)
    settle(page)
    return ctx, page


def run() -> int:
    for port in (NEW_PORT, BACKEND_PORT, fake_promo.PORT):
        if port_in_use(port):
            raise HarnessError(f"port {port} in use")
    OUT_DIR.mkdir(exist_ok=True)
    check = Checks()
    page_errors: list[str] = []
    backend = fake_backend.start(BACKEND_PORT)
    promo = fake_promo.start()
    os.environ["PROMO_API_URL"] = f"http://127.0.0.1:{fake_promo.PORT}"  # read by vite preview's proxy
    try:
        with tempfile.TemporaryDirectory(prefix="demos-e2e-") as tmp:
            out = Path(tmp) / "app"
            build("demos-e2e", APP_ROOT, out)
            proc, log = serve("demos-e2e", APP_ROOT, out, NEW_PORT)
            base = f"http://127.0.0.1:{NEW_PORT}/"
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")

                    # A user never sees the Demos section, and asking for it by URL is refused
                    # without the promo ever being contacted.
                    reqs: list[str] = []
                    ctx, page = open_page(browser, "tok-user", base + "#/demos/prospects", reqs, page_errors)
                    check("user: no Demos group in the sidebar",
                          page.locator('.sidebar-group[data-group="demos"]').count() == 0)
                    check("user: a Demos URL is refused",
                          "Only an admin can see the demos." in page.locator("main").inner_text())
                    check("user: the promo is never contacted", reqs == [], str(reqs))
                    ctx.close()

                    # Admin: the group is there, and a transcribe view doesn't touch the promo.
                    reqs = []
                    ctx, page = open_page(browser, "tok-admin", base + "#/overview", reqs, page_errors)
                    check("admin: Demos group with three items",
                          page.locator('.sidebar-group[data-group="demos"] .nav-item').count() == 3)
                    check("admin: no promo request on a transcribe view", reqs == [], str(reqs))

                    page.get_by_role("button", name="Prospects", exact=True).click()
                    page.get_by_role("heading", name="Unlock demos").wait_for()
                    check("Prospects opens #/demos/prospects", page.evaluate("location.hash") == "#/demos/prospects")
                    check("locked: the unlock card is shown", True)
                    check("only the health probe was sent while locked",
                          reqs == ["GET /promo-api/admin/health"], str(reqs))
                    check("breadcrumb says Demos", page.locator(".crumbs").inner_text().startswith("Demos"))
                    check("no mailbox picker or Refresh on Demos views",
                          page.locator(".mailbox-picker").count() == 0
                          and page.get_by_role("button", name="Refresh").count() == 0)
                    check("Demos render inside one .tw wrapper", page.locator("main .tw").count() == 1)
                    unlock_bg = page.get_by_role("button", name="Unlock demos").evaluate(
                        "e => getComputedStyle(e).backgroundColor")
                    check("unlock button is brand blue", unlock_bg == "rgb(17, 109, 255)", unlock_bg)

                    page.get_by_label("Promo password").fill("wrong")
                    page.get_by_role("button", name="Unlock demos").click()
                    page.get_by_role("alert").wait_for()
                    check("a wrong password is rejected", "Wrong password." in page.get_by_role("alert").inner_text())

                    page.get_by_label("Promo password").fill(fake_promo.PASSWORD)
                    page.get_by_role("button", name="Unlock demos").click()
                    page.get_by_text("Harbor Dental").first.wait_for()
                    check("unlocked: prospects are listed",
                          page.get_by_text("Harbor Dental").first.is_visible()
                          and page.get_by_text("Researching").first.is_visible())

                    page.get_by_role("button", name=re.compile("Harbor Dental")).click()
                    page.get_by_role("heading", name="Harbor Dental").wait_for()
                    check("a prospect gets its own URL",
                          page.evaluate("location.hash") == "#/demos/prospects/pr0SPct1",
                          page.evaluate("location.hash"))
                    check("Prospects stays highlighted on a prospect",
                          page.locator(".nav-item.is-active").inner_text().strip() == "Prospects")

                    page.reload()
                    settle(page)
                    page.get_by_role("heading", name="Harbor Dental").wait_for()
                    check("refresh keeps the prospect", True)
                    check("refresh stays unlocked (the promo cookie was kept)",
                          page.get_by_role("heading", name="Unlock demos").count() == 0)

                    page.goto(base + "#/demos/prospects/nope")
                    page.reload()
                    settle(page)
                    page.get_by_role("alert").wait_for()
                    check("an unknown prospect says so",
                          "That prospect doesn't exist." in page.get_by_role("alert").inner_text())

                    page.goto(base + "#/apiKeys")
                    page.reload()
                    settle(page)
                    check("#/apiKeys survives a refresh",
                          page.get_by_text("Let another system read call minutes").is_visible())

                    reqs.clear()
                    page.get_by_title("Sign out").click()
                    settle(page)
                    check("sign-out also locks the demos", "DELETE /promo-api/admin/login" in reqs, str(reqs))
                    ctx.close()

                    # The promo is down: an honest card, and "Try again" recovers once it's back.
                    promo.shutdown()
                    promo.server_close()
                    reqs = []
                    ctx, page = open_page(browser, "tok-admin", base + "#/demos/overview", reqs, page_errors)
                    page.get_by_role("heading", name="Demo service unreachable").wait_for()
                    check("promo down: the unreachable card is shown", True)
                    promo = restart_promo()
                    page.get_by_role("button", name="Try again").click()
                    page.get_by_role("heading", name="Unlock demos").wait_for()
                    check("Try again recovers once the promo is back", True)
                    ctx.close()

                    check("no page errors", page_errors == [], str(page_errors))
                    browser.close()
            finally:
                stop(proc, log)
    finally:
        backend.shutdown()
        backend.server_close()
        promo.shutdown()
        promo.server_close()

    print(f"\n{len(check.failed)} failing checks" if check.failed else "\nALL DEMOS CHECKS PASS")
    return 1 if check.failed else 0


def main() -> int:
    try:
        return run()
    except Exception as exc:  # noqa: BLE001 — any harness problem is exit 2, never a pass
        print(f"HARNESS FAILURE: {type(exc).__name__}: {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
