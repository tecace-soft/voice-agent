// Autosave for the business settings' text sections, without React (the hook is useAutosave.ts).
//
// A change is saved `delay` ms after the last one, or at once on `flush` (Save now, leaving the
// section, the tab going to the background). Saves never overlap: a change made while one is on its
// way waits for it, then goes in a save of its own — so nothing typed is dropped and no older save
// can land after a newer one. A change that doesn't pass `validate` is kept but not sent (a business
// with its name cleared mid-edit would otherwise stop answering as that business), and a failed save
// keeps the change until a retry or the next edit.
//
// A business section has no draft: what is saved is what callers get. The pause before saving is
// what keeps half a sentence from reaching them.

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "invalid" | "error";

export type AutosaveState = {
  status: AutosaveStatus;
  /** Why it wasn't saved (`invalid`, `error`). */
  message: string | null;
  /** When the last save landed (ms since epoch). */
  savedAt: number | null;
};

export const AUTOSAVE_DELAY = 1500;

export const IDLE: AutosaveState = { status: "idle", message: null, savedAt: null };

export type Autosaver = {
  /** Something in the section changed. */
  changed: () => void;
  /** Save now, if there's anything new. Resolves when that save (and any it waited for) is done. */
  flush: () => Promise<void>;
  /** Forget a waiting save. */
  cancel: () => void;
  /** Is there a change that hasn't been saved? */
  dirty: () => boolean;
};

export function createAutosaver(opts: {
  save: () => Promise<void>;
  validate?: () => string | null;
  delay?: number;
  onChange: (state: AutosaveState) => void;
  errorMessage: (error: unknown) => string;
}): Autosaver {
  const delay = opts.delay ?? AUTOSAVE_DELAY;
  // Every change bumps `version`; `savedVersion` is the version the last successful save carried.
  let version = 0;
  let savedVersion = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let state: AutosaveState = IDLE;

  const set = (next: Partial<AutosaveState>) => {
    state = { ...state, ...next };
    opts.onChange(state);
  };
  const dirty = () => version !== savedVersion;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  };

  async function flush(): Promise<void> {
    clear();
    // One at a time: wait for the save on its way, then see whether anything is left.
    if (inFlight) {
      await inFlight.catch(() => undefined);
      return flush();
    }
    if (!dirty()) return;
    const problem = opts.validate?.() ?? null;
    if (problem) {
      set({ status: "invalid", message: problem });
      return;
    }
    const carrying = version;
    set({ status: "saving", message: null });
    inFlight = opts.save();
    try {
      await inFlight;
      savedVersion = carrying;
      if (dirty()) {
        // Typed while it was saving: that goes in a save of its own, after the usual pause.
        set({ status: "pending", message: null });
        schedule();
      } else {
        set({ status: "saved", message: null, savedAt: Date.now() });
      }
    } catch (error) {
      set({ status: "error", message: opts.errorMessage(error) });
    } finally {
      inFlight = null;
    }
  }

  return {
    changed() {
      version += 1;
      // While a save is on its way the status stays "saving"; flush picks the change up after it.
      if (!inFlight) set({ status: "pending", message: null });
      schedule();
    },
    flush,
    cancel: clear,
    dirty,
  };
}
