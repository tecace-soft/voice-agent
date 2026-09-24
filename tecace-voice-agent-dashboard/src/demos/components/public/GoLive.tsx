import { ContactButtons } from "@/components/public/ContactButtons";
import { Card, CardContent } from "@/components/ui/card";
import { KeepYourNumber } from "@/components/public/illustrations";

/**
 * The switching cost, answered before it is asked. No price here — that is the
 * pricing page's job (components/public/Pricing.tsx) — so this section sells
 * the absence of upheaval: same number, same habits, knowledge already gathered.
 */
export function GoLive({
  agentName,
  businessName,
  mailto,
}: {
  agentName: string;
  businessName: string;
  mailto: string;
}) {
  const points = [
    {
      title: "Your number stays your number",
      body: "The number on your door, your van and your Google listing does not change. Calls forward to the agent when you want them to — all day, after hours, or only when your line is busy.",
    },
    {
      title: "Nothing for your staff to learn",
      body: "No app to install, no handset to buy, no training morning. Messages and bookings arrive where you already look.",
    },
    {
      title: "The knowledge is already gathered",
      body: `Everything ${agentName} knows about ${businessName} was researched before you opened this page. You can read it below and tell us what to correct — that is the whole setup.`,
    },
  ];

  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-8">
          <div className="space-y-2">
            <h2 className="ta-heading-2">What it takes to switch it on</h2>
            <p className="ta-body-2-reading text-muted-foreground">
              Less than you are bracing for. There is no new phone system to buy
              and nothing to rip out.
            </p>
          </div>
          <KeepYourNumber className="text-foreground/70 w-full max-w-56 shrink-0 md:w-48" />
        </div>

        <dl className="grid gap-5 md:grid-cols-3 md:gap-6">
          {points.map(({ title, body }) => (
            <div key={title} className="space-y-1">
              <dt className="ta-headline-2">{title}</dt>
              <dd className="ta-body-2-reading text-muted-foreground">{body}</dd>
            </div>
          ))}
        </dl>

        <ContactButtons mailto={mailto} />
      </CardContent>
    </Card>
  );
}
