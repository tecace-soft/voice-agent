import type { ReactNode } from "react";
import { ExternalLink, MessageSquareText, PhoneForwarded, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MODE_LABEL, linkPreview, type CallSettings } from "../callSettings";
import { LINK_EXAMPLES, TRANSFER_EXAMPLES } from "../examples";

// The console a demo's own customer gets in place of the operator's test call: one example call,
// built from their receptionist's own name, greeting and scenarios (or the stock examples where none
// are set up yet), and the way to call it for real — their demo page, where calls use the demo's
// minutes. The operator's test call is unmetered, which is why the customer doesn't get it here.

type Props = {
  businessName: string;
  agentName: string;
  greetingLine: string | null;
  settings: CallSettings;
  /** The demo page, where the customer can call their receptionist. Without it (the operator's
   * Example call tab, beside a real test call) only the example is shown. */
  demoLink?: string;
  /** The demo is paused or not ready: the page would say it's unavailable. */
  unavailable?: boolean;
};

export function ExampleCallPanel({ businessName, agentName, greetingLine, settings, demoLink, unavailable }: Props) {
  const transfer = settings.transfer.scenarios.find((s) => s.enabled) ?? TRANSFER_EXAMPLES[0]!.scenario();
  const link = settings.links.scenarios.find((l) => l.enabled) ?? LINK_EXAMPLES[0]!.scenario();
  const name = businessName || "your business";
  const agent = agentName || "Tess";
  const url = link.url && link.url !== "https://" ? link.url : "https://maps.google.com/";

  return (
    <div className="flex flex-col gap-4">
      {demoLink ? (
      <div className="bg-muted/40 flex flex-col gap-3 rounded-xl border p-4">
        <p className="ta-label-1">Call your receptionist</p>
        <p className="ta-caption-1 text-muted-foreground">
          Your demo page lets you call it from the browser. Calls there use your demo minutes.
        </p>
        {unavailable ? (
          <p className="ta-caption-1 text-muted-foreground">Your demo line is paused right now. Ask your TecAce contact to switch it back on.</p>
        ) : (
          <Button nativeButton={false} render={<a href={demoLink} target="_blank" rel="noreferrer" />}>
            <ExternalLink className="size-4" />
            Open my demo page
          </Button>
        )}
      </div>
      ) : null}

      <div>
        <p className="ta-label-1 mb-1">An example call</p>
        <p className="ta-caption-1 text-muted-foreground mb-3">
          What your receptionist does with what's set up. Gray notes show what happens behind the scenes.
        </p>
        <ul className="flex flex-col gap-2">
          <Say who="agent">{greetingLine || `Thanks for calling ${name}, this is ${agent}. How can I help?`}</Say>
          <Say who="caller">Hi, where are you located?</Say>
          <Say who="agent">[answers from your business information] Would you like me to text you a link?</Say>
          <Say who="caller">Yes, please.</Say>
          <Note icon={<Smartphone className="size-3.5" />}>
            Texted: "{linkPreview(link.text, url, name)}"
          </Note>
          <Say who="caller">Also, can I talk to someone about my booking?</Say>
          <Say who="agent">Of course. Can I get your name first?</Say>
          <Say who="caller">It's Jordan.</Say>
          <Say who="agent">Thanks, Jordan. Let me put you through. One moment.</Say>
          <Note icon={<PhoneForwarded className="size-3.5" />}>
            {MODE_LABEL[transfer.mode]} transfer to {transfer.name}.{" "}
            {transfer.mode === "cold"
              ? "Their phone rings straight away."
              : `They hear who's calling and why, and press 1 to take the call.`}
          </Note>
          <Note icon={<MessageSquareText className="size-3.5" />}>
            If nobody picks up, {agent} comes back on the line and takes a message for you.
          </Note>
        </ul>
      </div>
    </div>
  );
}

function Say({ who, children }: { who: "agent" | "caller"; children: ReactNode }) {
  return (
    <li
      className={`ta-body-2 max-w-[88%] rounded-2xl px-3 py-2 ${
        who === "agent" ? "bg-muted self-start" : "bg-primary text-primary-foreground self-end"
      }`}
    >
      {children}
    </li>
  );
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="ta-caption-1 text-muted-foreground flex items-start gap-2 border-l-2 py-0.5 pl-3">
      <span className="mt-0.5">{icon}</span>
      <span>{children}</span>
    </li>
  );
}
