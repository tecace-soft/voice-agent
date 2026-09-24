import { ArrowLeft, Phone } from "lucide-react";
import { ContactButtons } from "@/components/public/ContactButtons";
import { ScenarioList } from "@/components/public/ScenarioList";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VersionBadge } from "@/components/VersionBadge";
import { mailtoFor } from "@/lib/links";
import { SCENARIO_COUNT } from "@/lib/use-cases";

/**
 * The promo's `app/c/[id]/scenarios/page.tsx`, as a component.
 *
 * It was a server component that loaded the customer itself and called `notFound()`; here the public
 * entry does the loading for all three pages at once, so this takes what it needs as props. Its own
 * comment held: this page needs no call state and no research, so it asks for less than the demo
 * page does — and that is still true of these four props.
 *
 * `next/link` is a plain anchor: `/c/<id>` is a real document this app serves.
 */
type Props = {
  customerId: string;
  name: string;
  category?: string;
  agentName: string;
  demoUrl: string;
};

export function PublicScenariosScreen({ customerId, name, category, agentName, demoUrl }: Props) {
  const mailto = mailtoFor(name, demoUrl);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-8 px-4 py-8">
      <header className="space-y-4">
        <Button variant="ghost" size="sm" nativeButton={false} render={<a href={`/c/${customerId}`} />}>
          <ArrowLeft className="size-4" />
          Back to the demo
        </Button>
        <div className="space-y-2">
          <h1 className="ta-title-2">What a voice agent can do for {name}</h1>
          <p className="ta-body-2-reading text-muted-foreground">
            The demo answers the phone as {agentName}. That is one job out of {SCENARIO_COUNT}.
            Everything here runs on the same voice agent and the same knowledge about {name} — what
            changes is how much of the work it is allowed to finish.
          </p>
        </div>
      </header>

      <ScenarioList agentName={agentName} businessName={name} category={category} />

      <Card className="border-primary/30 bg-primary/5 rounded-xl border shadow-none">
        <CardContent className="space-y-3 p-4 text-center md:p-6">
          <p className="ta-headline-2">Which of these would you want first?</p>
          <p className="ta-body-2-reading text-muted-foreground">
            Tell us and we will set it up on your real number, with your hours and your booking
            rules. Or go back and hear the receptionist again.
          </p>
          <div className="flex flex-col items-center gap-3">
            <ContactButtons mailto={mailto} customerId={customerId} className="justify-center" />
            <Button variant="ghost" nativeButton={false} render={<a href={`/c/${customerId}`} />}>
              <Phone className="size-4" />
              Back to the demo
            </Button>
          </div>
        </CardContent>
      </Card>

      <footer className="flex flex-col items-center gap-1 pb-4">
        <p className="ta-caption-1 text-muted-foreground text-center">
          A TecAce demo. The business shown here has not endorsed it.
        </p>
        <VersionBadge />
      </footer>
    </main>
  );
}
