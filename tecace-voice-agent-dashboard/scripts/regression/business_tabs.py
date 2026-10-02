"""The Business page's receptionist settings, opened in a browser.

The page is the shared settings shell (src/settings/): a left menu of sections, each saving to its
own business endpoint. What this checks is that the sections hold the customer's data, that each
save goes to the right endpoint (never a demo one), that transfers save as a draft and publish
separately, that a refusal from the backend lands under the field it names, and that the two
styling systems keep out of each other's way — the page around the shell is the transcribe
stylesheet and the shell is Tailwind scoped to `.tw`.

Run (one at a time — these scripts share ports):  python scripts/regression/business_tabs.py
"""

from __future__ import annotations

import json
import re
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
APP_PORT = 4182
SAM = "sam@samsdental.example"


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


MENU = (
    "Guided setup", "Business information", "Agent profile", "FAQs", "Take a message", "Appointments",
    "Text a link", "Transfer calls", "Custom training", "Test & improve", "Launch instructions",
    "Call forwarding",
)


def main() -> int:
    check = Checks()
    backend = fake_backend.start(BACKEND_PORT)
    try:
        with tempfile.TemporaryDirectory(prefix="business-tabs-") as tmp:
            out = Path(tmp) / "app"
            build(out)
            server = serve(out)
            base = f"http://127.0.0.1:{APP_PORT}"
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")
                    ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
                    # Signed in as the customer whose business this is, the way the app does it.
                    ctx.add_init_script("localStorage.setItem('transcribe.token', 'tok-user')")
                    page = ctx.new_page()
                    errors: list[str] = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    sent: list[tuple[str, str, str]] = []
                    page.on("request", lambda r: sent.append((r.method, r.url, r.post_data or "")))
                    # The confirm() on delete and on turning consent off; not exercised here, but a
                    # dialog nobody answers would hang the page.
                    page.on("dialog", lambda d: d.accept())

                    nav = page.locator("nav[aria-label='Receptionist settings']")

                    def open_section(label: str) -> None:
                        nav.get_by_role("button", name=label).first.click()
                        page.wait_for_timeout(400)

                    def requests(fragment: str, method: str = "PUT") -> list[tuple[str, str, str]]:
                        return [x for x in sent if x[0] == method and fragment in x[1]]

                    page.goto(f"{base}/#/business", wait_until="networkidle")
                    page.wait_for_timeout(600)
                    body = page.inner_text("body")
                    check("the Business page still loads", "Sam's Dental" in body, body[:200])

                    # ---- the menu
                    for label in MENU:
                        check(f"menu: {label}", nav.get_by_text(label, exact=True).count() == 1)
                    menu_text = nav.inner_text()
                    check("menu: no spam filters or website widgets",
                          "Spam" not in menu_text and "Widget" not in menu_text)

                    # ---- Business information: the demo editor's fields, holding this business's data
                    for label, value in [
                        ("Business name", "Sam's Dental"),
                        ("Category", "Dental practice"),
                        ("Address", "12 Wharf St, Portland, ME"),
                        ("Phone", "+1 207 555 0142"),
                    ]:
                        field = page.get_by_label(label, exact=True).first
                        check(f"Business information: {label} holds the profile",
                              field.input_value() == value, f"{label}={field.input_value()!r}")
                    check("Business information: the hours rows are the week",
                          page.get_by_label("Day", exact=True).count() == 7,
                          str(page.get_by_label("Day", exact=True).count()))
                    check("Business information: the services are rows",
                          page.get_by_label("Service name", exact=True).count() == 3)
                    check("Business information: the policies are named fields",
                          page.get_by_label("Cancellation", exact=True).count() == 1)
                    check("Business information: FAQs are their own section",
                          page.get_by_label(re.compile(r"^Question \d+$")).count() == 0)

                    # ---- Autosave: a change saves itself a moment after typing stops, no button pressed
                    page.get_by_label("Phone", exact=True).first.fill("+1 207 555 0199")
                    page.wait_for_timeout(400)
                    check("Business information: nothing is sent while typing",
                          len(requests("/business/knowledge")) == 0)
                    check("Business information: says the change is waiting",
                          "Unsaved changes" in page.inner_text("main"))
                    page.wait_for_timeout(2200)
                    saves = requests("/business/knowledge")
                    check("Business information: autosave PUTs /business/knowledge once", len(saves) == 1, str(saves)[:200])
                    if saves:
                        payload = json.loads(saves[0][2] or "{}")
                        check("...carrying the whole profile, with the edit in it",
                              payload.get("profile", {}).get("phone") == "+1 207 555 0199"
                              and payload["profile"].get("name") == "Sam's Dental", str(payload)[:200])
                    check("Business information: says it saved, without a Save press",
                          "This is what the assistant now uses." in page.inner_text("main")
                          and "Saved at" in page.inner_text("main"))
                    check("Business information: Save now has nothing to do",
                          page.get_by_role("button", name="Save now").first.is_disabled())

                    # A cleared business name is held back, and says why.
                    name_field = page.get_by_label("Business name", exact=True).first
                    name_field.fill("")
                    page.wait_for_timeout(2200)
                    check("Business information: an empty name is not saved",
                          len(requests("/business/knowledge")) == 1, str(requests("/business/knowledge"))[:200])
                    check("...and it says why", "Not saved: Your business name is empty." in page.inner_text("main"))
                    name_field.fill("Sam's Dental")
                    page.get_by_role("button", name="Save now").first.click()
                    page.wait_for_timeout(900)
                    check("Business information: Save now saves at once",
                          len(requests("/business/knowledge")) == 2, str(requests("/business/knowledge"))[:200])

                    # ---- FAQs, and the section is in the URL
                    open_section("FAQs")
                    check("FAQs: the section is in the address bar", page.url.endswith("#/business/faqs"), page.url)
                    check("FAQs: the caller question is there",
                          page.get_by_label("Question 1", exact=True).count() == 1)
                    # Leaving the section saves what's waiting there, straight away.
                    page.get_by_label("Answer 1", exact=True).fill("Yes — call us to book your first visit.")

                    # ---- Agent profile: identity, then voice and language with the prompts
                    open_section("Agent profile")
                    page.wait_for_timeout(600)
                    faq_saves = requests("/business/knowledge")
                    check("FAQs: leaving the section saves the answer", len(faq_saves) == 3, str(faq_saves)[:200])
                    if faq_saves:
                        faq_body = json.loads(faq_saves[-1][2] or "{}").get("profile", {})
                        check("FAQs: the save sends the new answer, over the profile as last saved",
                              faq_body.get("faqs", [{}])[0].get("a") == "Yes — call us to book your first visit."
                              and faq_body.get("phone") == "+1 207 555 0199",
                              str(faq_body)[:300])
                    check("Agent profile: the receptionist name is editable",
                          page.get_by_label("Receptionist name", exact=True).count() == 1)
                    check("Agent profile: no call-sound controls — a real call is already a phone call",
                          "Call sound" not in page.inner_text("body"))
                    page.get_by_label("Receptionist name", exact=True).fill("Alex")
                    page.get_by_label("Greeting", exact=True).fill("Thanks for calling {business}, this is {agent}.")
                    check("Agent profile: shows what callers hear, placeholders filled",
                          "Thanks for calling Sam's Dental, this is Alex." in page.inner_text("body"))
                    page.wait_for_timeout(2400)
                    identity = requests("/business/identity")
                    check("Agent profile: autosave PUTs /business/identity with the name, once",
                          len(identity) == 1 and json.loads(identity[0][2]).get("agentName") == "Alex",
                          str(identity)[:200])
                    prompts = requests("/business/prompts")
                    check("...then /business/prompts with the voice",
                          bool(prompts) and json.loads(prompts[-1][2]).get("voice") == "gleam",
                          str(prompts)[:200])
                    check("Agent profile: says it saved",
                          "This is what the assistant now uses." in page.inner_text("main"))
                    open_section("FAQs")
                    check("FAQs: the saved answer is still on screen",
                          page.get_by_label("Answer 1", exact=True).input_value()
                          == "Yes — call us to book your first visit.")

                    # ---- Transfer calls: draft, a refusal under its field, publish
                    open_section("Transfer calls")
                    body = page.inner_text("main")
                    check("Transfers: the three kinds are explained",
                          all(w in body for w in ("Cold", "Warm", "Waterfall")))
                    check("Transfers: the number warm transfers come from is shown", "(425) 555-0100" in body)
                    check("Transfers: the old single transfer number is explained",
                          "before transfer scenarios existed" in body)
                    check("Transfers: the old number is listed as in use, not 'No transfers yet'",
                          "In use on calls" in body and "(425) 555-0111" in body and "No transfers yet" not in body,
                          body[:400])
                    check("Transfers: nothing to publish yet",
                          page.get_by_role("button", name="Publish").is_disabled())
                    # The old number opens in the editor, so its type and hours can be changed in place.
                    page.get_by_role("button", name="Edit Someone on the team").click()
                    page.wait_for_timeout(300)
                    old_editor = page.get_by_role("group", name="Edit Someone on the team")
                    check("Transfers: the old number opens in the editor",
                          old_editor.count() == 1 and old_editor.get_by_role("tab", name="Warm").count() == 1
                          and old_editor.get_by_role("button", name="Set hours").count() == 1)
                    old_editor.get_by_role("button", name="Cancel").click()
                    page.wait_for_timeout(200)
                    page.get_by_role("button", name="Add a transfer").first.click()
                    page.wait_for_timeout(300)
                    # The form opens in place, at the top of the list, rather than in a dialog.
                    dialog = page.get_by_role("group", name="Add a transfer")
                    dialog.get_by_label("Name", exact=True).fill("Billing")
                    dialog.get_by_label("Number", exact=True).fill("(425) 555-0100")
                    dialog.get_by_role("button", name="Save", exact=True).click()
                    page.wait_for_timeout(700)
                    check("Transfers: the backend's refusal shows in the form",
                          "ring itself" in dialog.inner_text(), dialog.inner_text()[:300])
                    dialog.get_by_label("Number", exact=True).fill("(206) 555-0134")
                    dialog.get_by_role("button", name="Save", exact=True).click()
                    page.wait_for_timeout(900)
                    drafts = requests("/business/call-settings")
                    check("Transfers: Save PUTs the draft", len(drafts) == 2, str(drafts)[:200])
                    check("Transfers: the new transfer is listed", "Billing" in page.inner_text("main"))
                    # Calls follow what is published: a saved draft does not replace the old number.
                    body = page.inner_text("main")
                    check("Transfers: the old number stays in use until the draft is published",
                          "In use on calls" in body and "Publish your transfers to replace it" in body, body[:400])
                    publish = page.get_by_role("button", name="Publish")
                    check("Transfers: Publish is offered once there is a change", publish.is_enabled())
                    publish.click()
                    page.wait_for_timeout(700)
                    check("Transfers: Publish POSTs publish",
                          len(requests("/call-settings/publish", "POST")) == 1)
                    check("...and then has nothing left to publish",
                          page.get_by_role("button", name="Publish").is_disabled())
                    check("...and the old number is no longer shown as in use",
                          "In use on calls" not in page.inner_text("main"))

                    # ---- Text a link
                    open_section("Text a link")
                    body = page.inner_text("main")
                    check("Text a link: the empty state says what to do", "No link scenarios yet" in body)
                    check("Text a link: the consent text is previewed", "Reply YES" in body and "STOP" in body)

                    # ---- Custom training: the prompts first and open, then the rules and instructions.
                    # (They used to sit behind "Advanced: prompts" at the foot of the page, below the
                    # fold on a business, and read as missing.)
                    open_section("Custom training")
                    check("Custom training: your own instructions are editable",
                          page.get_by_label("Your own instructions", exact=True).count() == 1)
                    check("Custom training: no Advanced toggle to find first",
                          page.get_by_role("button", name="Advanced: prompts").count() == 0)
                    for label in ("Voice prompt", "Backend prompt"):
                        check(f"Custom training: the {label} box is there, open",
                              page.get_by_label(label, exact=True).count() == 1)
                    prompts_top = page.get_by_role("heading", name="Prompts", exact=True).bounding_box()
                    rules_top = page.get_by_text("On every call, as standard").bounding_box()
                    check("Custom training: the Prompts section comes before the standard rules",
                          prompts_top is not None and rules_top is not None and prompts_top["y"] < rules_top["y"],
                          f"{prompts_top} {rules_top}")
                    page.get_by_role("button", name="Show", exact=True).click()
                    page.wait_for_timeout(700)
                    check("Custom training: the preview reads the composed session",
                          any("/business/session-preview" in x[1] for x in sent)
                          and "composed voice prompt" in page.inner_text("main"))

                    # ---- The prompts follow the saves above, and a hand edit says it froze them
                    voice_prompt = page.get_by_label("Voice prompt", exact=True)
                    check("Custom training: the voice prompt shows what the Business information save rebuilt",
                          "+1 207 555 0199" in voice_prompt.input_value(), voice_prompt.input_value()[:200])
                    frozen = "were edited by hand, so they no longer follow"
                    check("Custom training: not frozen before any hand edit", frozen not in page.inner_text("main"))
                    previews = len([x for x in sent if "/business/session-preview" in x[1]])
                    voice_prompt.fill(voice_prompt.input_value() + " Always mention free parking.")
                    page.get_by_role("button", name="Save prompts").click()
                    page.wait_for_timeout(900)
                    check("Custom training: a saved hand edit says the prompts are frozen, with a rebuild",
                          frozen in page.inner_text("main")
                          and page.get_by_role("button", name="Rebuild from settings").count() >= 1)
                    check("Custom training: the open preview re-reads after the save",
                          len([x for x in sent if "/business/session-preview" in x[1]]) > previews)
                    open_section("Business information")
                    check("Business information: says frozen prompts won't pick up changes here",
                          "don't pick up changes made here" in page.inner_text("main"))
                    open_section("Custom training")
                    page.get_by_role("button", name="Rebuild from settings").first.click()
                    page.wait_for_timeout(900)
                    check("Custom training: Rebuild unfreezes them",
                          frozen not in page.inner_text("main")
                          and any(json.loads(x[2] or "{}").get("rebuild") is True
                                  for x in requests("/business/prompts")))

                    # ---- Test & improve: the test call, the allowance, and the calls already made
                    open_section("Test & improve")
                    body = page.inner_text("main")
                    check("Test: this month's allowance is shown", "1:15 of 30:00 test minutes used" in body, body[:300])
                    check("Test: the call panel is there", page.get_by_role("button", name="Call").count() >= 1
                          or "Call, then talk as a caller would." in body)
                    check("Test: a past call shows its review and what happened",
                          "Went well: Put them through" in body and "Transfer finished: connected" in body)

                    # ---- Launch instructions
                    open_section("Launch instructions")
                    check("Launch: points to the call forwarding guide",
                          page.get_by_role("button", name="Set up call forwarding").count() == 1)

                    # ---- Call forwarding
                    page.get_by_role("button", name="Set up call forwarding").click()
                    page.wait_for_timeout(300)
                    body = page.inner_text("main")
                    check("Forwarding: the button opens the guide", "#/business/forwarding" in page.url, page.url)
                    check("Forwarding: missed-call codes carry the assistant's number",
                          "**61*4255550100#" in body and "**67*4255550100#" in body, body[:400])
                    check("Forwarding: every-call code shown alongside, no mode switch",
                          "**21*4255550100#" in body and page.get_by_role("radio").count() == 0, body[:400])
                    page.get_by_role("tab", name="Verizon").click()
                    body = page.inner_text("main")
                    check("Forwarding: Verizon shows *71 and *72 together, not the landline *90/*92",
                          "*714255550100" in body and "*724255550100" in body and "*90" not in body, body[:400])
                    check("Forwarding: no press-to-accept switch on a mobile tab while it's off",
                          page.get_by_role("switch").count() == 0)
                    page.get_by_role("tab", name="Landline").click()
                    body = page.inner_text("main")
                    check("Forwarding: landline explains answer confirmation", "press 1 to accept" in body, body[:400])
                    page.get_by_role("switch", name="My phone company still asks to press 1 to accept").click()
                    page.wait_for_timeout(300)
                    puts = [x for x in sent if x[0] == "PUT" and "/business/forward-accept" in x[1]]
                    check("Forwarding: the switch saves press-to-accept",
                          len(puts) == 1 and '"forwardAcceptPress":true' in puts[0][2].replace(" ", ""), str(puts))
                    check("Forwarding: the switch says it saved", "applies from the next call" in page.inner_text("main"))

                    # ---- Request go live: an account being set up, its part done, asks for its line
                    fake_backend.USER["status"] = "pre-production"
                    page.goto(f"{base}/#/business/business-info", wait_until="networkidle")
                    # Only the hash changed, so the app is still the one that read the old stage.
                    page.reload(wait_until="networkidle")
                    page.wait_for_timeout(800)
                    strip = page.get_by_role("status", name="Go live")
                    check("Go live: the strip says their part is done and offers the request",
                          strip.count() == 1 and "Your part is done." in strip.inner_text()
                          and strip.get_by_role("button", name="Request go live").count() == 1,
                          strip.inner_text()[:300] if strip.count() else page.inner_text("main")[:300])
                    open_section("Launch instructions")
                    body = page.inner_text("main")
                    check("Go live: Launch instructions splits the checklist into your part and ours",
                          "Your part" in body and "Our part, when you request go live" in body, body[:500])
                    strip.get_by_role("button", name="Request go live").click()
                    dialog = page.get_by_role("dialog")
                    dialog.get_by_label("Anything we should know? (optional)").fill("Monday please")
                    dialog.get_by_role("button", name="Send request").click()
                    page.wait_for_timeout(800)
                    asked = requests("/business/request-live", "POST")
                    check("Go live: Send request POSTs /business/request-live with the note",
                          len(asked) == 1 and json.loads(asked[0][2] or "{}").get("note") == "Monday please",
                          str(asked)[:200])
                    check("Go live: the strip and the checklist both say it's waiting",
                          "Go live requested" in strip.inner_text() and "Waiting for us" in strip.inner_text()
                          and page.inner_text("main").count("Waiting for us") >= 2,
                          strip.inner_text()[:300])
                    # The admin says not yet; the business reads the note and can ask again.
                    fake_backend.USER["liveRequest"] = None
                    fake_backend.USER["liveDeclined"] = {"declinedAt": "2026-09-29T10:00:00.000Z",
                                                         "note": "Add a transfer number first"}
                    page.reload(wait_until="networkidle")
                    page.wait_for_timeout(800)
                    strip = page.get_by_role("status", name="Go live")
                    check("Go live: a not yet shows the admin's note and Ask again",
                          "Not yet: Add a transfer number first" in strip.inner_text()
                          and strip.get_by_role("button", name="Ask again").count() == 1,
                          strip.inner_text()[:300])
                    fake_backend.USER["status"] = "unassigned"
                    fake_backend.USER["liveDeclined"] = None

                    check("...and nothing went to a demo endpoint",
                          not any("/demo/" in x[1] for x in sent),
                          str([x[1] for x in sent if "/demo/" in x[1]]))

                    # ---- the two styling systems
                    scoped = page.evaluate(
                        """() => {
                          const nav = document.querySelector('nav[aria-label="Receptionist settings"]');
                          const h1 = document.querySelector('header.topbar .topbar-slot h1');
                          return {
                            navInTw: Boolean(nav && nav.closest('.tw')),
                            cards: document.querySelectorAll('main .card').length,
                            barTitle: h1 ? h1.textContent.trim() : null,
                            barInTw: Boolean(h1 && h1.closest('.tw')),
                            rail: document.querySelector('.app').dataset.nav,
                            picker: document.querySelectorAll('header.topbar select').length,
                          };
                        }"""
                    )
                    check("the settings render inside the .tw boundary", scoped["navInTw"] is True)
                    # B2: the business card is folded into the app's top bar, the sidebar is an icon
                    # rail, and the transcribe-only mailbox picker and Refresh are gone from the bar.
                    check("B2: the business card is folded into the top bar (name there, no card on the page)",
                          scoped["cards"] == 0 and bool(scoped["barTitle"]) and scoped["barInTw"], str(scoped))
                    check("B2: the sidebar is an icon rail and the bar has no mailbox picker",
                          scoped["rail"] == "rail" and scoped["picker"] == 0, str(scoped))

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
    print("ALL BUSINESS SETTINGS CHECKS PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
