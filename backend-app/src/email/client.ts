// Transactional email over SMTP (nodemailer) — reuses the same Gmail SMTP_* credentials the
// voice-agent app uses. BEST-EFFORT: if email isn't configured or the send fails, we log and
// return false so the caller's own flow still completes (same pattern as the Cal.com client).
// One shared, lazily-created transport is reused across invocations.

import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

let transport: Transporter | null = null;

function getTransport(): Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.email.host,
      port: env.email.port,
      secure: env.email.port === 465, // 465 = implicit TLS; 587 = STARTTLS
      auth: { user: env.email.user, pass: env.email.pass },
    });
  }
  return transport;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<boolean> {
  if (!env.email.enabled) return false;
  if (!opts.to) return false;
  try {
    await getTransport().sendMail({
      from: env.email.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      ...(opts.html ? { html: opts.html } : {}),
    });
    console.log(`[email] sent "${opts.subject}" to ${opts.to}`);
    return true;
  } catch (e) {
    console.warn(`[email] could not send to ${opts.to}: ${(e as Error).message}`);
    return false;
  }
}
