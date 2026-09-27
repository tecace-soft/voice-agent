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
    "Business information", "Agent profile", "FAQs", "Take a message", "Appointments",
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
                          page.get_by_label("Question", exact=True).count() == 0)

                    page.get_by_label("Phone", exact=True).first.fill("+1 207 555 0199")
                    page.get_by_role("button", name="Save", exact=True).first.click()
                    page.wait_for_timeout(900)
                    saves = requests("/business/knowledge")
                    check("Business information: Save PUTs /business/knowledge", len(saves) == 1, str(saves)[:200])
                    if saves:
                        payload = json.loads(saves[0][2] or "{}")
                        check("...carrying the whole profile, with the edit in it",
                              payload.get("profile", {}).get("phone") == "+1 207 555 0199"
                              and payload["profile"].get("name") == "Sam's Dental", str(payload)[:200])

                    check("Business information: says it saved",
                          "Saved. This is what the assistant now uses." in page.inner_text("main"))

                    # ---- FAQs, and the section is in the URL
                    open_section("FAQs")
                    check("FAQs: the section is in the address bar", page.url.endswith("#/business/faqs"), page.url)
                    check("FAQs: the caller question is there",
                          page.get_by_label("Question", exact=True).count() == 1)
                    # An edit left unsaved here must survive another section's save.
                    page.get_by_label("Answer", exact=True).first.fill("Yes — call us to book your first visit.")

                    # ---- Agent profile: identity, then voice and language with the prompts
                    open_section("Agent profile")
                    check("Agent profile: the receptionist name is editable",
                          page.get_by_label("Receptionist name", exact=True).count() == 1)
                    check("Agent profile: no call-sound controls — a real call is already a phone call",
                          "Call sound" not in page.inner_text("body"))
                    page.get_by_label("Receptionist name", exact=True).fill("Alex")
                    page.get_by_label("Greeting", exact=True).fill("Thanks for calling {business}, this is {agent}.")
                    check("Agent profile: shows what callers hear, placeholders filled",
                          "Thanks for calling Sam's Dental, this is Alex." in page.inner_text("body"))
                    page.get_by_role("button", name="Save", exact=True).first.click()
                    page.wait_for_timeout(900)
                    identity = requests("/business/identity")
                    check("Agent profile: Save PUTs /business/identity with the name",
                          bool(identity) and json.loads(identity[0][2]).get("agentName") == "Alex",
                          str(identity)[:200])
                    prompts = requests("/business/prompts")
                    check("...then /business/prompts with the voice",
                          bool(prompts) and json.loads(prompts[-1][2]).get("voice") == "gleam",
                          str(prompts)[:200])
                    check("Agent profile: says it saved",
                          "Saved. This is what the assistant now uses." in page.inner_text("main"))
                    open_section("FAQs")
                    check("FAQs: the unsaved answer survived saving another section",
                          page.get_by_label("Answer", exact=True).first.input_value()
                          == "Yes — call us to book your first visit.")
                    page.get_by_role("button", name="Save", exact=True).first.click()
                    page.wait_for_timeout(900)
                    faq_saves = requests("/business/knowledge")
                    if len(faq_saves) >= 2:
                        faq_body = json.loads(faq_saves[-1][2] or "{}").get("profile", {})
                        check("FAQs: Save sends the new answer",
                              faq_body.get("faqs", [{}])[0].get("a") == "Yes — call us to book your first visit.",
                              str(faq_body.get("faqs"))[:200])
                    else:
                        check("FAQs: Save sends the new answer", False, str(faq_saves)[:200])

                    # ---- Transfer calls: draft, a refusal under its field, publish
                    open_section("Transfer calls")
                    body = page.inner_text("main")
                    check("Transfers: the three kinds are explained",
                          all(w in body for w in ("Cold", "Warm", "Waterfall")))
                    check("Transfers: the number warm transfers come from is shown", "(425) 555-0100" in body)
                    check("Transfers: the old single transfer number is explained",
                          "before transfer scenarios existed" in body)
                    check("Transfers: nothing to publish yet",
                          page.get_by_role("button", name="Publish").is_disabled())
                    page.get_by_role("button", name="Add a transfer").first.click()
                    page.wait_for_timeout(300)
                    dialog = page.get_by_role("dialog")
                    dialog.get_by_label("Name", exact=True).fill("Billing")
                    dialog.get_by_label("Number", exact=True).fill("(425) 555-0100")
                    dialog.get_by_role("button", name="Save", exact=True).click()
                    page.wait_for_timeout(700)
                    check("Transfers: the backend's refusal shows in the dialog",
                          "ring itself" in dialog.inner_text(), dialog.inner_text()[:300])
                    dialog.get_by_label("Number", exact=True).fill("(206) 555-0134")
                    dialog.get_by_role("button", name="Save", exact=True).click()
                    page.wait_for_timeout(900)
                    drafts = requests("/business/call-settings")
                    check("Transfers: Save PUTs the draft", len(drafts) == 2, str(drafts)[:200])
                    check("Transfers: the new transfer is listed", "Billing" in page.inner_text("main"))
                    publish = page.get_by_role("button", name="Publish")
                    check("Transfers: Publish is offered once there is a change", publish.is_enabled())
                    publish.click()
                    page.wait_for_timeout(700)
                    check("Transfers: Publish POSTs publish",
                          len(requests("/call-settings/publish", "POST")) == 1)
                    check("...and then has nothing left to publish",
                          page.get_by_role("button", name="Publish").is_disabled())

                    # ---- Text a link
                    open_section("Text a link")
                    body = page.inner_text("main")
                    check("Text a link: the empty state says what to do", "No link scenarios yet" in body)
                    check("Text a link: the consent text is previewed", "Reply YES" in body and "STOP" in body)

                    # ---- Custom training: instructions, and the prompts behind Advanced
                    open_section("Custom training")
                    check("Custom training: your own instructions are editable",
                          page.get_by_label("Your own instructions", exact=True).count() == 1)
                    page.get_by_role("button", name="Advanced: prompts").click()
                    page.wait_for_timeout(300)
                    for label in ("Voice prompt", "Backend prompt"):
                        check(f"Custom training: the {label} box is there",
                              page.get_by_label(label, exact=True).count() == 1)
                    page.get_by_role("button", name="Show").click()
                    page.wait_for_timeout(700)
                    check("Custom training: the preview reads the composed session",
                          any("/business/session-preview" in x[1] for x in sent)
                          and "composed voice prompt" in page.inner_text("main"))

                    # ---- Test & improve: the test call, the allowance, and the calls already made
                    open_section("Test & improve")
                    body = page.inner_text("main")
                    check("Test: this month's allowance is shown", "1:15 of 30:00 test minutes used" in body, body[:300])
                    check("Test: the call panel is there", page.get_by_role("button", name="Call").count() >= 1
                          or "Call to hear how the receptionist answers." in body)
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
                    page.get_by_role("radio", name="Every call").click()
                    page.get_by_role("tab", name="Verizon").click()
                    body = page.inner_text("main")
                    check("Forwarding: every call on Verizon", "*724255550100" in body, body[:400])

                    check("...and nothing went to a demo endpoint",
                          not any("/demo/" in x[1] for x in sent),
                          str([x[1] for x in sent if "/demo/" in x[1]]))

                    # ---- the two styling systems
                    scoped = page.evaluate(
                        """() => {
                          const nav = document.querySelector('nav[aria-label="Receptionist settings"]');
                          const card = document.querySelector('.card');
                          return {
                            navInTw: Boolean(nav && nav.closest('.tw')),
                            cardOutsideTw: Boolean(card) && !card.closest('.tw'),
                          };
                        }"""
                    )
                    check("the settings render inside the .tw boundary", scoped["navInTw"] is True)
                    check("...and the page's own cards stay outside it", scoped["cardOutsideTw"] is True)

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
