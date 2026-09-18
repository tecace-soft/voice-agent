// How the assistant behaves before a customer changes anything.
//
// The dashboard used to show "nothing set" on a business that had typed no instructions of their
// own, which reads as "the assistant has no behaviour" — the opposite of the truth. These are the
// standing rules every call already follows, written the way the customer would say them rather
// than the way the prompt says them.
//
// This is a SUMMARY, not the source. The rules themselves live in the agent's own instructions
// (openai-agent-app: realtime/instructions_inbound.py), and a check in that app fails if a line
// here stops matching what the prompt actually tells the agent to do — a list that quietly drifts
// out of date is worse than no list, because a customer reads it and believes it.

export interface BehaviourDefault {
  /** What it does, in one line, from the customer's side of the phone. */
  does: string;
  /** Why, when the reason is not obvious. Omitted where the line speaks for itself. */
  because?: string;
}

export const DEFAULT_BEHAVIOUR: BehaviourDefault[] = [
  {
    does: "Answers as your receptionist, using only the business details you saved",
    because: "It never guesses or fills a gap with something plausible.",
  },
  {
    does: "Asks which you mean when a question has more than one answer",
    because: '"How much is it?" gets a question back, not a guess at which price.',
  },
  {
    does: "Says it doesn't know rather than inventing an answer, and offers a person instead",
  },
  {
    does: "Asks before putting anyone through, and only transfers when they say yes",
  },
  {
    does: "Never says anything is booked, held or confirmed, and never promises what your team will do",
    because: "It cannot see your calendar, so it never implies it can.",
  },
  {
    does: "Takes a message using the number they are calling from",
    because: "It does not ask someone for the number they are already calling you on.",
  },
  {
    does: "Gives your address, hours and prices whenever a caller asks for them",
  },
  {
    does: "Tells callers it is an AI assistant the moment anyone asks",
  },
  {
    does: "Lets the caller finish, and does not rush to end the call",
  },
];
