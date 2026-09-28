import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BusinessFaq } from "@/lib/types";

// The FAQs section's editor (dashboard-only; the promo's KnowledgeEditor keeps its one-line pair for
// the other knowledge parts). Each question is a card: the question on one line, the answer in a box
// that grows with it, and the order — callers' most-asked first, since a long list is cut from the end.

/** transcribe-backend business/profileShape.ts MAX_FAQS. */
export const MAX_FAQS = 20;
/** Past this an answer stops sounding like something said on the phone (demo/prompt.ts FAQ_ANSWER_MAX). */
const LONG_ANSWER = 140;
/** Past this many, a search box helps find one. */
const SEARCH_FROM = 6;

export function FaqEditor({ faqs, onChange }: { faqs: BusinessFaq[]; onChange: (faqs: BusinessFaq[]) => void }) {
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const questionRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (focusIndex === null) return;
    const input = questionRefs.current[focusIndex];
    input?.focus();
    input?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFocusIndex(null);
  }, [focusIndex]);

  const full = faqs.length >= MAX_FAQS;
  const needle = query.trim().toLowerCase();
  const shown = faqs
    .map((faq, index) => ({ faq, index }))
    .filter(({ faq }) => !needle || `${faq.q} ${faq.a}`.toLowerCase().includes(needle));

  const update = (index: number, change: Partial<BusinessFaq>) =>
    onChange(faqs.map((faq, i) => (i === index ? { ...faq, ...change } : faq)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...faqs];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + by, 0, item);
    onChange(next);
  };
  const add = () => {
    setQuery("");
    onChange([...faqs, { q: "", a: "" }]);
    setFocusIndex(faqs.length);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="ta-headline-2">Caller questions</p>
          <p className="ta-caption-1 text-muted-foreground tabular-nums">
            {faqs.length} of {MAX_FAQS} · most-asked first
          </p>
        </div>
        {faqs.length > SEARCH_FROM ? (
          <div className="relative w-full sm:w-56">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a question"
              aria-label="Find a question"
              className="pl-8"
            />
          </div>
        ) : null}
        <Button variant="outline" size="sm" onClick={add} disabled={full} title={full ? `Up to ${MAX_FAQS} questions` : undefined}>
          <Plus className="size-4" />
          Add question
        </Button>
      </div>

      {faqs.length === 0 ? (
        <div className="bg-muted/40 rounded-xl border border-dashed p-6 text-center">
          <p className="ta-label-1">No questions yet</p>
          <p className="ta-caption-1 text-muted-foreground mt-1">
            Add the ones callers ask most — parking, new patients, what to bring.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="ta-body-2 text-muted-foreground">No question matches “{query}”.</p>
      ) : (
        <ol className="space-y-3">
          {shown.map(({ faq, index }) => {
            const long = faq.a.trim().length > LONG_ANSWER;
            const incomplete = !faq.q.trim() || !faq.a.trim();
            return (
              <li key={index} className="rounded-xl border p-4">
                <div className="flex items-start gap-3">
                  <span className="bg-muted text-muted-foreground ta-caption-1 mt-1.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full tabular-nums">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      ref={(node) => {
                        questionRefs.current[index] = node;
                      }}
                      value={faq.q}
                      placeholder="What callers ask, e.g. Do you take new patients?"
                      aria-label={`Question ${index + 1}`}
                      className="font-semibold"
                      onChange={(e) => update(index, { q: e.target.value })}
                    />
                    <Textarea
                      value={faq.a}
                      placeholder="The answer, the way you'd say it on the phone"
                      aria-label={`Answer ${index + 1}`}
                      className="min-h-20"
                      onChange={(e) => update(index, { a: e.target.value })}
                    />
                    <p
                      className={`ta-caption-1 tabular-nums ${long ? "text-warning" : "text-muted-foreground"}`}
                      aria-live="polite"
                    >
                      {faq.a.trim().length} characters
                      {long
                        ? " · long for the phone. Keep it to a sentence or two."
                        : incomplete
                          ? " · needs both a question and an answer to be used"
                          : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move question ${index + 1} up`}
                      title="Move up"
                      disabled={index === 0 || Boolean(needle)}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move question ${index + 1} down`}
                      title="Move down"
                      disabled={index === faqs.length - 1 || Boolean(needle)}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove question ${index + 1}`}
                      title="Remove"
                      onClick={() => onChange(faqs.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
