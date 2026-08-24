import { useMemo } from "react";
import type { TranscribeStats } from "../api/types";
import { RunsTable } from "../components/RunsTable";
import { derive } from "../stats";

// The run log on its own: every run the backend keeps in the series, or just the ones that failed.
export function RunsPage({ data, onlyFailed }: { data: TranscribeStats; onlyFailed?: boolean }) {
  const d = useMemo(() => derive(data), [data]);
  const runs = onlyFailed ? d.failedRuns : d.runsNewestFirst;

  return (
    <div className="view">
      <RunsTable
        key={onlyFailed ? "failed" : "all"}
        runs={runs}
        emptyMessage={
          onlyFailed
            ? "No run has failed a voicemail — nothing to look at here."
            : "No runs reported yet."
        }
        tabs={
          <div>
            <div className="card-title ta-headline-2">{onlyFailed ? "Failed runs" : "All runs"}</div>
            <div className="card-sub ta-caption-1">
              {onlyFailed
                ? "Runs that left at least one voicemail for a retry"
                : `Newest first · the last ${data.runSeries.length} runs the backend keeps`}
            </div>
          </div>
        }
      />
    </div>
  );
}
