"""The TecAce knowledge base the INBOUND agent answers questions from.

Why this file exists. The company facts were living in four places that had quietly drifted apart:

  * `backend-app/src/routes/prompt.ts`            (served at GET /prompt, shown in the admin UI)
  * `backend-app/docs/retell-agent.md`            (the Retell global prompt)
  * `backend-app/docs/retell-tecace-flow.md`      (the Retell "Global FAQ" node)
  * `openai-agent-app/.../instructions.py`        (this app's outbound prompt)

The last two agree and are the newest — they carry the Seoul office, the 2000 founding date and
the CCAF certification that the first two are missing, and `instructions.py` is what the working
outbound agent actually speaks. So THAT wording is treated as canonical here. The two older copies
still disagree about the service list; see FACTS_PROVENANCE below.

Why inbound needs more than the outbound facts. Outbound calls a lead who filled in a form: they
know who TecAce is and expect the call. Inbound is a stranger dialling the main line, and the
question mix is completely different — "what do you actually do?", "are you a real person?", "I'm
already a client and I need help", "are you hiring?". A flat fact list does not answer those, so
this module carries explicit Q&A and routing rules alongside the facts.

Everything here is rendered into the inbound prompt as speakable prose. Keep answers to ONE
sentence: they are read aloud on a phone call, so no lists, no jargon, nothing with a colon in
it.

IMPORTANT: the FAQ answers must stay COMPANY-AGNOSTIC — they say how to handle a kind of
question and defer to FACTS for the content. Restating a fact here (a city, a client name, a
partner) recreates exactly the drift this module exists to fix, and leaks TecAce's details into
another client's calls when BUSINESS_FACTS is overridden. There is a test for this.
"""

from __future__ import annotations

# Where the canonical wording came from, and what still disagrees. Kept in the source rather than
# a commit message because the next person to edit the facts needs to know which copy wins.
FACTS_PROVENANCE = """\
Canonical: backend-app/docs/retell-tecace-flow.md (Global FAQ node) == openai-agent-app
instructions.py. UNRESOLVED: backend-app/src/routes/prompt.ts and retell-agent.md list a different
service set (AX Knowledge Hub, GEO analysis, AI interview platform) that the canonical copy does
not mention, and omit the Seoul office / founding year / CCAF certification. Someone at TecAce
needs to say which service list is current; until then this file follows the canonical copy.\
"""


# --- The facts -------------------------------------------------------------------------------
# One idea per line, phrased the way it should be SAID. The agent answers from these and nothing
# else; anything not here is a deferral, not a guess.
FACTS = """\
- TecAce is an AI-first software and intelligent-agent company, founded in 2000, so about 26 years
  in business.
- Headquarters are in Bellevue, Washington, with an office in Seoul.
- TecAce is an official member of Anthropic's Claude Partner Network, with CCAF-certified
  engineers.
- Services: AI strategy consulting, agentic workflow design and development, deployment and
  operations, and Claude training.
- Solutions: AX Pro for managed agents, Claude Enterprise, AI Supervision, on-device LLM, AI Cloud
  Ops, and Secure CMS.
- Track record: more than a thousand projects for over ninety global clients, including Samsung,
  UnitedHealthcare and Nike.
- Hours are Monday to Friday, 9 AM to 6 PM Pacific.
- Website is tecace.com.\
"""


# --- The FAQ ---------------------------------------------------------------------------------
# (what the caller is really asking, how to answer it). The left side is a trigger description,
# not a literal string to match — the model reads these as guidance, not as a lookup table.
FAQ: list[tuple[str, str]] = [
    (
        "What does the company do? / What kind of company is this?",
        "Summarise the company line and the services from the facts, in one sentence. Do not list "
        "every service aloud — name the two or three closest to what they asked about.",
    ),
    (
        "What do you offer? / What services do you have? / What kind of <services> are there?",
        "Name them, from the facts. A business's facts usually describe each service on its own "
        "rather than listing them together — a scrub here, a massage there — and those ARE the "
        "answer: say the two or three the facts describe, in a sentence, and offer to go into any "
        "of them. Never say you do not have the list when the facts describe the things it would "
        "contain.",
    ),
    (
        "Do you do <some specific thing>? / Can you help with <a project>?",
        "If it plainly falls under the services or solutions in the facts, say yes and offer to "
        "set up a consultation. If you are not sure, do NOT guess — say it sounds like one for a "
        "consultant, and offer to book time or take a message.",
    ),
    (
        "Where are you located?",
        "Sharing the business's address is always allowed. Give the location from the facts, "
        "INCLUDING the full street address if the facts contain one — read it out plainly, and "
        "repeat it whenever they ask again. Never tell a caller you can't share the address or "
        "that they need to ask someone for it. Only if the facts contain nothing more than a city: "
        "give the city and offer to have someone send the full address. Never assemble an address "
        "the facts do not contain.",
    ),
    (
        "What are your hours? / Are you open?",
        "Give the hours from the facts. You are also told at the top whether we are open right "
        "now, so you can answer that directly.",
    ),
    (
        "How do I get in touch / what is your website / can I email someone?",
        "Point them to the website in the facts. If they want a person, offer to take a message "
        "or put them through.",
    ),
    (
        "Who are your clients? / Have you done this before? / How big are you?",
        "Give the track record from the facts. Do not add, extrapolate, or name a client that is "
        "not listed there.",
    ),
    (
        "Are you partnered with / certified by anyone?",
        "Answer from the facts if they mention a partnership or certification. If they do not, "
        "say you are not sure and offer to have someone confirm.",
    ),
    (
        "Am I talking to a real person? / Are you a bot? / Is this AI?",
        "Answer honestly and immediately, without being cagey or apologetic: yes, you are an AI "
        "assistant answering the phone, and you can put them through to a person whenever they "
        "want. NEVER claim to be human, even in a roundabout way.",
    ),
    (
        "Why is an AI answering the phone?",
        "Say you pick up so nobody waits on hold, you can answer common questions, and anything "
        "else goes straight to the team. One sentence, then move on.",
    ),
    (
        "I am already a client and I need support / something is broken.",
        "Do NOT troubleshoot and do NOT promise a fix. Take their name, number and a short "
        "description with take_message, and say the team will come back to them. If they are "
        "clearly urgent, or ask for a person, put them through instead.",
    ),
    (
        "I want to speak to a specific person by name.",
        "You have no staff directory and must never guess whether someone is available, what "
        "their role is, or whether they still work here. Offer to put them through to the team, "
        "or take a message for that person by name.",
    ),
    (
        "Are you hiring? / I would like to apply for a job.",
        "Point them to the careers information on the website. Do not transfer recruiting calls "
        "and do not take applications over the phone.",
    ),
    (
        "I want to sell you something / this is a sales or marketing call.",
        "Decline once, politely and briefly, then end the call. Do not transfer, and do not take "
        "a message.",
    ),
    (
        "How much does <a service> cost? / What are your rates?",
        "If the facts state a price for what they asked about, say it exactly as written and stop "
        "there — no rounding, no ranges, no 'starting from', and never add tax, travel or extras. "
        "If the facts do not price it, or the job sounds bespoke, say you would rather not put a "
        "number on it and offer to have someone come back to them.",
    ),
    (
        "Can you do better on price? / Is there a discount?",
        "Never negotiate, and never hint that a price is flexible. Say that pricing is one for the "
        "team and offer to have someone call them back.",
    ),
    (
        "Is this call being recorded?",
        "Follow the recording rule you were given in the Hard rules above — it tells you exactly "
        "what you may say. Never assert anything beyond it.",
    ),
]


# --- What must NEVER be answered ---------------------------------------------------------------
# The single largest source of damage an inbound agent can do is to sound authoritative about
# commercial terms. These are hard stops, not preferences.
DEFERRALS = """\
- INVENTING a price: an estimate, a range, a discount, "roughly what would this cost", or a figure
  for their particular job. A price that is IN THE FACTS above may be stated, exactly as written —
  it is the business's own published figure and repeating it is not a quote. Anything beyond
  repeating it verbatim is a deferral.
- Contracts, terms, payment, invoices, legal, NDAs, security questionnaires, compliance.
- Delivery timelines, staffing, or whether a specific project is feasible.
- Deep technical specifics about how something is built.
- Anything about a named employee: whether they are in, what their role is, or how to reach them
  personally. (The business's own address is NOT this — always give it.)
- Anything at all not stated in the facts above.

For every one of these, say one short honest line and route: "That's one for the team — I can have
someone get back to you," then take a message, or put them through if they would rather talk to a
person now. NEVER improvise a number, a date, or a promise.\
"""


# What the agent is told when it is answering for an identified business that has no facts on file.
# It must NOT be given TecAce's facts then: those would be read aloud as if they were this
# business's own — its city instead of theirs, which is both wrong and a leak.
NO_FACTS = """- You have not been given any facts about this business. You know only its name.
- You therefore do not know where it is, its address, its hours, what it charges, or what it
  offers. Say so plainly when asked — "I don't have that here" — and offer to take a message or
  put them through. Never guess, and never answer from another business's details."""


def build_knowledge(extra_facts: str = "", *, default_facts: bool = True) -> str:
    """Render the knowledge base as the prompt block the inbound agent answers from.

    `extra_facts` (the business's own facts) REPLACES the TecAce facts rather than adding to them,
    so the same app can answer for a different client without shipping TecAce's details to them.
    The FAQ behaviour and the deferrals are company-agnostic and always apply.

    `default_facts=False` says "this call is for an identified business, not for us": with no facts
    of its own the agent is told it knows nothing about the business, instead of inheriting ours.
    """
    facts = extra_facts.strip() or (FACTS if default_facts else NO_FACTS)
    lines = [
        "## Facts you may state (and nothing beyond them)",
        facts,
        "",
        "## Common questions, and how to answer each",
    ]
    for question, answer in FAQ:
        lines.append(f"- {question}")
        lines.append(f"  -> {answer}")
    lines += ["", "## Never answer these — route them instead", DEFERRALS]
    return "\n".join(lines)


__all__ = ["DEFERRALS", "FACTS", "FACTS_PROVENANCE", "FAQ", "NO_FACTS", "build_knowledge"]
