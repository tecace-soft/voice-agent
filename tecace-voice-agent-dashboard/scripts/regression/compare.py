"""Render every transcribe view in two builds of the dashboard and report any difference.

Usage (from tecace-voice-agent-dashboard/):
    python scripts/regression/compare.py                       # OLD=../transcribe-dashboard-app vs NEW=.
    python scripts/regression/compare.py --old <dir> --new <dir>
    python scripts/regression/compare.py --only admin:overview:light

Needs: Python Playwright (no bundled browser needed — it drives the installed Edge), npm deps
installed in both apps. Exit code 0 = identical, 1 = differences (listed), 2 = harness failure.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

import fake_backend

HERE = Path(__file__).resolve().parent
APP_ROOT = HERE.parent.parent
BACKEND = "http://127.0.0.1:8899"
OUT_DIR = APP_ROOT / ".regression"
OLD_PORT, NEW_PORT, BACKEND_PORT = 5198, 5199, 8899

ADMIN_VIEWS = ["overview", "analytics", "people", "activity", "runs", "failed", "feedback",
               "allFeedback", "calls", "business", "numbers", "apiKeys", "accounts"]
SCOPED_VIEWS = ["overview", "analytics", "activity", "runs", "failed", "calls", "business"]
USER_VIEWS = ["overview", "analytics", "activity", "runs", "feedback", "calls", "business"]

# NOTE: `apiKeys` is missing from routing.ts's VIEWS list in the original app (known bug, fixed in
# stage 3). Both builds therefore land on Overview for #/apiKeys — identical, which is what stage
# 1–2 must prove. Stage 3 adds it to the expected-difference list when it fixes the router.


class HarnessError(RuntimeError):
    """Something about the harness itself went wrong (exit 2), as opposed to a difference (exit 1)."""


# Locator specs are plain data so a capture list stays readable:
#   {"role": "button", "name": "Columns"}            -> page.get_by_role(...)
#   {"label": "Email"}                                -> page.get_by_label(...)
#   {"css": "tbody tr"}                               -> page.locator(...)
#   {"within": <spec>, ...}                           -> the same, scoped inside another locator
# Every step's locator must match at least one element; see run_steps().
NAV = {"role": "navigation", "name": "Dashboard sections"}

INTERACTIONS = [
    # Keyboard focus ring: four Tabs from a fresh page (the focused element's path is recorded too).
    {"id": "admin:runs:light+tab4", "token": "tok-admin", "hash": "#/runs", "theme": "light",
     "steps": [("press", "Tab")] * 4},
    # Row hover (tbody tr:hover td -> --accent-soft). The app has no <a> elements, so the "link"
    # hover is a sidebar nav button instead (.nav-item:hover, also --accent-soft).
    {"id": "admin:runs:light+hover-row", "token": "tok-admin", "hash": "#/runs", "theme": "light",
     "steps": [("hover", {"css": "main.content tbody tr"})]},
    {"id": "admin:runs:light+hover-nav", "token": "tok-admin", "hash": "#/runs", "theme": "light",
     "steps": [("hover", {"within": NAV, "role": "button", "name": "Accounts"})]},
    # Popover open.
    {"id": "admin:runs:light+columns-menu", "token": "tok-admin", "hash": "#/runs", "theme": "light",
     "steps": [("click", {"role": "button", "name": "Columns"}),
               ("wait", {"role": "group", "name": "Toggle columns"})]},
    # MailboxPicker is a native <select>, whose open list isn't DOM; pick a mailbox with it instead.
    {"id": "admin:overview:light+pick-mailbox", "token": "tok-admin", "hash": "#/overview",
     "theme": "light", "steps": [("select", {"role": "combobox"}, "sam@tecace.com")]},
    # Add-teammate form.
    {"id": "admin:accounts:light+add-user", "token": "tok-admin", "hash": "#/accounts", "theme": "light",
     "steps": [("click", {"role": "button", "name": "Add user"}),
               ("wait", {"css": "input[placeholder='Sam Lee']"})]},
    # Expanded call.
    {"id": "user:calls:light+open-call", "token": "tok-user", "hash": "#/calls", "theme": "light",
     "steps": [("click", {"role": "button", "name": "Jordan Lee"})]},
    # Sign-in error state (the fake answers POST /auth/login with 401).
    {"id": "signin:light+bad-login", "token": None, "hash": "", "theme": "light",
     "steps": [("fill", {"label": "Email"}, "nobody@tecace.com"),
               ("fill", {"label": "Password"}, "wrong-password"),
               ("click", {"role": "button", "name": "Sign in", "exact": True}),
               ("wait", {"role": "alert"})]},
]

# Elements that exist only in the new app by design. Before every capture (in BOTH runs) they get
# display:none — which takes them out of layout entirely, so the rest of the page is laid out
# exactly as in the old app — and the fingerprint skips them. Everything else must still match.
HIDE = [
    '.sidebar-group[data-group="demos"]',  # stage 3: the admin-only Demos nav group
]

# Captures that are MEANT to differ: id -> (why, marker). The marker must appear in the new app's
# text and not in the old app's — the change is proven, not merely skipped.
EXPECTED_CHANGES = {
    "admin:apiKeys:light": (
        "stage 3 fixed routing: #/apiKeys opens API keys (the original lands on Overview)",
        "Let another system read call minutes",
    ),
}

HIDE_JS = """
(selectors) => {
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      el.style.setProperty("display", "none", "important");
      el.setAttribute("data-regression-hidden", "");
    }
  }
}
"""


def captures() -> list[dict]:
    caps = [{"id": "signin:light", "token": None, "hash": "", "theme": "light"},
            {"id": "signin:dark", "token": None, "hash": "", "theme": "dark"}]
    for v in ADMIN_VIEWS:
        caps.append({"id": f"admin:{v}:light", "token": "tok-admin", "hash": f"#/{v}", "theme": "light"})
    for v in SCOPED_VIEWS:
        caps.append({"id": f"admin-scoped:{v}:light", "token": "tok-admin",
                     "hash": f"#/{v}?mailbox=sam%40tecace.com", "theme": "light"})
    for v in ["overview", "runs"]:
        caps.append({"id": f"admin-unattributed:{v}:light", "token": "tok-admin",
                     "hash": f"#/{v}?mailbox=unattributed", "theme": "light"})
    for v in USER_VIEWS:
        caps.append({"id": f"user:{v}:light", "token": "tok-user", "hash": f"#/{v}", "theme": "light"})
    for v in ["overview", "failed", "business", "accounts"]:
        caps.append({"id": f"admin:{v}:dark", "token": "tok-admin", "hash": f"#/{v}", "theme": "dark"})
    caps.append({"id": "user:overview:dark", "token": "tok-user", "hash": "#/overview", "theme": "dark"})
    caps.extend(INTERACTIONS)
    return caps


STYLE_PROPS = [
    "display", "position", "color", "background-color", "background-image", "border-top-width",
    "border-top-style", "border-top-color", "border-right-width", "border-right-style",
    "border-right-color", "border-bottom-width", "border-bottom-style", "border-bottom-color",
    "border-left-width", "border-left-style", "border-left-color", "border-radius", "border-collapse",
    "box-shadow", "box-sizing", "font-family", "font-size", "font-weight", "font-style", "line-height",
    "letter-spacing", "text-transform", "text-decoration-line", "text-overflow", "margin-top",
    "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom",
    "padding-left", "opacity", "outline-style", "outline-color", "outline-width", "list-style-type",
    "text-align", "vertical-align", "white-space", "gap", "width", "height", "max-width",
    "overflow-x", "overflow-y", "cursor", "color-scheme", "transform", "justify-content",
    "align-items", "flex-direction", "grid-template-columns", "fill", "stroke", "stroke-width",
    "accent-color", "clip", "clip-path",
]

# Walks <html> and <body> (not <head>: its <script>/<link>/<style> tags are build plumbing, and a
# stage-2 stylesheet tag there must not count as a difference). Each element gets its computed
# styles plus its document-relative box as "@x"/"@y"/"@w"/"@h".
FINGERPRINT_JS = """
(props) => {
  const out = {};
  let focus = null;
  const r2 = (v) => Math.round(v * 100) / 100;
  const sx = window.scrollX, sy = window.scrollY;
  const record = (el, path) => {
    const cs = getComputedStyle(el);
    const rec = {};
    for (const p of props) rec[p] = cs.getPropertyValue(p);
    const b = el.getBoundingClientRect();
    rec["@x"] = r2(b.left + sx); rec["@y"] = r2(b.top + sy);
    rec["@w"] = r2(b.width); rec["@h"] = r2(b.height);
    out[path] = rec;
    if (el === document.activeElement) focus = path;
  };
  const keyOf = (child) => {
    const cls = typeof child.className === "string"
      ? child.className.trim().split(/\\s+/).filter(Boolean).join(".")
      : (child.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).join(".");
    return child.tagName.toLowerCase() + (cls ? "." + cls : "");
  };
  const walk = (el, path) => {
    record(el, path);
    const counts = {};
    for (const child of el.children) {
      if (child.hasAttribute("data-regression-hidden")) continue;
      const key = keyOf(child);
      counts[key] = (counts[key] || 0) + 1;
      walk(child, path + ">" + key + "[" + counts[key] + "]");
    }
  };
  const html = document.documentElement;
  record(html, "html");
  walk(document.body, "html>body[1]");
  return { styles: out, focus };
}
"""

# Every custom-property name declared anywhere in the page's stylesheets (recursing into grouping
# rules — @layer/@media/@scope/@supports — and @import'ed sheets), resolved on <html>.
TOKENS_JS = r"""
() => {
  const names = new Set();
  const seen = new Set();
  const re = /--[\w-]+(?=\s*:)/g;
  const visitRules = (rules) => {
    for (const rule of rules) {
      if (rule.styleSheet) visitSheet(rule.styleSheet);           // @import
      let nested = null;
      try { nested = rule.cssRules; } catch (e) {}
      if (nested && nested.length) visitRules(nested);            // grouping / nesting rules
      if (rule.style) {
        for (const p of rule.style) if (p.startsWith("--")) names.add(p);
      }
      const text = rule.cssText || "";
      for (const m of text.matchAll(re)) names.add(m[0]);
    }
  };
  const visitSheet = (sheet) => {
    if (!sheet || seen.has(sheet)) return;
    seen.add(sheet);
    let rules;
    try { rules = sheet.cssRules; } catch (e) { return; }         // cross-origin (CDN font CSS)
    if (rules) visitRules(rules);
  };
  for (const sheet of document.styleSheets) visitSheet(sheet);
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const n of [...names].sort()) out[n] = cs.getPropertyValue(n).trim();
  return out;
}
"""

FONTS_JS = """
() => [...document.fonts].filter(f => f.status === 'loaded')
  .map(f => `${f.family} ${f.weight} ${f.style}`).sort()
"""


def npx() -> str:
    exe = shutil.which("npx.cmd") or shutil.which("npx")
    if not exe:
        raise HarnessError("npx not found on PATH")
    return exe


def check_ports_free() -> None:
    for port in (OLD_PORT, NEW_PORT, BACKEND_PORT):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                raise HarnessError(f"port {port} in use (another run, or a stray vite preview?)")


def build(label: str, app_dir: Path, out: Path) -> None:
    env = {**os.environ, "VITE_BACKEND_URL": BACKEND}
    log = OUT_DIR / f"{label}-build.log"
    print(f"  building {app_dir.name} -> {out}  (log: {log.name})")
    with open(log, "w", encoding="utf-8") as fh:
        rc = subprocess.run([npx(), "vite", "build", "--outDir", str(out), "--emptyOutDir"],
                            cwd=app_dir, env=env, stdout=fh, stderr=subprocess.STDOUT).returncode
    if rc != 0:
        raise HarnessError(f"vite build of {app_dir} failed (exit {rc}); see {log}")


def serve(label: str, app_dir: Path, out: Path, port: int) -> tuple[subprocess.Popen, object]:
    log = open(OUT_DIR / f"{label}-preview.log", "w", encoding="utf-8")
    proc = subprocess.Popen(
        [npx(), "vite", "preview", "--outDir", str(out), "--port", str(port), "--host", "127.0.0.1",
         "--strictPort"],
        cwd=app_dir, stdout=log, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}/"
    for _ in range(100):
        if proc.poll() is not None:
            log.close()
            raise HarnessError(f"vite preview for {app_dir.name} exited ({proc.returncode}); "
                               f"see {OUT_DIR / (label + '-preview.log')}")
        try:
            urllib.request.urlopen(url, timeout=1)
            return proc, log
        except OSError:
            time.sleep(0.2)
    stop(proc, log)
    raise HarnessError(f"vite preview for {app_dir.name} never answered on {url}")


def stop(proc: subprocess.Popen, log=None) -> None:
    # vite runs under a cmd/node tree on Windows; kill the whole tree.
    subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass
    if log is not None:
        log.close()


def locate(page, spec: dict):
    scope = locate(page, spec["within"]) if "within" in spec else page
    if "role" in spec:
        kw = {"name": spec["name"], "exact": spec.get("exact", False)} if "name" in spec else {}
        loc = scope.get_by_role(spec["role"], **kw)
    elif "label" in spec:
        loc = scope.get_by_label(spec["label"])
    else:
        loc = scope.locator(spec["css"])
    return loc.first


def run_steps(page, steps: list) -> None:
    """Raises LookupError naming the step if a locator matches nothing."""
    for step in steps:
        kind = step[0]
        if kind == "press":
            page.keyboard.press(step[1])
            continue
        loc = locate(page, step[1])
        try:
            loc.wait_for(state="visible", timeout=5000)
        except Exception as exc:  # noqa: BLE001 — Playwright raises its own TimeoutError
            raise LookupError(f"step {step!r}: locator matched no visible element") from exc
        if kind == "hover":
            loc.hover()
        elif kind == "click":
            loc.click()
        elif kind == "fill":
            loc.fill(step[2])
        elif kind == "select":
            loc.select_option(step[2])
        elif kind == "wait":
            pass
        else:
            raise HarnessError(f"unknown step kind {kind!r}")


def settle(page) -> None:
    page.wait_for_load_state("networkidle")
    page.evaluate("document.fonts.ready.then(() => true)")
    page.wait_for_timeout(300)


def capture_all(label: str, base_url: str, caps: list[dict]) -> dict:
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge")
        for cap in caps:
            ctx = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce",
                                      timezone_id="America/Los_Angeles", locale="en-US")
            init = ["try { localStorage.clear(); } catch (e) {}"]
            if cap["token"]:
                init.append(f"localStorage.setItem('transcribe.token', '{cap['token']}');")
            init.append(f"localStorage.setItem('theme', '{cap['theme']}');")
            ctx.add_init_script("\n".join(init))
            page = ctx.new_page()
            # Neither app ships a favicon; answering it keeps a racy 404 out of the error list.
            page.route("**/favicon.ico", lambda r: r.fulfill(status=204))
            page.clock.set_fixed_time(fake_backend.NOW)
            errors: list[str] = []
            # Record where each console error came from (with the per-app origin stripped, since
            # old and new are served on different ports) so a 404 names the missing resource.
            page.on("console", lambda m: errors.append(
                f"console.{m.type}: {m.text} @ {m.location.get('url', '').replace(base_url, '/')}")
                if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.goto(base_url + cap["hash"])
            settle(page)
            page.evaluate(HIDE_JS, HIDE)
            step_error = None
            if cap.get("steps"):
                try:
                    run_steps(page, cap["steps"])
                except LookupError as exc:
                    if label == "old":
                        raise HarnessError(f"[{cap['id']}] in OLD: {exc}") from exc
                    step_error = str(exc)  # in NEW it's a difference, reported by diff()
                settle(page)  # the mouse is not moved again, so a hover stays held
            page.evaluate(HIDE_JS, HIDE)  # again: a step may have re-rendered hidden elements
            fp = page.evaluate(FINGERPRINT_JS, STYLE_PROPS)
            results[cap["id"]] = {
                "text": page.evaluate("document.body.innerText"),
                "focus": fp["focus"],
                "fonts": page.evaluate(FONTS_JS),
                "tokens": page.evaluate(TOKENS_JS),
                "step_error": step_error,
                "errors": sorted(errors),
                "styles": fp["styles"],
            }
            ctx.close()
        browser.close()
    return results


def diff(old: dict, new: dict) -> list[str]:
    problems: list[str] = []
    for cid in old:
        a, b = old[cid], new.get(cid)
        if b is None:
            problems.append(f"[{cid}] missing from new run")
            continue
        if cid in EXPECTED_CHANGES:
            why, marker = EXPECTED_CHANGES[cid]
            in_old, in_new = marker in a["text"], marker in b["text"]
            if in_old or not in_new:
                problems.append(f"[{cid}] expected change did not happen ({why}): marker "
                                f"{marker!r} in old={in_old}, in new={in_new}")
            continue
        if b.get("step_error"):
            problems.append(f"[{cid}] interaction failed in new: {b['step_error']}")
        if a["text"] != b["text"]:
            problems.append(f"[{cid}] text differs:")
            udiff = list(difflib.unified_diff(a["text"].splitlines(), b["text"].splitlines(),
                                              "old", "new", lineterm="", n=1))
            problems.extend(f"[{cid}]     {line}" for line in udiff[:20])
            if len(udiff) > 20:
                problems.append(f"[{cid}]     ... ({len(udiff) - 20} more diff lines)")
        if a["focus"] != b["focus"]:
            problems.append(f"[{cid}] focused element: {a['focus']!r} -> {b['focus']!r}")
        if a["fonts"] != b["fonts"]:
            problems.append(f"[{cid}] loaded fonts differ: only old={sorted(set(a['fonts']) - set(b['fonts']))} "
                            f"only new={sorted(set(b['fonts']) - set(a['fonts']))}")
        if a["errors"] != b["errors"]:
            problems.append(f"[{cid}] errors differ: old={a['errors']} new={b['errors']}")
        # Tokens: only names OLD declares — stage 2's new Tailwind variables aren't noise.
        for name, val in a["tokens"].items():
            if name not in b["tokens"]:
                problems.append(f"[{cid}] token {name} declared in old, missing in new (old={val!r})")
            elif b["tokens"][name] != val:
                problems.append(f"[{cid}] token {name}: {val!r} -> {b['tokens'][name]!r}")
        only_old = sorted(set(a["styles"]) - set(b["styles"]))
        only_new = sorted(set(b["styles"]) - set(a["styles"]))
        for path in only_old:
            problems.append(f"[{cid}] element only in old: {path}")
        for path in only_new:
            problems.append(f"[{cid}] element only in new: {path}")
        for path in sorted(set(a["styles"]) & set(b["styles"])):
            for prop, val in a["styles"][path].items():
                if b["styles"][path].get(prop) != val:
                    problems.append(f"[{cid}] {path} {prop}: {val!r} -> {b['styles'][path].get(prop)!r}")
    return problems


def run(args) -> int:
    caps = [c for c in captures() if not args.only or c["id"] == args.only]
    if not caps:
        print(f"no capture called {args.only!r}")
        return 2
    check_ports_free()
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "diff.txt").unlink(missing_ok=True)
    server = fake_backend.start(BACKEND_PORT)
    runs = {}
    try:
        with tempfile.TemporaryDirectory(prefix="dash-regression-") as tmp:
            for label, app_dir, port in (("old", Path(args.old), OLD_PORT), ("new", Path(args.new), NEW_PORT)):
                out = Path(tmp) / label
                build(label, app_dir, out)
                proc, log = serve(label, app_dir, out, port)
                try:
                    print(f"  capturing {len(caps)} views from {label}")
                    runs[label] = capture_all(label, f"http://127.0.0.1:{port}/", caps)
                finally:
                    stop(proc, log)
                (OUT_DIR / f"{label}.json").write_text(json.dumps(runs[label], indent=1), encoding="utf-8")
    finally:
        server.shutdown()
        server.server_close()

    problems = diff(runs["old"], runs["new"])
    (OUT_DIR / "diff.txt").write_text("\n".join(problems) + ("\n" if problems else "IDENTICAL\n"),
                                      encoding="utf-8")
    total_errors = sum(len(r["errors"]) for r in runs["new"].values())
    print(f"\n{len(caps)} captures compared; {total_errors} console/page errors in new "
          f"(identical to old unless listed below).")
    if problems:
        limit = 60
        print(f"{len(problems)} DIFFERENCES (full list: {OUT_DIR / 'diff.txt'}):")
        for line in problems[:limit]:
            print("  " + line)
        if len(problems) > limit:
            print(f"  ... {len(problems) - limit} more in diff.txt")
        return 1
    confirmed = [cid for cid in EXPECTED_CHANGES if cid in runs["new"]]
    if confirmed:
        print(f"expected changes confirmed: {', '.join(confirmed)}")
    print("IDENTICAL")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", default=str(APP_ROOT.parent / "transcribe-dashboard-app"))
    ap.add_argument("--new", default=str(APP_ROOT))
    ap.add_argument("--only", help="run a single capture id, e.g. admin:overview:light")
    args = ap.parse_args()
    try:
        return run(args)
    except Exception as exc:  # noqa: BLE001 — anything unexpected is a harness failure, not a diff
        print(f"HARNESS FAILURE: {type(exc).__name__}: {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
