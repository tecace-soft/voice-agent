import { ArrowLeft, ArrowUpRight, Check, Gift } from "lucide-react";
import { ContactButtons } from "@/components/public/ContactButtons";
import { Logo } from "@/components/public/Logo";
import { PlanEstimator } from "@/components/public/PlanEstimator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VersionBadge } from "@/components/VersionBadge";
import { CONTACT_URL } from "@/lib/links";
import {
  PLANS,
  TRIAL_DAYS,
  callsFor,
  formatDollars,
  formatRate,
  type Plan,
} from "@/lib/pricing";

type Props = {
  mailto: string;
  /** Set when the page was opened from a demo: gives it a way back. */
  demo?: { id: string; businessName: string; agentName: string };
};

const TRIAL_WEEKS = TRIAL_DAYS / 7;

// The same on every plan. Plans differ by minutes, not by what the agent does.
const INCLUDED = [
  {
    title: "Every call answered",
    body: "Days, nights, weekends, and the second line while you are on the first.",
  },
  {
    title: "Your number stays your number",
    body: "Calls forward to the agent when you want them to. Nothing on your door or your listing changes.",
  },
  {
    title: "Built from your business",
    body: "Hours, services, prices and policies are researched for you, and yours to correct.",
  },
  {
    title: "The caller's language",
    body: "It follows the caller into the language they start speaking.",
  },
  {
    title: "Set up by us",
    body: "No app to install, no handset to buy, and nothing for your staff to learn.",
  },
  {
    title: "A dashboard of your calls",
    body: "Every call transcribed, with how many came in, when, and what people asked — so you can check the agent's work.",
  },
];

// The one place a bill can differ from the plan price, so it is said outright.
const CONNECTIONS = [
  {
    title: "Schedule connections",
    price: "Mostly free",
    body: "Bookings land in the calendar or booking tool you already run — Google Calendar, Outlook, Calendly, Square and the like. Most connect at no extra charge, and we tell you before you start if yours is not one of them.",
  },
  {
    title: "Custom connections",
    price: "Quoted separately",
    body: "A system of your own, an industry tool we have not connected before, or a workflow built around how you work. We scope it, quote it once, and bill it apart from your plan.",
  },
];

const BILLING = [
  {
    title: "Minutes are time on the phone",
    body: "A minute is a minute the agent spends talking with a caller. Setup, changes to what it knows, and calls nobody makes cost nothing.",
  },
  {
    title: "A busy month never cuts you off",
    body: "Past the included minutes the agent keeps answering, and the extra ones are billed at your plan's per-minute rate. Bigger plans pay less for them.",
  },
  {
    title: `${TRIAL_WEEKS} weeks before the first bill`,
    body: "New customers run the agent on real calls first. You see how many minutes your phone actually uses before you choose a plan.",
  },
];

function faqs(): { q: string; a: string }[] {
  // Destructured with a fallback under `noUncheckedIndexedAccess`, which types an indexed read as
  // possibly undefined however long the array literally is. Behaviour is unchanged: PLANS has three
  // entries, written just above, and an empty PLANS would have thrown here before instead of
  // rendering a sentence with "undefined" in it.
  const [solo, standard] = PLANS;
  if (!solo || !standard) return [];
  return [
    {
      q: "What happens if I go over my minutes?",
      a: `Nothing breaks. The agent keeps answering and the extra minutes are added to that month's bill at your plan's rate — ${PLANS.map(
        (p) => `${formatRate(p.overagePerMinute)} on ${p.name}`,
      ).join(", ")}.`,
    },
    {
      q: "How do I know which plan I need?",
      a: `Count the calls you get in a month and double it: a typical call runs about two minutes, so ${solo.includedMinutes} minutes is about ${callsFor(
        solo.includedMinutes,
      )} calls. If you are regularly over, the next plan up is cheaper than the overage — ${solo.name} passes the price of ${standard.name} at 750 minutes. The free ${TRIAL_WEEKS} weeks give you your real number.`,
    },
    {
      q: `How does the ${TRIAL_WEEKS}-week free trial work?`,
      a: `It is a launch offer for new customers, on any plan, for a limited time. We set the agent up on your line, it takes real calls for ${TRIAL_DAYS} days, and you decide after that.`,
    },
    {
      q: "Do I have to change my phone number or my phone system?",
      a: "No. Your number forwards to the agent — all day, after hours, or only when your line is busy. There is no new hardware and nothing to rip out.",
    },
    {
      q: "Is the demo I tried the same thing I would be paying for?",
      a: "It is the same agent with the same knowledge. The demo only talks; on your line it is connected to your number, your hours and your booking rules, which is what setup is.",
    },
    {
      q: "Does connecting my calendar cost extra?",
      a: "Usually not. Most calendars and booking tools connect at no extra charge. A custom connection — a system of your own, or a tool we have not connected before — is scoped and quoted separately, on any plan, and never appears on a bill you did not agree to first.",
    },
    {
      q: "Can I see what the agent said to my callers?",
      a: "Yes. Every plan comes with a dashboard: each call transcribed, plus how many calls came in, when, and what people were asking about.",
    },
    {
      q: "What is the Custom plan?",
      a: "For several locations or very high call volume. Minutes are unlimited and the price is quoted for your case.",
    },
  ];
}

function PlanCard({ plan }: { plan: Plan }) {
  const featured = Boolean(plan.recommended);
  return (
    <Card
      className={`rounded-xl border shadow-none ${
        featured ? "border-primary bg-primary/5" : ""
      }`}
    >
      <CardContent className="flex h-full flex-col gap-5 p-4 md:p-6">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="ta-heading-2">{plan.name}</h2>
            {featured ? <Badge>Recommended</Badge> : null}
          </div>
          {/* Two lines reserved, so the three prices sit on one line. */}
          <p className="ta-body-2-reading text-muted-foreground md:min-h-12">
            {plan.blurb}
          </p>
        </div>

        <p className="flex items-baseline gap-1">
          <span className="ta-display-3 tabular-nums">{formatDollars(plan.monthly)}</span>
          <span className="ta-body-2 text-muted-foreground">/month</span>
        </p>

        <dl className="space-y-3 border-t pt-4">
          <div>
            <dt className="ta-caption-1 text-muted-foreground">Included</dt>
            <dd className="ta-headline-2 tabular-nums">
              {plan.includedMinutes.toLocaleString("en-US")} minutes a month
            </dd>
            <dd className="ta-caption-1 text-muted-foreground tabular-nums">
              about {callsFor(plan.includedMinutes).toLocaleString("en-US")} calls
            </dd>
          </div>
          <div>
            <dt className="ta-caption-1 text-muted-foreground">After that</dt>
            <dd className="ta-headline-2 tabular-nums">
              {formatRate(plan.overagePerMinute)} per extra minute
            </dd>
          </div>
        </dl>

        <Button
          variant={featured ? "default" : "outline"}
          className="mt-auto w-full"
          nativeButton={false}
          render={<a href={CONTACT_URL} target="_blank" rel="noreferrer" />}
        >
          Start {TRIAL_WEEKS} weeks free
          <ArrowUpRight className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * The price list, shared by /pricing and /c/[id]/pricing. Three numbers per
 * plan and the explaining a prospect would otherwise have to email for. It
 * promises nothing the scenarios page does not: features are described, not
 * gated, because the plans differ by minutes alone.
 */
export function Pricing({ mailto, demo }: Props) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-10 px-4 py-8">
      <header className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Logo />
          {demo ? (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<a href={`/c/${demo.id}`} />}
            >
              <ArrowLeft className="size-4" />
              Back to the demo
            </Button>
          ) : null}
        </div>
        <div className="max-w-2xl space-y-3">
          <h1 className="ta-title-1 text-balance">
            Simple pricing for a phone that is always{" "}
            <span className="text-primary">answered.</span>
          </h1>
          <p className="ta-body-1-reading text-muted-foreground">
            {demo
              ? `Putting ${demo.agentName} on the real line at ${demo.businessName} is a monthly plan with minutes included. `
              : "An AI receptionist on your real line is a monthly plan with minutes included. "}
            Pick by how much your phone rings — every plan does the same work.
          </p>
        </div>
      </header>

      <section
        aria-label="Launch offer"
        className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:gap-4 md:p-5"
      >
        <span className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
          <Gift className="size-5" aria-hidden />
        </span>
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="ta-headline-2">Your first {TRIAL_WEEKS} weeks are free</p>
            <Badge variant="outline" className="border-primary/40 text-primary">
              Launch offer · limited time
            </Badge>
          </div>
          <p className="ta-body-2-reading text-muted-foreground">
            Every new customer, on any plan. The agent takes your real calls for{" "}
            {TRIAL_DAYS} days before the first bill.
          </p>
        </div>
      </section>

      <section aria-label="Plans" className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>

        <Card className="rounded-xl border shadow-none">
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-6">
            <div className="space-y-1">
              <h2 className="ta-headline-2">Custom</h2>
              <p className="ta-body-2-reading text-muted-foreground">
                Unlimited minutes, quoted for your case — several locations or very
                high call volume.
              </p>
            </div>
            <Button
              variant="outline"
              className="shrink-0"
              nativeButton={false}
              render={<a href={CONTACT_URL} target="_blank" rel="noreferrer" />}
            >
              Ask for a quote
              <ArrowUpRight className="size-4" />
            </Button>
          </CardContent>
        </Card>

        <p className="ta-caption-1 text-muted-foreground">
          Prices in US dollars, billed monthly, before any tax that applies. Call
          counts assume about two minutes a call.
        </p>
      </section>

      <PlanEstimator />

      <section aria-labelledby="billing-title" className="space-y-5">
        <h2 id="billing-title" className="ta-heading-2">
          How the billing works
        </h2>
        <dl className="grid gap-5 md:grid-cols-3 md:gap-6">
          {BILLING.map(({ title, body }) => (
            <div key={title} className="space-y-1">
              <dt className="ta-headline-2">{title}</dt>
              <dd className="ta-body-2-reading text-muted-foreground">{body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="connections-title" className="space-y-5">
        <div className="space-y-2">
          <h2 id="connections-title" className="ta-heading-2">
            Connecting it to your schedule
          </h2>
          <p className="ta-body-2-reading text-muted-foreground max-w-2xl">
            For the agent to take a booking it has to reach the diary the booking
            goes in. This is the only thing that can sit outside the plan price.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {CONNECTIONS.map(({ title, price, body }) => (
            <Card key={title} className="rounded-xl border shadow-none">
              <CardContent className="space-y-2 p-4 md:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="ta-headline-2">{title}</h3>
                  <Badge variant="outline">{price}</Badge>
                </div>
                <p className="ta-body-2-reading text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Card className="rounded-xl border shadow-none">
        <CardContent className="space-y-5 p-4 md:p-6">
          <div className="space-y-2">
            <h2 className="ta-heading-2">On every plan</h2>
            <p className="ta-body-2-reading text-muted-foreground">
              The plans differ by minutes, not by what the agent is allowed to do.
            </p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {INCLUDED.map(({ title, body }) => (
              <li key={title} className="flex gap-3">
                <Check className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
                <div className="space-y-0.5">
                  <p className="ta-label-1">{title}</p>
                  <p className="ta-caption-1 text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <section aria-labelledby="faq-title" className="space-y-3">
        <h2 id="faq-title" className="ta-heading-2">
          Questions people ask
        </h2>
        <div className="divide-y rounded-xl border">
          {faqs().map(({ q, a }) => (
            <details key={q} className="group px-4 md:px-6">
              <summary className="ta-label-1 flex cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden">
                {q}
                <span
                  aria-hidden
                  className="text-muted-foreground transition-transform duration-150 group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="ta-body-2-reading text-muted-foreground max-w-prose pb-4">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <Card className="border-primary/30 bg-primary/5 rounded-xl border shadow-none">
        <CardContent className="space-y-3 p-4 text-center md:p-6">
          <p className="ta-headline-2">Not sure which one? Start with the free weeks.</p>
          <p className="ta-body-2-reading text-muted-foreground">
            Tell us about your phone and we will set the agent up on your line. The
            plan can wait until you have seen your own numbers.
          </p>
          <ContactButtons mailto={mailto} pricing={false} className="justify-center" />
        </CardContent>
      </Card>

      <footer className="flex flex-col items-center gap-1 pb-4">
        <p className="ta-caption-1 text-muted-foreground text-center">
          TecAce voice agent pricing.
          {demo ? " The business shown in the demo has not endorsed it." : ""}
        </p>
        <VersionBadge />
      </footer>
    </main>
  );
}
