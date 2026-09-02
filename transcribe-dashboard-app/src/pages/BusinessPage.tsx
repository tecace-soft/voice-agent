import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getBusinessProfile, saveBusinessProfile } from "../api/backend";
import type { AgentNumber, BusinessProfile } from "../api/types";
import { accountErrorMessage } from "../auth";
import { IconAlert, IconCheck, IconPhone } from "../icons";
import { formatDateTime } from "../lib";

// What the voice agent says about a customer's business, and where they change it.
//
// The customer writes ONE thing: a description of their business, in their own words. Everything
// the agent speaks is produced from that by the backend. They never see or edit a prompt, because
// asking a dentist to write one is asking the wrong person.
//
// The read view is therefore also the PREVIEW, and that is the point of splitting read from edit.
// Nobody can review a prompt, but anyone can read "here is what we'll say about you" and notice
// that their closing time is wrong. Without it, a customer's only feedback would come from a caller.

const PLACEHOLDER = `Paste anything you already have — your website's About page, a services list, an email you send new customers. Plain sentences work just as well.

Useful to include: what the business does, where it is, opening hours, the services people ring about, prices if you quote them, and your website.`;

function factLines(facts: string | null): string[] {
  return (facts ?? "")
    .split("\n")
    .map((line) => line.replace(/^[-\s]+/, "").trim())
    .filter(Boolean);
}

/** Which of the four real situations this customer is in. Each needs a different thing said. */
type State = "empty" | "live" | "not-live" | "no-number";

function stateOf(profile: BusinessProfile | null, number: AgentNumber | null): State {
  if (!profile) return "empty";
  if (!profile.isLive) return "not-live";
  return number ? "live" : "no-number";
}

export function BusinessPage() {
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [number, setNumber] = useState<AgentNumber | null>(null);
  const [maxChars, setMaxChars] = useState(20_000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [transferNumber, setTransferNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(() => {
    getBusinessProfile()
      .then((r) => {
        setProfile(r.profile);
        setNumber(r.number);
        setMaxChars(r.maxSourceChars);
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load your business details.")))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startEditing() {
    setDraft(profile?.sourceText ?? "");
    setTransferNumber(profile?.transferNumber ?? "");
    setSaveError(null);
    setJustSaved(false);
    setEditing(true);
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { profile: saved } = await saveBusinessProfile(draft.trim(), transferNumber.trim());
      setProfile(saved);
      setEditing(false);
      setJustSaved(true);
      load(); // picks up the number too, in case it was assigned while they were typing
    } catch (e) {
      // A failed save changed nothing — whatever was live is still live and still being spoken.
      // The message from the backend says what to do, so it is shown as-is rather than replaced
      // with something generic.
      setSaveError(accountErrorMessage(e, "Couldn't save your details. Nothing was changed."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="muted ta-body-2">Loading…</p>;
  if (error) return <p className="error ta-body-2">{error}</p>;

  const state = stateOf(profile, number);
  const facts = factLines(profile?.facts ?? null);

  if (editing) {
    return (
      <div className="view">
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title ta-headline-2">Your business, in your own words</div>
              <div className="card-sub ta-caption-1">
                Write or paste it however you like — we turn it into what the assistant says. There's
                no format to get right, and you can change it whenever you want.
              </div>
            </div>
          </div>

          <form className="feedback-form" onSubmit={onSave}>
            {saveError && (
              <p className="error ta-label-1" role="alert">
                {saveError}
              </p>
            )}
            <label className="field">
              <span className="field-label ta-caption-1">About your business</span>
              <textarea
                className="input textarea business-source"
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, maxChars))}
                rows={16}
                placeholder={PLACEHOLDER}
                autoFocus
              />
              <span className="field-hint ta-caption-2 muted">
                {draft.length.toLocaleString()} of {maxChars.toLocaleString()} characters
              </span>
            </label>

            <label className="field">
              <span className="field-label ta-caption-1">
                Put callers through to (optional)
              </span>
              <input
                className="input"
                value={transferNumber}
                onChange={(e) => setTransferNumber(e.target.value)}
                placeholder="+1 206 555 1234"
                inputMode="tel"
              />
              <span className="field-hint ta-caption-2 muted">
                When someone asks to speak to a person, this is the phone that rings. Leave it empty
                and the assistant won't offer to put anyone through — it takes a message instead.
              </span>
            </label>

            <div className="inline-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving || !draft.trim()}>
                {saving ? "Reading it through…" : "Save"}
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="view">
      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">
              {profile?.businessName || "Your business"}
            </div>
            <div className="card-sub ta-caption-1">
              What the assistant says when someone calls you.
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={startEditing}>
            {profile ? "Edit" : "Add your business information"}
          </button>
        </div>

        <div className="business-status">
          {state === "empty" && (
            <p className="ta-body-2 muted">
              Nothing here yet. Add your business information and the assistant will start answering
              as you. Until then it still picks up — it takes a message and offers to put people
              through, it just doesn't say who it's answering for.
            </p>
          )}
          {state === "not-live" && (
            <p className="notice notice-slim" role="status">
              <IconAlert size={14} />
              We couldn't get enough from what you wrote to answer as your business — it needs at
              least your name and what you do. The assistant is taking messages in the meantime.
            </p>
          )}
          {state === "no-number" && (
            <p className="notice notice-slim" role="status">
              <IconAlert size={14} />
              Saved, but not in use yet — you don't have a phone number assigned. Ask your
              administrator to assign one and this starts answering calls straight away.
            </p>
          )}
          {state === "live" && number && (
            <>
              <p className="business-live ta-label-1">
                <IconPhone size={14} />
                Answering calls to {number.phoneE164}
                {justSaved && <span className="badge badge-success">Updated</span>}
              </p>
              <p className="ta-caption-1 muted business-transfer">
                {profile?.transferNumber
                  ? `Callers who ask for a person are put through to ${profile.transferNumber}.`
                  : "Nobody to put callers through to — the assistant takes a message instead."}
              </p>
            </>
          )}
        </div>
      </section>

      {profile && facts.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title ta-headline-2">What the assistant knows about you</div>
              <div className="card-sub ta-caption-1">
                Only these. It answers from them and defers anything else to a person — so if
                something here is wrong, callers will hear it wrong.
              </div>
            </div>
          </div>
          <ul className="business-facts">
            {facts.map((fact) => (
              <li key={fact} className="ta-body-2">
                <IconCheck size={14} />
                <span>{fact}</span>
              </li>
            ))}
          </ul>
          {profile.extractedAt && (
            <p className="muted ta-caption-1 view-foot">
              Read from what you wrote on {formatDateTime(profile.extractedAt)}. It will never quote
              a price you haven't given, agree a deadline, or discuss a contract — those always go to
              a person.
            </p>
          )}
        </section>
      )}

      {profile && (
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title ta-headline-2">What you wrote</div>
              <div className="card-sub ta-caption-1">
                Your own words, kept as you saved them. This is the part you edit.
              </div>
            </div>
          </div>
          <p className="business-source-read ta-body-2">{profile.sourceText}</p>
        </section>
      )}
    </div>
  );
}
