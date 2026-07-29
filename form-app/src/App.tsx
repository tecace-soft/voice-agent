import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { BackendError, submitIntake } from "./api/backend";
import type { IntakeInput } from "./api/types";

const LANGUAGES = ["English", "Korean"];

// The form's local state. `dateTime` holds the raw value from <input type="datetime-local">
// (a local wall-clock string with no timezone); it is converted to ISO 8601 on submit.
type FormState = Omit<IntakeInput, "dateTime"> & { dateTime: string };

const EMPTY: FormState = {
  language: "English",
  name: "",
  email: "",
  phoneNumber: "",
  purpose: "",
  dateTime: "",
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
      const input: IntakeInput = {
        ...form,
        // datetime-local is local wall-clock; convert to an ISO 8601 UTC instant.
        dateTime: new Date(form.dateTime).toISOString(),
      };
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

  if (submitted) {
    return (
      <main className="card success">
        <h1>Thank you!</h1>
        <p>We've received your request and will call you back at your chosen time.</p>
        <button type="button" onClick={() => setSubmitted(false)}>
          Submit another request
        </button>
      </main>
    );
  }

  return (
    <main className="card">
      <h1>Request a Callback</h1>
      <p className="subtitle">Tell us a bit about you and when to call.</p>

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
          <label htmlFor="purpose">What can we help with?</label>
          <textarea id="purpose" required value={form.purpose} onChange={update("purpose")} />
        </div>

        <div className="field">
          <label htmlFor="dateTime">Preferred callback time</label>
          <input
            id="dateTime"
            type="datetime-local"
            required
            value={form.dateTime}
            onChange={update("dateTime")}
          />
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Request callback"}
        </button>
      </form>
    </main>
  );
}
