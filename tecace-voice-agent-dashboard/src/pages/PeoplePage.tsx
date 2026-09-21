import { useCallback, useEffect, useMemo, useState } from "react";
import { listMailboxes } from "../api/backend";
import type { MailboxScope, MailboxSummary } from "../api/types";
import { accountErrorMessage } from "../auth";
import { TabBar, type TabDef } from "../components/TabBar";
import { IconAlert } from "../icons";
import { formatDateTime, formatMailbox } from "../lib";
import { useAccounts } from "../people";

// How much each person is getting. Admin-only.
//
// Two lists are joined here by email — the mailboxes voicemail data has actually been reported for,
// and the accounts that can sign in — because the interesting cases are the ones that DON'T pair
// up: a mailbox nobody can see, or a person who signs in to an empty dashboard. Those are
// configuration mistakes that are otherwise invisible until somebody complains.
//
// ADMIN accounts are left out of the second list. Nobody polls a mailbox for an admin, so listing
// them all as "No data" would be a permanent row of false alarms drowning the real ones. An admin
// who somehow DOES have voicemail data still appears, because hiding real data would be worse.

type Row = {
  key: string;
  email: string | null;
  name: string | null; // the matching account, if there is one
  data: MailboxSummary | null; // the mailbox's figures, if any have been reported
};

type TabId = "all" | "unmatched";

const pct = (part: number, whole: number) => (whole <= 0 ? 0 : (part / whole) * 100);

export function PeoplePage({ onPick }: { onPick?: (mailbox: MailboxScope) => void }) {
  const [mailboxes, setMailboxes] = useState<MailboxSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("all");
  // email -> { name, role }, from the shared lookup rather than another trip for the account list
  const accounts = useAccounts();

  const load = useCallback(() => {
    listMailboxes()
      .then((boxes) => {
        setMailboxes(boxes);
        setError(null);
      })
      .catch((e) => setError(accountErrorMessage(e, "Couldn't load per-person totals.")));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo<Row[]>(() => {
    if (!mailboxes) return [];
    const seen = new Set<string>();

    const withData: Row[] = mailboxes.map((m) => {
      if (m.mailboxEmail) seen.add(m.mailboxEmail);
      return {
        key: m.mailboxEmail ?? "unattributed",
        email: m.mailboxEmail,
        name: (m.mailboxEmail && accounts.get(m.mailboxEmail)?.name) || null,
        data: m,
      };
    });

    // accounts that have never had a voicemail reported for them — admins excluded, since that is
    // their normal state rather than something to fix
    const withoutData: Row[] = [...accounts.entries()]
      .filter(([email, info]) => !seen.has(email) && info.role !== "admin")
      .map(([email, info]) => ({ key: email, email, name: info.name, data: null }));

    return [...withData, ...withoutData];
  }, [mailboxes, accounts]);

  const unmatched = rows.filter((r) => !r.data || (!r.name && r.email !== null));
  const shown = tab === "unmatched" ? unmatched : rows;
  const totalProcessed = rows.reduce((n, r) => n + (r.data?.processed ?? 0), 0);

  const tabs: TabDef<TabId>[] = [
    { id: "all", label: "Everyone", count: rows.length },
    { id: "unmatched", label: "Needs attention", count: unmatched.length },
  ];

  if (error) return <p className="error ta-body-2">{error}</p>;

  return (
    <div className="view">
      <section className="card">
        <div className="card-toolbar">
          <div>
            <div className="card-title ta-headline-2">Per person</div>
            <div className="card-sub ta-caption-1">
              Voicemail volume by mailbox, matched to the account that can see it · admin accounts
              are left out · {totalProcessed.toLocaleString()} transcribed in total
            </div>
          </div>
          <TabBar tabs={tabs} active={tab} onChange={setTab} label="Which people to show" />
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th className="num" scope="col">
                  Transcribed
                </th>
                <th className="num" scope="col">
                  Share
                </th>
                <th className="num" scope="col">
                  Today
                </th>
                <th className="num" scope="col">
                  Last 7 days
                </th>
                <th className="num" scope="col">
                  Found
                </th>
                <th className="num" scope="col">
                  Failed
                </th>
                <th className="num" scope="col">
                  Runs
                </th>
                <th scope="col">Last run</th>
              </tr>
            </thead>
            <tbody>
              {mailboxes === null ? (
                <tr>
                  <td className="table-empty" colSpan={9}>
                    Loading…
                  </td>
                </tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td className="table-empty" colSpan={9}>
                    {tab === "unmatched"
                      ? "Every mailbox has an account and every account has data. Nothing to sort out."
                      : "No voicemail data or accounts yet."}
                  </td>
                </tr>
              ) : (
                shown.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <span className="person-cell">
                        <span className="person-identity">
                          {row.data && row.email && onPick ? (
                            <button
                              type="button"
                              className="link-button person-primary"
                              onClick={() => onPick(row.email)}
                              title={`Show only ${row.email}`}
                            >
                              {row.name ?? formatMailbox(row.email)}
                            </button>
                          ) : (
                            <span className={`person-primary${row.email ? "" : " is-unattributed"}`}>
                              {row.name ?? formatMailbox(row.email)}
                            </span>
                          )}
                          {row.name && row.email && (
                            <span className="person-secondary ta-caption-1 muted">{row.email}</span>
                          )}
                        </span>
                        {!row.data && (
                          <span className="badge badge-warning" title="This account has an inbox on the dashboard but no voicemails have ever been reported for its address">
                            <IconAlert size={12} />
                            No data
                          </span>
                        )}
                        {row.data && !row.name && row.email && (
                          <span className="badge badge-warning" title="Voicemails are being transcribed for this address, but no account signs in with it — nobody but an admin can see them">
                            <IconAlert size={12} />
                            No account
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="num">{(row.data?.processed ?? 0).toLocaleString()}</td>
                    <td className="num">
                      {totalProcessed === 0 || !row.data
                        ? "—"
                        : `${pct(row.data.processed, totalProcessed).toFixed(1)}%`}
                    </td>
                    <td className="num">{(row.data?.today ?? 0).toLocaleString()}</td>
                    <td className="num">{(row.data?.last7Days ?? 0).toLocaleString()}</td>
                    <td className="num">{(row.data?.voicemails ?? 0).toLocaleString()}</td>
                    <td className={`num${(row.data?.failed ?? 0) > 0 ? " is-danger" : ""}`}>
                      {(row.data?.failed ?? 0).toLocaleString()}
                    </td>
                    <td className="num">{(row.data?.runs ?? 0).toLocaleString()}</td>
                    <td>{row.data?.lastRunAt ? formatDateTime(row.data.lastRunAt) : "Never"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="muted ta-caption-1 view-foot">
        Voicemail data is matched to a person by email: the mailbox the transcribe app fetched from
        has to be the address they sign in with. <strong>No account</strong> means data nobody but an
        admin can see; <strong>No data</strong> means someone signs in to an empty dashboard. Admin
        accounts aren't listed — no mailbox is polled for them, so they'd never have data to show.
      </p>
    </div>
  );
}
