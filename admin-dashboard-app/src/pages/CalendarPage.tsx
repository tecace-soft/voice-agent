import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listIntakes } from "../api/backend";
import type { IntakeRecord } from "../api/types";
import { isPast, pacificDate } from "../lib";
import { AsyncState } from "../ui";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Cell {
  day: number;
  date: string; // YYYY-MM-DD
}

function buildMonth(year: number, month: number): (Cell | null)[] {
  const startDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (Cell | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, date });
  }
  return cells;
}

export function CalendarPage() {
  const [booked, setBooked] = useState<IntakeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0–11
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listIntakes({ status: "booked", limit: 200 })
      .then((d) => {
        if (active) setBooked(d.intakes);
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
  }, []);

  const countByDay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of booked) {
      if (isPast(b.scheduledAt)) continue; // don't count appointments whose time has passed
      const day = pacificDate(b.scheduledAt);
      map[day] = (map[day] ?? 0) + 1;
    }
    return map;
  }, [booked]);

  const cells = useMemo(() => buildMonth(year, month), [year, month]);

  function shift(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  }

  return (
    <section>
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="month-nav">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month">
            ‹
          </button>
          <span>
            {MONTHS[month]} {year}
          </span>
          <button type="button" onClick={() => shift(1)} aria-label="Next month">
            ›
          </button>
        </div>
      </div>

      <AsyncState loading={loading} error={error} />

      {!loading && !error && (
        <>
          <div className="calendar">
            {WEEKDAYS.map((w) => (
              <div key={w} className="cal-weekday">
                {w}
              </div>
            ))}
            {cells.map((cell, i) => {
              if (!cell) return <div key={`e${i}`} className="cal-cell empty" />;
              const count = countByDay[cell.date] ?? 0;
              return (
                <button
                  key={cell.date}
                  type="button"
                  className={`cal-cell${count ? " has" : ""}`}
                  onClick={() => navigate(`/calendar/${cell.date}`)}
                >
                  <span className="cal-day">{cell.day}</span>
                  {count > 0 && (
                    <span className="cal-count">
                      {count} booked
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="muted">Click a day to see its booked appointments.</p>
        </>
      )}
    </section>
  );
}
