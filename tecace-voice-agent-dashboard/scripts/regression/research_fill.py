"""Business information › Fill in from research, opened in a browser.

A business re-runs the research a demo gets (its site, FAQ pages and Google listing) instead of
typing its details again. What is checked:

- the card is on Business information, with the business's name and website already filled in;
- Run research POSTs /business/research with what was typed, and SAVES NOTHING by itself;
- what came back is laid over the form: changed fields take the new value, a field the run left
  empty keeps the business's own (the address), and the note says what changed;
- FAQs are added after the business's own, a question it already has is not added twice;
- Undo puts the form back; Save writes the filled-in details through PUT /business/knowledge.

Run (one at a time — these scripts share ports):  python scripts/regression/research_fill.py
Screenshot:  python scripts/regression/research_fill.py --shots <dir>
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import fake_backend  # noqa: E402
from dashboard_overview import APP_PORT, BACKEND_PORT, Checks, build, serve  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402


def main() -> int:
    check = Checks()
    backend = fake_backend.start(BACKEND_PORT)
    try:
        with tempfile.TemporaryDirectory(prefix="research-fill-") as tmp:
            out = Path(tmp) / "app"
            build(out)
            server = serve(out)
            base = f"http://127.0.0.1:{APP_PORT}"
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel="msedge")
                    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
                    ctx.add_init_script("localStorage.setItem('transcribe.token', 'tok-user')")
                    page = ctx.new_page()
                    errors: list[str] = []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    sent: list[tuple[str, str, str]] = []
                    page.on("request", lambda r: sent.append((r.method, r.url, r.post_data or "")))
                    page.goto(f"{base}/#/business/business-info", wait_until="networkidle")
                    page.wait_for_timeout(800)
                    main = page.locator("main")

                    def knowledge_puts():
                        return [s for s in sent if s[0] == "PUT" and "/business/knowledge" in s[1]]

                    category = page.get_by_label("Category", exact=True)
                    address = page.get_by_label("Address", exact=True)
                    category_before, address_before = category.input_value(), address.input_value()

                    check("the Fill in from research card is on Business information",
                          main.get_by_role("heading", name="Fill in from research").count() == 1)
                    page.get_by_role("button", name="Research my business").click()
                    name = page.locator("#research-name")
                    typed_name = name.input_value()
                    check("the business's name is already filled in", typed_name != "", typed_name)
                    page.locator("#research-notes").fill("Second location opened in May.")
                    puts_before = len(knowledge_puts())
                    page.get_by_role("button", name="Run research").click()
                    note = main.get_by_role("status").filter(has_text="Filled in from research")
                    note.wait_for(timeout=5000)

                    research = [s for s in sent if s[0] == "POST" and "/business/research" in s[1]]
                    asked = json.loads(research[-1][2] or "{}") if research else {}
                    check("Run research POSTs /business/research with what was typed",
                          len(research) == 1 and asked.get("notes") == "Second location opened in May."
                          and asked.get("businessName") == typed_name, str(asked))
                    check("...and saves nothing by itself", len(knowledge_puts()) == puts_before)
                    check("a field the run filled takes the new value", category.input_value() == "Family dentist",
                          category.input_value())
                    check("a field the run left empty keeps the business's own", address.input_value() == address_before,
                          f"{address_before!r} -> {address.input_value()!r}")
                    if "--shots" in sys.argv:
                        shots = Path(sys.argv[sys.argv.index("--shots") + 1])
                        page.screenshot(path=str(shots / "research-fill.png"))
                    text = note.inner_text()
                    check("the note says what changed, and how many FAQs were added",
                          "category" in text and "policies" in text and "address" not in text.split("Updated:")[-1].split(".")[0]
                          and "1 new FAQ added" in text, text)

                    page.get_by_role("button", name="Open FAQs").click()
                    page.wait_for_timeout(400)
                    body = main.inner_text()
                    check("FAQs: the new question is added after the business's own, not twice",
                          "2 of 20" in body and page.get_by_label("Question 2", exact=True).input_value() == "Is there parking?",
                          body[:300])
                    page.go_back()
                    page.wait_for_timeout(400)

                    page.get_by_role("button", name="Undo").click()
                    page.wait_for_timeout(300)
                    check("Undo puts the form back", page.get_by_label("Category", exact=True).input_value() == category_before)

                    page.get_by_role("button", name="Research my business").click()
                    page.get_by_role("button", name="Run research").click()
                    note.wait_for(timeout=5000)
                    main.get_by_role("button", name="Save", exact=True).first.click()
                    page.wait_for_timeout(800)
                    puts = knowledge_puts()
                    saved = json.loads(puts[-1][2]).get("profile", {}) if puts else {}
                    check("Save writes the filled-in details through PUT /business/knowledge",
                          saved.get("category") == "Family dentist" and saved.get("address") == address_before,
                          str(saved)[:300])
                    check("...and the note goes once it's saved",
                          main.get_by_role("status").filter(has_text="Filled in from research").count() == 0)
                    check("the inputs fold away once the results are in the form",
                          page.locator("#research-name").count() == 0)
                    check("no page errors", not errors, str(errors))
                    ctx.close()
                    browser.close()
            finally:
                server.terminate()
    finally:
        backend.shutdown()
    if check.failed:
        print(f"{check.failed} CHECK(S) FAILED")
        return 1
    print("ALL RESEARCH FILL CHECKS PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
