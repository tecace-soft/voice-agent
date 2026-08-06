import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { BackendError, submitIntake } from "./api/backend";
import type { IntakeInput } from "./api/types";

const LANGUAGES = ["English", "Korean"];

// Bookable start times (spa hours), as { value: "HH:MM", label: "9:00 AM" }. A dropdown of
// explicit slots — NOT <input type="datetime-local"> — because that widget silently defaults
// the time to 12:00 AM, so anyone who picks only a date submits a midnight appointment. This
// forces a real time to be chosen. Covers 9:00 AM–4:30 PM in 30-minute steps.
const TIME_SLOTS: { value: string; label: string }[] = [];
for (let m = 9 * 60; m <= 16 * 60 + 30; m += 30) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const value = `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const label = `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  TIME_SLOTS.push({ value, label });
}

// The form's local state. `date` (YYYY-MM-DD) and `time` (HH:MM) are chosen separately and
// combined into a naive wall-clock `dateTime` on submit, which the backend reads in the spa's
// timezone.
type FormState = Omit<IntakeInput, "dateTime"> & { date: string; time: string };

const EMPTY: FormState = {
  language: "English",
  name: "",
  email: "",
  phoneNumber: "",
  date: "",
  time: "",
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
      const { date, time, ...rest } = form;
      const input: IntakeInput = {
        ...rest,
        // Combine the chosen date + time into a naive wall-clock string. Sent AS-IS (no
        // browser-timezone conversion) so the backend interprets it in the spa's timezone —
        // "2 PM" always means 2 PM at the spa, regardless of the visitor's browser timezone.
        dateTime: `${date}T${time}:00`,
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
          <label htmlFor="date">Preferred Date</label>
          <input
            id="date"
            type="date"
            required
            value={form.date}
            onChange={update("date")}
          />
        </div>

        <div className="field">
          <label htmlFor="time">Preferred Time</label>
          <select id="time" required value={form.time} onChange={update("time")}>
            <option value="" disabled>
              Select a time…
            </option>
            {TIME_SLOTS.map((slot) => (
              <option key={slot.value} value={slot.value}>
                {slot.label}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Request Scheduling"}
        </button>
      </form>
    </main>
  );
}
