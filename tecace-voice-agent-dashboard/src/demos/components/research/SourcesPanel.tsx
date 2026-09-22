
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, FileSearch } from "lucide-react";
import type { ResearchSource } from "@/lib/types";

function Empty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <FileSearch className="size-6 text-muted-foreground" aria-hidden />
      <p className="ta-body-2 text-muted-foreground">{message}</p>
    </div>
  );
}

type Props = {
  dossier: string;
  sources: ResearchSource[];
  researchedAt?: string;
  /**
   * The reference reading of this panel, for the bottom of the Knowledge tab
   * on the public page. A prospect should be able to check where a claim came
   * from, which is the list of links; the raw briefing is the working-out and
   * folds away until someone asks for it.
   */
  compact?: boolean;
};

export function SourcesPanel({ dossier, sources, researchedAt, compact }: Props) {
  if (!dossier && sources.length === 0) {
    if (compact) return null;
    return <Empty message="No research yet. Run research to collect the business data." />;
  }

  const research = (
    <div className="ta-body-2-reading max-w-none space-y-3 [&_h1]:ta-headline-1 [&_h2]:ta-headline-2 [&_h3]:ta-label-1 [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{dossier}</ReactMarkdown>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="ta-headline-2">{compact ? "Where this came from" : "Sources"}</h3>
        {compact ? (
          <p className="ta-caption-1 text-muted-foreground">
            Every line above was read off a public page. These are the pages.
          </p>
        ) : null}
        {researchedAt ? (
          <p className="ta-caption-1 text-muted-foreground">
            Collected {new Date(researchedAt).toLocaleString()}
          </p>
        ) : null}
        {sources.length === 0 ? (
          <p className="ta-caption-1 text-muted-foreground">No sources were cited.</p>
        ) : (
          <ul className="space-y-1.5">
            {sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ta-label-1 text-primary inline-flex items-center gap-1.5 hover:underline"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!dossier ? null : compact ? (
        <details>
          <summary className="ta-caption-1 text-muted-foreground hover:text-foreground cursor-pointer">
            Read the full briefing
          </summary>
          <div className="pt-3">{research}</div>
        </details>
      ) : (
        <div className="space-y-2">
          <h3 className="ta-headline-2">Raw research</h3>
          {research}
        </div>
      )}
    </div>
  );
}
