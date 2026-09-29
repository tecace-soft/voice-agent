import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  getBusinessProfile,
  getReadiness,
  listAccounts,
  saveBusinessProfile,
  type Readiness,
} from "../api/backend";
import type {
  AgentNumber,
  AuthUser,
  BehaviourDefault,
  BusinessProfile,
  MailboxScope,
} from "../api/types";
import { accountErrorMessage } from "../auth";
import { TopbarMain } from "../chrome";
import { BusinessSettings } from "../settings/BusinessSettings";
import type { SectionId } from "../routing";
import { IconAlert, IconChevronLeft, IconChevronRight, IconPhone } from "../icons";
import { formatPhone } from "../lib";

// What the voice agent says about a customer's business, and where they change it.
//
// A customer starts by describing their business in their own words; the backend reads that into the
// structured profile. From then on the receptionist is configured in the settings studio, which takes
// the whole screen with the business's name and line status in the app's top bar
// (src/settings/BusinessSettings.tsx): what it knows, how it sounds, who it transfers
// to, which links it texts, and how to switch the line on.

const PLACEHOLDER = `Paste anything you already have — your website's About page, a services list, an email you send new customers. Plain sentences work just as well.

Useful to include: what the business does, where it is, opening hours, the services people ring about, prices if you quote them, and your website.`;

/** Which of the four real situations this customer is in. Each needs a different thing said. */
type State = "empty" | "live" | "not-live" | "no-number";

function stateOf(profile: BusinessProfile | null, number: AgentNumber | null): State {
  if (!profile) return "empty";
  if (!profile.isLive) return "not-live";
  return number ? "live" : "no-number";
}


export function BusinessPage({
  isAdmin = false,
  scope,
  onScope,
  section,
  onSection,
}: {
  isAdmin?: boolean;
  /** Which settings section is open, held in the URL. */
  section?: SectionId;
  onSection?: (section: SectionId) => void;
  /** Which customer an admin is looking at, held in the URL so a refresh stays put. */
  scope?: MailboxScope;
  onScope?: (next: MailboxScope) => void;
} = {}) {
  // An admin has no business of their own — they are TecAce staff, not a customer. So for them this
  // page is a way IN to somebody else's details, and it opens on the list rather than on an empty
  // profile that could never become live.
  const [customers, setCustomers] = useState<AuthUser[] | null>(null);
  // Once, the first time a customer opens their own business after approval: where they are and
  // what to do. Remembered per browser; nothing depends on it.
  const [welcome, setWelcome] = useState(() => {
    try {
      return !localStorage.getItem("business-welcome-seen");
    } catch {
      return false;
    }
  });
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  // What the assistant does before this business adds anything — sent with the profile so the
  // page never has its own stale copy of the agent's behaviour.
  const [standard, setStandard] = useState<BehaviourDefault[]>([]);
  // Their saved facts came from an older reader, so the description would produce more (or better)
  // facts today. Invisible otherwise: the page looks fine and only callers find the gaps.
  const [factsStale, setFactsStale] = useState(false);
  // There is a description on file but nothing read out of it into the structured shape yet. The
  // Knowledge tab then offers the re-read instead of a form.
  const [needsReread, setNeedsReread] = useState(false);
  const [rereading, setRereading] = useState(false);
  const [number, setNumber] = useState<AgentNumber | null>(null);
  // The account's stage and Go live checklist. Only an account being set up (pre-production) shows
  // it: its line is off until an admin goes live, whatever the number and profile say. Null when the
  // read fails — the page then says what it always said.
  const [readiness, setReadiness] = useState<Readiness | null>(null);
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

  // `quiet` re-reads without the Loading screen: after a settings section saves, the page only needs
  // its header and live state brought up to date, and swapping the whole page for "Loading…" would
  // unmount the settings screen and throw away every other section's unsaved edits.
  const load = useCallback((quiet = false) => {
    // An admin who hasn't picked anyone yet has nothing to load. One who has, but whose accounts
    // list hasn't arrived, stays loading until it does and `targetId` is known.
    if (isAdmin && !targetId) {
      if (!scope) setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    getBusinessProfile(targetId)
      .then((r) => {
        setProfile(r.profile);
        setNumber(r.number);
        setMaxChars(r.maxSourceChars);
        setStandard(r.defaultBehaviour ?? []);
        setFactsStale(Boolean(r.factsStale));
        setNeedsReread(Boolean(r.needsReread));
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load these business details.")))
      .finally(() => setLoading(false));
    getReadiness(targetId)
      .then(setReadiness)
      .catch(() => setReadiness(null));
  }, [isAdmin, targetId, scope]);

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

  async function onReread() {
    if (!profile) return;
    setRereading(true);
    setSaveError(null);
    try {
      const { profile: saved } = await saveBusinessProfile(
        profile.sourceText,
        profile.transferNumber ?? "",
        profile.transferTopics ?? "",
        targetId,
      );
      setProfile(saved);
      setFactsStale(false);
      load(true); // quiet: the Loading screen would unmount the settings and drop unsaved edits
    } catch (e) {
      setSaveError(accountErrorMessage(e, "Couldn't re-read your details. Nothing was changed."));
    } finally {
      setRereading(false);
    }
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
  if (isAdmin && scope && customers === null) return <p className="muted ta-body-2">Loading…</p>;
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
  const onboarding = readiness?.status === "pre-production";

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

  // No business information yet: the page is one card asking for it, in the ordinary chrome.
  if (!profile) {
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
              <div className="card-title ta-headline-2">Your business</div>
              <div className="card-sub ta-caption-1">
                Add your business information and the assistant will start answering as you.
              </div>
            </div>
            <button type="button" className="btn btn-primary" onClick={startEditing}>
              Add your business information
            </button>
          </div>
          <div className="business-status">
            <p className="ta-body-2 muted">
              Nothing here yet. Add your business information and the assistant will start answering
              as you. Until then it still picks up — it takes a message and offers to put people
              through, it just doesn't say who it's answering for.
            </p>
            <p className="ta-caption-1 muted business-transfer">
              You'll also be able to set a number for the assistant to forward callers to when they
              ask for a person.
            </p>
          </div>
        </section>
      </div>
    );
  }

  // The business card, folded into the app's top bar (B2, src/chrome.tsx): whose business this is,
  // and whether the line is answering. What the card said at length goes in one line across the top
  // of the settings.
  const name = profile.businessName || "Your business";
  const status =
    onboarding ? (
      <Pill tone="amber">Being set up</Pill>
    ) : state === "live" && number ? (
      <Pill tone="green">
        <IconPhone size={12} />
        Answering {formatPhone(number.phoneE164)}
      </Pill>
    ) : state === "no-number" ? (
      <Pill tone="amber">No number yet</Pill>
    ) : (
      <Pill tone="red">Taking messages only</Pill>
    );

  const header = (
    <>
      <nav className="ta-label-1 flex min-w-16 shrink items-center gap-1.5 overflow-hidden whitespace-nowrap" aria-label="Breadcrumb">
        <span className="hidden items-center gap-1.5 lg:flex">
        {isAdmin ? (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onScope?.(undefined)}
            title="All customers"
          >
            Business information
          </button>
        ) : (
          <span className="text-muted-foreground">Business information</span>
        )}
        <span className="text-muted-foreground/60" aria-hidden>
          /
        </span>
        </span>
        <h1 className="ta-label-1 truncate font-semibold!" title={viewing ? `${viewing.name} · ${viewing.email}` : undefined}>
          {name}
        </h1>
      </nav>
      <span className="flex shrink-0 items-center gap-1.5">
        {status}
        {justSaved ? <Pill tone="blue">Updated</Pill> : null}
      </span>
      <span className="flex-1" />
    </>
  );

  const dismissWelcome = () => {
    setWelcome(false);
    try {
      localStorage.setItem("business-welcome-seen", "1");
    } catch {
      /* a remembered dismissal is a nicety */
    }
  };
  const welcomeLine =
    onboarding && !viewing && welcome ? (
      <div className="bg-primary/5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-4 py-2.5" role="status">
        <span className="ta-caption-1 min-w-0 flex-1">
          <b className="font-semibold">Welcome — it's yours now.</b> Everything from your demo is here. Change anything,
          then try it with a test call; callers only get what you publish, once your line is on.
        </span>
        <button type="button" className="ta-caption-1 text-primary hover:underline" onClick={dismissWelcome}>
          Got it
        </button>
      </div>
    ) : null;

  const statusNotice =
    onboarding && readiness ? (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5" role="status" aria-label="Go live checklist">
        <span className="ta-caption-1">
          {viewing ? "Being set up." : "You're being set up."} The line stays off until everything required is ticked
          and {viewing ? "you switch it on from Accounts" : "we switch it on"}. Test calls work meanwhile.
        </span>
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {readiness.items.map((item) => (
            <li
              key={item.id}
              className={`ta-caption-1 flex items-center gap-1 ${
                item.ok ? "text-success" : item.required ? "text-destructive" : "text-warning"
              }`}
            >
              <span aria-hidden>{item.ok ? "✓" : item.required ? "✕" : "!"}</span>
              {item.label}
              {!item.required && !item.ok ? " (recommended)" : ""}
            </li>
          ))}
        </ul>
      </div>
    ) : state === "not-live" ? (
      <p className="bg-destructive/5 ta-caption-1 flex items-center gap-2 px-4 py-2.5" role="status">
        <IconAlert size={14} />
        We couldn't get enough from what you wrote to answer as your business — it needs at least your name and
        what you do. The assistant is taking messages in the meantime.
      </p>
    ) : state === "no-number" ? (
      <p className="bg-warning/5 ta-caption-1 flex items-center gap-2 px-4 py-2.5" role="status">
        <IconAlert size={14} />
        Saved, but not in use yet — there's no phone number assigned. Ask your administrator to assign one and this
        starts answering calls straight away.
      </p>
    ) : null;

  return (
    /*
      Everything the assistant knows, says and may do, as one settings screen with a menu — the same
      one a demo's page has (src/settings/). It takes the whole screen, with this page's header in the
      app's top bar.
    */
    <div className="tw">
      <TopbarMain>{header}</TopbarMain>
      <BusinessSettings
        profile={profile}
        number={number}
        standard={standard}
        needsReread={needsReread}
        factsStale={factsStale}
        rereading={rereading}
        onReread={() => void onReread()}
        onEditDescription={startEditing}
        userId={targetId}
        isAdmin={isAdmin}
        section={section}
        onSection={(next) => onSection?.(next)}
        phase={onboarding ? "onboarding" : undefined}
        notice={
          welcomeLine || statusNotice ? (
            <>
              {welcomeLine}
              {statusNotice}
            </>
          ) : null
        }
        onSaved={(next) => {
          setProfile(next);
          setJustSaved(true);
          // The header and the live state read the same row.
          void load(true);
        }}
      />
    </div>
  );
}

function Pill({ tone, children }: { tone: "green" | "amber" | "red" | "blue"; children: ReactNode }) {
  const colour = {
    green: "bg-success/15 text-success",
    amber: "bg-warning/15 text-warning",
    red: "bg-destructive/10 text-destructive",
    blue: "bg-primary/10 text-primary",
  }[tone];
  return (
    <span className={`ta-caption-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold whitespace-nowrap ${colour}`}>
      {children}
    </span>
  );
}
