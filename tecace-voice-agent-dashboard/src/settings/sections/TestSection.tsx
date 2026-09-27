import { useCallback, useEffect, useState } from "react";
import { getTestCalls, businessTestFetch, runCalendarTool } from "../../api/backend";
import type { TestCallRecord, TestUsage } from "../../api/types";
import { accountErrorMessage } from "../../auth";
import { displayPhone, type CallSettings } from "../callSettings";
import { SectionIntro } from "../SettingsShell";
import { TestCallPanel } from "../simulator/TestCallPanel";
import { eventLine } from "../simulator/eventLabels";

// A business's in-app test calls: the console beside the settings (the call itself and this month's
// allowance), and the Test & improve section (the calls already made, each with the review the call
// reviewer wrote). Both read one `useTestCalls`, so a call ending refreshes the list.

function minutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}


export type TestCalls = {
  calls: TestCallRecord[] | null;
  usage: TestUsage | null;
  error: string | null;
  /** This month's minutes are used up (never for an admin). */
  out: boolean;
  reload: () => void;
};

export function useTestCalls(userId?: string): TestCalls {
  const [calls, setCalls] = useState<TestCallRecord[] | null>(null);
  const [usage, setUsage] = useState<TestUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    getTestCalls(userId)
      .then((r) => {
        setCalls(r.calls);
        setUsage(r.usage);
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load your test calls.")));
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { calls, usage, error, out: Boolean(usage && !usage.unlimited && usage.remainingSec < 15), reload };
}

function UsageLine({ usage }: { usage: TestUsage | null }) {
  if (!usage) return null;
  return (
    <p className="ta-caption-1 text-muted-foreground">
      {usage.unlimited
        ? "Admin: test calls here aren't counted against the business's minutes."
        : `${minutes(usage.usedSec)} of ${minutes(usage.capSec)} test minutes used this month.`}
    </p>
  );
}

/** The console beside a business's settings: a test call on the draft settings. */
export function BusinessTestConsole({
  test,
  userId,
  profileUserId,
  settings,
  businessName,
  agentNumber,
  agentName,
}: {
  test: TestCalls;
  agentName?: string;
  userId?: string;
  profileUserId: string;
  settings: CallSettings;
  businessName: string;
  agentNumber: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <UsageLine usage={test.usage} />
      {test.out ? (
        <p className="ta-label-1 text-destructive" role="alert">
          You've used this month's test-call minutes. Ask us if you need more.
        </p>
      ) : null}
      <TestCallPanel
        api={businessTestFetch}
        customerId={userId ?? profileUserId}
        settings={settings}
        businessName={businessName}
        businessPhone={agentNumber ? displayPhone(agentNumber) : null}
        agentName={agentName}
        disabled={test.out}
        onEnded={test.reload}
        bookingTool={(name, args) => runCalendarTool(name, args, userId)}
      />
    </div>
  );
}

const TRY_THESE = [
  "Ask for a person by name or team, the way a caller would: \"Can I talk to someone about my bill?\"",
  "Ask something your FAQs answer, then something they don't. It should say it doesn't know, not guess.",
  "Ask for directions or a link, then say yes when it offers to text you.",
  "Ask to leave a message for the owner.",
];

/** Test & improve: what to try, and the test calls already made with their reviews. */
export function BusinessTestSection({ test }: { test: TestCalls }) {
  const { calls, usage, error } = test;
  return (
    <div>
      <SectionIntro>
        Call your assistant from the browser, in the Test call panel beside these settings, to hear exactly what
        callers will. Test calls use your draft settings, so you can try a transfer or a link before you publish
        it — you play the phone being rung and the caller's text messages.
      </SectionIntro>

      <div className="mb-6 rounded-xl border p-4">
        <p className="ta-label-1 mb-2">Things to try on a test call</p>
        <ul className="ta-body-2 list-disc space-y-1 pl-5">
          {TRY_THESE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="mt-3">
          <UsageLine usage={usage} />
        </div>
      </div>

      <p className="ta-headline-2 mb-3">Recent test calls</p>
      {error ? <p className="ta-body-2 text-destructive">{error}</p> : null}
      {calls && calls.length === 0 ? (
        <p className="ta-body-2 text-muted-foreground">No test calls yet. After each one, a short review appears here.</p>
      ) : null}
      <ul className="space-y-3">
        {(calls ?? []).map((c) => (
          <li key={c.id} className="rounded-xl border p-3">
            <p className="ta-label-1">
              {new Date(c.startedAt).toLocaleString()}
              <span className="ta-caption-1 text-muted-foreground ml-2">
                {c.durationSec != null ? minutes(c.durationSec) : ""} · {c.status}
              </span>
            </p>
            {c.review ? (
              <div className="ta-caption-1 mt-2 space-y-1">
                {c.review.tested ? <p>Tried: {c.review.tested}</p> : null}
                {c.review.worked ? <p>Went well: {c.review.worked}</p> : null}
                {c.review.struggled ? <p className="text-destructive">Struggled: {c.review.struggled}</p> : null}
              </div>
            ) : null}
            {c.events.map(eventLine).filter(Boolean).length ? (
              <p className="ta-caption-1 text-muted-foreground mt-2">
                {c.events.map(eventLine).filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
