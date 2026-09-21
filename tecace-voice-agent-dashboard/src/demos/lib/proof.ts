import type { BusinessProfile, ResearchSource } from "./types";

/**
 * The honest numbers behind the demo page's hero, and the words it puts in
 * a caller's mouth. Pure, like lib/analytics.ts: the hero is a client
 * component, so nothing here may touch node.
 */

/** What to ask when the business's own FAQs give us nothing short enough. */
export const FALLBACK_QUESTIONS = [
  "Are you open right now?",
  "Where do I park?",
  "Do I need to book?",
  "What do you charge?",
];

/** A chip has to fit beside two others on a phone; longer questions are dropped, never cut. */
const MAX_CHIP_CHARS = 36;

const normalise = (text: string) => text.trim().replace(/\s+/g, " ");

/**
 * Three or four things a visitor can say out loud, taken from the questions
 * this business's callers already ask, padded from a fallback list so the
 * row is never empty. Order is preserved; duplicates are folded regardless
 * of case.
 */
export function suggestedQuestions(
  profile: Pick<BusinessProfile, "faqs">,
  fallback: string[] = FALLBACK_QUESTIONS,
  max = 4,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const consider = (raw: string) => {
    const text = normalise(raw);
    if (!text || text.length > MAX_CHIP_CHARS) return;
    const key = text.toLowerCase();
    if (seen.has(key) || out.length >= max) return;
    seen.add(key);
    out.push(text);
  };
  for (const faq of profile.faqs) consider(faq.q);
  for (const question of fallback) consider(question);
  return out;
}

export type ProofKey = "sources" | "hours" | "services" | "faqs" | "researched";
export type ProofSegment = { key: ProofKey; label: string };

/**
 * The proof strip under the hero. Every segment is a count the research
 * actually produced; a zero drops its segment rather than printing "0
 * services", and fewer than two survivors means no strip at all — a lone
 * hairline rule is worse than none.
 */
export function proofCounts(
  profile: Pick<BusinessProfile, "hours" | "services" | "faqs">,
  sources: ResearchSource[],
  researchedAt?: string,
): ProofSegment[] | null {
  const segments: ProofSegment[] = [];
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  if (sources.length > 0) {
    segments.push({
      key: "sources",
      label: `Built from ${sources.length} public ${plural(sources.length, "source", "sources")}`,
    });
  }
  const openDays = profile.hours.filter((h) => !h.closed && h.open && h.close).length;
  if (openDays > 0) {
    segments.push({
      key: "hours",
      label: `Open ${openDays} ${plural(openDays, "day", "days")} a week`,
    });
  }
  if (profile.services.length > 0) {
    segments.push({
      key: "services",
      label: `${profile.services.length} ${plural(profile.services.length, "service", "services")}`,
    });
  }
  if (profile.faqs.length > 0) {
    segments.push({
      key: "faqs",
      label: `${profile.faqs.length} ${plural(profile.faqs.length, "question", "questions")} callers ask`,
    });
  }
  const researched = formatDate(researchedAt);
  if (researched) segments.push({ key: "researched", label: `Researched ${researched}` });

  return segments.length >= 2 ? segments : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * An absolute date, built by hand in UTC so the server and the client render
 * the same string and the strip never hydrates twice. Not `toLocaleDateString`:
 * its month names depend on the ICU data of whichever runtime is rendering
 * ("Sept" on one, "Sep" on another).
 */
function formatDate(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export type Headline = {
  text: string;
  size: "display" | "title";
  nameInSubtitle: boolean;
};

/** Rendered lengths past which the display face wraps to three, then four, lines in the hero column. */
const DISPLAY_MAX = 44;
const TITLE_MAX = 56;

/**
 * The hero headline with the business name in it, sized by how long the
 * whole sentence comes out — not by the name alone, so a copy rewrite moves
 * the thresholds with it. A four-line headline pushes the Call button under
 * the fold, so past the second threshold the name leaves the headline for
 * the supporting sentence.
 */
export function headline({
  template,
  name,
  fallback,
}: {
  template: string;
  name: string;
  fallback: string;
}): Headline {
  const text = template.replace("{name}", name);
  if (text.length <= DISPLAY_MAX) return { text, size: "display", nameInSubtitle: false };
  if (text.length <= TITLE_MAX) return { text, size: "title", nameInSubtitle: false };
  return { text: fallback, size: "display", nameInSubtitle: true };
}
