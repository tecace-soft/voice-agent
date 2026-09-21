"""Checks the Tailwind half of the stylesheet: utilities and the scoped reset work inside .tw,
and nothing inside .tw leaks out. Run from tecace-voice-agent-dashboard/ after a build:

    python scripts/regression/tw_probe.py

Exit 0 = all checks pass, 1 = failures listed, 2 = harness failure (port in use, build/preview
failed, or any other exception) — same convention as compare.py.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

import fake_backend
from compare import APP_ROOT, BACKEND_PORT, NEW_PORT, OUT_DIR, build, check_ports_free, serve, stop

PROBE = (APP_ROOT / "scripts" / "tw-probe.html").read_text(encoding="utf-8")

STYLE_OF = """
([id, prop]) => getComputedStyle(document.getElementById(id)).getPropertyValue(prop)
"""

LIGHT = [
    ("probe", "background-color", "rgba(0, 0, 0, 0)"),  # the .tw root paints no background (sits on the canvas)
    ("probe", "color", "rgb(23, 23, 23)"),
    ("p-bg", "background-color", "rgb(255, 255, 255)"),
    ("p-btn", "background-color", "rgb(17, 109, 255)"),
    ("p-btn", "border-top-left-radius", "16px"),
    ("p-btn", "border-top-style", "solid"),
    ("p-btn", "border-top-color", "rgba(112, 115, 124, 0.16)"),
    ("p-h1", "margin-top", "0px"),                  # scoped preflight reset the heading
    ("p-h1", "font-size", "16px"),                  # ...and its size (inherits)
    ("p-a", "color", "rgb(23, 23, 23)"),            # preflight beats legacy `a { color: primary }`
    ("p-ta", "font-weight", "500"),                 # scoped .ta-* beats the font-bold utility
    ("p-td", "padding-left", "0px"),                # Tailwind preflight `*{padding:0}` (base beats legacy)
    ("p-td", "border-top-width", "0px"),            # legacy th/td top border undone inside .tw
    ("p-outside-a", "color", "rgb(17, 109, 255)"),  # outside .tw the transcribe rule still applies
    ("p-outside-h1", "margin-top", "21.44px"),      # outside .tw the browser default h1 margin
    ("p-outside-grid", "display", "inline"),        # utilities are scoped: transcribe `grid` stays an SVG line
    ("p-outside-sr", "clip-path", "none"),          # ...and Tailwind's sr-only never reaches a transcribe element
]
DARK = [
    ("p-bg", "background-color", "rgb(27, 28, 30)"),
    ("p-btn", "background-color", "rgb(91, 132, 255)"),
]


def main() -> int:
    failures: list[str] = []
    check_ports_free()
    OUT_DIR.mkdir(exist_ok=True)
    server = fake_backend.start(BACKEND_PORT)
    try:
        with tempfile.TemporaryDirectory(prefix="tw-probe-") as tmp:
            out = Path(tmp)
            build("tw-probe", APP_ROOT, out)
            proc, log = serve("tw-probe", APP_ROOT, out, NEW_PORT)
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")
                    page = browser.new_page(viewport={"width": 1440, "height": 900})
                    page.goto(f"http://127.0.0.1:{NEW_PORT}/")
                    page.wait_for_load_state("networkidle")
                    page.evaluate("(html) => document.body.insertAdjacentHTML('beforeend', html)", PROBE)
                    for theme, checks in (("light", LIGHT), ("dark", DARK)):
                        page.evaluate(
                            "(t) => { document.documentElement.setAttribute('data-theme', t);"
                            " document.documentElement.classList.toggle('dark', t === 'dark'); }", theme)
                        for el, prop, want in checks:
                            got = page.evaluate(STYLE_OF, [el, prop])
                            status = "ok  " if got == want else "FAIL"
                            print(f"  {status} [{theme}] #{el} {prop}: {got!r}" + ("" if got == want else f" (want {want!r})"))
                            if got != want:
                                failures.append(f"[{theme}] #{el} {prop}")
                    browser.close()
            finally:
                stop(proc, log)
    finally:
        server.shutdown()
        server.server_close()
    print(f"\n{len(failures)} failing checks" if failures else "\nALL PROBE CHECKS PASS")
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 — anything unexpected is a harness failure, not a check failure
        print(f"HARNESS FAILURE: {type(exc).__name__}: {exc}")
        sys.exit(2)
