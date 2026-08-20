import { useEffect, useState } from "react";
import { getTranscribeStats } from "../api/backend";
import type { TranscribeStats } from "../api/types";
import { formatDateTime } from "../lib";
import { AsyncState } from "../ui";

// "2026-08-20" -> "8/20" for compact bar labels.
function shortDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function TranscriptionsPage() {
  const [data, setData] = useState<TranscribeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getTranscribeStats()
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load transcription stats.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const maxDaily = data ? Math.max(1, ...data.daily.map((d) => d.processed)) : 1;
  const hasAny = data && data.runs > 0;

  return (
    <section>
      <div className="page-head">
        <h1>Voicemail Transcriptions</h1>
      </div>

      <AsyncState loading={loading} error={error} />

      {!loading && !error && data && (
        <>
          <p className="muted">
            How many voicemails the transcribe app has processed
            {data.lastRunAt ? ` · last run ${formatDateTime(data.lastRunAt)}` : ""}.
          </p>

          <div className="stat-grid">
            <div className="stat">
              <div className="stat-num">{data.totalProcessed.toLocaleString()}</div>
              <div className="stat-label">Total transcribed</div>
            </div>
            <div className="stat">
              <div className="stat-num">{data.today.toLocaleString()}</div>
              <div className="stat-label">Today</div>
            </div>
            <div className="stat">
              <div className="stat-num">{data.last7Days.toLocaleString()}</div>
              <div className="stat-label">Last 7 days</div>
            </div>
            <div className="stat">
              <div className="stat-num">{data.runs.toLocaleString()}</div>
              <div className="stat-label">Runs</div>
            </div>
            <div className="stat">
              <div className="stat-num">{data.totalFailed.toLocaleString()}</div>
              <div className="stat-label">Failed</div>
            </div>
          </div>

          {!hasAny ? (
            <p className="muted">
              No transcription runs reported yet. Runs appear here once the transcribe app finishes a
              pass (with <code>BACKEND_URL</code> configured).
            </p>
          ) : (
            <>
              <h2>Transcribed per day (last 14 days)</h2>
              <div className="chart">
                <div className="bars">
                  {data.daily.map((d) => (
                    <div
                      key={d.day}
                      className="bar"
                      style={{ height: `${(d.processed / maxDaily) * 100}%` }}
                      title={`${d.day}: ${d.processed} transcribed`}
                    />
                  ))}
                </div>
                <div className="bar-labels">
                  {data.daily.map((d) => (
                    <span key={d.day}>{shortDay(d.day)}</span>
                  ))}
                </div>
              </div>

              <h2>Recent runs</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Found</th>
                      <th>Transcribed</th>
                      <th>Skipped</th>
                      <th>Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r) => (
                      <tr key={r.id}>
                        <td>{formatDateTime(r.createdAt)}</td>
                        <td>{r.voicemails}</td>
                        <td>{r.processed}</td>
                        <td>{r.skipped}</td>
                        <td>{r.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
