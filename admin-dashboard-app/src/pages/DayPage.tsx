import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { listIntakes } from "../api/backend";
import type { IntakeRecord } from "../api/types";
import { formatDateLong, formatTime, pacificDate } from "../lib";
import { AsyncState } from "../ui";

export function DayPage() {
  const { date = "" } = useParams();
  const [appts, setAppts] = useState<IntakeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listIntakes({ status: "booked", limit: 200 })
      .then((d) => {
        if (!active) return;
        const forDay = d.intakes
          .filter((i) => pacificDate(i.scheduledAt) === date)
          .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
        setAppts(forDay);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load appointments.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [date]);

  return (
    <section>
      <div className="page-head">
        <div>
          <Link to="/calendar" className="back">
            ‹ Calendar
          </Link>
          <h1>{formatDateLong(date)}</h1>
        </div>
      </div>

      <AsyncState loading={loading} error={error} />

      {!loading && !error &&
        (appts.length === 0 ? (
          <p className="muted">No booked appointments on this day.</p>
        ) : (
          <ul className="appts">
            {appts.map((a) => (
              <li key={a.id} className="appt">
                <div className="appt-time">{formatTime(a.scheduledAt)}</div>
                <div className="appt-body">
                  <div className="appt-name">{a.name}</div>
                  <div className="muted">
                    {a.email} · {a.phoneNumber} · {a.language}
                  </div>
                  <div>{a.purpose}</div>
                  {a.notes && <div className="appt-notes">{a.notes}</div>}
                </div>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
