import { CalendarCheck, MessageSquareText, PhoneForwarded, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MODE_LABEL } from "../callSettings";
import { ringingNumber, whisper, type PendingTransfer, type SimMessage, type SimText, type TextState } from "./simulate";
import type { SimBooking } from "./useCallSimulator";

// What a simulated call did, as cards: the transfer ringing, the texts on the caller's phone, a
// message taken, a booking made. Shared by the operator's test console (TestCallPanel) and the
// public demo page's call (src/public/PublicCall.tsx) — the same simulation, worded for who is
// watching. The operator plays the phone being rung; a prospect is shown it, and is told plainly
// that on a demo nothing really rings, sends or saves.

export type Audience = "operator" | "prospect";

const DemoTag = () => (
  <span className="ta-caption-2 bg-muted text-muted-foreground ml-auto rounded-full px-2 py-0.5 font-medium">Demo</span>
);

/** A transfer waiting on the phone being rung: answer, decline, or let it ring out. */
export function TransferCard({
  pending,
  businessName,
  onAnswer,
  audience = "operator",
}: {
  pending: PendingTransfer;
  businessName: string;
  onAnswer: (outcome: "accepted" | "declined" | "no_answer") => void;
  audience?: Audience;
}) {
  const heard = whisper(pending, businessName);
  const { scenario } = pending;
  const step = scenario.mode === "waterfall" ? ` (${pending.index + 1} of ${scenario.numbers.length})` : "";

  if (audience === "prospect") {
    return (
      <div className="flex flex-col gap-2.5 rounded-2xl border p-3.5" role="status" aria-live="polite">
        <p className="ta-label-1 flex items-center gap-2 font-semibold!">
          <span className="ta-caption-2 bg-warning/15 text-warning rounded-full px-2 py-0.5">Transfer · {MODE_LABEL[scenario.mode]}</span>
          Ringing {scenario.name}
          {step}
          <DemoTag />
        </p>
        <div className="flex flex-col gap-2.5 rounded-xl bg-[#15171c] p-3.5 text-white">
          <p className="ta-caption-1 text-white/70">
            Incoming on {scenario.name}'s phone, from {businessName || "the business"}'s receptionist
          </p>
          {heard ? <p className="ta-body-2 text-white/90">“{heard}”</p> : <p className="ta-body-2 text-white/90">The caller is put straight through.</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onAnswer("accepted")}
              className="ta-label-1 flex-1 rounded-full bg-[#0abe5c] px-3 py-2 font-semibold! text-white"
            >
              Answer as {scenario.name}
            </button>
            {scenario.mode !== "cold" ? (
              <button
                type="button"
                onClick={() => onAnswer("declined")}
                className="ta-label-1 rounded-full bg-white/15 px-3 py-2 text-white"
              >
                Decline
              </button>
            ) : null}
            <button type="button" onClick={() => onAnswer("no_answer")} className="ta-label-1 rounded-full bg-white/15 px-3 py-2 text-white">
              Let it ring
            </button>
          </div>
        </div>
        <p className="ta-caption-1 text-muted-foreground">
          You're playing {scenario.name}. On a real line their phone rings; if nobody takes it, the receptionist comes back and takes a message.
        </p>
      </div>
    );
  }

  return (
    <div className="border-warning/50 bg-warning/10 rounded-xl border p-3" role="status" aria-live="polite">
      <p className="ta-label-1 text-warning flex items-center gap-2">
        <PhoneForwarded className="size-4" />
        Transferring to {scenario.name} · {MODE_LABEL[scenario.mode]}
      </p>
      <p className="ta-caption-1 text-muted-foreground mt-1">
        Ringing {ringingNumber(pending)}
        {step}. The caller hears hold music.
      </p>
      {heard ? <p className="ta-body-2 mt-2">They hear: “{heard}”</p> : null}
      <p className="ta-caption-1 text-muted-foreground mt-2">You're playing the phone being rung:</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onAnswer("accepted")}>
          {scenario.mode === "cold" ? "Answer" : "Press 1 (take it)"}
        </Button>
        {scenario.mode !== "cold" ? (
          <Button size="sm" variant="outline" onClick={() => onAnswer("declined")}>
            Press 2 (decline)
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => onAnswer("no_answer")}>
          Let it ring out
        </Button>
      </div>
    </div>
  );
}

/** A booking a call made. On the operator's console it is real (a test event in their calendar). */
export function BookingCard({ booking, audience = "operator" }: { booking: SimBooking; audience?: Audience }) {
  const who = [booking.callerName, booking.reason].filter(Boolean).join(" · ") || "No name given";
  if (audience === "prospect") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border p-3.5" role="status">
        <p className="ta-label-1 flex items-center gap-2 font-semibold!">
          <span className="ta-caption-2 bg-success/15 text-success rounded-full px-2 py-0.5">Booking</span>
          {booking.when}
          <DemoTag />
        </p>
        <p className="ta-caption-1 text-muted-foreground">
          {who}. Held on the demo calendar, and not saved anywhere. On a real line it goes into the calendar the business already uses.
        </p>
      </div>
    );
  }
  return (
    <div className="border-primary/30 bg-primary/10 rounded-xl border p-3" role="status">
      <p className="ta-label-1 flex items-center gap-2">
        <CalendarCheck className="size-4" />
        Booked · {booking.when}
      </p>
      <p className="ta-caption-1 text-muted-foreground mt-1">{who} · in your calendar, marked [Test]</p>
    </div>
  );
}

/** The texts a call sent, on the caller's phone, with the replies the caller can send. */
export function TextsPhone({
  texts,
  textState,
  onReply,
  audience = "operator",
}: {
  texts: SimText[];
  textState: TextState;
  onReply: (reply: "YES" | "STOP") => void;
  audience?: Audience;
}) {
  if (!texts.length) return null;
  const prospect = audience === "prospect";
  return (
    <div className={prospect ? "flex flex-col gap-2 rounded-2xl border p-3.5" : "border-t pt-3"} aria-label="Texts">
      <p className={`ta-caption-1 text-muted-foreground mb-2 flex items-center gap-2 ${prospect ? "mb-0" : ""}`}>
        {prospect ? (
          <>
            <span className="ta-caption-2 bg-primary/10 text-primary rounded-full px-2 py-0.5 font-medium">Text a link</span>
            <span className="text-foreground ta-label-1 font-semibold!">Texted to your phone</span>
            <DemoTag />
          </>
        ) : (
          <>
            <Smartphone className="size-4" />
            The caller's phone
          </>
        )}
      </p>
      <ul className={`flex flex-col gap-2 ${prospect ? "bg-muted/50 rounded-xl p-3" : ""}`}>
        {texts.map((text, i) => (
          <li
            key={i}
            className={`ta-body-2 max-w-[85%] rounded-2xl px-3 py-2 break-words ${
              text.from === "business"
                ? prospect
                  ? "bg-background self-start border"
                  : "bg-muted self-start"
                : "bg-primary text-primary-foreground self-end"
            }`}
          >
            {text.text}
          </li>
        ))}
      </ul>
      {!textState.optedOut && (textState.waiting.length > 0 || textState.consented) ? (
        <div className="mt-1 flex gap-2">
          {textState.waiting.length > 0 ? (
            <Button size="sm" onClick={() => onReply("YES")}>
              Reply YES
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => onReply("STOP")}>
            Reply STOP
          </Button>
        </div>
      ) : null}
      {textState.optedOut ? (
        <p className="ta-caption-1 text-muted-foreground mt-2">This number has opted out; it gets no more texts.</p>
      ) : null}
      {prospect ? <p className="ta-caption-1 text-muted-foreground">Shown here for the demo. No text was sent.</p> : null}
    </div>
  );
}

/** A message the receptionist took. */
export function MessageCard({ message, audience = "operator" }: { message: SimMessage; audience?: Audience }) {
  const details = [message.callerName, message.callbackNumber, message.requestedTime].filter(Boolean).join(" · ") || "No name or number given";
  if (audience === "prospect") {
    return (
      <div className="flex flex-col gap-1.5 rounded-2xl border p-3.5" role="status">
        <p className="ta-label-1 flex items-center gap-2 font-semibold!">
          <span className="ta-caption-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5">Message</span>
          Message taken{message.scenario ? ` · ${message.scenario}` : ""}
          <DemoTag />
        </p>
        <p className="ta-body-2">{message.message}</p>
        <p className="ta-caption-1 text-muted-foreground">{details}. Not passed on: on a real line it goes to the business.</p>
      </div>
    );
  }
  return (
    <li className="rounded-xl border p-3">
      <p className="ta-label-1 flex items-center gap-2">
        <MessageSquareText className="size-4" />
        Message taken{message.scenario ? ` · ${message.scenario}` : ""}
      </p>
      <p className="ta-body-2 mt-1">{message.message}</p>
      <p className="ta-caption-1 text-muted-foreground mt-1">{details}</p>
    </li>
  );
}
