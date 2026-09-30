import { useCallback, useEffect, useReducer, useRef } from "react";
import { getSetup, resetSetup, sendSetupTurn } from "../../api/backend";
import { accountErrorMessage } from "../../auth";
import { withDefaults, type CallSettings } from "../callSettings";
import { canSend, initialSetupState, setupReducer, type SetupState } from "./setupState";

// The guided setup's one piece of plumbing: loads the interview, sends each turn behind the
// container's call-settings saves, and hands the draft a turn wrote back to the container so the
// board and every section read the same copy.

const HIGHLIGHT_MS = 2000;

export type GuidedSetup = SetupState & {
  /** A no-op while a turn can't be sent — except "" (start) when there is no active session. */
  send: (text: string) => Promise<void>;
  start: () => Promise<void>;
  reset: () => Promise<void>;
  reload: () => void;
};

export function useGuidedSetup(
  userId: string | undefined,
  options: {
    /** Hand the draft a turn wrote to the container (BusinessSettings), which owns the copy every section reads. */
    onDraft?: (draft: CallSettings, dirty: boolean) => void;
    /** The container's call-settings save queue: a turn is chained on it so a section save can never race the consultant's write. */
    queue?: { current: Promise<unknown> };
  } = {},
): GuidedSetup {
  const [state, dispatch] = useReducer(setupReducer, initialSetupState);

  // Refs, so the container needn't memoise what it passes.
  const onDraftRef = useRef(options.onDraft);
  onDraftRef.current = options.onDraft;
  const queueRef = useRef(options.queue);
  queueRef.current = options.queue;
  // The latest state, for the guard in `send` without re-creating it every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  // BusinessPage unmounts the whole studio when the user leaves mid-turn: nothing dispatches after.
  const liveRef = useRef(true);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    };
  }, []);

  const reload = useCallback(() => {
    dispatch({ type: "load" });
    getSetup(userId)
      .then((response) => {
        if (liveRef.current) dispatch({ type: "loaded", response });
      })
      .catch((e) => {
        if (liveRef.current) {
          dispatch({ type: "load_failed", message: accountErrorMessage(e, "Couldn't load the guided setup.") });
        }
      });
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const send = useCallback(
    async (text: string) => {
      const current = stateRef.current;
      const starting = text === "" && current.pending === null && current.session?.status !== "active";
      if (!starting && !canSend(current)) return;
      dispatch({ type: "sending", text });
      // Mark it in flight now, not at the next render, so a double click can't send twice.
      stateRef.current = setupReducer(current, { type: "sending", text });
      const run = (queueRef.current?.current ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => sendSetupTurn(text, userId));
      if (queueRef.current) queueRef.current.current = run.catch(() => undefined);
      try {
        const res = await run;
        if (!liveRef.current) return;
        // The container first, so the board and the sections re-render from one draft.
        onDraftRef.current?.(withDefaults(res.draft), res.dirty);
        dispatch({ type: "replied", response: res });
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => {
          highlightTimer.current = null;
          if (liveRef.current) dispatch({ type: "highlight_cleared" });
        }, HIGHLIGHT_MS);
      } catch (e) {
        if (!liveRef.current) return;
        dispatch({ type: "failed", message: accountErrorMessage(e, "The consultant didn't answer. Try again.") });
        // The server may have kept part of the turn (the message, a draft write, a "say continue"
        // note). Read it back so the board and the chat show it, and the composer doesn't offer to
        // resend a message the transcript already holds.
        try {
          const state = await getSetup(userId);
          if (liveRef.current) {
            onDraftRef.current?.(withDefaults(state.draft), state.dirty);
            dispatch({ type: "synced", response: state, failedText: text });
          }
        } catch {
          // The failed dispatch already told the user.
        }
      }
    },
    [userId],
  );

  const start = useCallback(() => send(""), [send]);

  const reset = useCallback(async () => {
    try {
      await resetSetup(userId);
      if (liveRef.current) dispatch({ type: "reset_done" });
    } catch (e) {
      if (liveRef.current) {
        dispatch({ type: "failed", message: accountErrorMessage(e, "Couldn't end the guided setup.") });
      }
    }
  }, [userId]);

  return { ...state, send, start, reset, reload };
}
