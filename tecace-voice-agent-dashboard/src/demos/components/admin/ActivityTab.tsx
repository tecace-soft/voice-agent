
import { demoFetch } from "@/api";
import { useState } from "react";
import { PhoneCall, Wrench } from "lucide-react";
import { toast } from "sonner";
import { readJson } from "@/lib/http";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Transcript } from "@/components/call/Transcript";
import { EmptyState, StatusBadge, STATUS_STYLES } from "@/components/admin/shared";
import { callerSaid, formatDuration, gapRollup } from "@/lib/analytics";
import type { CallLog, CallSentiment } from "@/lib/types";

const STATUS_KIND = {
  completed: "positive",
  started: "active",
  abandoned: "caution",
  failed: "negative",
} as const;

const SENTIMENT: Record<
  CallSentiment,
  { label: string; kind: keyof typeof STATUS_STYLES }
> = {
  happy: { label: "Happy", kind: "positive" },
  mixed: { label: "Mixed", kind: "caution" },
  frustrated: { label: "Frustrated", kind: "negative" },
};

/** One labelled line of the review. Nothing renders when the model said nothing. */
function ReviewLine({ label, text }: { label: string; text?: string }) {
  if (!text) return null;
  return (
    <div className="flex gap-3">
      <span className="ta-caption-1 text-muted-foreground w-20 shrink-0 pt-0.5">
        {label}
      </span>
      <span className="ta-body-2">{text}</span>
    </div>
  );
}

function CallCard({
  call,
  busy,
  onOpen,
  onSetKind,
}: {
  call: CallLog;
  busy: boolean;
  onOpen: () => void;
  onSetKind: (isTest: boolean) => void;
}) {
  const said = callerSaid(call);
  const review = call.review;
  const turns = call.turns ?? call.transcript.length;

  return (
    <li className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="ta-label-1">{new Date(call.startedAt).toLocaleString()}</span>
        <span className="ta-caption-1 text-muted-foreground tabular-nums">
          {formatDuration(call.durationSec)} · {turns} turns
        </span>
        <StatusBadge kind={STATUS_KIND[call.status]}>{call.status}</StatusBadge>
        {review ? (
          <StatusBadge kind={SENTIMENT[review.sentiment].kind}>
            {SENTIMENT[review.sentiment].label}
          </StatusBadge>
        ) : null}
        <label className="ta-caption-1 text-muted-foreground ml-auto flex items-center gap-2">
          <Switch
            checked={call.isTest}
            disabled={busy}
            onCheckedChange={(checked) => onSetKind(checked === true)}
            aria-label={`Count this call as ${call.isTest ? "a customer call" : "your test"}`}
          />
          {call.isTest ? "Test" : "Customer"}
        </label>
      </div>

      {review ? (
        <div className="mt-3 space-y-1.5">
          <ReviewLine label="Tested" text={review.tested} />
          <ReviewLine label="Worked" text={review.worked} />
          <ReviewLine label="Fell short" text={review.struggled} />
          {review.gaps.length ? (
            <div className="flex flex-wrap items-center gap-2 pt-1 pl-23">
              {review.gaps.map((gap) => (
                <span
                  key={gap}
                  className="ta-caption-1 text-warning bg-warning/10 rounded-full px-2.5 py-0.5"
                >
                  {gap}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="ta-caption-1 text-muted-foreground">
            {call.status === "started" ? "Still on the line." : "Not reviewed."}
          </p>
        </div>
      )}

      {said ? (
        <details className="mt-3">
          <summary className="ta-caption-1 text-muted-foreground hover:text-foreground cursor-pointer">
            What the caller said
          </summary>
          <p className="ta-body-2-reading text-muted-foreground mt-2">{said}</p>
        </details>
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        className="ta-caption-1 text-primary mt-3 hover:underline"
      >
        Read the full transcript
      </button>
    </li>
  );
}

export function ActivityTab({
  calls,
  customerId,
  onChanged,
}: {
  calls: CallLog[];
  customerId: string;
  onChanged?: () => void;
}) {
  const [selected, setSelected] = useState<CallLog | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patch(call: CallLog, body: Record<string, unknown>, done: string) {
    setBusyId(call.id);
    try {
      const response = await demoFetch(`/customers/${customerId}/calls`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: call.id, ...body }),
      });
      await readJson<{ call: CallLog }>(response);
      toast.success(done);
      onChanged?.();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not change it.");
    } finally {
      setBusyId(null);
    }
  }

  const testCount = calls.filter((call) => call.isTest).length;
  // A shortcoming that shows up in four calls is the next thing to build; the
  // same shortcoming read four times in four transcripts is just four calls.
  const gaps = gapRollup(calls);

  if (calls.length === 0) {
    return (
      <EmptyState
        icon={<PhoneCall className="size-6" />}
        message="No calls yet. Share the link to get started."
      />
    );
  }

  return (
    <>
      {testCount ? (
        <p className="ta-caption-1 text-muted-foreground pb-3">
          {testCount === calls.length
            ? "Every call here is marked as your own test, so none of them reach the numbers."
            : `${testCount} of these are marked as your own tests and are left out of the numbers.`}{" "}
          Switch one off if a customer made it.
        </p>
      ) : null}

      {gaps.length ? (
        <section className="bg-muted/40 mb-6 rounded-xl p-4">
          <h3 className="ta-headline-2 flex items-center gap-2">
            <Wrench className="text-muted-foreground size-4" aria-hidden />
            What to fix
          </h3>
          <p className="ta-caption-1 text-muted-foreground mt-1">
            Where the receptionist ran out of road, across every call here.
            Commonest first.
          </p>
          <ul className="mt-3 space-y-1.5">
            {gaps.map((gap) => (
              <li key={gap.text} className="flex items-baseline gap-3">
                <span className="ta-numeric text-warning w-6 shrink-0 text-right">
                  {gap.count}
                </span>
                <span className="ta-body-2">{gap.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ul className="space-y-3">
        {calls.map((call) => (
          <CallCard
            key={call.id}
            call={call}
            busy={busyId === call.id}
            onOpen={() => setSelected(call)}
            onSetKind={(isTest) =>
              void patch(
                call,
                { isTest },
                isTest ? "Counted as your test." : "Counted as a customer call.",
              )
            }
          />
        ))}
      </ul>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-96 overflow-y-auto sm:max-w-96">
          <SheetHeader>
            <SheetTitle className="ta-headline-1">Call transcript</SheetTitle>
            <SheetDescription className="ta-caption-1">
              {selected
                ? `${new Date(selected.startedAt).toLocaleString()} · ${formatDuration(
                    selected.durationSec,
                  )}`
                : ""}
            </SheetDescription>
          </SheetHeader>
          {selected ? (
            <Transcript
              entries={selected.transcript}
              emptyMessage="This call ended before anything was said."
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
