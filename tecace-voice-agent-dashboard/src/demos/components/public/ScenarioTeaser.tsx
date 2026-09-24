import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScenarioStack } from "@/components/public/illustrations";
import { businessNouns } from "@/lib/use-cases";

/**
 * The doorway to /c/[id]/scenarios. It names four of the nine in the reader's
 * own vocabulary — a bakery is offered a table, a dentist an appointment — so
 * the click is an informed one rather than a leap. The detail stays on the
 * other page; this is the trailer, not the film.
 */
export function ScenarioTeaser({
  customerId,
  category,
  count,
}: {
  customerId: string;
  category?: string;
  count: number;
}) {
  const { booking } = businessNouns(category);
  const named = [
    `Takes the ${booking}`,
    "Rings back to confirm it",
    "Writes up the voicemail",
    "Hands you the calls that need a person",
  ];

  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="grid gap-5 p-4 md:grid-cols-[auto_1fr] md:items-start md:gap-7 md:p-6">
        <ScenarioStack className="text-foreground/70 w-32 shrink-0 max-md:hidden" />

        <div className="space-y-4">
          <div className="space-y-2">
            <h2 className="ta-heading-2">
              Answering the phone is the smallest thing it does
            </h2>
            <p className="ta-body-2-reading text-muted-foreground">
              The same voice agent, with the rest of its work turned on. None of
              it is switched on for this demo — it is what the line looks like
              once it is yours.
            </p>
          </div>

          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {named.map((item) => (
              <li key={item} className="ta-body-2 flex items-start gap-2.5">
                <span
                  aria-hidden
                  className="bg-primary/60 mt-2 size-1.5 shrink-0 rounded-full"
                />
                {item}
              </li>
            ))}
          </ul>

          <Button
            nativeButton={false}
            render={<a href={`/c/${customerId}/scenarios`} />}
          >
            See all {count}, with sample calls
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
