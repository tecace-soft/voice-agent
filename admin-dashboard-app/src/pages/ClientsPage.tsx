import { useEffect, useMemo, useState } from "react";
import { listIntakes } from "../api/backend";
import type { IntakeRecord, IntakeStatus } from "../api/types";
import { formatDateTime } from "../lib";
import { AsyncState, StatusBadge } from "../ui";

const STATUSES: IntakeStatus[] = ["new", "contacted", "booked", "unreachable", "canceled"];

export function ClientsPage() {
  const [rows, setRows] = useState<IntakeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"" | IntakeStatus>("");
  const [q, setQ] = useState("");

  // Fetch by status on the server; filter the search text client-side (snappier, no
  // request per keystroke).
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listIntakes({ status: status || undefined, limit: 200 })
      .then((data) => {
        if (active) setRows(data.intakes);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load clients.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.name, r.email, r.purpose].some((f) => f.toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  return (
    <section>
      <div className="page-head">
        <h1>Clients</h1>
        <div className="filters">
          <input
            placeholder="Search name, email, purpose…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | IntakeStatus)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <AsyncState loading={loading} error={error} />

      {!loading && !error && (
        <>
          <p className="muted">
            {filtered.length} client{filtered.length === 1 ? "" : "s"}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Language</th>
                  <th>Purpose</th>
                  <th>Requested time</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>
                      <div>{r.email}</div>
                      <div className="muted">{r.phoneNumber}</div>
                    </td>
                    <td>{r.language}</td>
                    <td>{r.purpose}</td>
                    <td>{formatDateTime(r.scheduledAt)}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="notes">{r.notes ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted center">
                      No clients{q || status ? " match the filters" : " yet"}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
