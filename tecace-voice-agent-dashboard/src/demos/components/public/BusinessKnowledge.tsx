import { Lock, Plus } from "lucide-react";
import { knownHours } from "@/lib/hours";
import type { BusinessProfile } from "@/lib/types";

type Props = {
  profile: BusinessProfile;
  /**
   * Called the moment someone tries to change something. The demo is
   * deliberately read-only, so the page answers with what to do instead.
   */
  onEditAttempt?: () => void;
};

/**
 * Everything here renders as the form it is in the live product, because the
 * point of the page is that this is the business's own copy to correct. The
 * fields are genuinely read-only — `readOnly` rather than `disabled`, so they
 * stay focusable and a screen reader says so — and touching one asks us to
 * make the change.
 */
const FIELD =
  "ta-body-2 h-10 w-full rounded-lg border border-input bg-transparent px-3 " +
  "text-left outline-none transition-colors hover:border-ring/60 " +
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Field({
  label,
  value,
  onEditAttempt,
}: {
  label: string;
  value?: string;
  onEditAttempt?: () => void;
}) {
  if (!value) return null;
  return (
    <label className="block space-y-1">
      <span className="ta-caption-1 text-muted-foreground">{label}</span>
      <input
        className={`${FIELD} cursor-pointer`}
        value={value}
        readOnly
        onFocus={onEditAttempt}
        onClick={onEditAttempt}
      />
    </label>
  );
}

function AreaField({
  label,
  value,
  onEditAttempt,
}: {
  label: string;
  value?: string;
  onEditAttempt?: () => void;
}) {
  if (!value) return null;
  return (
    <label className="block space-y-1">
      <span className="ta-caption-1 text-muted-foreground">{label}</span>
      <textarea
        className={`${FIELD} h-auto min-h-20 cursor-pointer py-2`}
        value={value}
        readOnly
        rows={3}
        onFocus={onEditAttempt}
        onClick={onEditAttempt}
      />
    </label>
  );
}

/** The row that says the list is yours to grow. */
function AddRow({
  children,
  onEditAttempt,
}: {
  children: React.ReactNode;
  onEditAttempt?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onEditAttempt}
      className={`${FIELD} text-muted-foreground hover:text-foreground flex items-center gap-2`}
    >
      <Plus className="size-4 shrink-0" aria-hidden />
      {children}
    </button>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="ta-headline-2">{title}</h3>
      {children}
    </section>
  );
}

export function BusinessKnowledge({ profile, onEditAttempt }: Props) {
  // A day the research could not pin down says nothing, so it shows nothing.
  const days = knownHours(profile.hours);
  const policies = profile.policies ?? {};

  return (
    <div className="space-y-6">
      <div className="bg-muted/50 flex items-start gap-3 rounded-lg p-3">
        <Lock className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="ta-caption-1 text-muted-foreground">
          This is the whole of what the receptionist knows, and it is yours to
          edit — correct a price, fix the hours, add the questions your callers
          actually ask. Editing is switched off while this is a demo. Tell us
          what to change and it answers that way on the next call.
        </p>
      </div>

      <Section title="The business">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" value={profile.name} onEditAttempt={onEditAttempt} />
          <Field
            label="Category"
            value={profile.category}
            onEditAttempt={onEditAttempt}
          />
          <Field label="Phone" value={profile.phone} onEditAttempt={onEditAttempt} />
          <Field
            label="Website"
            value={profile.website}
            onEditAttempt={onEditAttempt}
          />
          <Field
            label="Rating"
            value={profile.rating ? `${profile.rating} out of 5` : undefined}
            onEditAttempt={onEditAttempt}
          />
        </div>
        <div className="pt-3">
          <Field
            label="Address"
            value={profile.address}
            onEditAttempt={onEditAttempt}
          />
        </div>
      </Section>

      <Section title="Hours">
        <div className="space-y-2">
          {days.map((hour) => (
            <div key={hour.day} className="flex items-center gap-3">
              <span className="ta-caption-1 text-muted-foreground w-24 shrink-0">
                {hour.day}
              </span>
              <input
                className={`${FIELD} cursor-pointer tabular-nums`}
                value={hour.text}
                readOnly
                onFocus={onEditAttempt}
                onClick={onEditAttempt}
              />
            </div>
          ))}
          <AddRow onEditAttempt={onEditAttempt}>
            {days.length ? "Add a day, or a holiday" : "Add your opening hours"}
          </AddRow>
        </div>
      </Section>

      <Section title="Services">
        <div className="space-y-2">
          {profile.services?.map((service, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                className={`${FIELD} min-w-0 cursor-pointer`}
                value={service.name}
                readOnly
                onFocus={onEditAttempt}
                onClick={onEditAttempt}
              />
              {/*
                FIELD carries w-full, which every other field wants. Here it has
                to be beaten rather than appended to: two width utilities of the
                same weight leave the later one in the stylesheet winning, and
                w-full plus shrink-0 had the price box eating the whole row and
                squeezing the service name down to nothing.
              */}
              <input
                className={`${FIELD} w-28! shrink-0 cursor-pointer`}
                value={service.price ?? ""}
                placeholder="Price"
                readOnly
                onFocus={onEditAttempt}
                onClick={onEditAttempt}
              />
            </div>
          ))}
          <AddRow onEditAttempt={onEditAttempt}>Add a service or a price</AddRow>
        </div>
      </Section>

      {profile.highlights?.length ? (
        <Section title="Known for">
          <div className="space-y-2">
            {profile.highlights.map((highlight, index) => (
              <input
                key={index}
                className={`${FIELD} cursor-pointer`}
                value={highlight}
                readOnly
                onFocus={onEditAttempt}
                onClick={onEditAttempt}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {Object.values(policies).some(Boolean) ? (
        <Section title="Policies">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Reservations"
              value={policies.reservations}
              onEditAttempt={onEditAttempt}
            />
            <Field
              label="Walk-ins"
              value={policies.walkIns}
              onEditAttempt={onEditAttempt}
            />
            <Field
              label="Parking"
              value={policies.parking}
              onEditAttempt={onEditAttempt}
            />
            <Field
              label="Payment"
              value={policies.payment}
              onEditAttempt={onEditAttempt}
            />
            <Field
              label="Cancellation"
              value={policies.cancellation}
              onEditAttempt={onEditAttempt}
            />
            {policies.other?.map((entry, index) => (
              <Field
                key={index}
                label="Also"
                value={entry}
                onEditAttempt={onEditAttempt}
              />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Questions callers ask">
        <div className="space-y-3">
          {profile.faqs?.map((faq, index) => (
            <div key={index} className="space-y-1.5">
              <input
                className={`${FIELD} cursor-pointer font-medium`}
                value={faq.q}
                readOnly
                onFocus={onEditAttempt}
                onClick={onEditAttempt}
              />
              <textarea
                className={`${FIELD} text-muted-foreground h-auto min-h-16 cursor-pointer py-2`}
                value={faq.a}
                readOnly
                rows={2}
                onFocus={onEditAttempt}
                onClick={onEditAttempt}
              />
            </div>
          ))}
          <AddRow onEditAttempt={onEditAttempt}>
            Add a question your callers ask
          </AddRow>
        </div>
      </Section>

      <AreaField
        label="What reviews say"
        value={profile.reviewSummary}
        onEditAttempt={onEditAttempt}
      />
    </div>
  );
}
