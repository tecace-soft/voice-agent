import { useCallback, useEffect, useState } from "react";
import { listAccounts, listMailboxes } from "../api/backend";
import type { AuthUser, MailboxSummary } from "../api/types";
import { accountErrorMessage } from "../auth";
import { PersonPanel } from "../components/PersonPanel";
import { ActivityPage } from "./ActivityPage";
import { OverviewPage } from "./OverviewPage";

// The admin's "all mailboxes" version of Overview and Daily activity: one collapsible card per
// person instead of everyone's numbers blended into a single dashboard.
//
// Opening a card renders the very same page a person sees for themselves, over their data — so
// there is one implementation of "the overview" rather than an admin copy that drifts from it.
// Scoped to a single mailbox (or signed in as a `user`), the page is rendered directly and none of
// this is involved.

export function PersonBoardsPage({ kind }: { kind: "overview" | "activity" }) {
  const [mailboxes, setMailboxes] = useState<MailboxSummary[] | null>(null);
  const [accounts, setAccounts] = useState<AuthUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([listMailboxes(), listAccounts().catch(() => [] as AuthUser[])])
      .then(([boxes, users]) => {
        setMailboxes(boxes);
        setAccounts(users);
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load the list of people.")));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p className="error ta-body-2">{error}</p>;
  if (mailboxes === null) return <p className="muted ta-body-2">Loading…</p>;

  if (mailboxes.length === 0) {
    return (
      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title ta-headline-2">No voicemail data yet</div>
            <div className="card-sub ta-caption-1">Nothing has been reported for any mailbox</div>
          </div>
        </div>
        <p className="feedback-empty muted ta-body-2">
          Once the transcribe app runs against a mailbox, that person appears here with their own
          dashboard.
        </p>
      </section>
    );
  }

  const nameFor = (email: string | null) =>
    email ? (accounts.find((a) => a.email === email)?.name ?? null) : null;

  return (
    <div className="view">
      <p className="muted ta-caption-1 boards-intro">
        {mailboxes.length} {mailboxes.length === 1 ? "person" : "people"} with voicemail data, busiest
        first. Open one to see their {kind === "overview" ? "overview" : "daily activity"} — or pick a
        single mailbox in the header to view it on its own.
      </p>

      {mailboxes.map((mailbox) => (
        <PersonPanel
          key={mailbox.mailboxEmail ?? "unattributed"}
          mailbox={mailbox}
          accountName={nameFor(mailbox.mailboxEmail)}
        >
          {(data) =>
            kind === "overview" ? (
              <OverviewPage
                data={data}
                mailboxLabel={mailbox.mailboxEmail ?? "Unattributed"}
                showMailbox={false}
              />
            ) : (
              <ActivityPage data={data} />
            )
          }
        </PersonPanel>
      ))}
    </div>
  );
}
