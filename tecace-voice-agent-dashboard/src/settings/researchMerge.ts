import type { BusinessFaq, BusinessProfile } from "@/lib/types";
import { MAX_FAQS } from "./sections/FaqEditor";

// "Fill in from research" on Business information: what the run found, laid over the form.
//
// The run is a reading of the business's site and listings, so where it found something it is taken —
// and where it found nothing, what the business already has stays. FAQs are the exception: they are
// added, never replaced, because a business's own answers outrank a web page's, and a question asked
// twice would be answered twice. Nothing here saves; the business checks the form and presses Save.

export type ResearchMerge = {
  profile: BusinessProfile;
  /** The top-level parts the run changed, for the note above the form. */
  changed: (keyof BusinessProfile)[];
  faqsAdded: number;
  /** New questions that did not fit under the 20-question limit. */
  faqsLeftOut: number;
};

const EMPTY: BusinessProfile = {
  name: "",
  category: "",
  address: "",
  hours: [],
  services: [],
  highlights: [],
  policies: {},
  faqs: [],
};

const filled = (value: unknown): boolean =>
  Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim() !== "" : value != null;

const questionKey = (faq: BusinessFaq) => faq.q.trim().toLowerCase().replace(/[?.!\s]+$/, "");

export function mergeResearch(current: BusinessProfile | null, found: BusinessProfile): ResearchMerge {
  const base = current ?? EMPTY;
  const profile: BusinessProfile = { ...base };
  const changed: (keyof BusinessProfile)[] = [];

  for (const key of Object.keys(found) as (keyof BusinessProfile)[]) {
    if (key === "faqs" || key === "policies") continue;
    const value = found[key];
    if (!filled(value) || JSON.stringify(value) === JSON.stringify(base[key])) continue;
    (profile as Record<string, unknown>)[key] = value;
    changed.push(key);
  }

  // Policy by policy, so a run that found the parking but not the payment rules keeps the payment rules.
  const policies = { ...base.policies };
  for (const [key, value] of Object.entries(found.policies ?? {})) {
    if (filled(value)) (policies as Record<string, unknown>)[key] = value;
  }
  if (JSON.stringify(policies) !== JSON.stringify(base.policies)) {
    profile.policies = policies;
    changed.push("policies");
  }

  const seen = new Set(base.faqs.map(questionKey));
  const fresh = (found.faqs ?? []).filter((faq) => faq.q?.trim() && faq.a?.trim() && !seen.has(questionKey(faq)));
  const room = Math.max(0, MAX_FAQS - base.faqs.length);
  const added = fresh.slice(0, room);
  profile.faqs = [...base.faqs, ...added];

  return { profile, changed, faqsAdded: added.length, faqsLeftOut: fresh.length - added.length };
}
