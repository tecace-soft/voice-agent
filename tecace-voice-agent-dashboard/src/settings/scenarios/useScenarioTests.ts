import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteScenarioTest,
  getScenarioPass,
  listScenarioPasses,
  listScenarioTests,
  resetScenarioTest,
  saveScenarioTest,
  startScenarioPass,
  stopScenarioPass,
} from "../../api/backend";
import type { ScenarioDefinition, ScenarioListResponse, ScenarioPassDetail, ScenarioPassSummary } from "../../api/types";
import { accountErrorMessage } from "../../auth";

// The Scenario tests section's data. The running pass (whichever pass is open) is re-read every 3 s while
// it runs, and only then: nothing here starts work on its own. An answer for a pass the viewer has since
// navigated away from is dropped.

export function useScenarioTests(userId: string) {
  const [list, setList] = useState<ScenarioListResponse | null>(null);
  const [passes, setPasses] = useState<ScenarioPassSummary[]>([]);
  const [open, setOpen] = useState<ScenarioPassDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The pass id the viewer last asked to see; a slower answer for any other id is ignored.
  const openIdRef = useRef<string | null>(null);
  const fail = useCallback((e: unknown) => setError(accountErrorMessage(e)), []);

  const reload = useCallback(async () => {
    try {
      const [l, p] = await Promise.all([listScenarioTests(userId), listScenarioPasses(userId)]);
      setList(l);
      setPasses(p);
      setError(null);
    } catch (e) {
      fail(e);
    }
  }, [userId, fail]);

  const openPass = useCallback(
    async (id: string) => {
      openIdRef.current = id;
      try {
        const detail = await getScenarioPass(userId, id);
        if (openIdRef.current === id) setOpen(detail);
      } catch (e) {
        if (openIdRef.current === id) fail(e);
      }
    },
    [userId, fail],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // The latest pass opens by itself the first time there is one (never after the viewer has chosen).
  useEffect(() => {
    if (openIdRef.current === null && passes[0]) void openPass(passes[0].id);
  }, [passes, openPass]);

  const runningPass = passes.find((p) => p.status === "running") ?? null;
  const runningId = runningPass?.id ?? null;
  useEffect(() => {
    if (!runningId) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void getScenarioPass(userId, runningId)
        .then((detail) => {
          if (cancelled) return;
          setError(null);
          setPasses((prev) => prev.map((p) => (p.id === runningId ? detail.pass : p)));
          if (openIdRef.current === runningId) setOpen(detail);
          if (detail.pass.status !== "running") void reload();
        })
        .catch((e) => {
          if (!cancelled) fail(e);
        });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runningId, userId, reload, fail]);

  async function guarded<T>(work: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      const out = await work();
      setError(null);
      return out;
    } catch (e) {
      fail(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return {
    list,
    passes,
    open,
    runningPass,
    error,
    busy,
    openPass,
    run: (settings: "draft" | "published", ids: string[]) =>
      guarded(async () => {
        const { passId } = await startScenarioPass(userId, settings, ids);
        await reload();
        await openPass(passId);
      }),
    stop: () =>
      guarded(async () => {
        if (!runningId) return;
        const detail = await stopScenarioPass(userId, runningId);
        if (openIdRef.current === runningId) setOpen(detail);
        await reload();
      }),
    save: (id: string | null, title: string, definition: ScenarioDefinition) =>
      guarded(async () => {
        await saveScenarioTest(userId, id, { title, definition });
        await reload();
        return true;
      }),
    remove: (id: string) =>
      guarded(async () => {
        await deleteScenarioTest(userId, id);
        await reload();
        return true;
      }),
    reset: (id: string) =>
      guarded(async () => {
        await resetScenarioTest(userId, id);
        await reload();
        return true;
      }),
  };
}
