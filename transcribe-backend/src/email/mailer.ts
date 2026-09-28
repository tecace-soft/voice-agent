import { env } from "../config/env.js";

// Transactional email: sign-up codes, password resets, sign-in links, "you can edit now", and the
// admin's new-request notice.
//
// BEST EFFORT, like backend-app's `email/client.ts`: a send that fails is logged and answered
// `false`, and the caller's own flow carries on. A customer approved while the mail server was down
// is still approved; the admin screen shows whether the email went.
//
// Links are built from DASHBOARD_URL only (`dashboardLink`), never from a request's Host header, so a
// forged header can't aim a reset link at somebody else's site.
//
// Tests swap the transport for an outbox (`useTestMailer`), which also stands in for "configured".

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

type Send = (mail: Mail) => Promise<void>;

let testOutbox: Mail[] | null = null;
let testFail = false;
let transport: { sendMail: (m: Record<string, unknown>) => Promise<unknown> } | null = null;

/** Tests: collect mail in `outbox` instead of sending it, or (null) go back to the real config. */
export function useTestMailer(outbox: Mail[] | null, opts: { fail?: boolean } = {}): void {
  testOutbox = outbox;
  testFail = opts.fail ?? false;
}

/** Can this deployment send email at all? Decides whether sign-up by code is open. */
export function mailConfigured(): boolean {
  return testOutbox ? true : env.mailEnabled;
}

const SEND_TIMEOUT_MS = 10_000;

async function realSend(mail: Mail): Promise<void> {
  if (!transport) {
    // Imported on first use, so a deployment with no SMTP never loads it.
    const nodemailer = (await import("nodemailer")).default;
    transport = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465, // 465 = implicit TLS; 587 = STARTTLS
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
  }
  await transport.sendMail({ from: env.smtp.from, to: mail.to, subject: mail.subject, text: mail.text });
}

const send: Send = async (mail) => {
  if (testOutbox) {
    if (testFail) throw new Error("test mailer failure");
    testOutbox.push(mail);
    return;
  }
  await realSend(mail);
};

export async function sendMail(mail: Mail): Promise<boolean> {
  if (!mailConfigured() || !mail.to) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      send(mail),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), SEND_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch (err) {
    console.warn(`[email] could not send "${mail.subject}": ${(err as Error).message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** A link into the dashboard, or null when DASHBOARD_URL is not set. `path` starts with "/". */
export function dashboardLink(path: string): string | null {
  return env.dashboardUrl ? `${env.dashboardUrl}${path}` : null;
}

// ---- the messages ----------------------------------------------------------------------------

const SIGN = "\n\n— TecAce Voice Agent";

export function codeMail(to: string, code: string, purpose: "signup"): Mail {
  void purpose;
  return {
    to,
    subject: `Your code: ${code}`,
    text:
      `Your verification code is ${code}.\n\n` +
      "Enter it on the page where you signed up. It works for 15 minutes.\n\n" +
      "If you didn't sign up, you can ignore this email." +
      SIGN,
  };
}

export function alreadyHaveAccountMail(to: string): Mail {
  const login = dashboardLink("/");
  return {
    to,
    subject: "You already have an account",
    text:
      "Someone (probably you) tried to sign up with this email, but it already has an account.\n\n" +
      (login ? `Sign in here: ${login}\n` : "Sign in to the dashboard with your password.\n") +
      "Forgot your password? Use \"Forgot password\" on the sign-in page.\n\n" +
      "If this wasn't you, you can ignore this email." +
      SIGN,
  };
}

export function resetMail(to: string, link: string): Mail {
  return {
    to,
    subject: "Reset your password",
    text:
      `Set a new password here (the link works for 60 minutes, once):\n${link}\n\n` +
      "If you didn't ask for this, you can ignore this email — your password hasn't changed." +
      SIGN,
  };
}

export function inviteMail(to: string, name: string, link: string): Mail {
  return {
    to,
    subject: "Your receptionist is ready to set up",
    text:
      `Hi ${name},\n\n` +
      `Choose a password to sign in (the link works for 7 days, once):\n${link}\n\n` +
      "Everything from your demo is already there. Edit it, try it with a test call, and we'll switch " +
      "your phone line on when the checklist is done." +
      SIGN,
  };
}

export function approvedMail(to: string, name: string): Mail {
  const login = dashboardLink("/");
  return {
    to,
    subject: "You can edit your receptionist now",
    text:
      `Hi ${name},\n\n` +
      "We've approved your setup. Everything from your demo is now yours to edit: business details, " +
      "answers, transfers, texts and bookings. Try each change with a test call.\n\n" +
      (login ? `Sign in: ${login}\n\n` : "") +
      "We'll switch your phone line on when the checklist is done." +
      SIGN,
  };
}

export function adminNoticeMail(input: {
  to: string;
  kind: "request" | "signup";
  name: string;
  email: string;
  business: string;
  note?: string | null;
  verified: boolean;
}): Mail {
  const open = dashboardLink("/#/demo/customers");
  const what = input.kind === "signup" ? "New sign-up" : "Setup requested";
  return {
    to: input.to,
    subject: `${what}: ${input.business}`,
    text:
      `${what} for ${input.business}.\n\n` +
      `Name: ${input.name}\nEmail: ${input.email}${input.verified ? " (verified)" : " (not verified)"}\n` +
      (input.note ? `Note: ${input.note}\n` : "") +
      (open ? `\nReview it: ${open}` : "") +
      SIGN,
  };
}
