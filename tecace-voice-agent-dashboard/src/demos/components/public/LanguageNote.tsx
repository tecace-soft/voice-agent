import { Languages } from "lucide-react";
import { languageOf } from "@/lib/languages";

/**
 * Said out loud on the page because it is the one thing a prospect would never
 * guess and would not think to test: the receptionist answers in whatever
 * language it is spoken to in, and for some businesses it does not start in
 * English at all.
 *
 * Its own component so the public page mounts it in one line — the page around
 * it is being reworked, and a line is cheaper to move than a block.
 */
export function LanguageNote({
  agentName,
  language,
}: {
  agentName: string;
  language?: string;
}) {
  const opensIn = languageOf(language);

  return (
    <p className="ta-caption-1 text-muted-foreground flex items-center justify-center gap-1.5 text-center">
      <Languages className="size-3.5 shrink-0" aria-hidden />
      <span>
        {agentName} answers in {opensIn.native}, and switches to whatever
        language you speak to it in. Try it mid-sentence.
      </span>
    </p>
  );
}
