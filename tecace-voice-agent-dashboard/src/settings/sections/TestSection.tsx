import { useCallback, useEffect, useState } from "react";
import { getTestCalls, businessTestFetch } from "../../api/backend";
import type { TestCallRecord, TestUsage } from "../../api/types";
import { accountErrorMessage } from "../../auth";
import { displayPhone, type CallSettings } from "../callSettings";
import { SectionIntro } from "../SettingsShell";
import { TestCallPanel } from "../simulator/TestCallPanel";

// A business's Test & improve section: the in-app test call, this month's allowance, and the calls
// already made, each with the review the call reviewer wrote.

const EVENT_LABEL: Record<string, string> = {
  transfer_requested: "Transfer asked for",
  transfer_final: "Transfer finished",
  consent_requested: "Consent text sent",
  link_sent: "Link texted",
  link_blocked: "Link not sent (opted out)",
  consent_reply: "Caller replied",
  message_taken: "Message taken",
};

function minutes(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function eventLine(e: TestCallRecord["events"][number]): string | null {
  const label = EVENT_LABEL[e.type];
  if (!label) return null;
  if (e.type === "transfer_final") return `${label}: ${e.data.success ? "connected" : "nobody picked up"}`;
  if (e.type === "consent_reply") return `${label} ${String(e.data.reply ?? "").toUpperCase()}`;
  return label;
}

export function BusinessTestSection({
  userId,
  profileUserId,
  settings,
  businessName,
  agentNumber,
}: {
  userId?: string;
  profileUserId: string;
  settings: CallSettings;
  businessName: string;
  agentNumber: string | null;
}) {
  const [calls, setCalls] = useState<TestCallRecord[] | null>(null);
  const [usage, setUsage] = useState<TestUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getTestCalls(userId)
      .then((r) => {
        setCalls(r.calls);
        setUsage(r.usage);
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load your test calls.")));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const out = Boolean(usage && !usage.unlimited && usage.remainingSec < 15);

  return (
    <div>
      <SectionIntro>
        Call your assistant from the browser to hear exactly what callers will. Test calls use your draft
        settings, so you can try a transfer or a link before you publish it — you play the phone being rung
        and the caller's text messages.
      </SectionIntro>

      {usage ? (
        <p className="ta-caption-1 text-muted-foreground mb-4">
          {usage.unlimited
            ? "Admin: test calls here aren't counted against the business's minutes."
            : `${minutes(usage.usedSec)} of ${minutes(usage.capSec)} test minutes used this month.`}
        </p>
      ) : null}
      {out ? (
        <p className="ta-label-1 text-destructive mb-4" role="alert">
          You've used this month's test-call minutes. Ask us if you need more.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-xl border p-4">
          <TestCallPanel
            api={businessTestFetch}
            customerId={userId ?? profileUserId}
            settings={settings}
            businessName={businessName}
            businessPhone={agentNumber ? displayPhone(agentNumber) : null}
            disabled={out}
            onEnded={load}
          />
        </div>

        <div>
          <p className="ta-headline-2 mb-3">Recent test calls</p>
          {error ? <p className="ta-body-2 text-destructive">{error}</p> : null}
          {calls && calls.length === 0 ? (
            <p className="ta-body-2 text-muted-foreground">No test calls yet.</p>
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
      </div>
    </div>
  );
}
