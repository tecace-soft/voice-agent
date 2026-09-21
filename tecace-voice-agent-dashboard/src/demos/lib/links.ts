/**
 * Where the demo page sends a prospect who wants the real thing. These are
 * read at build time, so changing one needs a redeploy; they live here rather
 * than inline so that is a one-line change.
 */
export const CONTACT_URL =
  import.meta.env.VITE_CONTACT_URL || "https://www.tecace.com/contact-us";

// TecAce publishes no pricing page yet, so this points at the same form until
// there is somewhere better to send people.
export const PRICING_URL =
  import.meta.env.VITE_PRICING_URL || "https://www.tecace.com/contact-us";

export const CONTACT_EMAIL =
  import.meta.env.VITE_CONTACT_EMAIL || "contact@tecace.com";

/** A mailto that arrives already knowing which demo it came from. */
export function mailtoFor(businessName: string, demoUrl: string): string {
  const subject = `AI receptionist for ${businessName}`;
  const body = [
    `We tried the demo receptionist you built for ${businessName}.`,
    "",
    `Demo: ${demoUrl}`,
    "",
    "We would like to talk about:",
    "- ",
  ].join("\n");
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}
