import { useCallback, useEffect, useState, type FormEvent } from "react";
import { listMyFeedback, sendFeedback } from "../api/backend";
import type { Feedback, FeedbackCategory } from "../api/types";
import { accountErrorMessage } from "../auth";
import { CategoryBadge, CATEGORIES, ScreenshotThumb, StatusBadge } from "../components/feedbackBits";
import { ScreenshotField, useScreenshot } from "../components/ScreenshotField";
import { IconMessage } from "../icons";
import { formatDateTime } from "../lib";
import { imageFromClipboard } from "../screenshot";

// Where anyone signed in writes to the team — a bug, an idea, a question about the numbers. Below
// the form is what you've already sent, so you can see it landed and whether it's been dealt with.
const MAX_LENGTH = 4000;

export function FeedbackPage() {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const shot = useScreenshot();

  const [mine, setMine] = useState<Feedback[] | null>(null);

  const load = useCallback(() => {
    listMyFeedback()
      .then(setMine)
      .catch(() => setMine([])); // the form is the point of this page; an empty history is fine
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendFeedback(category, message.trim(), shot.value);
      setMessage("");
      shot.clear();
      setSent(true);
      load();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't send that. Try again."));
    } finally {
      setSending(false);
    }
  }

  const chosen = CATEGORIES.find((c) => c.id === category);

  return (
    <div className="view">
      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title ta-headline-2">Send feedback</div>
            <div className="card-sub ta-caption-1">
              Goes straight to the TecAce team — no ticket, no reply address needed.
            </div>
          </div>
        </div>

        <form
          className="feedback-form"
          onSubmit={onSubmit}
          onPaste={(e) => {
            const image = imageFromClipboard(e.clipboardData?.items ?? null);
            if (!image) return; // a normal text paste — leave it to the textarea
            e.preventDefault();
            void shot.accept(image);
          }}
        >
          {error && (
            <p className="error ta-label-1" role="alert">
              {error}
            </p>
          )}
          {sent && !error && (
            <p className="notice notice-slim" role="status">
              <IconMessage size={14} />
              Thanks — that's with the team. Send another any time.
            </p>
          )}

          <fieldset className="choice-grid">
            <legend className="field-label ta-caption-1">What's this about?</legend>
            {CATEGORIES.map((c) => (
              <label key={c.id} className={`choice${category === c.id ? " is-active" : ""}`}>
                <input
                  type="radio"
                  name="category"
                  value={c.id}
                  checked={category === c.id}
                  onChange={() => setCategory(c.id)}
                />
                <span className="ta-label-1">{c.label}</span>
              </label>
            ))}
          </fieldset>

          <label className="field">
            <span className="field-label ta-caption-1">Your message</span>
            <textarea
              className="input textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_LENGTH))}
              rows={6}
              required
              placeholder={chosen?.hint || "Tell us what's on your mind."}
            />
            <span className="field-hint ta-caption-2 muted">
              {message.length}/{MAX_LENGTH} · include a date or a run if it helps us find it
            </span>
          </label>

          <ScreenshotField shot={shot} busy={sending} />

          <div className="inline-form-actions">
            <button type="submit" className="btn btn-primary" disabled={sending || !message.trim()}>
              {sending ? "Sending…" : "Send feedback"}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">What you've sent</div>
            <div className="card-sub ta-caption-1">
              Only yours — everyone's notes go to the team, not to each other.
            </div>
          </div>
        </div>

        {mine === null ? (
          <p className="feedback-empty muted ta-body-2">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="feedback-empty muted ta-body-2">
            Nothing yet. Anything you send will show up here.
          </p>
        ) : (
          <ul className="feedback-list">
            {mine.map((note) => (
              <li key={note.id} className="feedback-item">
                <div className="feedback-meta">
                  <CategoryBadge category={note.category} />
                  <StatusBadge note={note} />
                  <span className="ta-caption-1 muted">{formatDateTime(note.createdAt)}</span>
                </div>
                <p className="feedback-message ta-body-2">{note.message}</p>
                {note.screenshot && <ScreenshotThumb src={note.screenshot} />}
                {note.status === "resolved" && note.resolvedBy && (
                  <p className="ta-caption-1 muted feedback-resolved">
                    Marked resolved by {note.resolvedBy}
                    {note.resolvedAt ? ` · ${formatDateTime(note.resolvedAt)}` : ""}.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
