function baseUrl(): string {
  const configured: string | undefined = import.meta.env.VITE_PUBLIC_DEMO_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
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
