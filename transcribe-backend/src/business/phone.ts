/**
 * Best-effort E.164, matching openai-agent-app's `to_e164` exactly.
 *
 * This is the ONLY normalizer in this system by design. The agent sends Twilio's raw `To` and the
 * backend normalizes it, so the string that looks a number up is produced by the same code that
 * wrote it. Two implementations of "nearly E.164" drift on some edge case and then a lookup misses
 * silently — which, here, means falling back to the neutral prompt for a customer who is correctly
 * configured.
 */
export function toE164(input: string, defaultCountryCode = "1"): string {
  const s = (input ?? "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return "+" + s.slice(1).replace(/\D/g, "");
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : s;
}
