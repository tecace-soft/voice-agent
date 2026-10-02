import { useEffect, useState } from "react";
import { Search, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BusinessResearchInputs } from "../../api/backend";
import type { ResearchMerge } from "../researchMerge";

// Business information › "Fill in from research": run the research a demo gets (the business's site,
// its FAQ pages, its Google listing) and lay what it finds over the form, so a business refills its
// details instead of typing them again. Nothing is saved until the business checks the form and
// presses Save; Undo puts the form back as it was.

const LABELS: Record<string, string> = {
  name: "name",
  category: "category",
  address: "address",
  phone: "phone",
  website: "website",
  hours: "hours",
  services: "services",
  highlights: "highlights",
  policies: "policies",
  rating: "rating",
  reviewSummary: "review summary",
};

export type ResearchOutcome = ResearchMerge & { sources: { url: string; title: string }[] };

export function ResearchFillCard({
  defaults,
  running,
  error,
  outcome,
  onRun,
  onUndo,
  onOpenFaqs,
}: {
  defaults: { businessName: string; websiteUrl: string };
  running: boolean;
  error: string | null;
  outcome: ResearchOutcome | null;
  onRun: (inputs: BusinessResearchInputs) => void;
  onUndo: () => void;
  onOpenFaqs: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [inputs, setInputs] = useState<Required<BusinessResearchInputs>>({
    businessName: defaults.businessName,
    websiteUrl: defaults.websiteUrl,
    mapsUrl: "",
    notes: "",
  });
  const set = (change: Partial<BusinessResearchInputs>) => setInputs((current) => ({ ...current, ...change }));
  // Once results are in the form, the inputs fold away: the note and the form are what to look at.
  useEffect(() => {
    if (outcome) setOpen(false);
  }, [outcome]);

  return (
    <section className="mb-6 rounded-xl border p-4" aria-labelledby="research-fill-heading">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 id="research-fill-heading" className="ta-label-1">
            Fill in from research
          </h3>
          <p className="ta-caption-1 text-muted-foreground">
            We read your website, its FAQ pages and your Google listing again and fill in the form below and
            your FAQs. Nothing changes for callers until you check it and press Save.
          </p>
        </div>
        {!open && !running ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            <Search className="size-4" />
            Research my business
          </Button>
        ) : null}
      </div>

      {open || running ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="research-name" className="ta-label-1">
                Business name
              </Label>
              <Input
                id="research-name"
                value={inputs.businessName}
                disabled={running}
                onChange={(e) => set({ businessName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="research-website" className="ta-label-1">
                Website
              </Label>
              <Input
                id="research-website"
                placeholder="https://example.com"
                value={inputs.websiteUrl}
                disabled={running}
                onChange={(e) => set({ websiteUrl: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="research-maps" className="ta-label-1">
                Google Maps link <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="research-maps"
                placeholder="https://maps.google.com/…"
                value={inputs.mapsUrl}
                disabled={running}
                onChange={(e) => set({ mapsUrl: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="research-notes" className="ta-label-1">
                Anything the web won't say <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="research-notes"
                className="min-h-16"
                maxLength={1000}
                placeholder="A second location, a new menu, a page that moved…"
                value={inputs.notes}
                disabled={running}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => onRun(inputs)}
              disabled={running || !inputs.businessName.trim()}
            >
              {running ? "Researching…" : "Run research"}
            </Button>
            {!running ? (
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            ) : (
              <span className="ta-caption-1 text-muted-foreground">This takes a minute or two. Stay on this page.</span>
            )}
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="ta-label-1 text-destructive mt-4" role="alert">
          {error}
        </p>
      ) : null}

      {outcome ? (
        <div className="bg-primary/5 mt-4 flex flex-wrap items-start gap-3 rounded-lg p-3" role="status">
          <div className="ta-caption-1 min-w-0 flex-1 space-y-1">
            <p className="ta-label-1 text-primary">Filled in from research. Check it below, then Save.</p>
            <p className="text-muted-foreground">
              {outcome.changed.length
                ? `Updated: ${outcome.changed.map((key) => LABELS[key] ?? key).join(", ")}.`
                : "Nothing new for the form."}{" "}
              {outcome.faqsAdded
                ? `${outcome.faqsAdded} new FAQ${outcome.faqsAdded === 1 ? "" : "s"} added — save them on the FAQs page.`
                : "No new FAQs."}
              {outcome.faqsLeftOut
                ? ` ${outcome.faqsLeftOut} more didn't fit under the 20-question limit.`
                : ""}
            </p>
            {outcome.sources.length ? (
              <p className="text-muted-foreground truncate" title={outcome.sources.map((s) => s.url).join("\n")}>
                From {outcome.sources.length} source{outcome.sources.length === 1 ? "" : "s"}, including{" "}
                {outcome.sources[0]?.title || outcome.sources[0]?.url}.
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            {outcome.faqsAdded ? (
              <Button variant="outline" size="sm" onClick={onOpenFaqs}>
                Open FAQs
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onUndo}>
              <Undo2 className="size-4" />
              Undo
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
