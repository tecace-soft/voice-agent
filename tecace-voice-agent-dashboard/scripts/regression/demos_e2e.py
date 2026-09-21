"""End-to-end check of the Demos section: proxy, promo cookie, unlock card, record-id routes, and
the promo's real Overview and Prospects screens (KPIs, charts, recent calls; the prospects table,
its menu, copy link, the "New customer" dialog and the live switch), portals, theme re-render and a
runtime check that no transcribe (@layer legacy) class name lands on promo markup.

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


# Every class name used in a rule inside `@layer legacy` (the transcribe CSS), and for each one the
# properties it sets when it's the whole selector (`.x { … }`). Walks document.styleSheets
# recursively: CSSLayerBlockRule has .name and .cssRules; an `@import … layer(legacy)` that survived
# bundling is a CSSImportRule with .layerName and .styleSheet. Also returns the properties set by
# unlayered single-class rules inside `@scope (.tw)` — the promo's own copies — so a shared name can
# be shown to be fully shadowed (unlayered beats every layer, whatever the specificity).
LEGACY_CLASSES_JS = r"""
() => {
  const legacy = {}, scoped = {};
  const classesOf = (sel) => [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  const propsOf = (rule) => [...rule.style].filter((p) => !p.startsWith("--"));
  const walk = (rules, inLegacy, layered, inTwScope) => {
    for (const rule of rules) {
      if (rule instanceof CSSImportRule) {
        if (!rule.styleSheet) continue;
        let inner;
        try { inner = rule.styleSheet.cssRules; } catch (e) { continue; }  // cross-origin (fonts)
        const name = rule.layerName;
        walk(inner, inLegacy || name === "legacy", layered || name !== null, inTwScope);
        continue;
      }
      if (typeof CSSLayerBlockRule !== "undefined" && rule instanceof CSSLayerBlockRule) {
        walk(rule.cssRules, inLegacy || rule.name === "legacy", true, inTwScope);
        continue;
      }
      if (typeof CSSScopeRule !== "undefined" && rule instanceof CSSScopeRule) {
        walk(rule.cssRules, inLegacy, layered, inTwScope || /\.tw\b/.test(rule.start || ""));
        continue;
      }
      if (rule instanceof CSSStyleRule) {
        const sel = rule.selectorText;
        if (inLegacy) {
          for (const c of classesOf(sel)) {
            const entry = (legacy[c] ??= { props: [], compound: false });
            if (sel.trim() === "." + c) entry.props.push(...propsOf(rule));
            else entry.compound = true;
          }
        } else if (!layered && inTwScope && /^\.[-\w]+$/.test(sel.trim())) {
          const c = sel.trim().slice(1);
          (scoped[c] ??= []).push(...propsOf(rule));
        }
        if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules, inLegacy, layered, inTwScope);
        continue;
      }
      if (rule.cssRules) walk(rule.cssRules, inLegacy, layered, inTwScope);  // @media, @supports …
    }
  };
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    walk(rules, false, false, false);
  }
  return { legacy, scoped };
}
"""

# Every class on every element of the promo's markup: the Demos .tw wrapper and the portal container.
TW_CLASSES_JS = """
() => {
  const out = new Set();
  for (const el of document.querySelectorAll('main .tw, main .tw *, [data-tw-portal], [data-tw-portal] *'))
    for (const c of el.classList) out.add(c);
  return [...out];
}
"""

# A StatCard's value, found by its title (components/admin/shared.tsx).
STAT_JS = """
(title) => {
  for (const label of document.querySelectorAll('main .tw span.ta-label-1')) {
    if (label.textContent.trim() !== title) continue;
    const value = label.parentElement.querySelector('.ta-numeric');
    return value ? value.textContent.trim() : null;
  }
  return null;
}
"""

# The resolved --ui-popover colour as the browser would paint it (rgb(...)), read from `el`.
POPOVER_COLOR_JS = """
(el) => {
  const probe = document.createElement('div');
  probe.style.backgroundColor = getComputedStyle(el).getPropertyValue('--ui-popover').trim();
  el.appendChild(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return { popover: color, bg: getComputedStyle(el).backgroundColor };
}
"""


DEMO_BASE_URL = "http://promo.example"
# Where the dark Overview is saved, so the chart colours can be looked at (DEMOS_E2E_SCREENSHOT).
SCREENSHOT = Path(os.environ.get("DEMOS_E2E_SCREENSHOT")
                  or Path(tempfile.gettempdir()) / "demos-e2e-chart-dark.png")

# The colours the Overview charts are drawn with — the variables src/demos/lib/chart-theme.ts
# readChartTheme() reads, resolved on <html> as it does. The chart colours must be 6-digit hex:
# the charts append a 2-digit alpha (`${color}1F`), which makes any other form an invalid colour
# that canvas silently ignores (the bug that painted the dark charts black).
CHART_VARS_JS = """
() => {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const colors = Array.from({ length: 7 }, (_, i) => v(`--ui-chart-${i + 1}`));
  const other = Object.fromEntries(['--ui-foreground', '--ui-muted-foreground', '--ui-card',
    '--ui-border', '--ui-success', '--ui-destructive', '--ui-font-sans'].map((n) => [n, v(n)]));
  return { colors, other };
}
"""

# What a chart actually painted: over every pixel of the canvas, how many are close to `rgb`
# (the chart's series colour; pixels any alpha > 0, compared unpremultiplied) and how many are
# near-black (r+g+b <= 60 with alpha > 0).
CANVAS_PIXELS_JS = """
(canvas, rgb) => {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let near = 0, black = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a === 0) continue;
    if (r + g + b <= 60) black++;
    if (Math.abs(r - rgb[0]) + Math.abs(g - rgb[1]) + Math.abs(b - rgb[2]) <= 60) near++;
  }
  return { near, black };
}
"""


def open_page(browser, token: str | None, url: str, promo_requests: list[str], page_errors: list[str]):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    init = ["try { localStorage.clear(); } catch (e) {}", "localStorage.setItem('theme', 'light');"]
    if token:
        init.append(f"localStorage.setItem('transcribe.token', '{token}');")
    ctx.add_init_script("\n".join(init))
    # "Copy link" / "Copy email" write to the clipboard; without the grant the write is refused
    # and the (unawaited) promise rejection would surface as a page error.
    ctx.grant_permissions(["clipboard-read", "clipboard-write"])
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
    # Baked into the build: the origin of the demo links "Copy link" / "Copy email" produce.
    os.environ["VITE_PUBLIC_DEMO_BASE_URL"] = DEMO_BASE_URL
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
                    harbor_link = page.get_by_role("link", name="Harbor Dental", exact=True)
                    harbor_link.wait_for()
                    rows = page.locator("main .tw table tbody tr")
                    check("unlocked: prospects are listed",
                          harbor_link.is_visible()
                          and rows.filter(has_text="Researching").count() == 1)
                    tw_classes: set[str] = set(page.evaluate(TW_CLASSES_JS))

                    # --- Prospects: the promo's real table ---
                    check("prospects: the table lists both prospects", rows.count() == 2, str(rows.count()))
                    search = page.get_by_label("Search customers")
                    search.fill("cedar")
                    page.wait_for_function(
                        "() => document.querySelectorAll('main .tw table tbody tr').length === 1")
                    check("prospects: searching 'cedar' leaves one row",
                          rows.count() == 1 and "cedarbakery" in rows.first.inner_text(),
                          rows.first.inner_text())
                    search.fill("")
                    page.wait_for_function(
                        "() => document.querySelectorAll('main .tw table tbody tr').length === 2")

                    harbor_row = rows.filter(has=harbor_link)
                    harbor_row.get_by_role("button", name="More actions").click()
                    menu = page.locator("[data-tw-portal] [role=menu]")
                    menu.wait_for()
                    check("prospects: the actions menu renders inside [data-tw-portal]",
                          menu.count() == 1
                          and page.locator("[role=menu]").count() == 1
                          and menu.get_by_role("menuitem", name="Copy link").is_visible())
                    colors = menu.evaluate(POPOVER_COLOR_JS)
                    check("prospects: the menu has the promo's popover background",
                          colors["bg"] == colors["popover"] and colors["bg"] not in ("rgba(0, 0, 0, 0)", "transparent"),
                          str(colors))
                    tw_classes |= set(page.evaluate(TW_CLASSES_JS))
                    menu.get_by_role("menuitem", name="Copy link").click()
                    page.get_by_text("Link copied.").wait_for()
                    check("prospects: Copy link shows a toast",
                          page.locator("main .tw [data-sonner-toast]", has_text="Link copied.").count() >= 1)
                    copied = page.evaluate("navigator.clipboard.readText()")
                    check("prospects: Copy link copies the public demo link (VITE_PUBLIC_DEMO_BASE_URL)",
                          copied == f"{DEMO_BASE_URL}/c/pr0SPct1", repr(copied))

                    page.get_by_role("button", name="New customer").click()
                    dialog = page.locator("[data-tw-portal] [role=dialog]")
                    dialog.wait_for()
                    check("prospects: the New customer dialog renders inside [data-tw-portal]",
                          page.locator("[role=dialog]").count() == 1
                          and dialog.get_by_role("heading", name="New customer").is_visible())
                    tw_classes |= set(page.evaluate(TW_CLASSES_JS))
                    add = dialog.get_by_role("button", name="Add customer")
                    check("prospects: Add customer is disabled with no business name", add.is_disabled())
                    # The button stays disabled for a blank name, so a name of spaces is submitted
                    # the only way left (the form's own submit); the promo refuses it server-side.
                    reqs.clear()
                    dialog.get_by_label("Business name").fill("   ")
                    dialog.locator("form").evaluate("f => f.requestSubmit()")
                    dialog.get_by_role("alert").wait_for()
                    check("prospects: a blank business name shows the promo's 400 error",
                          dialog.get_by_role("alert").inner_text().strip() == "Enter the business name."
                          and "POST /promo-api/admin/customers" in reqs,
                          dialog.get_by_role("alert").inner_text())
                    dialog.get_by_label("Business name").fill("Birch Florist")
                    add.click()
                    page.get_by_text("Customer added. Research is running.").wait_for()
                    dialog.wait_for(state="detached")
                    check("prospects: adding a customer toasts and closes the dialog",
                          page.locator("[role=dialog]").count() == 0)

                    page.get_by_role("switch", name="Toggle the demo for Harbor Dental").click()
                    page.get_by_text("Demo is paused.").wait_for()
                    check("prospects: pausing a live demo says so", True)
                    rows.filter(has_text="sam@cedarbakery.example").get_by_role("switch").click()
                    page.get_by_text("Demo is live.").wait_for()
                    check("prospects: resuming a paused demo says so", True)

                    # --- Demo overview: KPIs, charts, recent calls ---
                    page.get_by_role("button", name="Demo overview", exact=True).click()
                    page.get_by_text("Recent calls").wait_for()
                    page.wait_for_function("() => document.querySelectorAll('main .tw canvas').length === 2")
                    stats = {t: page.evaluate(STAT_JS, t) for t in ("Customers", "Tested", "Calls", "Minutes")}
                    check("overview: the KPI cards show the promo's numbers",
                          stats == {"Customers": "2", "Tested": "1", "Calls": "3", "Minutes": "9"}, str(stats))
                    check("overview: both charts are titled",
                          page.get_by_text("Calls per day", exact=True).is_visible()
                          and page.get_by_text("Top customers", exact=True).is_visible())
                    check("overview: a <canvas> for each chart",
                          page.locator("main .tw canvas").count() == 2)
                    recent = page.locator("main .tw table tbody tr")
                    check("overview: Recent calls links a row to the prospect",
                          recent.count() == 4
                          and recent.locator('a[href="#/demos/prospects/pr0SPct1"]').count() == 4,
                          str(recent.count()))
                    tw_classes |= set(page.evaluate(TW_CLASSES_JS))

                    # The charts read their colours when drawn, so a theme change must redraw them —
                    # the charts are keyed on the theme, so each <canvas> is a new element after.
                    page.evaluate("() => document.querySelectorAll('main .tw canvas')"
                                  ".forEach((c) => c.dataset.beforeToggle = '1')")
                    page.get_by_title("Dark theme").click()
                    page.wait_for_function(
                        "() => document.documentElement.dataset.theme === 'dark'"
                        " && document.querySelectorAll('main .tw canvas').length === 2"
                        " && document.querySelectorAll('main .tw canvas[data-before-toggle]').length === 0",
                        timeout=5000)
                    check("overview: toggling the theme redraws both charts (new <canvas> elements)", True)
                    tw_classes |= set(page.evaluate(TW_CLASSES_JS))

                    # Dark charts are drawn in the promo's dark palette — not the transcribe
                    # variables (whose dark --chart-1 is 3-digit hex, which the alpha suffix
                    # broke into black fills).
                    chart_vars = page.evaluate(CHART_VARS_JS)
                    hex6 = re.compile(r"^#[0-9a-f]{6}$", re.IGNORECASE)
                    check("dark: every chart colour variable is set and 6-digit hex",
                          all(hex6.match(c) for c in chart_vars["colors"])
                          and all(chart_vars["other"].values()), str(chart_vars))
                    page.wait_for_timeout(600)  # Chart.js animates the redraw (150 ms)
                    c1 = chart_vars["colors"][0]
                    rgb = [int(c1[i:i + 2], 16) for i in (1, 3, 5)] if hex6.match(c1) else [0, 0, 0]
                    canvases = page.locator("main .tw canvas")
                    for i, which in enumerate(("calls line + area fill", "top-customers bar")):
                        px = canvases.nth(i).evaluate(CANVAS_PIXELS_JS, rgb)
                        check(f"dark: the {which} is painted in --ui-chart-1, not black",
                              px["near"] >= 300 and px["black"] < px["near"] // 10, f"{px} for {c1}")
                    page.locator("main .tw").screenshot(path=str(SCREENSHOT))
                    print(f"       (dark Overview screenshot: {SCREENSHOT})")
                    page.get_by_title("Light theme").click()
                    page.wait_for_function("() => document.documentElement.dataset.theme === 'light'")

                    # The promo session ends mid-use (cookie gone): the next promo call answers
                    # 401 and the section re-locks instead of showing an error.
                    ctx.clear_cookies(name=fake_promo.COOKIE)
                    page.get_by_label("Select the reporting period").click()
                    option = page.locator("[data-tw-portal] [role=option]", has_text="Last 7 days")
                    option.wait_for()
                    tw_classes |= set(page.evaluate(TW_CLASSES_JS))
                    reqs.clear()
                    option.click()
                    page.get_by_role("heading", name="Unlock demos").wait_for()
                    check("a promo session ending mid-use re-locks the demos",
                          "GET /promo-api/admin/analytics" in reqs, str(reqs))
                    page.get_by_label("Promo password").fill(fake_promo.PASSWORD)
                    page.get_by_role("button", name="Unlock demos").click()
                    page.get_by_text("Recent calls").wait_for()

                    # --- No transcribe class name lands on promo markup ---
                    css = page.evaluate(LEGACY_CLASSES_JS)
                    legacy, scoped = css["legacy"], css["scoped"]
                    # sr-only: Tailwind's utility sets a superset of the transcribe rule's
                    # properties (spec §3). grid: legacy only has `.areachart .grid` /
                    # `.barchart .grid` (SVG gridlines), which can't match promo markup — no
                    # promo element sits under .areachart/.barchart.
                    allowed = {"sr-only", "grid"}
                    hits = sorted((tw_classes & set(legacy)) - allowed)
                    # The TecAce type scale (.ta-*) is defined twice on purpose (spec §3): the
                    # transcribe copy in @layer legacy and the promo's unlayered copy in
                    # @scope (.tw), which wins inside .tw. A shared name passes only when every
                    # legacy rule for it is a plain `.name` rule whose properties the promo's
                    # copy also sets — i.e. it is fully shadowed.
                    shadowed = [c for c in hits
                                if c.startswith("ta-") and not legacy[c]["compound"]
                                and set(legacy[c]["props"]) <= set(scoped.get(c, []))]
                    bad = [c for c in hits if c not in shadowed]
                    check("no @layer legacy class name on promo markup (bar sr-only, grid, shadowed .ta-*)",
                          bool(legacy) and bool(tw_classes) and bad == [],
                          f"collisions: {bad}; legacy classes seen: {len(legacy)}")
                    if shadowed:
                        print(f"       (fully shadowed by the promo's own copy: {', '.join(shadowed)})")

                    page.get_by_role("button", name="Prospects", exact=True).click()
                    harbor_link.wait_for()
                    harbor_link.click()
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
