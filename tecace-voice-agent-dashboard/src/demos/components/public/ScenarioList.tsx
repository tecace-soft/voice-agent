import {
  CalendarCheck,
  CalendarPlus,
  ClipboardList,
  Languages,
  MoonStar,
  PackageSearch,
  PhoneCall,
  PhoneForwarded,
  Voicemail,
  type LucideIcon,
} from "lucide-react";
import { Exchange } from "@/components/public/Exchange";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { businessNouns, buildUseCases, type UseCase } from "@/lib/use-cases";

/**
 * Every scenario, open, on a page of its own. This is for the reader who
 * clicked through from the demo, so nothing is collapsed and nothing is
 * teased — they already said they want the detail.
 *
 * lib/use-cases.ts stays React-free, so the icon it names is resolved here.
 */
const ICONS: Record<string, LucideIcon> = {
  "phone-call": PhoneCall,
  languages: Languages,
  "calendar-plus": CalendarPlus,
  "calendar-check": CalendarCheck,
  voicemail: Voicemail,
  "phone-forwarded": PhoneForwarded,
  "moon-star": MoonStar,
  "package-search": PackageSearch,
  "clipboard-list": ClipboardList,
};

function Scenario({
  useCase,
  agentName,
}: {
  useCase: UseCase;
  agentName: string;
}) {
  const Icon = ICONS[useCase.icon] ?? PhoneCall;

  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="space-y-3 p-4 md:p-5">
        <div className="flex items-start gap-3">
          <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-4.5" aria-hidden />
          </span>
          <div className="flex-1 space-y-1">
            <h3 className="ta-headline-2 flex flex-wrap items-center gap-2">
              {useCase.title}
              {useCase.live ? (
                <Badge variant="secondary">in this demo</Badge>
              ) : null}
            </h3>
            <p className="ta-label-1 text-muted-foreground">{useCase.tagline}</p>
          </div>
        </div>

        <p className="ta-body-2-reading text-muted-foreground">{useCase.body}</p>

        <div className="bg-muted/50 flex flex-col gap-2 rounded-lg p-3">
          <p className="ta-caption-2 text-muted-foreground">How it sounds</p>
          {useCase.example.map((turn, index) => (
            <Exchange
              key={index}
              speaker={turn.speaker}
              text={turn.text}
              agentName={agentName}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Group({
  label,
  note,
  items,
  agentName,
}: {
  label: string;
  note: string;
  items: UseCase[];
  agentName: string;
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="ta-heading-2">{label}</h2>
        <p className="ta-caption-1 text-muted-foreground">{note}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((useCase) => (
          <Scenario key={useCase.id} useCase={useCase} agentName={agentName} />
        ))}
      </div>
    </section>
  );
}

export function ScenarioList({
  agentName,
  businessName,
  category,
}: {
  agentName: string;
  businessName: string;
  category?: string;
}) {
  const cases = buildUseCases({
    agentName,
    businessName,
    nouns: businessNouns(category),
  });
  const live = cases.filter((useCase) => useCase.live);
  const rest = cases.filter((useCase) => !useCase.live);

  return (
    <div className="space-y-8">
      <Group
        label="What the demo already does"
        note={`Call ${businessName} on the demo page and you get both of these today.`}
        items={live}
        agentName={agentName}
      />
      <Group
        label="What the same system does next"
        note="None of these are switched on for this demo. They are the same voice agent with the rest of its work turned on — ask us and we set them up."
        items={rest}
        agentName={agentName}
      />
    </div>
  );
}
