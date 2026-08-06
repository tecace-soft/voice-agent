// Lead-facing follow-up emails. Kept separate from the email transport (email/client.ts) so
// the message wording lives in one place. Best-effort — returns whether the email went out.

import { env } from "../config/env.js";
import type { IntakeRecord } from "../db/intakes.js";
import { sendEmail } from "../email/client.js";
import { formatSpoken } from "../lib/spoken.js";

// Sent to a lead we could only reach by voicemail: a warm nudge to book, since we've stopped
// calling. Triggered by the post-call webhook on a voicemail outcome.
export async function sendVoicemailFollowUp(intake: IntakeRecord): Promise<boolean> {
  const name = intake.name || "there";
  const when = intake.scheduledAt
    ? formatSpoken(intake.scheduledAt, env.schedule.timezone)
    : "";
  const timeLine = when ? ` about your requested time (${when})` : "";
  const subject = "We tried to reach you — Olympus Spa";
  const text = [
    `Hi ${name},`,
    ``,
    `This is Tess from Olympus Spa. We tried to reach you by phone${timeLine} to help you ` +
      `book your spa appointment, but we couldn't connect and left a short voicemail.`,
    ``,
    `Whenever you're ready, just reply to this email or give us a call back and we'll get ` +
      `you scheduled. We'd love to see you at Olympus Spa!`,
    ``,
    `— Tess, Olympus Spa`,
  ].join("\n");
  return sendEmail({ to: intake.email, subject, text });
}
