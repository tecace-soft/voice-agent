import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  getBusinessProfile,
  listAccounts,
  saveAgentIdentity,
  saveHouseRules,
  saveBusinessProfile,
} from "../api/backend";
import type { AgentNumber, AuthUser, BusinessProfile, MailboxScope } from "../api/types";
import { accountErrorMessage } from "../auth";
import { IconAlert, IconCheck, IconChevronLeft, IconChevronRight, IconPhone } from "../icons";
import { formatDateTime, formatPhone } from "../lib";

// What the voice agent says about a customer's business, and where they change it.
//
// The customer writes ONE thing: a description of their business, in their own words. Everything
// the agent speaks is produced from that by the backend. They never see or edit a prompt, because
// asking a dentist to write one is asking the wrong person.
//
// The read view is therefore also the PREVIEW, and that is the point of splitting read from edit.
// Nobody can review a prompt, but anyone can read "here is what we'll say about you" and notice
// that their closing time is wrong. Without it, a customer's only feedback would come from a caller.

// Mirrors the agent's own AGENT_NAME default and the backend's MAX_* caps. Shown only as a hint
// and a soft cap — the backend validates for real and says what to fix — but if the agent's default
// name is ever changed, this hint is the other place that knows it.
const DEFAULT_AGENT_NAME = "Tess";
const MAX_AGENT_NAME = 40;
const MAX_GREETING = 240;

/** A worked example in the customer's own terms, using whatever name they've typed so far. */
function greetingExample(name: string): string {
  const who = name.trim() || DEFAULT_AGENT_NAME;
  return `Hello, you've reached {business}, this is ${who}. How may I help you today?`;
}

// Customers should not write their own recording notice: the agent splices the required one in,
// and a second copy would have callers told twice.
const discloseNote = " Any call-recording notice is added for you.";

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


/**
 * What this business wants the assistant to do differently — its own card, its own save.
 *
 * Separate from the description for the same reason the greeting is: the description is a paste box
 * a model reads facts out of, and these are instructions used as written. It is also the setting a
 * business changes most often once they have heard a few calls, so it does not belong three clicks
 * inside an edit form.
 */
function HouseRulesCard({
  profile,
  userId,
  onSaved,
}: {
  profile: BusinessProfile;
  userId?: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rules, setRules] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const lines = (profile.houseRules ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

  function startEditing() {
    setRules(profile.houseRules ?? "");
    setError(null);
    setJustSaved(false);
    setEditing(true);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveHouseRules(rules.trim(), userId);
      setEditing(false);
      setJustSaved(true);
      onSaved();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't save that. Nothing was changed."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <div className="card-toolbar">
        <div>
          <div className="card-title ta-headline-2">How it behaves on a call</div>
          <div className="card-sub ta-caption-1">
            Your own instructions to the assistant, in your words — what to mention, what to leave
            alone, what to tell people who ask. One per line.
          </div>
        </div>
        {!editing && (
          <button type="button" className="btn btn-quiet" onClick={startEditing}>
            {lines.length ? "Change" : "Set this up"}
          </button>
        )}
      </div>

      {!editing ? (
        <div className="business-status">
          {lines.length ? (
            <ul className="fact-list">
              {lines.map((line) => (
                <li key={line} className="ta-body-2">
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="ta-body-2 muted">
              Nothing set — the assistant answers the way it does by default. Add a line for
              anything you would tell a new receptionist on their first day.
            </p>
          )}
          {justSaved && <span className="badge badge-success">Updated</span>}
        </div>
      ) : (
        <form className="inline-form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label ta-caption-1">One instruction per line</span>
            <textarea
              className="input textarea"
              value={rules}
              onChange={(e) => setRules(e.target.value.slice(0, MAX_HOUSE_RULES))}
              rows={6}
              autoFocus
              placeholder={
                "Mention that tips for services are cash only.\n" +
                "Tell first-time guests to arrive fifteen minutes early.\n" +
                "Don't discuss other spas."
              }
            />
            <span className="field-hint ta-caption-2 muted">
              These are followed on top of the way the assistant already works: it will still never
              say something is booked, never promise what your team will do, never answer from
              anything but your business details, and always ask before putting a caller through.
              {rules.length > MAX_HOUSE_RULES - 200 && (
                <> {MAX_HOUSE_RULES - rules.length} characters left.</>
              )}
            </span>
          </label>
          {error && (
            <p className="error ta-body-2" role="alert">
              {error}
            </p>
          )}
          <div className="inline-form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
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
      )}
    </section>
  );
}

/**
 * How the assistant answers the phone — its own card, because it is its own decision.
 *
 * Deliberately NOT part of the business-description form. That form is a paste box: you write what
 * your business is and a model reads facts out of it. This is the opposite kind of setting — two
 * short values, used exactly as typed, that change what a caller hears in the first three seconds.
 * Editing one should never mean re-saving the other.
 */
function IdentityCard({
  profile,
  userId,
  onSaved,
}: {
  profile: BusinessProfile;
  userId?: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [hello, setHello] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // What a caller actually hears, placeholders resolved. This is the only place a customer can
  // check it — they never ring their own line.
  const spoken = (profile.greeting || greetingExample(profile.agentName ?? ""))
    .replace(/\{business\}/g, profile.businessName ?? "your business")
    .replace(/\{agent\}/g, profile.agentName || DEFAULT_AGENT_NAME);

  function startEditing() {
    setName(profile.agentName ?? "");
    setHello(profile.greeting ?? "");
    setError(null);
    setJustSaved(false);
    setEditing(true);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveAgentIdentity(name.trim(), hello.trim(), userId);
      setEditing(false);
      setJustSaved(true);
      onSaved();
    } catch (e) {
      setError(accountErrorMessage(e, "Couldn't save that."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <div className="card-toolbar">
        <div>
          <div className="card-title ta-headline-2">How it answers the phone</div>
          <div className="card-sub ta-caption-1">
            The name it gives and the first words a caller hears. Nothing here is read from your
            business description — it is said exactly as you write it.
          </div>
        </div>
        {!editing && (
          <button type="button" className="btn btn-quiet" onClick={startEditing}>
            {profile.greeting || profile.agentName ? "Change" : "Set this up"}
          </button>
        )}
      </div>

      {!editing ? (
        <div className="business-status">
          <p className="business-greeting ta-body-2">
            <span className="field-label ta-caption-1">
              Callers hear{!profile.greeting && " (the standard greeting)"}
            </span>
            <q>{spoken}</q>
            {justSaved && <span className="badge badge-success">Updated</span>}
          </p>
        </div>
      ) : (
        <form className="feedback-form" onSubmit={onSubmit}>
          {error && (
            <p className="error ta-label-1" role="alert">
              {error}
            </p>
          )}
          <label className="field">
            <span className="field-label ta-caption-1">What the assistant is called</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={DEFAULT_AGENT_NAME}
              maxLength={MAX_AGENT_NAME}
              autoFocus
            />
            <span className="field-hint ta-caption-2 muted">
              Leave it empty to use {DEFAULT_AGENT_NAME}.
            </span>
          </label>

          <label className="field">
            <span className="field-label ta-caption-1">The first thing it says</span>
            <textarea
              className="input textarea"
              value={hello}
              onChange={(e) => setHello(e.target.value.slice(0, MAX_GREETING))}
              rows={2}
              placeholder={greetingExample(name)}
            />
            <span className="field-hint ta-caption-2 muted">
              Word for word. Leave it empty for the standard greeting. Write{" "}
              <code>{"{business}"}</code> or <code>{"{agent}"}</code> and we'll fill those in.
              {discloseNote}
              {hello.trim().length > 0 && ` · ${hello.trim().length} of ${MAX_GREETING}`}
            </span>
          </label>

          <div className="inline-form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
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
      )}
    </section>
  );
}

// The backend's own limit (MAX_HOUSE_RULES). Enforced here too so the box stops rather than
// letting someone type a page and have the save rejected.
const MAX_HOUSE_RULES = 1500;

export function BusinessPage({
  isAdmin = false,
  scope,
  onScope,
}: {
  isAdmin?: boolean;
  /** Which customer an admin is looking at, held in the URL so a refresh stays put. */
  scope?: MailboxScope;
  onScope?: (next: MailboxScope) => void;
} = {}) {
  // An admin has no business of their own — they are TecAce staff, not a customer. So for them this
  // page is a way IN to somebody else's details, and it opens on the list rather than on an empty
  // profile that could never become live.
  const [customers, setCustomers] = useState<AuthUser[] | null>(null);
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [number, setNumber] = useState<AgentNumber | null>(null);
  const [maxChars, setMaxChars] = useState(20_000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [transferNumber, setTransferNumber] = useState("");
  const [transferTopics, setTransferTopics] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Who we're actually reading and writing. Undefined = the signed-in user's own.
  const viewing = isAdmin
    ? (customers ?? []).find((c) => c.email === scope) ?? null
    : null;
  const targetId = isAdmin ? viewing?.id : undefined;

  useEffect(() => {
    if (!isAdmin) return;
    listAccounts()
      .then((all) => setCustomers(all.filter((u) => u.role !== "admin")))
      .catch(() => setCustomers([]));
  }, [isAdmin]);

  const load = useCallback(() => {
    // An admin who hasn't picked anyone yet has nothing to load.
    if (isAdmin && !targetId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getBusinessProfile(targetId)
      .then((r) => {
        setProfile(r.profile);
        setNumber(r.number);
        setMaxChars(r.maxSourceChars);
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load these business details.")))
      .finally(() => setLoading(false));
  }, [isAdmin, targetId]);

  useEffect(() => {
    load();
  }, [load]);

  function startEditing() {
    setDraft(profile?.sourceText ?? "");
    setTransferNumber(profile?.transferNumber ?? "");
    setTransferTopics(profile?.transferTopics ?? "");
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
      const { profile: saved } = await saveBusinessProfile(
        draft.trim(),
        transferNumber.trim(),
        transferTopics.trim(),
        targetId,
      );
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

  // An admin with nobody selected: choose a customer. Shown instead of the profile, not above it,
  // because there is no profile to show until they pick — and an admin's own would always be empty.
  if (isAdmin && !viewing) {
    return (
      <div className="view">
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title ta-headline-2">Whose business information?</div>
              <div className="card-sub ta-caption-1">
                Pick a customer to see what the assistant says about them, and to edit it on their
                behalf. You don't have business details of your own — an admin account isn't a
                business the assistant answers for.
              </div>
            </div>
          </div>
          {customers === null ? (
            <p className="feedback-empty muted ta-body-2">Loading…</p>
          ) : customers.length === 0 ? (
            <p className="feedback-empty muted ta-body-2">
              No customer accounts yet. Add one under Accounts first.
            </p>
          ) : (
            <ul className="customer-list">
              {customers.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="customer-row"
                    onClick={() => onScope?.(c.email)}
                  >
                    <span className="person-identity">
                      <span className="person-primary ta-label-1">{c.name}</span>
                      <span className="person-secondary ta-caption-1 muted">{c.email}</span>
                    </span>
                    <IconChevronRight size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  if (loading) return <p className="muted ta-body-2">Loading…</p>;
  if (error) return <p className="error ta-body-2">{error}</p>;

  const state = stateOf(profile, number);
  const facts = factLines(profile?.facts ?? null);

  if (editing) {
    return (
      <div className="view">
      {isAdmin && viewing && (
        <div className="viewing-as" role="status">
          <button type="button" className="btn btn-quiet" onClick={() => onScope?.(undefined)}>
            <IconChevronLeft size={14} />
            All customers
          </button>
          <span className="ta-label-1">
            Editing <strong>{viewing.name}</strong>'s business information
          </span>
          <span className="ta-caption-2 muted">{viewing.email}</span>
        </div>
      )}
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

            <label className="field">
              <span className="field-label ta-caption-1">
                What else should reach a person (optional)
              </span>
              <textarea
                className="input textarea"
                value={transferTopics}
                onChange={(e) => setTransferTopics(e.target.value.slice(0, 400))}
                rows={3}
                placeholder="Gift certificate problems. Group bookings for more than six people."
              />
              <span className="field-hint ta-caption-2 muted">
                Booking, rescheduling and cancelling an appointment already go straight to a person.
                Add anything else specific to you.
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
      {isAdmin && viewing && (
        <div className="viewing-as" role="status">
          <button type="button" className="btn btn-quiet" onClick={() => onScope?.(undefined)}>
            <IconChevronLeft size={14} />
            All customers
          </button>
          <span className="ta-label-1">
            Editing <strong>{viewing.name}</strong>'s business information
          </span>
          <span className="ta-caption-2 muted">{viewing.email}</span>
        </div>
      )}
      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">
              {profile?.businessName || "Your business"}
            </div>
            <div className="card-sub ta-caption-1">
              {profile
                ? "Answering as this business. Details are further down the page."
                : "Add your business information and the assistant will start answering as you."}
            </div>
          </div>
          <button
            type="button"
            className={profile ? "btn btn-quiet" : "btn btn-primary"}
            onClick={startEditing}
          >
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
          {state === "empty" && (
            <p className="ta-caption-1 muted business-transfer">
              You'll also be able to set a number for the assistant to forward callers to when they
              ask for a person.
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
            <p className="business-live ta-label-1">
              <IconPhone size={14} />
              Answering calls to {formatPhone(number.phoneE164)}
              {justSaved && <span className="badge badge-success">Updated</span>}
            </p>
          )}
        </div>
      </section>

      {profile && <IdentityCard profile={profile} userId={targetId} onSaved={load} />}
      {profile && <HouseRulesCard profile={profile} userId={targetId} onSaved={load} />}

      {profile && (
        <section className="card">
          <div className="card-toolbar">
            <div>
              <div className="card-title ta-headline-2">When someone asks for a person</div>
              <div className="card-sub ta-caption-1">
                {profile.transferNumber
                  ? "The assistant offers to put them through, and this is the phone that rings."
                  : "No number set, so the assistant doesn't offer to put anyone through — it takes a message and passes it on instead."}
              </div>
            </div>
            <button type="button" className="btn btn-quiet" onClick={startEditing}>
              {profile.transferNumber ? "Change" : "Add a number"}
            </button>
          </div>
          {profile.transferTopics && (
            <p className="business-topics ta-caption-1 muted">
              Also put through: {profile.transferTopics}
            </p>
          )}
          <p className="business-transfer">
            {profile.transferNumber ? (
              <span className="number-cell ta-headline-2">
                <IconPhone size={16} />
                {formatPhone(profile.transferNumber)}
              </span>
            ) : (
              <span className="muted ta-body-2">Not set — calls are never forwarded.</span>
            )}
          </p>
        </section>
      )}

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
          <div className="card-toolbar">
            <div>
              <div className="card-title ta-headline-2">Your business information</div>
              <div className="card-sub ta-caption-1">
                Your own words, kept as you saved them. Everything the assistant knows is read from
                this.
              </div>
            </div>
            <button type="button" className="btn btn-primary" onClick={startEditing}>
              Edit
            </button>
          </div>
          <p className="business-source-read ta-body-2">{profile.sourceText}</p>
        </section>
      )}
    </div>
  );
}
