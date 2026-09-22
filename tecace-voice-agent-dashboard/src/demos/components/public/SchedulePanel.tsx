
import { CalendarCheck, Plus } from "lucide-react";
import {
  INTEGRATIONS,
  INTEGRATION_GROUPS,
  integrationGroupsFor,
  type Integration,
} from "@/lib/integrations";
import { demoWeek, hoursUnknown } from "@/lib/schedule";
import { businessNouns } from "@/lib/use-cases";
import type { BusinessProfile } from "@/lib/types";

type Props = {
  profile: BusinessProfile;
  agentName: string;
  /**
   * Called when someone tries to work the mock-up. Nothing here is connected,
   * so the page answers with what to do instead. Left out on the admin side,
   * where the operator already knows.
   */
  onLocked?: () => void;
};

/**
 * Microsoft withdrew their marks from Simple Icons, and Outlook is the second
 * calendar every business names, so it is drawn rather than left out. Four
 * squares is the whole logo.
 */
function MicrosoftMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
      <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

/**
 * No free glyph exists for most reservation systems, and a logo redrawn from
 * memory is a worse look than none. An initial on the brand colour names the
 * product and claims nothing.
 */
function Monogram({ integration }: { integration: Integration }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <rect width="24" height="24" rx="6" fill={integration.hex} />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fill="#fff"
      >
        {integration.name.charAt(0)}
      </text>
    </svg>
  );
}

function Mark({ integration }: { integration: Integration }) {
  if (integration.path === "microsoft") return <MicrosoftMark />;
  if (integration.path === "monogram") return <Monogram integration={integration} />;
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path d={integration.path} fill={integration.hex} />
    </svg>
  );
}

function IntegrationTile({
  integration,
  onLocked,
}: {
  integration: Integration;
  onLocked?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onLocked}
      className="hover:border-ring/60 hover:bg-accent ta-label-1 flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors"
    >
      <Mark integration={integration} />
      <span className="truncate">{integration.name}</span>
    </button>
  );
}

export function SchedulePanel({ profile, agentName, onLocked }: Props) {
  const booking = businessNouns(profile.category).booking;
  const week = demoWeek(profile.hours);
  const blank = hoursUnknown(week);

  return (
    <div className="space-y-6">
      <div className="bg-muted/50 flex items-start gap-3 rounded-lg p-3">
        <CalendarCheck
          className="text-muted-foreground mt-0.5 size-4 shrink-0"
          aria-hidden
        />
        <p className="ta-caption-1 text-muted-foreground">
          {agentName} can take the {booking} while the caller is still on the
          phone, and write it into the calendar you already use. The week below
          is a mock-up drawn from {profile.name || "this business"}&rsquo;s own
          opening hours — the demo takes no real bookings.
        </p>
      </div>

      <section className="space-y-2">
        <h3 className="ta-headline-2">A week on the book</h3>
        {blank ? (
          <p className="ta-caption-1 text-muted-foreground">
            We did not find opening hours for this business, so there is no week
            to draw. Add the hours in Knowledge and it fills in.
          </p>
        ) : (
          <p className="ta-caption-1 text-muted-foreground">
            Example {booking}s {agentName} took on the phone, not real ones.
            Dotted is free.
          </p>
        )}

        {blank ? null : (
          <div className="-mx-1 overflow-x-auto px-1 pt-1">
            <div className="grid min-w-[36rem] grid-cols-7 gap-2">
              {week.map((day) => (
                <div key={day.day} className="flex flex-col gap-1.5">
                  <div className="space-y-0.5 text-center">
                    <p className="ta-label-1">{day.short}</p>
                    <p className="ta-caption-2 text-muted-foreground tabular-nums">
                      {day.closed ? "Closed" : (day.hours ?? "—")}
                    </p>
                  </div>
                  {day.closed || day.slots.length === 0 ? (
                    <div className="bg-muted/40 min-h-28 flex-1 rounded-lg" />
                  ) : (
                    <div className="space-y-1.5">
                      {day.slots.map((slot) =>
                        slot.who ? (
                          <div
                            key={slot.time}
                            className="border-primary/30 bg-primary/10 space-y-0.5 rounded-lg border px-1.5 py-1.5"
                          >
                            <p className="ta-caption-2 text-primary tabular-nums">
                              {slot.time}
                            </p>
                            <p className="ta-caption-2 truncate font-medium">
                              {slot.who}
                            </p>
                          </div>
                        ) : (
                          <button
                            key={slot.time}
                            type="button"
                            onClick={onLocked}
                            className="hover:border-ring/60 text-muted-foreground ta-caption-2 w-full rounded-lg border border-dashed px-1.5 py-1.5 text-center tabular-nums transition-colors"
                          >
                            {slot.time}
                          </button>
                        ),
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h3 className="ta-headline-2">Connect it to what you already use</h3>
          <p className="ta-caption-1 text-muted-foreground">
            The booking goes where your day already lives. Nothing is connected
            in the demo — tell us which one you run and we set it up.
          </p>
        </div>

        {integrationGroupsFor(booking).map((id) => {
          const group = INTEGRATION_GROUPS.find((entry) => entry.id === id);
          if (!group) return null;
          const items = INTEGRATIONS.filter(
            (integration) => integration.group === group.id,
          );
          if (!items.length) return null;
          return (
            <div key={group.id} className="space-y-2">
              <div>
                <p className="ta-label-1">{group.title}</p>
                <p className="ta-caption-2 text-muted-foreground">{group.blurb}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((integration) => (
                  <IntegrationTile
                    key={integration.id}
                    integration={integration}
                    onLocked={onLocked}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={onLocked}
          className="hover:border-ring/60 hover:text-foreground text-muted-foreground ta-label-1 flex w-full items-center gap-2.5 rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors"
        >
          <Plus className="size-4 shrink-0" aria-hidden />
          Running something else? Tell us what it is.
        </button>
      </section>
    </div>
  );
}
