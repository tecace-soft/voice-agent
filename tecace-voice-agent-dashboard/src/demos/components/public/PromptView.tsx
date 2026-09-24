import type { CustomerPrompts } from "@/lib/types";

type Props = {
  prompts: Pick<CustomerPrompts, "live" | "backend" | "greeting">;
  voiceLabel: string;
  agentName: string;
};

function Block({
  title,
  description,
  body,
}: {
  title: string;
  description: string;
  body: string;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="ta-headline-2">{title}</h3>
      <p className="ta-caption-1 text-muted-foreground">{description}</p>
      <pre className="bg-muted max-h-72 overflow-auto rounded-lg p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap">
        {body}
      </pre>
    </section>
  );
}

export function PromptView({ prompts, voiceLabel, agentName }: Props) {
  return (
    <div className="space-y-6">
      <p className="ta-caption-1 text-muted-foreground">
        Nothing about the call is hard-coded. These are the instructions the
        receptionist runs on, generated from the collected data. Change a line here
        and the next call follows it.
      </p>

      <div className="ta-body-2 flex flex-wrap gap-x-6 gap-y-1">
        <span>
          <span className="text-muted-foreground">Receptionist</span> {agentName}
        </span>
        <span>
          <span className="text-muted-foreground">Voice</span> {voiceLabel}
        </span>
      </div>

      <Block
        title="Greeting"
        description="Sent the moment the call connects, so the receptionist speaks first."
        body={prompts.greeting}
      />
      <Block
        title="Voice prompt"
        description="Runs on the voice model. Manner, pace, and the facts worth answering instantly."
        body={prompts.live}
      />
      <Block
        title="Backend prompt"
        description="Runs on the model behind the voice. It holds the full profile and the rules for looking things up."
        body={prompts.backend}
      />
    </div>
  );
}
