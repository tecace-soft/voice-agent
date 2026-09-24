/**
 * Where the demo page sends a prospect who wants the real thing. These are
 * read at build time, so changing one needs a redeploy; they live here rather
 * than inline so that is a one-line change.
 */
export const CONTACT_URL =
  import.meta.env.VITE_CONTACT_URL || "https://www.tecace.com/contact-us";

// The price list is the prospect's own copy of the pricing page, which this app now serves at
// `/c/<id>/pricing`. Set the variable only to send people somewhere else instead, such as a pricing
// page on tecace.com; empty means "use ours", which is the promo's own default.
//
// It was pointed at the contact form while the public pages lived on the promo and this app had no
// pricing page to link to.
export const PRICING_URL = import.meta.env.VITE_PRICING_URL || "";

/**
 * Where the Pricing button goes. From a demo it is that prospect's own copy of the page, which knows
 * the way back and whose demo the email is about.
 */
export function pricingHref(customerId?: string): string {
  if (PRICING_URL) return PRICING_URL;
  return customerId ? `/c/${customerId}/pricing` : "/pricing";
}

export const CONTACT_EMAIL =
  import.meta.env.VITE_CONTACT_EMAIL || "contact@tecace.com";

/** For the pricing page reached without a demo: there is no business to name. */
export function pricingMailto(): string {
  const subject = "AI receptionist pricing";
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

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
