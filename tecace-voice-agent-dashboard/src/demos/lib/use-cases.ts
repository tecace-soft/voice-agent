/**
 * The menu of things this voice agent can do, as /c/[id]/scenarios shows it.
 *
 * Only two of these are true of the demo itself — it answers the phone, and it
 * answers in the caller's language. The other seven are the pitch: the same
 * system, turned on for a business that asks. Nothing here starts a call or
 * changes a prompt, so the copy must never imply a prospect can dial in and
 * have a booking taken.
 *
 * Pure data and pure functions, like lib/analytics.ts — a client component
 * imports it, so keep node imports out.
 */

export type UseCaseTurn = { speaker: "caller" | "agent"; text: string };

export type UseCase = {
  id: string;
  /** A lucide icon name. The component owns the mapping; this file stays React-free. */
  icon: string;
  title: string;
  /** One line, shown while the item is collapsed. */
  tagline: string;
  /** Two or three sentences, shown once the item is opened. */
  body: string;
  example: UseCaseTurn[];
  /** True when the demo above already does this. */
  live: boolean;
};

export type BusinessNouns = {
  /** "table", "appointment", "pickup", "service visit" */
  booking: string;
  /**
   * The status call this kind of business gets all day, written out whole. A
   * noun slot in a fixed sentence does not survive the jump from a bakery to a
   * dental office ("is my visit ready?"), so each bucket carries its own
   * question and its own sample exchange.
   */
  statusQuestion: string;
  statusAsk: string;
  statusAnswer: string;
  /**
   * The call that turns into money, which is a quote for a plumber, a new
   * patient for a dentist, and a catering order for a bakery. Same use case,
   * so it carries its own title and exchange rather than a swapped noun.
   */
  leadTitle: string;
  leadTagline: string;
  leadAsk: string;
  leadAnswer: string;
};

type Bucket = BusinessNouns & { keywords: string[] };

/**
 * Categories come from research as free text ("Italian Restaurant", "Family
 * Dental Clinic"), so match on substrings rather than an enum. The first bucket
 * that matches wins, which is why the food words sit ahead of the retail ones.
 */
const BUCKETS: Bucket[] = [
  {
    keywords: [
      "restaurant", "cafe", "café", "coffee", "bar", "pub", "pizzeria",
      "bakery", "diner", "grill", "sushi", "bistro", "brewery", "eatery",
    ],
    booking: "table",
    statusQuestion: "is my order ready?",
    statusAsk: "Checking on a pickup order under Reyes.",
    statusAnswer:
      "Found it — boxed and ready since this morning, whenever you want to swing by.",
    leadTitle: "Takes catering and large-party calls",
    leadTagline: "Date, headcount, budget — before they call the next place.",
    leadAsk: "Do you do platters for about thirty people?",
    leadAnswer:
      "We do. Give me the date and the headcount and catering will come back to you today with a quote.",
  },
  {
    keywords: [
      "dentist", "dental", "clinic", "medical", "doctor", "salon", "spa",
      "barber", "vet", "chiropract", "therapy", "therapist", "nail", "optom",
      "physio", "massage", "orthodont",
    ],
    booking: "appointment",
    statusQuestion: "are my results back?",
    statusAsk: "I am calling to see whether my results came back.",
    // It checks and routes; it does not read a chart down the phone.
    statusAnswer:
      "They are in your chart — I can have the front desk call you back this morning to go through them.",
    leadTitle: "Qualifies new patients and books the first visit",
    leadTagline: "Insurance, reason for the visit, first opening.",
    leadAsk: "Do you take Delta Dental, and are you seeing new patients?",
    leadAnswer:
      "We do, and we are. I can put you in Tuesday at nine and note the insurance so the paperwork is ready.",
  },
  {
    keywords: [
      "shop", "store", "retail", "boutique", "grocery", "pharmacy", "florist",
      "hardware", "market", "outfitter", "supply",
    ],
    booking: "pickup",
    statusQuestion: "is my order in?",
    statusAsk: "Did the part I ordered come in?",
    statusAnswer:
      "It landed yesterday — it is at the counter under your name, and we hold it a week.",
    leadTitle: "Checks stock and takes special orders",
    leadTagline: "Answers the have-you-got-it call, then sells it.",
    leadAsk: "Do you have that in a ten, or is it worth driving over?",
    leadAnswer:
      "Not on the shelf, but I can bring one in for you by Friday and hold it. Want me to?",
  },
  {
    keywords: [
      "plumb", "hvac", "electric", "roof", "landscap", "auto", "repair",
      "cleaning", "moving", "contractor", "locksmith", "pest", "garage",
      "detailing", "remodel",
    ],
    booking: "service visit",
    statusQuestion: "how is the job going?",
    statusAsk: "Any update on the work at my place?",
    statusAnswer:
      "The crew is booked for Thursday morning, and I can text you when they are on the way.",
    leadTitle: "Qualifies the job and books the estimate",
    leadTagline: "Scope, address, urgency — captured before you call back.",
    leadAsk: "I need a quote on a water heater replacement.",
    leadAnswer:
      "I can get someone out Thursday morning. What is the address, and is it gas or electric?",
  },
];

const DEFAULT_NOUNS: BusinessNouns = {
  booking: "appointment",
  statusQuestion: "where is my request?",
  statusAsk: "I sent something over last week — any word on it?",
  statusAnswer:
    "I have it here, and I can have someone follow up with you today.",
  leadTitle: "Qualifies the enquiry and books the follow-up",
  leadTagline: "What they want, how soon, and a time in the diary.",
  leadAsk: "Can someone tell me what this would cost?",
  leadAnswer:
    "I can take the details now and have someone come back to you today with a number. What are you after?",
};

/**
 * What this kind of business calls a booking. A business researched without a
 * category still has to read cleanly, so an unknown or missing category lands
 * on the neutral set rather than leaving a hole in the sentence.
 */
export function businessNouns(category?: string): BusinessNouns {
  const haystack = (category ?? "").toLowerCase();
  if (!haystack) return DEFAULT_NOUNS;
  const bucket = BUCKETS.find((candidate) =>
    candidate.keywords.some((keyword) => haystack.includes(keyword)),
  );
  if (!bucket) return DEFAULT_NOUNS;
  return nouns(bucket);
}

/** The bucket without its matching keywords, which are none of a caller's business. */
function nouns(bucket: Bucket): BusinessNouns {
  return {
    booking: bucket.booking,
    statusQuestion: bucket.statusQuestion,
    statusAsk: bucket.statusAsk,
    statusAnswer: bucket.statusAnswer,
    leadTitle: bucket.leadTitle,
    leadTagline: bucket.leadTagline,
    leadAsk: bucket.leadAsk,
    leadAnswer: bucket.leadAnswer,
  };
}

/**
 * How many scenarios the catalog holds, for copy that counts them out loud.
 * A test keeps it honest against buildUseCases().
 */
export const SCENARIO_COUNT = 9;

export type UseCaseOptions = {
  agentName: string;
  businessName: string;
  nouns: BusinessNouns;
};

export function buildUseCases({
  agentName,
  businessName,
  nouns,
}: UseCaseOptions): UseCase[] {
  const {
    booking,
    statusQuestion,
    statusAsk,
    statusAnswer,
    leadTitle,
    leadTagline,
    leadAsk,
    leadAnswer,
  } = nouns;

  return [
    {
      id: "receptionist",
      icon: "phone-call",
      title: "Answers the phone, every time",
      tagline: "Hours, address, services, prices — no hold music.",
      body:
        `${agentName} answers on the first ring and knows what ${businessName} ` +
        "actually does, from the same public research the demo page shows you. " +
        "No phone tree, no queue, no caller hanging up at ring six.",
      example: [
        { speaker: "caller", text: "Hi — are you open on Sunday?" },
        {
          speaker: "agent",
          text: "We are, ten to four on Sundays. Anything I can get ready for you?",
        },
      ],
      live: true,
    },
    {
      id: "multilingual",
      icon: "languages",
      title: "Answers in the caller's language",
      tagline: "Switches mid-sentence and stays there.",
      body:
        "Try it on the demo call. Start in English, switch to Spanish or " +
        "Korean, and the answer comes back in the language you used — same " +
        "receptionist, same knowledge, no separate line to staff.",
      example: [
        { speaker: "caller", text: "¿Hablan español?" },
        { speaker: "agent", text: "Claro que sí. ¿En qué le puedo ayudar hoy?" },
      ],
      live: true,
    },
    {
      id: "reservations",
      icon: "calendar-plus",
      title: `Takes the ${booking}`,
      tagline: `Offers what is open, then writes the ${booking} down.`,
      body:
        `${agentName} checks the calendar while the caller is still on the line, ` +
        "offers the times that are genuinely free, and takes the name and number. " +
        `The ${booking} is in your book before they hang up — including the ones ` +
        "that come in at nine at night.",
      example: [
        {
          speaker: "caller",
          text: "Do you have anything Friday around seven? Four of us.",
        },
        {
          speaker: "agent",
          text: "Seven is full, but I can do 7:45 for four. Want me to hold it?",
        },
        { speaker: "caller", text: "That works." },
        {
          speaker: "agent",
          text: "Done — four at 7:45 Friday. Can I get a name and a mobile number?",
        },
      ],
      live: false,
    },
    {
      id: "confirmations",
      icon: "calendar-check",
      title: "Calls to confirm, so fewer no-shows",
      tagline: "Rings the day before. Confirm, move, or cancel.",
      body:
        `The day before, ${agentName} calls out instead of in. A confirmed ` +
        `${booking} stays put, a moved one is rebooked on the spot, and a ` +
        "cancellation frees the slot early enough for someone else to take it.",
      example: [
        {
          speaker: "agent",
          text: `Hi, this is ${agentName} at ${businessName}, confirming tomorrow at two.`,
        },
        { speaker: "caller", text: "Can we push it to four?" },
        {
          speaker: "agent",
          text: "Four is open — moved. You will get a text with the new time.",
        },
      ],
      live: false,
    },
    {
      id: "voicemail",
      icon: "voicemail",
      title: "Voicemail that types itself",
      tagline: "A message, a transcript, and the reason they called.",
      body:
        "Nobody listens back to eleven messages on Monday morning. " +
        `${agentName} takes the message, writes it down, and sends it over with ` +
        "the callback number and what the call was about — sorted by what needs " +
        "answering first.",
      example: [
        {
          speaker: "caller",
          text: "Just leaving a message — it is about my invoice.",
        },
        {
          speaker: "agent",
          text: "Got it. Best number to reach you, and is a callback tomorrow morning alright?",
        },
      ],
      live: false,
    },
    {
      id: "handoff",
      icon: "phone-forwarded",
      title: "Hands over the calls that need a person",
      tagline: "Transfers, and says what the caller already told it.",
      body:
        `A complaint, an unusual quote, an emergency — ${agentName} stops trying, ` +
        "transfers to whoever is on, and tells them the story first. The caller " +
        "never repeats themselves, and never hits a dead end.",
      example: [
        {
          speaker: "caller",
          text: "This is the third time I have called about this.",
        },
        {
          speaker: "agent",
          text: "That is not good enough — let me put you through to someone now. One moment.",
        },
      ],
      live: false,
    },
    {
      id: "afterhours",
      icon: "moon-star",
      title: "Picks up nights, weekends, and line two",
      tagline: "No busy signal, no machine at seven pm.",
      body:
        `${agentName} takes the calls nobody is free for: the second line while ` +
        "the counter is slammed, the Saturday call, the one at closing time. " +
        "Anything it cannot settle becomes a message waiting for you in the morning.",
      example: [
        {
          speaker: "caller",
          text: "I know you are closed — what time do you open tomorrow?",
        },
        {
          speaker: "agent",
          text: "Eight sharp. Want me to leave a note that you are coming in?",
        },
      ],
      live: false,
    },
    {
      id: "orderstatus",
      icon: "package-search",
      title: `Answers "${statusQuestion}"`,
      tagline: "Looks it up, gives the window, and says what happens next.",
      body:
        `It is the same call all day. ${agentName} finds it by name or number, ` +
        "says when it will be ready, and handles the follow-up that always comes " +
        "after it — without pulling anyone off the floor.",
      example: [
        { speaker: "caller", text: statusAsk },
        { speaker: "agent", text: statusAnswer },
      ],
      live: false,
    },
    {
      id: "quotes",
      icon: "clipboard-list",
      title: leadTitle,
      tagline: leadTagline,
      body:
        `A lead that waits an hour is usually somebody else's. ${agentName} asks ` +
        "what they want, how soon, and what it depends on, books the next step " +
        "while they are still on the line, and has it in your inbox before the " +
        "caller has finished shopping around.",
      example: [
        { speaker: "caller", text: leadAsk },
        { speaker: "agent", text: leadAnswer },
      ],
      live: false,
    },
  ];
}
