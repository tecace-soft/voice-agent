import { Card, CardContent } from "@/components/ui/card";
import { CallWalksAway } from "@/components/public/illustrations";

/**
 * The problem, named without inventing a statistic. Everything here is a
 * thing the owner has watched happen in their own shop, which is stronger
 * than a percentage nobody can source.
 */
export function MissedCalls({ businessName }: { businessName: string }) {
  const moments = [
    "While the counter is three deep and both hands are full.",
    "After you lock up, when the caller is planning tomorrow.",
    "On the second line, while you are already on the first.",
  ];

  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="grid gap-6 p-4 md:grid-cols-[1fr_auto] md:items-center md:gap-8 md:p-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <h2 className="ta-heading-2">
              The call you miss is the one you never hear about
            </h2>
            <p className="ta-body-2-reading text-muted-foreground">
              Hardly anyone leaves a voicemail for a local business. They ring,
              nobody picks up, and they ring the next place on the list. The
              calls that do reach {businessName} are the only ones you can
              count, which is exactly why the missed ones stay invisible.
            </p>
          </div>
          <ul className="space-y-2">
            {moments.map((moment) => (
              <li
                key={moment}
                className="ta-body-2 text-muted-foreground flex items-start gap-2.5"
              >
                <span
                  aria-hidden
                  className="bg-border mt-2 size-1.5 shrink-0 rounded-full"
                />
                {moment}
              </li>
            ))}
          </ul>
        </div>

        <CallWalksAway className="text-foreground/70 mx-auto w-full max-w-64 md:w-64" />
      </CardContent>
    </Card>
  );
}
