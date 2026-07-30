import { useEffect, useState } from "react";
import { getPrompt } from "../api/backend";
import type { AgentPrompt } from "../api/types";
import { AsyncState } from "../ui";

export function PromptPage() {
  const [data, setData] = useState<AgentPrompt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getPrompt()
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Failed to load the prompt.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <div className="page-head">
        <h1>Agent Prompt &amp; Scenario</h1>
      </div>

      <AsyncState loading={loading} error={error} />

      {!loading && !error && data && (
        <>
          <p className="muted">
            What the agent ({data.agentName}) currently follows. Read-only for now
            {data.editable ? "." : " — editing will come in a later update."}
          </p>
          <h2>System Prompt</h2>
          <pre className="prompt-block">{data.systemPrompt}</pre>
          <h2>Call Scenario</h2>
          <pre className="prompt-block">{data.scenario}</pre>
        </>
      )}
    </section>
  );
}
