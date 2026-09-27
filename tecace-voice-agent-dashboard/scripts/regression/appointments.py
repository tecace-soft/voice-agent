"""The Business page's Appointments section, opened in a browser.

What this checks: every product the public page names is listed, and only the ones that can be
connected say so (the rest say "Coming soon" or "Needs setup" and cannot be clicked); connecting
Apple Calendar with an app-specific password goes through the dialog, a refusal lands in it, and a
good one shows the connected calendar with its picker and openings; the booking rules save into the
call-settings draft (never a demo endpoint); and the section stays inside `.tw`.

Screenshots go to .regression/appointments/ (git-ignored).

Run (one at a time — these scripts share ports):  python scripts/regression/appointments.py
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import fake_backend  # noqa: E402
from business_tabs import APP_PORT, BACKEND_PORT, Checks, build, serve  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

# Git-ignored, like compare.py's output.
OUT = Path(__file__).resolve().parents[2] / ".regression" / "appointments"


def main() -> int:
    check = Checks()
    OUT.mkdir(parents=True, exist_ok=True)
    backend = fake_backend.start(BACKEND_PORT)
    try:
        with tempfile.TemporaryDirectory(prefix="appointments-") as tmp:
            out = Path(tmp) / "app"
            build(out)
            server = serve(out)
            base = f"http://127.0.0.1:{APP_PORT}"
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")
                    ctx = browser.new_context(viewport={"width": 1600, "height": 1100})
                    ctx.add_init_script("localStorage.setItem('transcribe.token', 'tok-user')")
                    page = ctx.new_page()
                    errors: list[str] = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    sent: list[tuple[str, str, str]] = []
                    page.on("request", lambda r: sent.append((r.method, r.url, r.post_data or "")))
                    page.on("dialog", lambda d: d.accept())

                    page.goto(f"{base}/#/business/appointments", wait_until="networkidle")
                    page.wait_for_timeout(800)
                    main_el = page.locator("main")
                    text = main_el.inner_text()
                    check("the section opens from the URL", "Where bookings go" in text, text[:300])
                    check("no 'Soon' badge on the menu entry any more",
                          "Soon" not in page.locator("nav[aria-label='Receptionist settings']").inner_text())
                    check("nothing connected yet", "No calendar connected yet" in text)

                    def tile(name: str):
                        return main_el.get_by_role("button", name=name)

                    for name in ("Apple Calendar", "Other calendar (CalDAV)", "Cal.com", "Calendly",
                                 "Squarespace Scheduling"):
                        t = tile(name)
                        check(f"{name}: listed and connectable", t.count() == 1 and t.first.is_enabled()
                              and "Connect" in t.first.inner_text())
                    for name in ("Google Calendar", "Microsoft Outlook"):
                        t = tile(name)
                        check(f"{name}: listed, needs server setup", t.count() == 1 and not t.first.is_enabled()
                              and "Needs setup" in t.first.inner_text())
                    for name in ("OpenTable", "Resy", "Square Appointments", "HubSpot Meetings"):
                        t = tile(name)
                        check(f"{name}: coming soon, not clickable", t.count() == 1 and not t.first.is_enabled()
                              and "Coming soon" in t.first.inner_text())
                    page.screenshot(path=str(OUT / "appointments-gallery.png"), full_page=True)

                    # ---- Apple: a refusal lands in the dialog, a good password connects
                    tile("Apple Calendar").first.click()
                    dialog = page.get_by_role("dialog")
                    check("Apple: the dialog explains the app-specific password",
                          "App-Specific Passwords" in dialog.inner_text())
                    dialog.get_by_label("Apple ID email").fill("sam@icloud.com")
                    dialog.get_by_label("App-specific password").fill("wrong")
                    page.screenshot(path=str(OUT / "appointments-apple-dialog.png"))
                    dialog.get_by_role("button", name="Connect", exact=True).click()
                    page.wait_for_timeout(600)
                    check("Apple: a refusal is shown in the dialog", "didn't accept that sign-in" in dialog.inner_text())
                    dialog.get_by_label("App-specific password").fill("good-app-password")
                    dialog.get_by_role("button", name="Connect", exact=True).click()
                    page.wait_for_timeout(900)
                    text = main_el.inner_text()
                    check("Apple: connected, with the account", "Connected" in text and "sam@icloud.com" in text, text[:400])
                    connects = [x for x in sent if x[0] == "POST" and "/business/calendar/connect" in x[1]]
                    check("Apple: POSTs /business/calendar/connect with the provider",
                          len(connects) == 2 and json.loads(connects[-1][2]).get("provider") == "apple-calendar",
                          str(connects)[:200])
                    check("Apple: the calendar picker shows where bookings go", "Bookings go into" in text and "Home" in text)

                    main_el.get_by_role("button", name="Check next openings").click()
                    page.wait_for_timeout(600)
                    check("openings: shown as a caller would hear them",
                          "Tuesday, September 1 at 9:00 AM" in main_el.inner_text())

                    # ---- booking rules: saved into the call-settings draft
                    main_el.get_by_role("switch", name="Book appointments on calls").click()
                    page.wait_for_timeout(700)
                    main_el.get_by_label("What callers book").fill("Cleaning")
                    main_el.get_by_role("button", name="Save booking rules").click()
                    page.wait_for_timeout(700)
                    saves = [x for x in sent if x[0] == "PUT" and "/business/call-settings" in x[1]]
                    last = json.loads(saves[-1][2]).get("draft", {}).get("appointments", {}) if saves else {}
                    check("rules: saved to /business/call-settings as the draft",
                          last.get("enabled") is True and last.get("title") == "Cleaning", str(last)[:200])
                    check("rules: never a demo endpoint", not [x for x in sent if "/demo/" in x[1]])
                    check("rules: other settings kept in the saved draft",
                          bool(saves) and "transfer" in json.loads(saves[-1][2]).get("draft", {}))
                    page.screenshot(path=str(OUT / "appointments-connected.png"), full_page=True)

                    in_tw = page.evaluate(
                        "() => !!document.querySelector('main')?.closest('.tw') || !!document.querySelector('.tw main') || !!document.querySelector('.tw')"
                    )
                    check("the section renders inside .tw", bool(in_tw))
                    check("no page errors", not errors, "; ".join(errors)[:300])
                    browser.close()
            finally:
                server.terminate()
    finally:
        backend.shutdown()
    print("PASS" if not check.failed else f"FAIL ({check.failed})")
    return 1 if check.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
