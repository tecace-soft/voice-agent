"""End-to-end check of the Demos section: who may reach it, the record-id routes, and the promo's
real Overview, Prospects, prospect and CRM screens (KPIs, charts, tables, portals, the drawer and
the pipeline board), plus a runtime check that no transcribe (@layer legacy) class name lands on
promo markup.

    python scripts/regression/demos_e2e.py      (from tecace-voice-agent-dashboard/)

Builds this app, serves it with `vite preview` and points it at fake_backend.py, which now answers
the Demo tabs' /demo/* routes as well as the transcribe ones. There is no promo any more: no proxy,
no second sign-in, no cookie — the Demo screens send the dashboard's own admin bearer token, so
this walks the flow as an admin, as a signed-in user, and signed out. Exit 0 = all checks pass,
1 = failures listed, 2 = harness failure. Needs ports 5199 and 8899 free.
"""

from __future__ import annotations

import json
import os
import re
import socket
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import TimeoutError as PlaywrightTimeout, expect, sync_playwright

import fake_backend
from compare import (APP_ROOT, BACKEND, BACKEND_PORT, NEW_PORT, OUT_DIR, HarnessError, build,
                     serve, settle, stop)


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


def fulfill_json(route, status: int, body: dict) -> None:
    """Answer an intercepted request with JSON.

    The backend is a different origin from the app (:8899 vs :5199), so a fulfilled response needs
    the same CORS header the fake sends — without it the browser drops the answer and the screen
    reports "Couldn't reach the server." instead of whatever this call is pretending happened.
    """
    route.fulfill(status=status, body=json.dumps(body),
                  headers={"content-type": "application/json", "access-control-allow-origin": "*"})


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

# Ask the backend's /demo routes straight from the page with whatever token is handed in (none at
# all for `null`) — what a signed-in user, or nobody, gets if they go looking for the data behind
# the Demo tabs rather than at the tabs themselves.
PROBE_JS = """
async ([base, token]) => {
  const paths = ['/demo/analytics?days=30', '/demo/customers', '/demo/customers/pr0SPct1',
                 '/demo/crm'];
  const out = {};
  for (const path of paths) {
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    const response = await fetch(base + path, { headers });
    out[path] = { status: response.status, body: await response.json().catch(() => null) };
  }
  return out;
}
"""

# What a stale, slow read of Harbor Dental would put in the drawer if it were allowed to land.
STALE_HARBOR = {
    "customer": {"id": "pr0SPct1", "businessName": "Harbor Dental", "active": True,
                 "profile": {"name": "Harbor Dental", "category": "Dentist", "address": "12 Wharf St",
                             "hours": [], "services": [], "highlights": [], "policies": {}, "faqs": []},
                 "dossier": "", "sources": [], "prompts": {"live": "", "backend": "", "greeting": "",
                                                           "edited": False},
                 "voice": "gleam", "agentName": "Alex", "stage": "interested", "status": "ready",
                 "createdAt": "2026-09-01T00:00:00.000Z", "updatedAt": "2026-09-01T00:00:00.000Z"},
    "stats": {"views": 0, "calls": 0, "totalSec": 0, "visitors": 0},
    "calls": [], "events": [],
    "notes": [{"id": "stale1", "at": "2026-09-01T00:00:00.000Z",
               "text": "A note only the stale read has."}],
}

# The pipeline board: one entry per stage column, with its header count and the cards in it.
BOARD_JS = """
() => [...document.querySelectorAll('main .tw .grid-cols-5 > section')].map((column) => ({
  stage: column.querySelector('h3').textContent.trim(),
  count: column.querySelector('header span').textContent.trim(),
  cards: [...column.querySelectorAll('li .ta-label-1')].map((c) => c.textContent.trim()),
}))
"""

# A StatCard's value, found by its title (components/admin/shared.tsx).
STAT_JS = """
(title) => {
  for (const label of document.querySelectorAll('main .tw span.ta-label-1')) {
    if (label.textContent.trim() !== title) continue;
    const value = label.parentElement.querySelector('.ta-numeric');
    if (value) return value.textContent.trim();
  }
  return null;
}
"""

# The prospect page's detail grid: the tabs card, how far it spans, and what is in the column
# beside it. The promo's layout is three tracks with the tabs card over two of them and the
# "Test call" card in the third — restored with the test call on 2026-09-23.
TABS_CARD_JS = """
() => {
  const card = document.querySelector('main .tw [role=tablist]').closest('.rounded-xl');
  const grid = card.parentElement;
  const cards = [...grid.children];
  const panel = grid.querySelector('button[aria-label="Call now"],'
    + ' button[aria-label="Start a new call"], button[aria-label="End the call"]');
  return {
    card: Math.round(card.getBoundingClientRect().width),
    grid: Math.round(grid.getBoundingClientRect().width),
    tracks: getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length,
    span: getComputedStyle(card).gridColumnStart,
    siblings: cards.length,
    tabsIndex: cards.indexOf(card),
    panelIndex: panel ? cards.indexOf(panel.closest('.rounded-xl')) : -1,
    panelTitle: panel ? panel.closest('.rounded-xl').querySelector('.ta-headline-2').textContent.trim() : null,
  };
}
"""

# One orb (components/call/VoiceOrb.tsx), measured rather than eyeballed. The sidebar's copy is
# the interesting one: it sits in legacy markup, outside the Demos `.tw` wrapper, so it only gets
# `rounded-full object-cover shrink-0` because the brand mark wraps it in a `.tw` island of its
# own. A missing island shows up here as border-radius 0 and object-fit "fill" — an unrounded,
# stretched square — not as a crash, which is why it is asserted and not looked at.
ORB_JS = """
(selector) => {
  const video = document.querySelector(selector);
  if (!video) return { found: false };
  const style = getComputedStyle(video);
  const box = video.getBoundingClientRect();
  const parent = video.parentElement;
  return {
    found: true,
    tag: video.tagName,
    src: new URL(video.getAttribute('src'), location.href).pathname,
    poster: new URL(video.getAttribute('poster'), location.href).pathname,
    muted: video.muted,
    loop: video.loop,
    ariaHidden: video.getAttribute('aria-hidden'),
    w: Math.round(box.width),
    h: Math.round(box.height),
    radius: style.borderTopLeftRadius,
    radiusPx: parseFloat(style.borderTopLeftRadius) || 0,
    objectFit: style.objectFit,
    shrink: style.flexShrink,
    inTw: Boolean(video.closest('.tw')),
    parentClass: parent ? parent.className : null,
  };
}
"""

# Where the Test call card's orb sits: centred across the card's content, and above the panel's
# own controls rather than beside or below them.
ORB_CENTRED_JS = """
() => {
  const video = document.querySelector('main .tw video');
  const content = video.parentElement.parentElement;
  const button = content.querySelector('button');
  const orb = video.getBoundingClientRect();
  const box = content.getBoundingClientRect();
  const panel = button.getBoundingClientRect();
  const left = orb.left - box.left;
  const right = box.right - orb.right;
  return {
    centred: Math.abs(left - right) <= 1,
    abovePanel: orb.bottom <= panel.top,
    left: Math.round(left), right: Math.round(right),
  };
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
# src/routes/demo.ts, POST /demo/session: the only refusal past the admin guard that the panel can
# be made to show. The fake can't hold a per-IP rate limit, so the harness stages the 429 itself.
RATE_LIMITED = "Too many calls in a row. Wait a minute and try again."

# lib/analytics.ts DEMO_TIME_STEPS, as the "Add time" menu writes them.
DEMO_TIME_LABELS = ["10 minutes", "30 minutes", "60 minutes"]
# The Add-time button on the customer page and in the Share tab: "Demo time: <n> min".
DEMO_TIME_BUTTON = re.compile(r"^Demo time: \d+ min$")
# Every Add-time button on screen, in order, so a top-up can be seen landing on all of them
# without the page being read again.
DEMO_TIME_SHOWN_JS = ("() => [...document.querySelectorAll('main .tw button')]"
                      ".map((b) => b.innerText.trim()).filter((t) => t.startsWith('Demo time:'))")
# The prospect page's status badge ("Researching" / "Ready" / "Error" / "Stalled"). Found through
# the <h1> rather than by class, because PageHeader is the only place the badge sits beside one —
# the tabs below hold badges of their own.
STATUS_BADGE_JS = """
() => {
  const h1 = document.querySelector('main .tw h1');
  const header = h1 && h1.parentElement && h1.parentElement.parentElement;
  const badge = header && header.querySelector('[data-slot="badge"]');
  return badge ? badge.textContent.trim() : null;
}
"""
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

# Keeps every stream getUserMedia hands the page, so the harness can see the test call stop the
# microphone afterwards (every track "ended"). With window.__holdMic = true, getUserMedia waits
# (like a permission prompt left open) until the harness calls window.__releaseMic(); window.__micHeld
# says it is waiting. Behaviour is otherwise unchanged.
MIC_HOOK_JS = """
(() => {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const original = md.getUserMedia.bind(md);
  window.__micStreams = [];
  window.__holdMic = false;
  window.__micHeld = false;
  md.getUserMedia = async (constraints) => {
    if (window.__holdMic) {
      window.__micHeld = true;
      await new Promise((resolve) => { window.__releaseMic = resolve; });
      window.__micHeld = false;
    }
    const stream = await original(constraints);
    window.__micStreams.push(stream);
    return stream;
  };
})();
"""

MIC_STATE_JS = """
() => (window.__micStreams || []).map((s) => s.getTracks().map((t) => t.kind + ':' + t.readyState))
"""

# Marks the toasts on screen now, so a wait can tell a new toast from one still fading out.
MARK_TOASTS_JS = "() => document.querySelectorAll('[data-sonner-toast]').forEach((t) => t.dataset.seen = '1')"


def new_toast(page, text: str, timeout: float | None = None, required: bool = True) -> bool:
    """Wait for a toast with `text` that wasn't on screen at the last MARK_TOASTS_JS.

    With `required=False` a toast that never arrives is a failed check (False) rather than a
    harness error — for the checks whose whole point is that something gets said.
    """
    toast = page.locator("main .tw [data-sonner-toast]:not([data-seen])", has_text=text).first
    if required:
        toast.wait_for(timeout=timeout) if timeout else toast.wait_for()
        return True
    try:
        toast.wait_for(timeout=timeout or 10000)
    except PlaywrightTimeout:
        return False
    return True


def settled(page, expression: str, timeout: float = 10000) -> bool:
    """Wait for `expression` to hold, reporting a timeout as False rather than aborting the run —
    for the checks whose whole point is that the screen follows an answer it was given."""
    try:
        page.wait_for_function(expression, timeout=timeout)
    except PlaywrightTimeout:
        return False
    return True


def legacy_collisions(css: dict, classes: set[str]) -> tuple[list[str], list[str]]:
    """Classes on promo markup that a rule in @layer legacy also uses: (collisions, shadowed).

    sr-only: Tailwind's utility sets a superset of the transcribe rule's properties (spec §3).
    grid: legacy only has `.areachart .grid` / `.barchart .grid` (SVG gridlines), which can't
    match promo markup — no promo element sits under .areachart/.barchart. The TecAce type scale
    (.ta-*) is defined twice on purpose (spec §3): the transcribe copy in @layer legacy and the
    promo's unlayered copy in @scope (.tw), which wins inside .tw. A shared .ta-* name passes
    only when every legacy rule for it is a plain `.name` rule whose properties the promo's copy
    also sets — i.e. it is fully shadowed.
    """
    legacy, scoped = css["legacy"], css["scoped"]
    hits = sorted((classes & set(legacy)) - {"sr-only", "grid"})
    shadowed = [c for c in hits
                if c.startswith("ta-") and not legacy[c]["compound"]
                and set(legacy[c]["props"]) <= set(scoped.get(c, []))]
    return [c for c in hits if c not in shadowed], shadowed


def demo_nav(page, label: str):
    """A nav button in the Demo group. Scoped to the group on purpose: the Demo tabs now carry the
    promo's own names, so "Overview" matches the Dashboard group's item as well."""
    return page.locator('.sidebar-group[data-group="demos"]').get_by_role(
        "button", name=label, exact=True)


def open_page(browser, token: str | None, url: str, demo_requests: list[str], page_errors: list[str]):
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    init = ["try { localStorage.clear(); } catch (e) {}", "localStorage.setItem('theme', 'light');",
            MIC_HOOK_JS]
    if token:
        init.append(f"localStorage.setItem('transcribe.token', '{token}');")
    ctx.add_init_script("\n".join(init))
    # "Copy link" / "Copy email" write to the clipboard; without the grant the write is refused
    # and the (unawaited) promise rejection would surface as a page error. The microphone is
    # Edge's fake device (launch flags), granted so the test call's getUserMedia needs no prompt.
    ctx.grant_permissions(["microphone", "clipboard-read", "clipboard-write"])
    page = ctx.new_page()
    page.route("**/favicon.ico", lambda r: r.fulfill(status=204))
    # Every request the Demo screens make, by path. The CORS preflights the browser sends first
    # (the bearer token makes the requests non-simple) are left out: they are the browser's, not
    # the app's, and Playwright reports them inconsistently.
    page.on("request", lambda r: demo_requests.append(f"{r.method} {urlparse(r.url).path}")
            if urlparse(r.url).path.startswith("/demo") and r.method != "OPTIONS" else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.goto(url)
    settle(page)
    return ctx, page


def run() -> int:
    for port in (NEW_PORT, BACKEND_PORT):
        if port_in_use(port):
            raise HarnessError(f"port {port} in use")
    OUT_DIR.mkdir(exist_ok=True)
    check = Checks()
    page_errors: list[str] = []
    backend = fake_backend.start(BACKEND_PORT)
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
                    # A fake microphone (a generated tone), with no permission prompt, so the test
                    # call builds a real WebRTC offer.
                    browser = p.chromium.launch(channel="msedge", args=[
                        "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])

                    # A signed-in user never sees the Demos section, asking for it by URL is
                    # refused, and the data behind it is refused to their token as well.
                    reqs: list[str] = []
                    ctx, page = open_page(browser, "tok-user", base + "#/demos/prospects", reqs, page_errors)
                    check("user: no Demo group in the sidebar",
                          page.locator('.sidebar-group[data-group="demos"]').count() == 0)
                    check("user: a Demos URL is refused",
                          "Only an admin can see the demos." in page.locator("main").inner_text())
                    check("user: no demo data is asked for", reqs == [], str(reqs))
                    denied = page.evaluate(PROBE_JS, [BACKEND, "tok-user"])
                    check("user: the /demo routes refuse this token (403 forbidden)",
                          all(answer["status"] == 403
                              and answer["body"] == fake_backend.DEMO_FORBIDDEN
                              for answer in denied.values()), str(denied))
                    anonymous = page.evaluate(PROBE_JS, [BACKEND, None])
                    check("signed out: the /demo routes answer 401 unauthorized",
                          all(answer["status"] == 401
                              and answer["body"] == fake_backend.DEMO_UNAUTHORIZED
                              for answer in anonymous.values()), str(anonymous))
                    ctx.close()

                    # Admin: the group is there, and a transcribe view doesn't read demo data.
                    reqs = []
                    ctx, page = open_page(browser, "tok-admin", base + "#/overview", reqs, page_errors)
                    check("admin: Demo group with three items",
                          page.locator('.sidebar-group[data-group="demos"] .nav-item').count() == 3)
                    check("admin: no demo request on a transcribe view", reqs == [], str(reqs))

                    demo_nav(page, "Customers").click()
                    harbor_link = page.get_by_role("link", name="Harbor Dental", exact=True)
                    harbor_link.wait_for()
                    rows = page.locator("main .tw table tbody tr")
                    check("Prospects opens #/demos/prospects", page.evaluate("location.hash") == "#/demos/prospects")
                    # The dashboard's own admin session is the only one there is: the records are
                    # on screen with nothing else asked of the operator.
                    check("admin: the prospects load with no second sign-in",
                          harbor_link.is_visible()
                          and rows.filter(has_text="Researching").count() == 1
                          and page.get_by_label("Password").count() == 0)
                    check("admin: ... and the only request was for them",
                          reqs != [] and set(reqs) == {"GET /demo/customers"}, str(reqs))
                    check("breadcrumb says Demo", page.locator(".crumbs").inner_text().startswith("Demo"))
                    check("no mailbox picker or Refresh on Demos views",
                          page.locator(".mailbox-picker").count() == 0
                          and page.get_by_role("button", name="Refresh").count() == 0)
                    check("Demos render inside one .tw wrapper", page.locator("main .tw").count() == 1)
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

                    # The "Add time" steps as a submenu on a row (AddDemoTimeSubmenu). Cedar's, so
                    # the prospect page's own top-ups further down still start from the fixture.
                    cedar_row = rows.filter(has_text="sam@cedarbakery.example")
                    cedar_row.get_by_role("button", name="More actions").click()
                    row_menu = page.locator("[data-tw-portal] [role=menu]").first
                    row_menu.wait_for()
                    row_menu.get_by_role("menuitem", name="Add demo time").hover()
                    sub = page.locator("[data-tw-portal] [data-slot='dropdown-menu-sub-content']")
                    sub.wait_for()
                    steps = sub.get_by_role("menuitem")
                    check("prospects: the row menu offers the demo-time steps as a submenu",
                          [t.strip() for t in steps.all_inner_texts()] == DEMO_TIME_LABELS,
                          str(steps.all_inner_texts()))
                    tw_classes |= set(page.evaluate(TW_CLASSES_JS))
                    page.evaluate(MARK_TOASTS_JS)
                    with page.expect_request(lambda r: r.method == "PATCH"
                                             and r.url.endswith("/demo/customers/cedar42")) as req:
                        sub.get_by_role("menuitem", name="30 minutes").click()
                    body = req.value.post_data_json
                    check("prospects: a step PATCHes {addDemoMinutes: n} and sends no total",
                          body == {"addDemoMinutes": 30}, str(body))
                    # Cedar stores no minutes, so the backend added 30 to DEFAULT_DEMO_MINUTES. The
                    # request above carried the amount and nothing else, so the 40 in the toast can
                    # only have been worked out from the stored value.
                    check("prospects: ... and the toast names the total the backend added it to",
                          new_toast(page, "Added 30 minutes. The demo now has 40 in all.",
                                    required=False))

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
                    # the only way left (the form's own submit); the backend refuses it.
                    reqs.clear()
                    dialog.get_by_label("Business name").fill("   ")
                    dialog.locator("form").evaluate("f => f.requestSubmit()")
                    dialog.get_by_role("alert").wait_for()
                    check("prospects: a blank business name shows the backend's 400 error",
                          dialog.get_by_role("alert").inner_text().strip() == "Enter the business name."
                          and "POST /demo/customers" in reqs,
                          dialog.get_by_role("alert").inner_text())
                    dialog.get_by_label("Business name").fill("Birch Florist")
                    with page.expect_response(
                            lambda r: r.request.method == "POST"
                            and urlparse(r.url).path == "/demo/customers") as created:
                        add.click()
                    page.get_by_text("Customer added. Research is running.").wait_for()
                    dialog.wait_for(state="detached")
                    check("prospects: adding a customer toasts and closes the dialog",
                          page.locator("[role=dialog]").count() == 0)
                    # The dialog's toast promises a run; the record it was answered with is what
                    # makes that true. POST /demo/customers fires the research in the background
                    # and answers straight away, so a new prospect is always mid-research.
                    made = created.value.json().get("customer", {})
                    check("prospects: ... and the new prospect comes back researching",
                          made.get("status") == "researching"
                          and made.get("businessName") == "Birch Florist", str(made.get("status")))

                    page.get_by_role("switch", name="Toggle the demo for Harbor Dental").click()
                    page.get_by_text("Demo is paused.").wait_for()
                    check("prospects: pausing a live demo says so", True)
                    rows.filter(has_text="sam@cedarbakery.example").get_by_role("switch").click()
                    page.get_by_text("Demo is live.").wait_for()
                    check("prospects: resuming a paused demo says so", True)

                    # --- Demo overview: KPIs, charts, recent calls ---
                    demo_nav(page, "Overview").click()
                    page.get_by_text("Recent calls").wait_for()
                    page.wait_for_function("() => document.querySelectorAll('main .tw canvas').length === 2")
                    stats = {t: page.evaluate(STAT_JS, t) for t in ("Customers", "Tested", "Calls", "Minutes")}
                    check("overview: the KPI cards show the backend's numbers",
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

                    # The reporting period is a portal surface of its own, and picking one re-reads
                    # the analytics for that window.
                    page.get_by_label("Select the reporting period").click()
                    option = page.locator("[data-tw-portal] [role=option]", has_text="Last 7 days")
                    option.wait_for()
                    tw_classes |= set(page.evaluate(TW_CLASSES_JS))
                    with page.expect_request(lambda r: "/demo/analytics" in r.url
                                             and r.method == "GET") as req:
                        option.click()
                    page.get_by_text("Recent calls").wait_for()
                    check("overview: picking a period re-reads the analytics for it",
                          "days=7" in req.value.url, req.value.url)

                    # --- No transcribe class name lands on promo markup ---
                    css = page.evaluate(LEGACY_CLASSES_JS)
                    bad, shadowed = legacy_collisions(css, tw_classes)
                    check("no @layer legacy class name on promo markup (bar sr-only, grid, shadowed .ta-*)",
                          bool(css["legacy"]) and bool(tw_classes) and bad == [],
                          f"collisions: {bad}; legacy classes seen: {len(css['legacy'])}")
                    if shadowed:
                        print(f"       (fully shadowed by the promo's own copy: {', '.join(shadowed)})")

                    # --- The prospect page (the promo's real customer page) ---
                    demo_nav(page, "Customers").click()
                    harbor_link.wait_for()
                    harbor_link.click()
                    page.get_by_role("heading", name="Harbor Dental", level=1).wait_for()
                    check("a prospect gets its own URL",
                          page.evaluate("location.hash") == "#/demos/prospects/pr0SPct1",
                          page.evaluate("location.hash"))
                    check("Customers stays highlighted on a prospect",
                          page.locator(".nav-item.is-active").inner_text().strip() == "Customers")

                    main_tw = page.locator("main .tw")
                    stats = {t: page.evaluate(STAT_JS, t)
                             for t in ("Link opens", "Calls", "Minutes", "Average call")}
                    check("prospect: header names the business and its address",
                          main_tw.get_by_text("12 Wharf St, Portland, ME", exact=True).is_visible())
                    check("prospect: the stat cards show the backend's numbers",
                          stats == {"Link opens": "14", "Calls": "3", "Minutes": "9", "Average call": "3:00"},
                          str(stats))
                    # The promo's three-column detail grid, back with the test call: the tabs card
                    # over two tracks and the "Test call" panel in the third.
                    layout = page.evaluate(TABS_CARD_JS)
                    check("prospect: three grid tracks, the tabs card spanning two, the call panel in the third",
                          layout["tracks"] == 3 and layout["siblings"] == 2
                          and layout["span"] == "span 2" and layout["tabsIndex"] == 0
                          and layout["panelIndex"] == 1 and layout["panelTitle"] == "Test call"
                          # Two of three equal tracks plus the 16px gap between them:
                          # 3 * card == 2 * grid - gap.
                          and abs(layout["card"] * 3 - (layout["grid"] * 2 - 16)) <= 6,
                          str(layout))
                    # The orb above the call panel, and the one that replaced the sidebar's
                    # voicemail icon. Both are the same component and the same film; what is
                    # asserted is that the scoped utilities actually reached each of them — a
                    # 64/28px circle showing the centre of the frame, not a stretched square.
                    orb = page.evaluate(ORB_JS, 'main .tw video')
                    check("prospect: the orb sits above the call panel, circular and 64px",
                          orb["found"] and orb["tag"] == "VIDEO" and orb["w"] == 64 and orb["h"] == 64
                          and orb["radiusPx"] >= orb["w"] / 2 and orb["objectFit"] == "cover"
                          and orb["src"] == "/voice-orb.mp4" and orb["poster"] == "/voice-orb.png"
                          and orb["muted"] and orb["loop"] and orb["ariaHidden"] == "true",
                          str(orb))
                    centred = page.evaluate(ORB_CENTRED_JS)
                    check("prospect: ... centred in the Test call card, above the panel",
                          centred["centred"] and centred["abovePanel"], str(centred))
                    brand = page.evaluate(ORB_JS, '.sidebar-brand video')
                    check("sidebar: the brand mark is the orb, in a .tw island so the utilities apply",
                          brand["found"] and brand["inTw"] and brand["parentClass"] == "tw"
                          and brand["w"] == 28 and brand["h"] == 28
                          and brand["radiusPx"] >= brand["w"] / 2 and brand["objectFit"] == "cover"
                          and brand["shrink"] == "0" and brand["src"] == "/voice-orb.mp4",
                          str(brand))
                    tint = page.evaluate(
                        "() => getComputedStyle(document.querySelector('.sidebar-brand .brand-mark'))"
                        ".backgroundColor")
                    check("sidebar: ... and the tinted square behind it is gone",
                          tint in ("rgba(0, 0, 0, 0)", "transparent"), tint)

                    # --- Add demo time, from the page header (AddDemoTimeMenu) ---
                    #
                    # Harbor stores no minutes, so the button opens on DEFAULT_DEMO_MINUTES. The
                    # Share tab is closed, so this is the only one of these buttons on screen.
                    add_time = main_tw.get_by_role("button", name=DEMO_TIME_BUTTON)
                    check("prospect: the header carries the Add-time button with the current total",
                          add_time.count() == 1
                          and add_time.inner_text().strip() == "Demo time: 10 min",
                          str(page.evaluate(DEMO_TIME_SHOWN_JS)))
                    add_time.click()
                    time_menu = page.locator("[data-tw-portal] [role=menu]")
                    time_menu.wait_for()
                    check("prospect: ... opening it shows the steps under an 'Add demo time' label",
                          "Add demo time" in time_menu.inner_text()
                          and [t.strip() for t in time_menu.get_by_role("menuitem").all_inner_texts()]
                          == DEMO_TIME_LABELS,
                          time_menu.inner_text())
                    page.evaluate(MARK_TOASTS_JS)
                    with page.expect_request(lambda r: r.method == "PATCH"
                                             and r.url.endswith("/demo/customers/pr0SPct1")) as req:
                        time_menu.get_by_role("menuitem", name="10 minutes").click()
                    body = req.value.post_data_json
                    check("prospect: a step PATCHes {addDemoMinutes: n} and sends no total",
                          body == {"addDemoMinutes": 10}, str(body))
                    check("prospect: ... and the header shows the new total without a reload",
                          settled(page, f"() => ({DEMO_TIME_SHOWN_JS})()"
                                        ".includes('Demo time: 20 min')"),
                          str(page.evaluate(DEMO_TIME_SHOWN_JS)))
                    check("prospect: ... and says what the total now is",
                          new_toast(page, "Added 10 minutes. The demo now has 20 in all.",
                                    required=False))

                    # The menu only ever offers positive steps, so the backend's refusal for an
                    # amount it cannot use is staged here — it is the sentence a caller with a
                    # hand-made request would get, and what the page does with it is the point:
                    # say it, and leave the total where it was.
                    def refuse_top_up(route):
                        # Everything else, the CORS preflight included, goes to the fake.
                        if route.request.method == "PATCH":
                            fulfill_json(route, 400, {"error": "Minutes to add must be positive."})
                        else:
                            route.fallback()

                    page.route("**/demo/customers/pr0SPct1", refuse_top_up)
                    page.evaluate(MARK_TOASTS_JS)
                    add_time.click()
                    time_menu.wait_for()
                    time_menu.get_by_role("menuitem", name="60 minutes").click()
                    said = new_toast(page, "Minutes to add must be positive.", required=False)
                    check("prospect: a refused top-up says why and leaves the total alone",
                          said and add_time.inner_text().strip() == "Demo time: 20 min",
                          f"said={said} {page.evaluate(DEMO_TIME_SHOWN_JS)}")
                    page.unroute("**/demo/customers/pr0SPct1")

                    per_state: dict[str, set[str]] = {}

                    def snapshot(label: str) -> None:
                        per_state[label] = set(page.evaluate(TW_CLASSES_JS))

                    # Activity (the default tab)
                    transcript_buttons = main_tw.get_by_role("button", name="Read the full transcript")
                    check("activity: one card per call (4)", transcript_buttons.count() == 4,
                          str(transcript_buttons.count()))
                    fix = main_tw.locator("section", has=page.get_by_role("heading", name="What to fix"))
                    shared = fix.locator("li", has_text="No price list for implants")
                    check("activity: the gap roll-up counts the shared gap twice",
                          shared.count() == 1 and shared.locator(".ta-numeric").inner_text().strip() == "2",
                          fix.inner_text() if fix.count() else "no 'What to fix' section")
                    check("activity: the test call is called out",
                          main_tw.get_by_text("1 of these are marked as your own tests").is_visible())
                    snapshot("activity")

                    transcript_buttons.nth(1).click()  # call2: the 18-turn reviewed call
                    sheet = page.locator("[data-tw-portal] [role=dialog]")
                    sheet.wait_for()
                    check("activity: the transcript opens in a sheet inside [data-tw-portal]",
                          page.locator("[role=dialog]").count() == 1
                          and sheet.get_by_role("heading", name="Call transcript").is_visible()
                          and sheet.get_by_text("Perfect, book me in for Thursday then.").is_visible())
                    snapshot("activity + transcript sheet")
                    page.keyboard.press("Escape")
                    sheet.wait_for(state="detached")

                    page.evaluate(MARK_TOASTS_JS)
                    with page.expect_request(lambda r: r.method == "PATCH"
                                             and r.url.endswith("/demo/customers/pr0SPct1/calls")) as req:
                        main_tw.get_by_role("switch", name="Count this call as your test").first.click()
                    body = req.value.post_data_json
                    check("activity: marking a call as a test PATCHes {callId, isTest}",
                          body == {"callId": "call2", "isTest": True}, str(body))
                    check("activity: ... and says so", new_toast(page, "Counted as your test."))

                    # "Analyze" is back (it reviews for real again — see PORTING.md). It shows on
                    # the two calls the fixtures leave unreviewed, and on no other.
                    analyze = main_tw.get_by_role("button", name="Analyze")
                    unreviewed = analyze.count()
                    page.evaluate(MARK_TOASTS_JS)
                    with page.expect_request(lambda r: r.method == "PATCH"
                                             and r.url.endswith("/demo/customers/pr0SPct1/calls")) as req:
                        analyze.first.click()
                    body = req.value.post_data_json
                    check("activity: Analyze is on the unreviewed calls and PATCHes {callId, analyze}",
                          unreviewed == 2 and body == {"callId": "call1", "analyze": True},
                          f"{unreviewed} buttons, {body}")
                    check("activity: ... and says Reviewed.", new_toast(page, "Reviewed."))

                    # Knowledge
                    main_tw.get_by_role("tab", name="Knowledge").click()
                    phone = main_tw.get_by_label("Phone", exact=True)
                    phone.wait_for()
                    check("knowledge: the fields hold the profile",
                          phone.input_value() == "+1 207 555 0142"
                          and main_tw.get_by_label("Category", exact=True).input_value() == "Dentist")
                    snapshot("knowledge")
                    phone.fill("+1 207 555 0199")
                    page.evaluate(MARK_TOASTS_JS)
                    with page.expect_request(lambda r: r.method == "PATCH"
                                             and r.url.endswith("/demo/customers/pr0SPct1")) as req:
                        main_tw.get_by_role("button", name="Save", exact=True).click()
                    body = req.value.post_data_json
                    check("knowledge: Save PATCHes the edited profile",
                          body["profile"]["phone"] == "+1 207 555 0199"
                          and body["profile"]["name"] == "Harbor Dental", str(body.get("profile")))
                    check("knowledge: ... and says Saved.", new_toast(page, "Saved."))

                    # Schedule (a mock-up drawn from the profile's hours)
                    main_tw.get_by_role("tab", name=re.compile(r"^Schedule")).click()
                    main_tw.get_by_role("heading", name="A week on the book").wait_for()
                    week = page.evaluate("""() => [...document.querySelectorAll('main .tw .grid-cols-7 > div')]
                        .map((col) => [...col.querySelectorAll(':scope > div:first-child p')]
                        .map((p) => p.textContent.trim()).join(' '))""")
                    expected = [f"{d} 08:00 to 17:00" for d in ("Mon", "Tue", "Wed", "Thu", "Fri")] \
                        + ["Sat Closed", "Sun Closed"]
                    check("schedule: the week grid follows the hours (Mon-Fri 08:00-17:00, weekend closed)",
                          week == expected, str(week))
                    check("schedule: it says it's a mock-up",
                          main_tw.get_by_text(re.compile(r"is a mock-up drawn from Harbor Dental")).is_visible())
                    snapshot("schedule")

                    # Prompt
                    main_tw.get_by_role("tab", name="Prompt").click()
                    greeting = main_tw.get_by_label("Greeting", exact=True)
                    greeting.wait_for()
                    check("prompt: the three prompts are shown",
                          main_tw.get_by_label("Voice prompt").input_value().startswith("You are Alex, the receptionist at Harbor Dental")
                          and main_tw.get_by_label("Backend prompt").input_value() == "Facts about Harbor Dental for the receptionist."
                          and greeting.input_value() == "Thanks for calling Harbor Dental, this is Alex. How can I help?")
                    snapshot("prompt")
                    greeting.fill("Harbor Dental, Alex speaking. What can I do for you?")
                    page.evaluate(MARK_TOASTS_JS)
                    with page.expect_request(lambda r: r.method == "PATCH"
                                             and r.url.endswith("/demo/customers/pr0SPct1")) as req:
                        main_tw.get_by_role("button", name="Save", exact=True).click()
                    body = req.value.post_data_json
                    check("prompt: an edited prompt is saved with prompts.edited true",
                          body["prompts"]["edited"] is True
                          and body["prompts"]["greeting"] == "Harbor Dental, Alex speaking. What can I do for you?",
                          str(body.get("prompts")))
                    new_toast(page, "Saved.")
                    check("prompt: ... and the page says the prompts were edited by hand",
                          main_tw.get_by_text("These prompts were edited by hand").is_visible())

                    # Sources (the research inputs and the dossier as markdown)
                    main_tw.get_by_role("tab", name="Sources").click()
                    main_tw.get_by_role("heading", name="Raw research").wait_for()
                    check("sources: the dossier renders as markdown (<strong>, <li>)",
                          main_tw.locator("strong", has_text="Family dental practice").count() == 1
                          and main_tw.locator("li", has_text="Free parking behind the building").count() == 1)
                    links = main_tw.locator('a[href="https://harbordental.example"][target="_blank"],'
                                            ' a[href="https://maps.google.com/?cid=42"][target="_blank"]')
                    check("sources: the cited sources link out in a new tab", links.count() == 2,
                          str(links.count()))
                    snapshot("sources")

                    # Share
                    main_tw.get_by_role("tab", name="Share").click()
                    link = main_tw.get_by_label("Customer link")
                    link.wait_for()
                    check("share: the customer link is the public demo URL",
                          link.input_value() == f"{DEMO_BASE_URL}/c/pr0SPct1", link.input_value())
                    page.evaluate(MARK_TOASTS_JS)
                    main_tw.get_by_role("button", name="Copy", exact=True).click()
                    new_toast(page, "Link copied.")
                    copied = page.evaluate("navigator.clipboard.readText()")
                    check("share: Copy copies it", copied == f"{DEMO_BASE_URL}/c/pr0SPct1", repr(copied))
                    subject = main_tw.get_by_label("Email subject").input_value()
                    email = main_tw.get_by_label("Email body").input_value()
                    check("share: the email names the business and carries the link",
                          "Harbor Dental" in subject and "Harbor Dental" in email
                          and f"{DEMO_BASE_URL}/c/pr0SPct1" in email, subject)

                    # The third Add-time menu: beside the Share tab's own Demo minutes field, which
                    # sets the total outright. Scoped to the field's row, because the header's
                    # button is on screen too — and that is what makes the last check below worth
                    # making: one answer moves both.
                    minutes_field = main_tw.locator("#demo-minutes")
                    share_add_time = minutes_field.locator("xpath=..").get_by_role(
                        "button", name=DEMO_TIME_BUTTON)
                    check("share: the Add-time menu sits beside the Demo minutes field",
                          share_add_time.count() == 1 and minutes_field.input_value() == "20",
                          f"{share_add_time.count()} buttons, field={minutes_field.input_value()}")
                    page.evaluate(MARK_TOASTS_JS)
                    share_add_time.click()
                    time_menu.wait_for()
                    with page.expect_request(lambda r: r.method == "PATCH"
                                             and r.url.endswith("/demo/customers/pr0SPct1")) as req:
                        time_menu.get_by_role("menuitem", name="30 minutes").click()
                    body = req.value.post_data_json
                    check("share: a step PATCHes {addDemoMinutes: n} and sends no total",
                          body == {"addDemoMinutes": 30}, str(body))
                    # 10 + 10 + 30. The second top-up compounds on the first because the backend
                    # added it to what it had stored; every one of these requests carried only the
                    # amount, so the browser's own figure never entered into it.
                    landed = settled(
                        page, "() => document.querySelector('main .tw #demo-minutes').value === '50'")
                    shown = page.evaluate(DEMO_TIME_SHOWN_JS)
                    check("share: ... and the field and both Add-time buttons show the compounded "
                          "total without a reload",
                          landed and shown == ["Demo time: 50 min", "Demo time: 50 min"],
                          f"field={minutes_field.input_value()} buttons={shown}")
                    check("share: ... and says what the total now is",
                          new_toast(page, "Added 30 minutes. The demo now has 50 in all.",
                                    required=False))
                    snapshot("share")

                    # --- The test call ---
                    #
                    # A real WebRTC offer, built in Edge from its fake microphone, against
                    # fake_backend's POST /demo/session. The promo's version of these checks could
                    # only ever see a refused dial — the fake promo answered "all the demo lines are
                    # busy" because it had no way to mint an SDP answer. This fake writes one from
                    # the offer, so the granted path is walked too: the answer is taken, the line
                    # rings (nothing is listening on the candidates, so it rings until it is hung
                    # up), and hanging up reports the call to POST /demo/calls/<callId>.
                    call_now = main_tw.get_by_role("button", name="Call now")
                    end_call = main_tw.get_by_role("button", name="End the call")
                    again = main_tw.get_by_role("button", name="Start a new call")
                    with page.expect_request(lambda r: r.method == "POST"
                                             and r.url.endswith("/demo/session"),
                                             timeout=20000) as req:
                        call_now.click()
                    body = req.value.post_data_json or {}
                    check("test call: POST /demo/session with customerId, isTest, timeZone and a real SDP offer",
                          body.get("customerId") == "pr0SPct1" and body.get("isTest") is True
                          and isinstance(body.get("timeZone"), str) and bool(body.get("timeZone"))
                          and str(body.get("sdp", "")).startswith("v=0"),
                          str({k: (v[:12] + "…" if isinstance(v, str) and len(v) > 12 else v)
                               for k, v in body.items()}))
                    granted = req.value.response()
                    # The panel says "Ringing" before the request even goes out, so the answer has
                    # to have been taken for this to mean anything: a rejected SDP throws out of
                    # `dial` within the moment below, and leaves "Call failed" and an error
                    # paragraph behind instead.
                    page.wait_for_timeout(1000)
                    refused = main_tw.locator("p[role=alert]").all_inner_texts()
                    ringing = (granted.status == 200 and not refused
                               and main_tw.get_by_text("Ringing").count() == 1
                               and end_call.count() == 1)
                    check("test call: the granted answer is accepted and the line is ringing",
                          ringing
                          and main_tw.get_by_text("Call to hear how the receptionist answers.").is_visible(),
                          f"{granted.status} {refused}")
                    # "End call" sends session.close over a data channel that never opened, so the
                    # hook's own five-second timeout is what ends it: the report is the proof the
                    # call was hung up rather than left on the line.
                    if ringing:
                        with page.expect_request(lambda r: r.method == "POST"
                                                 and "/demo/calls/" in r.url, timeout=20000) as req:
                            end_call.click()
                        report = req.value.post_data_json or {}
                        check("test call: hanging up reports it to POST /demo/calls/<callId>",
                              urlparse(req.value.url).path
                              == f"/demo/calls/{fake_backend.SESSION_CALL_ID}"
                              and report.get("customerId") == "pr0SPct1"
                              and report.get("status") == "completed"
                              and report.get("endReason") == "close_timeout"
                              and report.get("transcript") == [],
                              f"{urlparse(req.value.url).path} "
                              + str({k: v for k, v in report.items() if k != "transcript"}))
                    else:
                        # A dial that failed instead of ringing has already reported itself, so
                        # there is no hang-up left to watch. Say so and carry on: the checks after
                        # this one are about the refusal and the unload paths, which still stand.
                        check("test call: hanging up reports it to POST /demo/calls/<callId>", False,
                              "the line never reached Ringing — see the check above")
                    again.wait_for()
                    mics = page.evaluate(MIC_STATE_JS)
                    check("test call: the fake microphone was opened and is stopped again",
                          len(mics) == 1 and mics[0] and all(t.endswith(":ended") for t in mics[0]),
                          str(mics))
                    again.click()
                    call_now.wait_for()
                    check("test call: 'Call again' returns to a callable state",
                          call_now.is_enabled() and main_tw.locator("p[role=alert]").count() == 0)

                    # A refused dial. The promo refused with "All the demo lines are busy right now"
                    # — its demo allowance and live-session concurrency, neither of which
                    # transcribe-backend's admin route keeps (see the design doc's table). Its one
                    # refusal past the admin guard is the per-IP rate limit, and a stateless fake
                    # cannot hold a rate limit, so the harness stages the 429 itself.
                    page.route("**/demo/session",
                               lambda route: fulfill_json(route, 429, {"error": RATE_LIMITED})
                               if route.request.method == "POST" else route.fallback())
                    with page.expect_request(lambda r: r.method == "POST"
                                             and r.url.endswith("/demo/session"),
                                             timeout=20000) as req:
                        call_now.click()
                    refusal = main_tw.locator("p[role=alert]").filter(has_text=RATE_LIMITED)
                    refusal.wait_for()
                    again.wait_for()
                    check("test call: a refused dial shows the backend's message, and 'Call failed'",
                          refusal.is_visible() and main_tw.get_by_text("Call failed").is_visible())
                    snapshot("test call refused")
                    mics = page.evaluate(MIC_STATE_JS)
                    check("test call: a retry dials again and stops its microphone too",
                          len(mics) == 2 and all(all(t.endswith(":ended") for t in s) for s in mics),
                          str(mics))
                    page.unroute("**/demo/session")
                    again.click()
                    call_now.wait_for()

                    # Leaving the page while the microphone prompt is still open must not let the
                    # call carry on behind it (mic, ringtone, a session nobody hears or reports).
                    page.evaluate("() => { window.__holdMic = true; }")
                    call_now.click()
                    page.wait_for_function("() => window.__micHeld === true")
                    demo_nav(page, "Customers").click()
                    harbor_link.wait_for()
                    after_leave = len(reqs)
                    page.evaluate("() => { window.__holdMic = false; window.__releaseMic(); }")
                    page.wait_for_function("() => window.__micStreams.length === 3")
                    page.wait_for_timeout(3000)  # time for a runaway dial to reach /demo/session
                    late = [r for r in reqs[after_leave:] if r.endswith("/demo/session")]
                    check("test call: leaving mid-dial sends no session request afterwards", late == [],
                          str(late))
                    mics = page.evaluate(MIC_STATE_JS)
                    check("test call: ... and the microphone it got after leaving is stopped",
                          len(mics) == 3 and all(t.endswith(":ended") for t in mics[2]), str(mics))
                    harbor_link.click()
                    page.get_by_role("heading", name="Harbor Dental", level=1).wait_for()

                    # The billed case: the backend GRANTS the session after the admin has left. The
                    # session request is held (not answered) until the page is gone, then answered
                    # with a grant; the call must be handed back with one "abandoned / unmounted"
                    # report and go no further (the unusable SDP in the grant would make
                    # setRemoteDescription throw if it did).
                    held: list = []
                    reports: list[dict] = []

                    def record_report(route):
                        if route.request.method != "POST":
                            route.fallback()  # the preflight goes to the fake, or the POST is dropped
                            return
                        try:
                            body = json.loads(route.request.post_data or "{}")
                        except ValueError:
                            body = {"unparsable": route.request.post_data}
                        reports.append({"path": urlparse(route.request.url).path, **body})
                        fulfill_json(route, 200, {"ok": True, "reviewed": False})

                    page.route("**/demo/session",
                               lambda route: held.append(route)
                               if route.request.method == "POST" else route.fallback())
                    page.route("**/demo/calls/**", record_report)
                    errors_before = len(page_errors)
                    call_now.click()
                    for _ in range(150):  # up to 15 s for the mic, the offer and ICE gathering
                        if held:
                            break
                        page.wait_for_timeout(100)
                    if not held:
                        raise HarnessError("the test call never sent its session request")
                    demo_nav(page, "Customers").click()
                    harbor_link.wait_for()
                    fulfill_json(held[0], 200, {"callId": "held42", "sessionId": "sess_held42",
                                                "sdp": "v=0\r\n", "greeting": "Hi."})
                    for _ in range(50):
                        if reports:
                            break
                        page.wait_for_timeout(100)
                    page.wait_for_timeout(3000)  # time for a second report to show up
                    check("test call: a session granted after leaving is reported once as abandoned/unmounted",
                          len(reports) == 1 and reports[0]["path"] == "/demo/calls/held42"
                          and reports[0].get("customerId") == "pr0SPct1"
                          and reports[0].get("status") == "abandoned"
                          and reports[0].get("endReason") == "unmounted",
                          str([{k: v for k, v in rep.items() if k != "transcript"} for rep in reports]))
                    mics = page.evaluate(MIC_STATE_JS)
                    check("test call: ... its microphone is stopped and nothing threw",
                          len(mics) == 4 and all(t.endswith(":ended") for t in mics[3])
                          and len(page_errors) == errors_before,
                          f"{mics} {page_errors[errors_before:]}")
                    page.unroute("**/demo/session")
                    page.unroute("**/demo/calls/**")

                    # --- Research: the header button, the panel's own, and a run that fails ---
                    #
                    # Last on the prospect page on purpose: a finished run replaces the draft with
                    # the researched record, and every check above reads a prospect as the fixtures
                    # leave it. Cedar is the one the fixtures leave mid-research — no profile, no
                    # dossier — so a run here has something visible to finish. Its table link reads
                    # "Unnamed" for exactly that reason.
                    cedar_link = page.get_by_role("link", name="Unnamed", exact=True)
                    cedar_link.wait_for()
                    cedar_link.click()
                    page.get_by_role("heading", name="Cedar Bakery", level=1).wait_for()
                    re_research = main_tw.get_by_role("button", name="Re-research")
                    check("research: a prospect mid-research says so, and offers Re-research",
                          page.evaluate(STATUS_BADGE_JS) == "Researching"
                          and re_research.count() == 1 and re_research.is_enabled(),
                          f"badge={page.evaluate(STATUS_BADGE_JS)}, {re_research.count()} buttons")
                    page.evaluate(MARK_TOASTS_JS)
                    with page.expect_request(
                            lambda r: r.method == "POST"
                            and urlparse(r.url).path == "/demo/customers/cedar42/research") as req:
                        re_research.click()
                    body = req.value.post_data_json
                    check("research: Re-research POSTs the promo's body to /customers/<id>/research",
                          body == {"regeneratePrompts": False, "businessName": "Cedar Bakery",
                                   "websiteUrl": "", "mapsUrl": "", "researchNotes": ""}, str(body))
                    check("research: ... and says it finished", new_toast(page, "Research finished."))
                    check("research: ... and the answer lands on the page without a reload",
                          settled(page, f"() => ({STATUS_BADGE_JS})() === 'Ready'")
                          and main_tw.get_by_text("8 Mill Lane, Portland, ME", exact=True).is_visible(),
                          f"badge={page.evaluate(STATUS_BADGE_JS)}")

                    # ResearchInputsPanel's own run button — the second trigger for the same
                    # action, which is why it could not outlive the handler and had to come back
                    # with it.
                    main_tw.get_by_role("tab", name="Sources").click()
                    run_again = main_tw.get_by_role("button", name="Run research again")
                    run_again.wait_for()
                    check("research: the Sources tab carries the panel's own run button, under the "
                          "dossier the run wrote",
                          run_again.count() == 1
                          and main_tw.locator("strong", has_text="The run finished just now.").count() == 1)

                    # A run that fails. The fake plays the failure a deployment with no
                    # OPENAI_API_KEY gets, staged through the notes field the operator already
                    # types into — so the panel's button is what asks for it, inputs and all.
                    main_tw.get_by_label("Notes for the research").fill(
                        fake_backend.RESEARCH_FAIL_MARKER)
                    page.evaluate(MARK_TOASTS_JS)
                    with page.expect_request(
                            lambda r: r.method == "POST"
                            and urlparse(r.url).path == "/demo/customers/cedar42/research") as req:
                        run_again.click()
                    body = req.value.post_data_json
                    check("research: the panel's button runs it with the edited inputs",
                          body.get("researchNotes") == fake_backend.RESEARCH_FAIL_MARKER
                          and body.get("regeneratePrompts") is False
                          and body.get("businessName") == "Cedar Bakery", str(body))
                    check("research: a failed run shows the backend's message",
                          new_toast(page, fake_backend.RESEARCH_FAILURE, required=False))
                    # The catch re-reads the record, so what is on screen after a failure is what
                    # the backend holds rather than the half-finished draft.
                    check("research: ... and the record is read again",
                          settled(page, f"() => ({STATUS_BADGE_JS})() === 'Researching'"),
                          f"badge={page.evaluate(STATUS_BADGE_JS)}")

                    demo_nav(page, "Customers").click()
                    harbor_link.wait_for()
                    harbor_link.click()
                    page.get_by_role("heading", name="Harbor Dental", level=1).wait_for()

                    for label, classes in per_state.items():
                        bad, _ = legacy_collisions(css, classes)
                        check(f"no @layer legacy class name on promo markup: prospect / {label}",
                              bool(classes) and bad == [], f"collisions: {bad}")

                    page.reload()
                    settle(page)
                    page.get_by_role("heading", name="Harbor Dental", level=1).wait_for()
                    check("refresh keeps the prospect", True)

                    page.goto(base + "#/demos/prospects/nope")
                    page.reload()
                    settle(page)
                    page.locator("main .tw").get_by_text("Customer not found.").wait_for()
                    check("an unknown prospect says so (the backend's 404 message)",
                          page.get_by_role("heading", name="Harbor Dental").count() == 0)

                    # A record id that isn't a demo id never reaches a demo path: the hash decodes
                    # to "../../analytics", which would leave the customer route.
                    reqs.clear()
                    page.evaluate("() => { location.hash = '#/demos/prospects/..%2F..%2Fanalytics'; }")
                    harbor_link.wait_for()
                    page.wait_for_timeout(500)
                    stray = [r for r in reqs if not re.fullmatch(
                        r"/demo/customers(/[A-Za-z0-9_-]+(/[a-z]+)?)?", r.split(" ", 1)[1])]
                    check("a malformed prospect id shows the list and asks the backend nothing else",
                          page.get_by_role("heading", name="Customers", level=1).is_visible() and stray == [],
                          str(reqs))

                    # --- The CRM pipeline ---
                    demo_nav(page, "CRM").click()
                    page.get_by_role("heading", name="CRM", level=1).wait_for()
                    main_tw.get_by_text("Left a voicemail with the owner.").wait_for()
                    board = page.evaluate(BOARD_JS)
                    check("pipeline: a column per stage, with the fake's counts and cards",
                          board == [{"stage": "New", "count": "0", "cards": []},
                                    {"stage": "Contacted", "count": "1", "cards": ["Cedar Bakery"]},
                                    {"stage": "Interested", "count": "1", "cards": ["Harbor Dental"]},
                                    {"stage": "Won", "count": "0", "cards": []},
                                    {"stage": "Lost", "count": "0", "cards": []}], str(board))
                    due = main_tw.locator("div", has=page.get_by_text("Due now", exact=True)).last
                    check("pipeline: the due-follow-up section names Cedar Bakery",
                          due.get_by_role("button", name="Cedar Bakery").count() == 1
                          and page.evaluate(STAT_JS, "Follow-ups due") == "1", due.inner_text())
                    feed = main_tw.locator("ul", has=page.get_by_text("Opened the demo link").first).last
                    rows = feed.locator("li")
                    top = [" ".join(rows.nth(i).inner_text().split()) for i in range(4)]
                    check("pipeline: the activity feed lists both prospects, newest first",
                          rows.count() == 20
                          and top[0].startswith("Harbor Dental Your test call · 1:00 · 4 turns")
                          and top[1].startswith("Harbor Dental Called · 4:00 · 18 turns")
                          and top[2].startswith("Harbor Dental Opened the demo link")
                          and top[3].startswith("Cedar Bakery Left a voicemail with the owner.")
                          and rows.filter(has_text="Cedar Bakery").count() == 1,
                          f"{rows.count()} rows; first four: {top}")
                    per_state["pipeline"] = set(page.evaluate(TW_CLASSES_JS))

                    # The board moves a card before its PATCH is answered, so every move check
                    # holds the request and decides the answer itself.
                    held: list = []

                    def hold_patch(route):
                        # Everything else — the CORS preflight included — goes to the fake, which
                        # answers it with the headers the browser needs.
                        if route.request.method == "PATCH":
                            held.append(route)
                        else:
                            route.fallback()

                    def answer_held(status: int, body: dict):
                        for _ in range(50):
                            if held:
                                break
                            page.wait_for_timeout(100)
                        if not held:
                            raise HarnessError("the board never sent its PATCH")
                        fulfill_json(held[0], status, body)
                        return json.loads(held[0].request.post_data or "{}")

                    # A refused move: the card goes back where it was, and it says why.
                    page.route("**/demo/customers/pr0SPct1", hold_patch)
                    page.evaluate(MARK_TOASTS_JS)
                    main_tw.get_by_role("button", name="Move on to Won").click()
                    page.wait_for_function(
                        "() => [...document.querySelectorAll('main .tw .grid-cols-5 > section')][3]"
                        ".innerText.includes('Harbor Dental')")
                    answer_held(500, {"error": "The store is read-only."})
                    new_toast(page, "The store is read-only.")
                    page.wait_for_function(
                        "() => [...document.querySelectorAll('main .tw .grid-cols-5 > section')][2]"
                        ".innerText.includes('Harbor Dental')")
                    check("pipeline: a refused stage move says so and puts the card back",
                          page.evaluate(BOARD_JS)[2]["cards"] == ["Harbor Dental"]
                          and page.evaluate(BOARD_JS)[3]["cards"] == [])

                    # Both the move and the reload behind it fail: the board is now showing a
                    # stage the backend never accepted, so the reload's failure has to be said out
                    # loud rather than left on screen as a silent lie.
                    held.clear()

                    def crm_unavailable(route):
                        if route.request.method != "GET":
                            route.fallback()
                        else:
                            fulfill_json(route, 500, {"error": "The CRM is unavailable."})

                    page.route("**/demo/crm", crm_unavailable)
                    page.evaluate(MARK_TOASTS_JS)
                    main_tw.get_by_role("button", name="Move on to Won").click()
                    answer_held(500, {"error": "The store is read-only."})
                    check("pipeline: a failed move whose reload also fails still reports it",
                          new_toast(page, "The CRM is unavailable.", required=False))
                    page.unroute("**/demo/crm")
                    held.clear()

                    # Back to a board that matches the fake for the rest of the checks.
                    demo_nav(page, "Customers").click()
                    harbor_link.wait_for()
                    demo_nav(page, "CRM").click()
                    main_tw.get_by_text("Left a voicemail with the owner.").wait_for()

                    page.evaluate(MARK_TOASTS_JS)
                    main_tw.get_by_role("button", name="Move on to Won").click()
                    page.wait_for_function(
                        "() => [...document.querySelectorAll('main .tw .grid-cols-5 > section')][3]"
                        ".innerText.includes('Harbor Dental')")
                    moved_early = page.evaluate(BOARD_JS)
                    body = answer_held(200, {"customer": {"id": "pr0SPct1", "stage": "won"}})
                    check("pipeline: a stage move PATCHes {stage} and moves the card before the answer",
                          body == {"stage": "won"}
                          and moved_early[3]["cards"] == ["Harbor Dental"]
                          and moved_early[2]["cards"] == [],
                          f"body={body} board={moved_early}")
                    check("pipeline: ... and says where it went", new_toast(page, "Moved to Won."))
                    page.unroute("**/demo/customers/pr0SPct1")

                    # The drawer: one prospect's CRM, over the board. Three ways in.
                    drawer = page.locator("[data-tw-portal] [role=dialog]")
                    feed.locator("li", has_text="Left a voicemail with the owner.").first.click()
                    drawer.get_by_role("heading", name="Cedar Bakery").wait_for()
                    check("pipeline: an activity-feed row opens that prospect's drawer",
                          drawer.get_by_text("Left a voicemail with the owner.").count() >= 1)
                    page.keyboard.press("Escape")
                    drawer.wait_for(state="detached")
                    due.get_by_role("button", name="Cedar Bakery").click()
                    drawer.get_by_role("heading", name="Cedar Bakery").wait_for()
                    check("pipeline: a Due now chip opens that prospect's drawer",
                          drawer.get_by_label("Deal stage").inner_text().strip() == "Contacted",
                          drawer.get_by_label("Deal stage").inner_text())
                    page.keyboard.press("Escape")
                    drawer.wait_for(state="detached")

                    main_tw.get_by_role("button", name="Harbor Dental").first.click()
                    drawer.wait_for()
                    drawer.get_by_text("Asked for a follow-up after the expo.").wait_for()
                    check("pipeline: the card opens the drawer inside [data-tw-portal], with the timeline",
                          page.locator("[role=dialog]").count() == 1
                          and drawer.get_by_role("heading", name="Harbor Dental").is_visible()
                          and drawer.get_by_text("Called · 4:00 · 18 turns").count() == 1
                          and drawer.get_by_text("Opened the demo link").count() == 14)
                    # The ported Button renders the link as <a role="button"> (verbatim promo
                    # markup), so this looks for the anchor rather than the "link" role.
                    opener = page.evaluate("""() => {
                        const el = [...document.querySelectorAll('[data-tw-portal] [role=dialog] a')]
                          .find((n) => n.textContent.trim().startsWith('Open the customer'));
                        return el ? { href: el.getAttribute('href'), role: el.getAttribute('role') } : null;
                    }""")
                    check("pipeline: the drawer links to the prospect page",
                          opener is not None and opener["href"] == "#/demos/prospects/pr0SPct1",
                          str(opener))
                    per_state["pipeline + drawer"] = set(page.evaluate(TW_CLASSES_JS))

                    # The drawer's own writes. Its Stage select is a second portal surface: a
                    # popover portalled into the shared .tw container beside the modal sheet, so
                    # it has to be reachable and clickable from inside the sheet.
                    # (The fake is stateless, so the board behind can't be asserted to follow:
                    # its next read of /demo/crm returns the original stages.)
                    drawer.get_by_label("Deal stage").click()
                    listbox = page.locator("[data-tw-portal] [role=listbox]")
                    listbox.wait_for()
                    lost = listbox.get_by_role("option", name="Lost")
                    check("drawer: the stage select opens inside [data-tw-portal]",
                          page.locator("[role=listbox]").count() == 1 and lost.is_visible())
                    with page.expect_request(lambda r: r.method == "PATCH"
                                             and "/demo/customers/" in r.url) as req:
                        lost.click()
                    body = req.value.post_data_json
                    check("drawer: picking a stage PATCHes {stage}",
                          body == {"stage": "lost"}
                          and req.value.url.endswith("/demo/customers/pr0SPct1"),
                          f"{body} {req.value.url}")
                    with page.expect_request(lambda r: r.method == "PATCH"
                                             and "/demo/customers/" in r.url) as req:
                        drawer.get_by_label("Follow up on").fill("2026-10-01")
                    body = req.value.post_data_json
                    check("drawer: setting the follow-up date PATCHes {followUpAt}",
                          body == {"followUpAt": "2026-10-01"}, str(body))

                    note = drawer.get_by_label("Add a note")
                    add_note = drawer.get_by_role("button", name="Add note")
                    reqs.clear()
                    note.fill("   ")
                    page.wait_for_timeout(300)
                    check("pipeline: a blank note can't be sent (the button stays disabled)",
                          add_note.is_disabled()
                          and [r for r in reqs if r.endswith("/notes")] == [], str(reqs))
                    note.fill("Called back, wants pricing.")
                    page.evaluate(MARK_TOASTS_JS)
                    with page.expect_request(lambda r: r.method == "POST"
                                             and r.url.endswith("/demo/customers/pr0SPct1/notes")) as req:
                        add_note.click()
                    body = req.value.post_data_json
                    # expect_request fires when the request goes out; the box is cleared when the
                    # answer comes back, so wait for that before reading the toasts.
                    expect(note).to_have_value("", timeout=10000)
                    check("pipeline: adding a note POSTs {text}, clears the box and reports nothing",
                          body == {"text": "Called back, wants pricing."}
                          and page.locator("main .tw [data-sonner-toast]:not([data-seen])").count() == 0,
                          f"body={body} draft={note.input_value()!r}")
                    page.keyboard.press("Escape")
                    drawer.wait_for(state="detached")

                    # A slow read for a prospect the operator has already closed must not land in
                    # the drawer they are looking at now — nor let its next save go to the wrong
                    # record (the drawer keeps the id it is *currently* on).
                    held.clear()

                    def hold_harbor_get(route):
                        if route.request.method == "GET":
                            held.append(route)
                        else:
                            route.fallback()

                    page.route("**/demo/customers/pr0SPct1", hold_harbor_get)
                    main_tw.get_by_role("button", name="Harbor Dental").first.click()
                    drawer.wait_for()
                    for _ in range(50):
                        if held:
                            break
                        page.wait_for_timeout(100)
                    if not held:
                        raise HarnessError("the drawer never read the prospect")
                    page.keyboard.press("Escape")
                    drawer.wait_for(state="detached")
                    main_tw.get_by_role("button", name="Cedar Bakery").first.click()
                    drawer.get_by_text("Left a voicemail with the owner.").wait_for()
                    fulfill_json(held[0], 200, STALE_HARBOR)
                    page.wait_for_timeout(1000)
                    check("drawer: a stale read for a closed prospect can't take over the open one",
                          drawer.get_by_role("heading", name="Cedar Bakery").is_visible()
                          and drawer.get_by_text("A note only the stale read has.").count() == 0
                          and drawer.get_by_text("Left a voicemail with the owner.").count() >= 1,
                          drawer.inner_text()[:400])
                    drawer.get_by_label("Deal stage").click()
                    listbox.wait_for()
                    with page.expect_request(lambda r: r.method == "PATCH"
                                             and "/demo/customers/" in r.url) as req:
                        listbox.get_by_role("option", name="Interested").click()
                    check("drawer: ... and the next save still goes to the prospect on screen",
                          req.value.url.endswith("/demo/customers/cedar42")
                          and req.value.post_data_json == {"stage": "interested"},
                          f"{req.value.url} {req.value.post_data_json}")
                    page.unroute("**/demo/customers/pr0SPct1")
                    page.keyboard.press("Escape")
                    drawer.wait_for(state="detached")

                    for label in ("pipeline", "pipeline + drawer"):
                        bad, _ = legacy_collisions(css, per_state[label])
                        check(f"no @layer legacy class name on promo markup: {label}",
                              bool(per_state[label]) and bad == [], f"collisions: {bad}")

                    main_tw.get_by_role("button", name="Harbor Dental").first.click()
                    drawer.wait_for()
                    open_link = drawer.locator(':is(a, button):has-text("Open the customer")').last
                    open_link.click()
                    page.get_by_role("heading", name="Harbor Dental", level=1).wait_for()
                    check("pipeline: following the drawer's link lands on the prospect page",
                          page.evaluate("location.hash") == "#/demos/prospects/pr0SPct1",
                          page.evaluate("location.hash"))

                    page.goto(base + "#/apiKeys")
                    page.reload()
                    settle(page)
                    check("#/apiKeys survives a refresh",
                          page.get_by_text("Let another system read call minutes").is_visible())

                    # Signing out is the end of it: there is no separate demo session to leave
                    # behind, so the Demos views go with the dashboard's own.
                    page.get_by_title("Sign out").click()
                    settle(page)
                    check("signing out returns to the sign-in screen",
                          page.get_by_role("button", name="Sign in", exact=True).is_visible()
                          and page.evaluate("localStorage.getItem('transcribe.token')") is None)
                    reqs.clear()
                    page.goto(base + "#/demos/overview")
                    settle(page)
                    check("signing out ends access to the demos",
                          page.get_by_role("button", name="Sign in", exact=True).is_visible()
                          and page.locator('.sidebar-group[data-group="demos"]').count() == 0
                          and reqs == [], str(reqs))
                    ctx.close()

                    # The brand orb is on every page of the app, so what it costs on load matters.
                    # Both of the component's escapes are measured rather than assumed: with
                    # reduced motion the poster is all that is fetched and the film never is (that
                    # is the state every check above ran in), and with motion allowed the muted
                    # film autoplays at the idle rate of 0.65 rather than at 1.
                    for motion, plays in (("reduce", False), ("no-preference", True)):
                        asked: list[str] = []
                        mctx = browser.new_context(viewport={"width": 1440, "height": 900},
                                                   reduced_motion=motion)
                        mctx.add_init_script(
                            "try { localStorage.clear(); } catch (e) {} "
                            "localStorage.setItem('theme', 'light'); "
                            "localStorage.setItem('transcribe.token', 'tok-admin');")
                        mpage = mctx.new_page()
                        mpage.route("**/favicon.ico", lambda r: r.fulfill(status=204))
                        mpage.on("request", lambda r, a=asked: a.append(urlparse(r.url).path))
                        mpage.on("pageerror", lambda e: page_errors.append(str(e)))
                        mpage.goto(base + "#/overview")
                        settle(mpage)
                        mpage.wait_for_timeout(1500)
                        film = mpage.evaluate(
                            "() => { const v = document.querySelector('.sidebar-brand video');"
                            " return { paused: v.paused, rate: v.playbackRate }; }")
                        fetched = "/voice-orb.mp4" in asked
                        check(f"brand orb ({motion}): the film is "
                              + ("fetched and playing at the idle rate" if plays
                                 else "never fetched and the still stays up"),
                              fetched is plays and film["paused"] is not plays
                              and (abs(film["rate"] - 0.65) < 0.001 if plays else film["rate"] == 1)
                              and "/voice-orb.png" in asked,
                              f"{film} fetched={fetched} poster={'/voice-orb.png' in asked}")
                        mctx.close()

                    check("no page errors", page_errors == [], str(page_errors))
                    browser.close()
            finally:
                stop(proc, log)
    finally:
        backend.shutdown()
        backend.server_close()

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
