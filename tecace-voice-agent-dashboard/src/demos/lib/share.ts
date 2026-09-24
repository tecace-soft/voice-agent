/**
 * Where a demo link points: this app's own origin, because this app serves `/c/<id>`.
 *
 * There was a `VITE_PUBLIC_DEMO_BASE_URL` here while the page lived on the promo, and an unset
 * build fell back to this origin — which produced a link that looked right, opened the dashboard,
 * and landed on Overview. There is nothing to configure now, and nothing to get wrong: the page and
 * the link are the same deployment.
 */
function baseUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  // Only reachable from a non-browser context (a test importing this directly); the promo's own
  // fallback, kept so `customerLink` always returns an absolute URL.
  return "http://localhost:5175";
}

export function customerLink(id: string): string {
  return `${baseUrl()}/c/${id}`;
}

export function emailSubject(businessName: string): string {
  return `A quick demo: an AI receptionist for ${businessName}`;
}

export function emailBody(
  businessName: string,
  contactName: string | undefined,
  link: string,
): string {
  return [
    `Hi ${contactName || "there"},`,
    "",
    `We built a working AI receptionist for ${businessName} so you can hear it for yourself.`,
    "",
    `Open this link and press call: ${link}`,
    "",
    "It answers in a real voice, knows your hours, services, and policies, and you can interrupt it like a real call. It takes about a minute.",
    "",
    "Happy to tune what it says once you have tried it.",
  ].join("\n");
}

export function mailtoLink(
  businessName: string,
  contactName: string | undefined,
  contactEmail: string | undefined,
  link: string,
): string {
  const params = new URLSearchParams({
    subject: emailSubject(businessName),
    body: emailBody(businessName, contactName, link),
  });
  return `mailto:${contactEmail ?? ""}?${params.toString()}`;
}
