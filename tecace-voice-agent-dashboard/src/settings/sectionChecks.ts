import type { BusinessProfile } from "@/lib/types";
import type { Readiness } from "../api/types";

// Small rules the settings screens share, kept free of React so they can be unit-tested.

/**
 * Why Business information can't be saved as it stands, or null. A profile with no name is not live:
 * saved, it would drop a working receptionist to taking messages — so autosave waits for one.
 */
export function businessInfoProblem(profile: BusinessProfile | null): string | null {
  if (!profile) return null;
  return profile.name?.trim() ? null : "Your business name is empty.";
}

/** Why the FAQs can't be saved as they stand: a question without its answer, or the reverse. */
export function faqsProblem(profile: BusinessProfile | null): string | null {
  const faqs = profile?.faqs ?? [];
  return faqs.some((faq) => !faq.q.trim() || !faq.a.trim()) ? "Each question needs an answer." : null;
}

/** The business's own required Go live items: how many are done, and whether all are. */
export function customerPart(readiness: Readiness) {
  const mine = readiness.items.filter((item) => item.owner === "customer" && item.required);
  const done = mine.filter((item) => item.ok).length;
  return { done, total: mine.length, ready: readiness.customerReady ?? done === mine.length };
}
