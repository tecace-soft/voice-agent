import type { ReactNode } from "react";
import { Lightbulb, MessageSquareText, PhoneForwarded, Smartphone } from "lucide-react";
import {
  DEFAULT_COLLECT_BEFORE,
  DEFAULT_LINK_TEXT,
  MODE_LABEL,
  linkPreview,
  newId,
  type LinkScenario,
  type MessageScenario,
  type TransferScenario,
} from "./callSettings";

// Worked examples for the settings: ready-made scenarios to start from, and short sample calls that
// show what a setting sounds like to a caller. The same examples serve an admin setting a business up
// ("Start from an example" fills the dialog) and a demo's own customer, who can't edit yet and sees
// them as a preview of what their receptionist can do.
//
// The sample numbers are 555-01xx, the range reserved for fiction, so an example can never ring anyone.

export type TransferExample = { key: string; label: string; scenario: () => TransferScenario; sampleNumbers: string[] };
/** `sampleUrl` stands in for the link where an example is only shown, never saved. */
export type LinkExample = { key: string; label: string; scenario: () => LinkScenario; sampleUrl: string };
export type MessageExample = { key: string; label: string; scenario: () => MessageScenario };

const weekdays = (open: string, close: string) =>
  (["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const).map((day) => ({ day, open, close }));

export const TRANSFER_EXAMPLES: TransferExample[] = [
  {
    key: "front-desk",
    label: "Front desk",
    sampleNumbers: ["(206) 555-0134"],
    scenario: () => ({
      id: newId(),
      enabled: true,
      mode: "warm",
      name: "Front desk",
      description: "Booking changes, or anything the receptionist can't answer itself.",
      numbers: [""],
      collectBefore: DEFAULT_COLLECT_BEFORE,
      holdMusic: "classical",
      hours: weekdays("09:00", "17:00"),
    }),
  },
  {
    key: "manager",
    label: "Manager",
    sampleNumbers: ["(206) 555-0161"],
    scenario: () => ({
      id: newId(),
      enabled: true,
      mode: "cold",
      name: "Manager",
      description: "A complaint, a refund, or a caller who asks for the manager.",
      numbers: [""],
      collectBefore: "",
      holdMusic: "classical",
      hours: [],
    }),
  },
  {
    key: "after-hours",
    label: "After-hours emergency",
    sampleNumbers: ["(206) 555-0188", "(206) 555-0189"],
    scenario: () => ({
      id: newId(),
      enabled: true,
      mode: "waterfall",
      name: "After-hours emergency",
      description: "A real emergency after closing: flooding, a lockout, severe pain. Not for routine questions.",
      numbers: ["", ""],
      collectBefore: "The caller's name, where they are, and what happened",
      holdMusic: "soft-rock",
      hours: [],
    }),
  },
];

export const LINK_EXAMPLES: LinkExample[] = [
  {
    key: "directions",
    label: "Directions",
    sampleUrl: "https://maps.google.com/?q=your+business",
    scenario: () => ({
      id: newId(),
      enabled: true,
      triggers: ["directions", "where you are", "parking"],
      text: "[business_name]: Here's how to find us",
      url: "https://maps.google.com/",
    }),
  },
  {
    key: "booking",
    label: "Booking page",
    sampleUrl: "https://your-website.com/book",
    scenario: () => ({
      id: newId(),
      enabled: true,
      triggers: ["book online", "availability", "appointment"],
      text: "[business_name]: Book a time that suits you here",
      url: "https://",
    }),
  },
  {
    key: "menu",
    label: "Menu or price list",
    sampleUrl: "https://your-website.com/prices",
    scenario: () => ({
      id: newId(),
      enabled: true,
      triggers: ["menu", "prices", "price list"],
      text: DEFAULT_LINK_TEXT,
      url: "https://",
    }),
  },
];

export const MESSAGE_EXAMPLES: MessageExample[] = [
  {
    key: "new-customer",
    label: "New customer",
    scenario: () => ({
      id: newId(),
      enabled: true,
      name: "New customer",
      brief: "Ask how they heard about us and what they're hoping to get done, so we can call back ready.",
    }),
  },
  {
    key: "quote",
    label: "Quote request",
    scenario: () => ({
      id: newId(),
      enabled: true,
      name: "Quote request",
      brief: "Ask for the address, what needs doing, and a good time for us to come and look.",
    }),
  },
  {
    key: "complaint",
    label: "Complaint",
    scenario: () => ({
      id: newId(),
      enabled: true,
      name: "Complaint",
      brief: "Stay calm and apologetic. Write down what happened and when, and say the manager will call back today.",
    }),
  },
];

export const GREETING_EXAMPLES = [
  "Thanks for calling {business}, this is {agent}. How can I help?",
  "Hi, you've reached {business}. I'm {agent}, the virtual receptionist. What can I do for you?",
  "Good day, {business}. {agent} speaking. Are you calling to book, or with a question?",
];

export const INSTRUCTION_EXAMPLES = [
  "Mention free parking behind the building when someone asks where we are.",
  "Tell first-time customers to arrive ten minutes early.",
  "Never quote a price for a repair; offer a free estimate instead.",
  "If someone asks about a job opening, take a message for the manager.",
];

/** Buttons that each start a new scenario from an example. */
export function ExamplePicker<T extends { key: string; label: string }>({
  examples,
  onPick,
  label = "Start from an example",
}: {
  examples: T[];
  onPick: (example: T) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="ta-caption-1 text-muted-foreground">{label}:</span>
      {examples.map((example) => (
        <button
          key={example.key}
          type="button"
          onClick={() => onPick(example)}
          className="text-foreground hover:border-primary hover:text-primary rounded-full border border-dashed px-2.5 py-0.5 text-[12px] transition-colors"
        >
          {example.label}
        </button>
      ))}
    </div>
  );
}

type Line = { who: "caller" | "agent" | "note"; text: ReactNode };

/** A few lines of a call, to show what a setting sounds like. */
export function ExampleExchange({
  title = "How it sounds on a call",
  icon,
  lines,
  footnote,
}: {
  title?: string;
  icon?: ReactNode;
  lines: Line[];
  footnote?: ReactNode;
}) {
  return (
    <div className="border-t pt-4">
      <p className="ta-label-1 mb-3 flex items-center gap-2">
        {icon}
        {title}
        <span className="ta-caption-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5">Example</span>
      </p>
      <ul className="flex flex-col gap-2">
        {lines.map((line, i) =>
          line.who === "note" ? (
            <li key={i} className="ta-caption-1 text-muted-foreground border-l-2 pl-3">
              {line.text}
            </li>
          ) : (
            <li
              key={i}
              className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px] leading-5 ${
                line.who === "agent" ? "bg-muted self-start" : "bg-primary text-primary-foreground self-end"
              }`}
            >
              {line.text}
            </li>
          ),
        )}
      </ul>
      {footnote ? <p className="ta-caption-1 text-muted-foreground mt-3">{footnote}</p> : null}
    </div>
  );
}

export function TransferExchange({ businessName, scenario }: { businessName: string; scenario?: TransferScenario }) {
  const name = scenario?.name || "Front desk";
  const mode = scenario?.mode ?? "warm";
  const lines: Line[] = [
    { who: "caller", text: "Hi, can I talk to someone about changing my booking?" },
    ...(mode === "cold"
      ? []
      : ([
          { who: "agent", text: "Of course. Can I get your name first?" },
          { who: "caller", text: "It's Jordan." },
        ] as Line[])),
    { who: "agent", text: `Thanks${mode === "cold" ? "" : ", Jordan"}. Let me put you through. One moment.` },
    {
      who: "note",
      text:
        mode === "cold"
          ? `${name}'s phone rings straight away. If nobody answers, the receptionist takes a message.`
          : `The caller hears hold music. ${name} hears: "${businessName || "Your business"}: Jordan is calling about changing a booking. Press 1 to take the call, or 2 to decline."`,
    },
  ];
  return (
    <ExampleExchange
      icon={<PhoneForwarded className="size-4" />}
      lines={lines}
      footnote={`${MODE_LABEL[mode]} transfer to ${name}. If nobody takes it, the receptionist comes back and takes a message.`}
    />
  );
}

export function LinkExchange({ businessName, link }: { businessName: string; link?: LinkScenario }) {
  const topic = link?.triggers[0] || "directions";
  const url = link?.url && link.url !== "https://" ? link.url : "https://maps.google.com/…";
  return (
    <ExampleExchange
      icon={<Smartphone className="size-4" />}
      lines={[
        { who: "caller", text: `Can you tell me about ${topic}?` },
        { who: "agent", text: "Sure. [answers out loud first] Would you like me to text you the link as well?" },
        { who: "caller", text: "Yes, please." },
        { who: "agent", text: "Done. It's on its way to the number you're calling from." },
        { who: "note", text: `Text: "${linkPreview(link?.text ?? "", url, businessName)}"` },
      ]}
      footnote="Nothing is texted unless the caller says yes. With text consent on, a first-time number is asked to reply YES before the link arrives."
    />
  );
}

export function MessageExchange({ scenario }: { scenario?: MessageScenario }) {
  return (
    <ExampleExchange
      icon={<MessageSquareText className="size-4" />}
      lines={[
        { who: "caller", text: "Is the owner there? I wanted to ask about a quote." },
        { who: "agent", text: "The owner isn't available right now. Can I take a message so they can call you back?" },
        { who: "caller", text: "Sure, it's Sam, about redoing my kitchen floor." },
        {
          who: "agent",
          text: scenario
            ? "Thanks, Sam. [asks what the brief says] I'll pass that on, and someone will get back to you."
            : "Thanks, Sam. I'll pass that on, and someone will get back to you.",
        },
        { who: "note", text: "The message appears under Transcripts with the caller's name, number and reason." },
      ]}
    />
  );
}

/** A short list of dos and don'ts, with an example of each. */
export function Tips({ title = "Tips", items }: { title?: string; items: { good: string; avoid?: string }[] }) {
  return (
    <div className="border-t pt-4">
      <p className="ta-label-1 mb-2 flex items-center gap-2">
        <Lightbulb className="size-4" />
        {title}
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.good} className="ta-caption-1">
            <span className="text-foreground block">Good: {item.good}</span>
            {item.avoid ? <span className="text-muted-foreground block">Avoid: {item.avoid}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
