import { useEffect, useMemo, useRef, useState } from "react";
import { AUTOSAVE_DELAY, IDLE, createAutosaver, type AutosaveState } from "./autosave";

export type AutosaveView = AutosaveState & {
  dirty: boolean;
  /** Save now (Save now, Retry, leaving the section). */
  flush: () => Promise<void>;
};

/**
 * Save `value` a moment after it stops changing (see autosave.ts). `save` and `validate` are read at
 * the time of saving, so they always see the latest render's state. A change still waiting when the
 * section unmounts (another page, another account) is saved on the way out.
 */
export function useAutosave(opts: {
  value: unknown;
  save: () => Promise<void>;
  validate?: () => string | null;
  errorMessage: (error: unknown) => string;
  delay?: number;
}): AutosaveView {
  const [state, setState] = useState<AutosaveState>(IDLE);
  const latest = useRef(opts);
  latest.current = opts;
  const saver = useMemo(
    () =>
      createAutosaver({
        save: () => latest.current.save(),
        validate: () => latest.current.validate?.() ?? null,
        errorMessage: (error) => latest.current.errorMessage(error),
        delay: opts.delay ?? AUTOSAVE_DELAY,
        onChange: setState,
      }),
    // One saver for the life of the section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // A change is a different value from the last render's — the first render is what was loaded.
  const serialized = JSON.stringify(opts.value ?? null);
  const seen = useRef(serialized);
  useEffect(() => {
    if (serialized === seen.current) return;
    seen.current = serialized;
    saver.changed();
  }, [serialized, saver]);

  useEffect(
    () => () => {
      if (saver.dirty()) void saver.flush();
    },
    [saver],
  );

  return { ...state, dirty: saver.dirty(), flush: saver.flush };
}
