import { useCallback, useEffect, useRef, useState } from "react";
import { listAgentServices } from "../api/backend";
import type { AgentServiceStatus as Service } from "../api/types";
import { overallState, serviceLine, serviceStateLabel, serviceTitle, type ServiceState } from "../agentServices";

// Are the voice agent's three processes (call server, outbound poller, scenario runner) running?
//
// Same reasoning as PollerStatus: a process that died produces no rows and no errors, so nothing
// else on the dashboard can say so. This is ALWAYS on screen once the first load settles, in every
// state, including "never reported" and "can't read status" — a hidden panel makes "healthy" and
// "never deployed" look the same. A failed request is shown as such, not as "never reported", and
// keeps being retried.
//
// Admin-only (the endpoint is), and rendered inside the Overview's `.tw` screen, so it is built from
// Tailwind utilities on the promo tokens — no transcribe class names.

const DOT: Record<ServiceState, string> = {
  online: "bg-success",
  erroring: "bg-warning",
  offline: "bg-destructive",
  never: "bg-muted-foreground/40",
};

const TEXT: Record<ServiceState, string> = {
  online: "text-success",
  erroring: "text-warning",
  offline: "text-destructive",
  never: "text-muted-foreground",
};

export function AgentServiceStatus() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // A slow backend must not stack requests: a tick that finds a load still in flight is skipped.
  const inFlight = useRef(false);

  const load = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    listAgentServices()
      .then((s) => {
        setServices(s);
        setFailed(null);
      })
      .catch((e) => {
        setFailed(e instanceof Error ? e.message : "Request failed");
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, []);

  useEffect(() => {
    load();
    // The processes report every 60 s; re-check on that timescale so an open screen notices one
    // going quiet, and so an unreadable status recovers by itself.
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (services === null && failed === null) return null; // first load only

  const overall = services ? overallState(services) : null;

  return (
    <section
      className="bg-card text-card-foreground flex flex-col gap-3 rounded-2xl border p-4"
      aria-label="Voice agent services"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="ta-label-1">Voice agent services</h2>
        {failed && !services ? (
          <span className="ta-caption-1 text-destructive">Can't read service status</span>
        ) : (
          overall && (
            <span className={`ta-caption-1 ${TEXT[overall]}`}>{serviceStateLabel({ state: overall })}</span>
          )
        )}
      </div>
      {failed && (
        <p className="ta-caption-1 text-destructive">
          Can't read service status: {failed}. Trying again every minute.
        </p>
      )}
      {services && (
        <ul className="flex flex-col gap-2">
          {services.map((s) => (
            <li key={s.service} className="flex items-start gap-3">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[s.state]}`} aria-hidden="true" />
              <div className="flex min-w-0 flex-col">
                <span className="ta-label-1">
                  {s.label} <span className={`ta-caption-1 ${TEXT[s.state]}`}>{serviceStateLabel(s)}</span>
                </span>
                <span className="ta-caption-1 text-muted-foreground" title={serviceTitle(s)}>
                  {serviceLine(s)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
