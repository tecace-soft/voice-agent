import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { BackendError, submitIntake } from "./api/backend";
import type { IntakeInput } from "./api/types";

const LANGUAGES = ["English", "Korean"];

// We constrain the date picker to the future against the BUSINESS timezone (matches the backend's
// SCHEDULE_TIMEZONE), so a visitor in another timezone can't pick a day that's already past in
// Pacific. The specific appointment TIME is not chosen here anymore — the agent asks for it on the
// call — so the form only collects a date.
const TIME_ZONE = "America/Los_Angeles";

// Today's date ("YYYY-MM-DD") in the business timezone.
function todayInBusinessZone(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// The form's local state. Only a `date` (YYYY-MM-DD) is collected; it's sent as `requestedDate`
// on submit, and the agent captures the specific time on the call.
type FormState = Omit<IntakeInput, "requestedDate"> & { date: string };

const EMPTY: FormState = {
  language: "English",
  name: "",
  email: "",
  phoneNumber: "",
  purpose: "",
  date: "",
};

export function App() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const update =
    (field: keyof FormState) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { date, ...rest } = form;
      // Guard against a past day even if the input's `min` was bypassed (e.g. typed in). The agent
      // won't book a past time anyway; catch it here with a clear message.
      if (date < todayInBusinessZone()) {
        setError("Please choose a date that isn't in the past.");
        return;
      }
      const input: IntakeInput = { ...rest, requestedDate: date };
      await submitIntake(input);
      setSubmitted(true);
      setForm(EMPTY);
    } catch (err) {
      setError(
        err instanceof BackendError
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // The date picker is constrained to today or later (business timezone).
  const today = todayInBusinessZone();

  if (submitted) {
    return (
      <main className="card success">
        <h1>Thank you!</h1>
        <p>We've received your request and will call you back to set up a time on your chosen day.</p>
        <button type="button" onClick={() => setSubmitted(false)}>
          Submit another request
        </button>
      </main>
    );
  }

  return (
    <main className="card">
      <h1>Schedule Your Appointment</h1>
      <p className="subtitle">Tell us a bit about you and the day you'd like — we'll call to set a time.</p>

      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="language">Preferred language</label>
          <select id="language" value={form.language} onChange={update("language")}>
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="name">Full name</label>
          <input id="name" type="text" required value={form.name} onChange={update("name")} />
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required value={form.email} onChange={update("email")} />
        </div>

        <div className="field">
          <label htmlFor="phoneNumber">Phone number</label>
          <input
            id="phoneNumber"
            type="tel"
            required
            value={form.phoneNumber}
            onChange={update("phoneNumber")}
          />
        </div>

        <div className="field">
          <label htmlFor="purpose">What can we help you with?</label>
          <textarea
            id="purpose"
            required
            rows={3}
            value={form.purpose}
            onChange={update("purpose")}
            placeholder="Briefly, what you're interested in — e.g. AI adoption for our logistics operations."
          />
        </div>

        <div className="field">
          <label htmlFor="date">Preferred Date</label>
          <input
            id="date"
            type="date"
            required
            min={today}
            value={form.date}
            onChange={update("date")}
          />
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Request Scheduling"}
        </button>
      </form>
    </main>
  );
}
