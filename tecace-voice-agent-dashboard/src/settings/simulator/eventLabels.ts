// How a test call's events read in a list: the console's Events tab and the Test & improve history.

const EVENT_LABEL: Record<string, string> = {
  transfer_requested: "Transfer asked for",
  transfer_final: "Transfer finished",
  consent_requested: "Consent text sent",
  link_sent: "Link texted",
  link_blocked: "Link not sent (opted out)",
  consent_reply: "Caller replied",
  message_taken: "Message taken",
};

export function eventLine(e: { type: string; data: Record<string, unknown> }): string | null {
  const label = EVENT_LABEL[e.type];
  if (!label) return null;
  if (e.type === "transfer_final") return `${label}: ${e.data.success ? "connected" : "nobody picked up"}`;
  if (e.type === "consent_reply") return `${label} ${String(e.data.reply ?? "").toUpperCase()}`;
  return label;
}
