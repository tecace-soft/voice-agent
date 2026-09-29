
import { demoFetch } from "@/api";
import { useState, type ReactNode } from "react";
import { ChevronRight, PhoneCall, Sparkles, Wrench } from "lucide-react";
import { toast } from "sonner";
import { readJson } from "@/lib/http";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Transcript } from "@/components/call/Transcript";
import { EmptyState, StatusBadge, STATUS_STYLES } from "@/components/admin/shared";
import { CallsPerDayChart } from "@/components/charts/CallsPerDayChart";
import { callerSaid, callsPerDay, formatDuration, gapRollup } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { CallLog, CallSentiment, CallStatus } from "@/lib/types";

// Dashboard-only (see PORTING.md): the promo listed every call as a card, which stops being readable
// past a handful. Here the calls are a table — one row per call, the review one click away in a
// side panel — under a calls-per-day chart and a mood breakdown.

const STATUS: Record<CallStatus, { label: string; kind: keyof typeof STATUS_STYLES }> = {
  completed: { label: "Completed", kind: "positive" },
  started: { label: "On the line", kind: "active" },
  abandoned: { label: "Dropped", kind: "caution" },
  failed: { label: "Failed", kind: "negative" },
};

const SENTIMENT: Record<
  CallSentiment,
  { label: string; kind: keyof typeof STATUS_STYLES; bar: string }
> = {
  happy: { label: "Happy", kind: "positive", bar: "bg-success" },
  mixed: { label: "Mixed", kind: "caution", bar: "bg-warning" },
  frustrated: { label: "Frustrated", kind: "negative", bar: "bg-destructive" },
};

type Mood = CallSentiment | "unreviewed";
const MOODS: Mood[] = ["happy", "mixed", "frustrated", "unreviewed"];
const MOOD_LABEL: Record<Mood, string> = {
  happy: "Happy",
  mixed: "Mixed",
  frustrated: "Frustrated",
  unreviewed: "Not reviewed",
};
const MOOD_BAR: Record<Mood, string> = {
  happy: SENTIMENT.happy.bar,
  mixed: SENTIMENT.mixed.bar,
  frustrated: SENTIMENT.frustrated.bar,
  unreviewed: "bg-muted-foreground/30",
};

type Who = "all" | "customer" | "test";

const CHART_DAYS = 14;
const PAGE = 25;

function moodOf(call: CallLog): Mood {
  return call.review?.sentiment ?? "unreviewed";
}

/** The operator reads a review as a test report; the business owner reads it as a call summary. */
function reviewLabels(readOnly: boolean) {
  return readOnly
    ? { tested: "Caller wanted", worked: "Went well", struggled: "Missed", gaps: "couldn't answer" }
    : { tested: "Tested", worked: "Worked", struggled: "Fell short", gaps: "to fix" };
}

/** One labelled line of the review. Nothing renders when the model said nothing. */
function ReviewLine({ label, text }: { label: string; text?: string }) {
  if (!text) return null;
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-3">
      <span className="ta-caption-1 text-muted-foreground pt-0.5">{label}</span>
      <span className="ta-body-2">{text}</span>
    </div>
  );
}

/** How the reviewed calls went, as one stacked bar and its legend. */
function MoodBreakdown({ calls, note, wide }: { calls: CallLog[]; note?: string; wide?: boolean }) {
  const counts = Object.fromEntries(MOODS.map((mood) => [mood, 0])) as Record<Mood, number>;
  for (const call of calls) counts[moodOf(call)] += 1;
  const total = calls.length;

  return (
    <Card className="rounded-xl border shadow-none">
      <CardContent className="p-4 md:p-6">
        <p className="ta-headline-2">How callers felt</p>
        <p className="ta-caption-1 text-muted-foreground">
          {note ?? `From the review of each call · ${total} ${total === 1 ? "call" : "calls"}`}
        </p>
        {total ? (
          <>
            <div
              className="bg-secondary mt-4 flex h-3 w-full overflow-hidden rounded-full"
              role="img"
              aria-label={MOODS.map((mood) => `${MOOD_LABEL[mood]} ${counts[mood]}`).join(", ")}
            >
              {MOODS.map((mood) =>
                counts[mood] ? (
                  <span
                    key={mood}
                    className={cn("h-full", MOOD_BAR[mood])}
                    style={{ width: `${(counts[mood] / total) * 100}%` }}
                  />
                ) : null,
              )}
            </div>
            <ul className={cn("mt-4 grid grid-cols-2 gap-x-4 gap-y-2", wide && "md:grid-cols-4 md:gap-x-8")}>
              {MOODS.map((mood) => (
                <li key={mood} className="flex items-center gap-2">
                  <span className={cn("size-2.5 shrink-0 rounded-full", MOOD_BAR[mood])} aria-hidden />
                  <span className="ta-caption-1 text-muted-foreground flex-1 truncate">{MOOD_LABEL[mood]}</span>
                  <span className="ta-label-1 tabular-nums">{counts[mood]}</span>
                  <span className="ta-caption-1 text-muted-foreground w-9 text-right tabular-nums">
                    {Math.round((counts[mood] / total) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="ta-body-2 text-muted-foreground mt-4">No customer calls yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "ta-caption-1 rounded-full border px-3 py-1 transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ActivityTab({
  calls,
  customerId,
  onChanged,
  readOnly = false,
}: {
  calls: CallLog[];
  customerId: string;
  onChanged?: () => void;
  /** Dashboard-only: the demo's own customer — no test switch, no Analyze, no chart or roll-up. */
  readOnly?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [who, setWho] = useState<Who>("all");
  const [mood, setMood] = useState<Mood | "all">("all");
  const [shown, setShown] = useState(PAGE);

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

  const setKind = (call: CallLog, isTest: boolean) =>
    void patch(call, { isTest }, isTest ? "Counted as your test." : "Counted as a customer call.");
  const analyze = (call: CallLog) => void patch(call, { analyze: true }, "Reviewed.");

  if (calls.length === 0) {
    return (
      <Card className="rounded-xl border shadow-none">
        <CardContent className="p-4 md:p-6">
          <EmptyState
            icon={<PhoneCall className="size-6" />}
            message={
              readOnly
                ? "No calls yet. Open your demo link and call your receptionist."
                : "No calls yet. Share the link to get started."
            }
          />
        </CardContent>
      </Card>
    );
  }

  const labels = reviewLabels(readOnly);
  const testCount = calls.filter((call) => call.isTest).length;
  const customerCalls = calls.filter((call) => !call.isTest);
  // A shortcoming that shows up in four calls is the next thing to build; the
  // same shortcoming read four times in four transcripts is just four calls.
  const gaps = gapRollup(calls);
  const topGap = gaps[0]?.count ?? 0;

  const byWho = calls.filter((call) =>
    who === "all" ? true : who === "test" ? call.isTest : !call.isTest,
  );
  const visible = byWho.filter((call) => mood === "all" || moodOf(call) === mood);
  const longest = Math.max(1, ...visible.map((call) => call.durationSec ?? 0));
  // Read from the list, not kept as a copy, so the panel follows an Analyze or a Test switch.
  const selected = calls.find((call) => call.id === selectedId) ?? null;

  const moodCounts = (mood: Mood) => byWho.filter((call) => moodOf(call) === mood).length;

  return (
    <div className="flex flex-col gap-4">
      {readOnly ? null : (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="rounded-xl border shadow-none xl:col-span-2">
            <CardContent className="p-4 md:p-6">
              <p className="ta-headline-2">Calls per day</p>
              <p className="ta-caption-1 text-muted-foreground">
                Customer calls, the last {CHART_DAYS} days
              </p>
              <div className="mt-4 h-48">
                <CallsPerDayChart data={callsPerDay(calls, CHART_DAYS)} />
              </div>
            </CardContent>
          </Card>
          <MoodBreakdown
            calls={customerCalls}
            note={testCount ? "Customer calls only — your tests are left out" : undefined}
          />
        </div>
      )}

      {gaps.length && !readOnly ? (
        <Card className="rounded-xl border shadow-none">
          <CardContent className="p-4 md:p-6">
            <section>
              <h3 className="ta-headline-2 flex items-center gap-2">
                <Wrench className="text-muted-foreground size-4" aria-hidden />
                What to fix
              </h3>
              <p className="ta-caption-1 text-muted-foreground mt-1">
                Where the receptionist ran out of road, across every call here. Commonest first.
              </p>
              <ul className="mt-4 grid gap-x-8 gap-y-2.5 lg:grid-cols-2">
                {gaps.map((gap) => (
                  <li key={gap.text} className="flex items-center gap-3">
                    <span className="ta-numeric text-warning w-6 shrink-0 text-right">{gap.count}</span>
                    <span className="min-w-0 flex-1">
                      <span className="ta-body-2 block">{gap.text}</span>
                      <span className="bg-secondary mt-1 block h-1 overflow-hidden rounded-full">
                        <span
                          className="bg-warning block h-full rounded-full"
                          style={{ width: `${(gap.count / topGap) * 100}%` }}
                        />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </CardContent>
        </Card>
      ) : null}

      {readOnly ? <MoodBreakdown calls={calls} wide /> : null}

      <Card className="rounded-xl border shadow-none">
        <CardContent className="p-4 md:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <p className="ta-headline-2">
              Calls <span className="text-muted-foreground tabular-nums">{visible.length}</span>
            </p>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {readOnly || !testCount ? null : (
                <>
                  <Chip active={who === "all"} onClick={() => setWho("all")}>
                    All {calls.length}
                  </Chip>
                  <Chip active={who === "customer"} onClick={() => setWho("customer")}>
                    Customers {customerCalls.length}
                  </Chip>
                  <Chip active={who === "test"} onClick={() => setWho("test")}>
                    Tests {testCount}
                  </Chip>
                  <span className="bg-border mx-1 h-5 w-px" aria-hidden />
                </>
              )}
              <Chip active={mood === "all"} onClick={() => setMood("all")}>
                Any mood
              </Chip>
              {MOODS.map((option) =>
                moodCounts(option) ? (
                  <Chip key={option} active={mood === option} onClick={() => setMood(option)}>
                    <span className={cn("mr-1.5 inline-block size-2 rounded-full", MOOD_BAR[option])} aria-hidden />
                    {MOOD_LABEL[option]} {moodCounts(option)}
                  </Chip>
                ) : null,
              )}
            </div>
          </div>
          {testCount && !readOnly ? (
            <p className="ta-caption-1 text-muted-foreground mt-2">
              {testCount === calls.length
                ? "Every call here is marked as your own test, so none of them reach the numbers."
                : `${testCount} of these are marked as your own tests and are left out of the numbers.`}{" "}
              Switch one off if a customer made it.
            </p>
          ) : null}

          <Table className="mt-4">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="ta-caption-1 text-muted-foreground">When</TableHead>
                <TableHead className="ta-caption-1 text-muted-foreground hidden md:table-cell">Length</TableHead>
                <TableHead className="ta-caption-1 text-muted-foreground">Mood</TableHead>
                <TableHead className="ta-caption-1 text-muted-foreground w-full">
                  {readOnly ? "What the caller wanted" : "What was tested"}
                </TableHead>
                {readOnly ? null : (
                  <TableHead className="ta-caption-1 text-muted-foreground">Counted as</TableHead>
                )}
                <TableHead>
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.slice(0, shown).map((call) => {
                const review = call.review;
                const turns = call.turns ?? call.transcript.length;
                const summary = review?.tested || callerSaid(call);
                const started = new Date(call.startedAt);
                const busy = busyId === call.id;
                return (
                  <TableRow
                    key={call.id}
                    className={cn("cursor-pointer", call.isTest && "text-muted-foreground")}
                    onClick={() => setSelectedId(call.id)}
                  >
                    <TableCell className="align-top">
                      <span className="ta-label-1 block">{started.toLocaleDateString()}</span>
                      <span className="ta-caption-1 text-muted-foreground tabular-nums">
                        {started.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        <span className="md:hidden"> · {formatDuration(call.durationSec)}</span>
                      </span>
                    </TableCell>
                    <TableCell className="hidden align-top md:table-cell">
                      <span className="ta-label-1 block tabular-nums">{formatDuration(call.durationSec)}</span>
                      <span className="bg-secondary mt-1 block h-1 w-20 overflow-hidden rounded-full" aria-hidden>
                        <span
                          className="bg-chart-1 block h-full rounded-full"
                          style={{ width: `${((call.durationSec ?? 0) / longest) * 100}%` }}
                        />
                      </span>
                      <span className="ta-caption-1 text-muted-foreground tabular-nums">{turns} turns</span>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-col items-start gap-1">
                        {review ? (
                          <StatusBadge kind={SENTIMENT[review.sentiment].kind}>
                            {SENTIMENT[review.sentiment].label}
                          </StatusBadge>
                        ) : call.status === "started" || readOnly ? (
                          <span className="ta-caption-1 text-muted-foreground">—</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={(event) => {
                              event.stopPropagation();
                              analyze(call);
                            }}
                          >
                            <Sparkles className="size-3.5" aria-hidden />
                            Analyze
                          </Button>
                        )}
                        {call.status === "completed" ? null : (
                          <StatusBadge kind={STATUS[call.status].kind}>{STATUS[call.status].label}</StatusBadge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <span
                        className={cn(
                          "ta-body-2 line-clamp-2 min-w-44 md:min-w-56",
                          !review && "text-muted-foreground",
                        )}
                      >
                        {summary || "No words exchanged"}
                      </span>
                      {review?.gaps.length ? (
                        <span className="ta-caption-1 text-warning mt-1 inline-flex items-center gap-1.5">
                          <span className="bg-warning size-1.5 rounded-full" aria-hidden />
                          {review.gaps.length} {labels.gaps}
                        </span>
                      ) : null}
                    </TableCell>
                    {readOnly ? null : (
                      <TableCell className="align-top" onClick={(event) => event.stopPropagation()}>
                        <label className="ta-caption-1 text-muted-foreground flex items-center gap-2">
                          <Switch
                            checked={call.isTest}
                            disabled={busy}
                            onCheckedChange={(checked) => setKind(call, checked === true)}
                            aria-label={`Count this call as ${call.isTest ? "a customer call" : "your test"}`}
                          />
                          {call.isTest ? "Test" : "Customer"}
                        </label>
                      </TableCell>
                    )}
                    <TableCell className="align-top">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Open call details"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(call.id);
                        }}
                      >
                        <ChevronRight className="size-4" aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {visible.length === 0 ? (
            <p className="ta-body-2 text-muted-foreground py-8 text-center">No calls match these filters.</p>
          ) : null}
          {visible.length > shown ? (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => setShown((count) => count + PAGE)}>
                Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="ta-headline-1">Call details</SheetTitle>
            <SheetDescription className="ta-caption-1">
              {selected
                ? `${new Date(selected.startedAt).toLocaleString()} · ${formatDuration(
                    selected.durationSec,
                  )} · ${selected.turns ?? selected.transcript.length} turns`
                : ""}
            </SheetDescription>
          </SheetHeader>
          {selected ? (
            <div className="flex flex-col gap-6 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge kind={STATUS[selected.status].kind}>{STATUS[selected.status].label}</StatusBadge>
                {selected.review ? (
                  <StatusBadge kind={SENTIMENT[selected.review.sentiment].kind}>
                    {SENTIMENT[selected.review.sentiment].label}
                  </StatusBadge>
                ) : null}
                {readOnly ? null : (
                  <StatusBadge kind="neutral">{selected.isTest ? "Your test" : "Customer call"}</StatusBadge>
                )}
              </div>

              <section className="bg-muted/40 rounded-xl p-4">
                <h3 className="ta-headline-2">Summary</h3>
                {selected.review ? (
                  <div className="mt-3 space-y-2">
                    <ReviewLine label={labels.tested} text={selected.review.tested} />
                    <ReviewLine label={labels.worked} text={selected.review.worked} />
                    <ReviewLine label={labels.struggled} text={selected.review.struggled} />
                    {selected.review.gaps.length ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {selected.review.gaps.map((gap) => (
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
                  <p className="ta-caption-1 text-muted-foreground mt-2">
                    {selected.status === "started"
                      ? "Still on the line."
                      : readOnly
                        ? "No summary for this call."
                        : "Not reviewed — this call happened before reviews, or the model was unreachable. Analyze it from the list."}
                  </p>
                )}
              </section>

              <section>
                <h3 className="ta-headline-2 mb-3">Transcript</h3>
                <Transcript
                  entries={selected.transcript}
                  emptyMessage="This call ended before anything was said."
                />
              </section>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
