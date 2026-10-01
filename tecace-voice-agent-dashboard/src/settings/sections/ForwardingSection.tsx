import { useState, type ReactNode } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { displayPhone } from "../callSettings";
import { SectionIntro } from "../SettingsShell";

// How a business points its existing line at the receptionist. Callers keep dialling the number they
// already know; the business's phone forwards to the receptionist's number. Condensed from the usual
// carrier help pages to what our customers need: missed calls or every call, the codes for the big
// carriers with the number filled in, how to undo it, and how to check it works.
//
// Shared by the business settings (admin and the customer) and a demo's settings, where there is no
// number yet and the codes show a placeholder.

type Mode = "missed" | "all";

type Code = { label: string; code: string };

type Carrier = {
  id: string;
  label: string;
  /** Who this row covers, under the tab. */
  covers: string;
  /** Codes to dial, in order; `{n}` is the receptionist's number. Empty: set it up elsewhere. */
  missed: Code[];
  all: Code[];
  off: Code[];
  /** What to do instead of (or as well as) dialling a code. */
  note?: string;
  /** How to turn off answer confirmation ("press 1 to accept") for this kind of line. */
  confirm: string;
};

const MOBILE_CONFIRM =
  "Mobile forwarding passes the call straight on and never asks for a key, so there's nothing to turn off.";

const GSM: Carrier = {
  id: "gsm",
  label: "AT&T, T-Mobile",
  covers: "Also Cricket, Metro, Mint, Consumer Cellular and most other mobile plans.",
  missed: [
    { label: "When you're on another call", code: "**67*{n}#" },
    { label: "When you don't pick up", code: "**61*{n}#" },
    { label: "When your phone is off or has no signal", code: "**62*{n}#" },
  ],
  all: [{ label: "Every call", code: "**21*{n}#" }],
  off: [
    { label: "Turn off every call", code: "##21#" },
    { label: "Turn off all forwarding", code: "##002#" },
  ],
  note: "To change how long your phone rings before the receptionist picks up, dial **61*{n}**20# instead — any of 5, 10, 15, 20, 25 or 30 seconds.",
  confirm: MOBILE_CONFIRM,
};

const CARRIERS: Carrier[] = [
  GSM,
  {
    id: "verizon",
    label: "Verizon",
    covers: "Also US Cellular and other plans on Verizon's network.",
    missed: [
      { label: "When you're on another call", code: "*90{n}" },
      { label: "When you don't pick up", code: "*92{n}" },
    ],
    all: [{ label: "Every call", code: "*72{n}" }],
    off: [{ label: "Turn off all forwarding", code: "*73" }],
    note: "Verizon can't turn off one rule on its own: *73 turns off all of them.",
    confirm: MOBILE_CONFIRM,
  },
  {
    id: "landline",
    label: "Landline",
    covers: "A traditional business line from the phone company.",
    missed: [],
    all: [{ label: "Every call", code: "*72{n}" }],
    off: [{ label: "Turn off all forwarding", code: "*73" }],
    note: "Forwarding only missed calls depends on your plan — ask your phone company to forward when busy or unanswered to your receptionist's number, or look for it in their online account.",
    confirm:
      "Some phone companies play \"This is a forwarded call, press 1 to accept\" before passing the call on. Call your phone company and ask them to turn off answer confirmation (also called call screening or forwarded call announcement) for calls forwarded to {n}. Some let you switch it off yourself in the call forwarding settings of their online account.",
  },
  {
    id: "voip",
    label: "Business phone app",
    covers: "RingCentral, Google Voice, OpenPhone, Grasshopper, Zoom Phone, Dialpad and similar.",
    missed: [],
    all: [],
    off: [],
    note: "These don't use dial codes. In the app's admin settings, open the call handling or forwarding rules for your business number and add your receptionist's number — as the step after your team's phones ring for missed calls, or as the first step for every call.",
    confirm:
      "Open the forwarding rule you added for {n} and turn off any setting that makes the person answering press a key first. It may be called answer confirmation, call screening, announce caller or \"press 1 to accept\". In Google Voice it's Settings › Calls › Screen calls; in RingCentral it's \"Prompt me to press 1 before connecting the call\" on the forwarding number.",
  },
];

const PLACEHOLDER = "[receptionist number]";

function fill(code: string, digits: string) {
  return code.replaceAll("{n}", digits || PLACEHOLDER);
}

export function ForwardingSection({
  agentNumber,
  notice,
}: {
  /** The receptionist's number, once one is assigned; codes show a placeholder until then. */
  agentNumber: string | null;
  /** A line under the number, e.g. why a demo has no number yet. */
  notice?: ReactNode;
}) {
  const [mode, setMode] = useState<Mode>("missed");
  const [carrierId, setCarrierId] = useState("gsm");
  const carrier = CARRIERS.find((c) => c.id === carrierId) ?? GSM;
  const digits = agentNumber?.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") ?? "";
  const codes = mode === "missed" ? carrier.missed : carrier.all;

  return (
    <div className="max-w-3xl">
      <SectionIntro>
        Callers keep dialling the number they already know. Your phone passes the call to your receptionist's
        number, and the receptionist answers as your business. You can turn it off at any time.
      </SectionIntro>

      <div className="bg-primary/5 mb-8 rounded-xl border p-4">
        <p className="ta-caption-1 text-muted-foreground">Forward your calls to</p>
        <p className="ta-headline-1">{agentNumber ? displayPhone(agentNumber) : "Assigned when you go live"}</p>
        {notice ? <p className="ta-caption-1 text-muted-foreground mt-1">{notice}</p> : null}
      </div>

      <Step n={1} title="Choose which calls the receptionist answers">
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Which calls to forward">
          <ModeCard
            selected={mode === "missed"}
            onSelect={() => setMode("missed")}
            title="Missed calls"
            badge="Recommended"
            body="Your phone rings first. When you're busy, don't pick up or have no signal, the receptionist answers."
          />
          <ModeCard
            selected={mode === "all"}
            onSelect={() => setMode("all")}
            title="Every call"
            body="The receptionist answers every call straight away, and puts callers through to you when they need a person."
          />
        </div>
        {mode === "all" ? (
          <p className="ta-caption-1 text-muted-foreground mt-3 flex items-start gap-2">
            <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
            Transfer calls to a different number than the one you forward, such as a mobile — a call transferred to
            the forwarded line comes straight back to the receptionist.
          </p>
        ) : null}
      </Step>

      <Step n={2} title="Dial the code from your business phone">
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Your phone company">
          {CARRIERS.map((c) => (
            <Button
              key={c.id}
              role="tab"
              aria-selected={c.id === carrier.id}
              variant={c.id === carrier.id ? "default" : "outline"}
              size="sm"
              onClick={() => setCarrierId(c.id)}
            >
              {c.label}
            </Button>
          ))}
        </div>
        <p className="ta-caption-1 text-muted-foreground mb-3">{carrier.covers}</p>

        {codes.length ? (
          <>
            <ul className="divide-y rounded-xl border">
              {codes.map((c) => (
                <CodeRow key={c.code} label={c.label} code={fill(c.code, digits)} copyable={Boolean(digits)} />
              ))}
            </ul>
            <p className="ta-caption-1 text-muted-foreground mt-3">
              Dial each code and press call. You'll hear a tone or see a confirmation, then you can hang up.
              {mode === "missed" && codes.length > 1 ? " Each code is its own rule, so dial all of them." : ""}
            </p>
          </>
        ) : null}
        {carrier.note ? (
          <p className={codes.length ? "ta-caption-1 text-muted-foreground mt-3" : "ta-body-2"}>
            {fill(carrier.note, digits)}
          </p>
        ) : null}

        {carrier.off.length ? (
          <details className="mt-4">
            <summary className="ta-label-1 cursor-pointer">Turn forwarding off</summary>
            <ul className="mt-2 divide-y rounded-xl border">
              {carrier.off.map((c) => (
                <CodeRow key={c.code} label={c.label} code={c.code} copyable />
              ))}
            </ul>
          </details>
        ) : null}
      </Step>

      <Step n={3} title="Turn off answer confirmation">
        <p className="ta-body-2">{fill(carrier.confirm, digits)}</p>
        {carrier.confirm !== MOBILE_CONFIRM ? (
          <p className="ta-caption-1 text-muted-foreground mt-3">
            Your receptionist answers by speaking, not by pressing keys. With answer confirmation on, callers wait
            while the receptionist presses 1 for them, and may hear the key tones.
          </p>
        ) : null}
      </Step>

      <Step n={4} title="Check it works" last>
        <ul className="ta-body-2 list-disc space-y-2 pl-5">
          <li>
            From a different phone, call your business number.
            {mode === "missed" ? " Let it ring without answering." : ""}
          </li>
          <li>Your receptionist should answer as your business. Ask it something from your FAQs.</li>
          <li>
            Voicemail answered instead? On an iPhone, turn off Live Voicemail (Settings › Apps › Phone). On
            Android, turn off Call Screen. Otherwise shorten the ring time above, so forwarding happens before
            voicemail.
          </li>
          <li>
            Hear "This is a forwarded call, press 1 to accept" or a beep before the receptionist speaks? Answer
            confirmation is still on — see step 3.
          </li>
          <li>A code didn't take? Codes vary by plan — your phone company can turn forwarding on for you.</li>
        </ul>
      </Step>
    </div>
  );
}

function Step({ n, title, last, children }: { n: number; title: string; last?: boolean; children: ReactNode }) {
  return (
    <section className={`relative pl-10 ${last ? "" : "pb-8"}`}>
      {!last ? <span className="bg-border absolute top-8 bottom-0 left-[13px] w-px" aria-hidden /> : null}
      <span
        className="bg-primary text-primary-foreground ta-caption-1 absolute top-0 left-0 inline-flex size-7 items-center justify-center rounded-full"
        aria-hidden
      >
        {n}
      </span>
      <h3 className="ta-headline-2 mb-3 pt-0.5">{title}</h3>
      {children}
    </section>
  );
}

function ModeCard({
  selected,
  onSelect,
  title,
  badge,
  body,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  badge?: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`rounded-xl border p-4 text-left transition-colors ${
        selected ? "border-primary bg-primary/5" : "hover:bg-muted/40"
      }`}
    >
      <span className="ta-label-1 flex items-center gap-2">
        {title}
        {badge ? <span className="ta-caption-2 text-primary">{badge}</span> : null}
      </span>
      <span className="ta-caption-1 text-muted-foreground mt-1 block">{body}</span>
    </button>
  );
}

function CodeRow({ label, code, copyable }: { label: string; code: string; copyable: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="min-w-0">
        <span className="ta-caption-1 text-muted-foreground block">{label}</span>
        <span className="ta-body-1 font-mono break-all">{code}</span>
      </span>
      {copyable ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Copy ${code}`}
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      ) : null}
    </li>
  );
}
