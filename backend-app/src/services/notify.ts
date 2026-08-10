// Lead-facing follow-up emails. Kept separate from the email transport (email/client.ts) so
// the message wording lives in one place. Best-effort — returns whether the email went out.

import { env } from "../config/env.js";
import type { IntakeRecord } from "../db/intakes.js";
import { sendEmail } from "../email/client.js";
import { formatSpoken } from "../lib/spoken.js";

// Sent when a booking succeeds (agent or dashboard): a warm confirmation with the time. Uses
// our own SMTP so it doesn't depend on Cal.com being configured. Best-effort.
export async function sendBookingConfirmation(intake: IntakeRecord): Promise<boolean> {
  const name = intake.name || "there";
  const when = formatSpoken(intake.scheduledAt, env.schedule.timezone);
  const subject = "Your TecAce consultation is confirmed";
  // Personalize with what they reached out about, when we have it, so the note feels tailored
  // and it's clear the consultant will prep against their inquiry.
  const prep = intake.purpose
    ? `You reached out to us about ${intake.purpose}, and our consultant will review that ahead of the call.`
    : `Our consultant will review your inquiry ahead of the call.`;
  const text = [
    `Hi ${name},`,
    ``,
    `Your 30-minute consultation with TecAce is confirmed for ${when}.`,
    ``,
    prep,
    ``,
    `A calendar invite with the meeting link will follow. If you need to change or reschedule, ` +
      `just reply to this email.`,
    ``,
    `Looking forward to speaking with you!`,
    ``,
    `— The TecAce Team`,
  ].join("\n");
  return sendEmail({ to: intake.email, subject, text });
}

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
