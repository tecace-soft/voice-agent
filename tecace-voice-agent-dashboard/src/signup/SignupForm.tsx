import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Link2, LockKeyhole, Mail, MailCheck, Store, UserRound, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { keepSession, signupApi, type SignedIn } from "./api";

// Signing up, for both public pages that do it:
//
//   * `claim` — "Request setup" on a demo's page. The sign-up is the request: the account is linked
//     to that demo, and an admin approves it before anything becomes editable.
//   * `start` — self-service at /start: their business's name and website or Maps link, and we build
//     the receptionist once the email is proven.
//
// Three steps: the details, the six-digit code from the email, and done. On a deployment with no
// email there is no code: a claim is saved as a request for an admin (`next: "requested"`), and
// /start does not show this form at all.

export type SignupMode = { kind: "claim"; demoId: string; businessName: string } | { kind: "start" };

type Props = {
  mode: SignupMode;
  /** Signed in: the caller decides what comes next (the dashboard, or building the receptionist). */
  onSignedIn: (result: SignedIn) => void;
  /** Saved without email (a claim on a deployment with no email): the request is with an admin. */
  onRequested?: () => void;
  /** Above the form, for the page to introduce it. */
  intro?: ReactNode;
};

const MIN_PASSWORD = 10;

export function SignupForm({ mode, onSignedIn, onRequested, intro }: Props) {
  const [step, setStep] = useState<"details" | "code">("details");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [link, setLink] = useState("");
  // Nobody sees this field; a script filling in every input fills it in too.
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  // /start is a page of its own, so its fields carry an icon and an example; the claim form sits in
  // a small panel on the demo page and stays plain.
  const start = mode.kind === "start";

  async function submitDetails(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
      return;
    }
    setBusy(true);
    try {
      if (mode.kind === "claim") {
        const res = await signupApi.claim({
          demoId: mode.demoId,
          name: name.trim(),
          email: email.trim(),
          password,
          phone: phone.trim() || undefined,
          note: note.trim() || undefined,
          website: trap || undefined,
        });
        if (!res.ok) return setError(res.message);
        if (res.body.next === "requested") return onRequested?.();
        setStep("code");
      } else {
        const url = link.trim();
        const maps = /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\./i.test(url);
        const res = await signupApi.start({
          name: name.trim(),
          email: email.trim(),
          password,
          business: {
            businessName: businessName.trim(),
            ...(url ? (maps ? { mapsUrl: url } : { websiteUrl: /^https?:\/\//i.test(url) ? url : `https://${url}` }) : {}),
          },
          website: trap || undefined,
        });
        if (!res.ok) return setError(res.message);
        setStep("code");
      }
    } finally {
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <CodeStep
        email={email.trim()}
        onBack={() => setStep("details")}
        onSignedIn={(result) => {
          keepSession(result.token);
          onSignedIn(result);
        }}
      />
    );
  }

  return (
    <form onSubmit={submitDetails} className="flex flex-col gap-4" noValidate={false}>
      {intro}
      {mode.kind === "start" ? (
        <>
          <Field id="su-business" label="Business name" icon={Store}>
            <Input id="su-business" placeholder="e.g. Harbor Dental" className={FIELD_INPUT} required maxLength={160} value={businessName} onChange={(e) => setBusinessName(e.target.value)} autoComplete="organization" />
          </Field>
          <Field id="su-link" label="Website or Google Maps link" icon={Link2} hint="We read it to learn your hours, services and the questions callers ask.">
            <Input id="su-link" className={FIELD_INPUT} required maxLength={1000} value={link} onChange={(e) => setLink(e.target.value)} placeholder="yourbusiness.com" inputMode="url" />
          </Field>
        </>
      ) : null}
      <Field id="su-name" label="Your name" icon={start ? UserRound : undefined}>
        <Input id="su-name" placeholder={start ? "First and last name" : undefined} className={start ? FIELD_INPUT : undefined} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <Field id="su-email" label="Work email" icon={start ? Mail : undefined}>
        <Input id="su-email" placeholder={start ? "you@yourbusiness.com" : undefined} className={start ? FIELD_INPUT : undefined} type="email" required maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </Field>
      <Field
        id="su-password"
        label="Password"
        icon={start ? LockKeyhole : undefined}
        hint={`At least ${MIN_PASSWORD} characters. You'll sign in with this email and password.`}
        aside={
          <button
            type="button"
            className="ta-caption-1 text-primary font-semibold underline-offset-2 hover:underline"
            aria-controls="su-password"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        }
      >
        <Input
          id="su-password"
          className={start ? FIELD_INPUT : undefined}
          type={showPassword ? "text" : "password"}
          required
          minLength={MIN_PASSWORD}
          maxLength={512}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      {mode.kind === "claim" ? (
        <>
          <Field id="su-phone" label="Phone (optional)">
            <Input id="su-phone" type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </Field>
          <Field id="su-note" label="Anything we should know? (optional)">
            <Textarea id="su-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="When you'd like to start, what to change first…" />
          </Field>
        </>
      ) : null}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Company site
          <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </label>
      </div>
      {error ? (
        <p role="alert" className="ta-caption-1 bg-destructive/10 text-destructive rounded-lg px-3 py-2">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={busy} className="h-11">
        {busy ? "Sending…" : mode.kind === "claim" ? "Request setup" : "Create my receptionist"}
        {start && !busy ? <ArrowRight className="size-4" aria-hidden /> : null}
      </Button>
      <p className="ta-caption-2 text-muted-foreground text-center">
        Already have an account?{" "}
        <a className="text-primary underline-offset-2 hover:underline" href="/">
          Sign in
        </a>
      </p>
    </form>
  );
}

function CodeStep({ email, onBack, onSignedIn }: { email: string; onBack: () => void; onSignedIn: (r: SignedIn) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [wait, setWait] = useState(60);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await signupApi.verify(email, code.replace(/\s/g, ""));
      if (!res.ok) return setError(res.message);
      onSignedIn(res.body);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNote(null);
    const res = await signupApi.resend(email);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setNote("A new code is on its way.");
    setWait(60);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-full">
          <MailCheck className="size-5" aria-hidden />
        </span>
        <div>
          <p className="ta-headline-2">Check your email</p>
          <p className="ta-body-2 text-muted-foreground">
            We sent a 6-digit code to <span className="text-foreground font-semibold">{email}</span>. It works for 15 minutes.
          </p>
        </div>
      </div>
      <Field id="su-code" label="Code">
        <Input
          id="su-code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="h-12 text-center font-mono text-[22px] tracking-[0.4em]"
          autoFocus
        />
      </Field>
      {error ? (
        <p role="alert" className="ta-caption-1 bg-destructive/10 text-destructive rounded-lg px-3 py-2">
          {error}
        </p>
      ) : null}
      {note ? (
        <p role="status" className="ta-caption-1 text-success flex items-center gap-1.5">
          <Check className="size-3.5" /> {note}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={busy || code.replace(/\s/g, "").length !== 6} className="h-11">
        {busy ? "Checking…" : "Continue"}
      </Button>
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" /> Change details
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={wait > 0} onClick={() => void resend()}>
          {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
        </Button>
      </div>
    </form>
  );
}

/** A taller input with room on the left for the field's icon. */
const FIELD_INPUT = "h-10 pl-10";

function Field({
  id,
  label,
  hint,
  icon: Icon,
  aside,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  /** Drawn inside the input, on the left; the input needs FIELD_INPUT to make room for it. */
  icon?: LucideIcon;
  /** At the right of the label, e.g. the password's Show. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="ta-label-1">
          {label}
        </Label>
        {aside}
      </div>
      {Icon ? (
        <div className="relative">
          <Icon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" aria-hidden />
          {children}
        </div>
      ) : (
        children
      )}
      {hint ? <p className="ta-caption-2 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
