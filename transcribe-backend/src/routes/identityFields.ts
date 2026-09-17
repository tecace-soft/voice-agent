// Validation for the two fields that decide how the assistant introduces itself.
//
// Pure and separate from the route because the rule below is subtle and worth testing on its own:
// "not sent" and "sent empty" mean different things, and getting them the wrong way round silently
// deletes a customer's greeting when they edit something else entirely.

// A greeting is ONE spoken line, and the cap is what keeps it one. Without a limit this field is
// an unbounded slot in the agent's own instructions, which is a different feature with different
// risks; with it, the worst case is a long-winded hello.
export const MAX_AGENT_NAME = 40;
export const MAX_GREETING = 240;
// Longer than a greeting: this is a short list, not one spoken sentence. Still capped, because it
// lands in the agent's own instructions and an unbounded field there is a different feature.
export const MAX_TRANSFER_TOPICS = 400;
// The business's own instructions to the assistant. Longer than the others because it is a short
// list of preferences rather than a spoken line — but still capped: it lands inside the agent's
// instructions on every call, and an unbounded field there is a different feature with different
// risks.
export const MAX_HOUSE_RULES = 1500;

/**
 * Tidy a line the agent will SPEAK, or null if there is nothing there.
 *
 * Newlines and control characters are collapsed rather than rejected — someone pasting from a
 * document brings them along without meaning to, and a line break is meaningless to a voice.
 * Length is rejected rather than truncated: silently cutting a greeting mid-word would be
 * discovered by a caller hearing it, which is much too late.
 */
export function spokenLine(raw: string | undefined, max: number, field: string): string | null | { tooLong: string } {
  const cleaned = (raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length > max) {
    return { tooLong: `${field} is ${cleaned.length} characters — keep it under ${max}.` };
  }
  return cleaned;
}

/**
 * The introduction fields for a save, where "not sent" and "sent empty" mean different things.
 *
 * Sent empty is a customer clearing the field, and clears it. Not sent at all is a form that does
 * not own the field, and must leave whatever is there untouched.
 */
export function resolveIdentity(
  body: { agentName?: string; greeting?: string },
  existing: { agentName: string | null; greeting: string | null } | null,
): { agentName: string | null; greeting: string | null } | { field: string; tooLong: string } {
  const name =
    body.agentName === undefined
      ? existing?.agentName ?? null
      : spokenLine(body.agentName, MAX_AGENT_NAME, "The assistant's name");
  if (name && typeof name === "object") return { field: "bad_agent_name", tooLong: name.tooLong };

  const hello =
    body.greeting === undefined
      ? existing?.greeting ?? null
      : spokenLine(body.greeting, MAX_GREETING, "The greeting");
  if (hello && typeof hello === "object") return { field: "bad_greeting", tooLong: hello.tooLong };

  return { agentName: name, greeting: hello };
}
