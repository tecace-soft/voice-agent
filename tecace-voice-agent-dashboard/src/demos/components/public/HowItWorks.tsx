import { Card, CardContent } from "@/components/ui/card";
import {
  StepAnswers,
  StepRings,
  StepWritesItDown,
} from "@/components/public/illustrations";

/**
 * The three steps, strung on one line rather than dealt as three cards —
 * the order is the information here, so the drawing carries it.
 *
 * Step three has to stay honest: this demo hands back a transcript, not a
 * booking, and the copy says so before it says what booking would look like.
 */
export function HowItWorks({
  agentName,
  businessName,
}: {
  agentName: string;
  businessName: string;
}) {
  const steps = [
    {
      Art: StepRings,
      title: "Your phone rings",
      body: `At noon, at nine at night, or on the second line while you are already serving someone. ${agentName} picks up on the first ring, every time.`,
    },
    {
      Art: StepAnswers,
      title: "It answers as your business",
      body: `Your hours, your prices, your parking, your policies — the answers you would have given, because they come from ${businessName}'s own information.`,
    },
    {
      Art: StepWritesItDown,
      title: "You get it in writing",
      body: "In this demo that is the transcript below. With booking switched on, the reservation or the message lands where you already look, already written down.",
    },
  ];

  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="space-y-6 p-4 md:p-6">
        <div className="space-y-1">
          <h2 className="ta-heading-2">What happens when someone calls</h2>
          <p className="ta-caption-1 text-muted-foreground">
            No phone tree, no “press one for hours”. The caller just talks.
          </p>
        </div>

        {/*
          The rule is drawn per step and suppressed on the last one, so the
          line stops at the third node instead of running off the card. Its
          offsets track the node box: half of size-16 on the stack, half of
          size-20 once the steps sit in a row.
        */}
        <ol className="grid gap-6 md:grid-cols-3 md:gap-8">
          {steps.map(({ Art, title, body }, index) => (
            <li
              key={title}
              className={`relative flex items-start gap-4 md:flex-col md:gap-3 ${
                index === steps.length - 1
                  ? ""
                  : "after:bg-border after:absolute after:top-16 after:-bottom-6 after:left-8 after:w-px md:after:top-10 md:after:-right-8 md:after:bottom-auto md:after:left-20 md:after:h-px md:after:w-auto"
              }`}
            >
              <span className="bg-card relative z-10 flex size-16 shrink-0 items-center justify-center rounded-xl border md:size-20">
                <Art className="size-11 md:size-14" />
              </span>
              <div className="space-y-1 md:pr-2">
                <h3 className="ta-headline-2 text-balance">{title}</h3>
                <p className="ta-body-2-reading text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
