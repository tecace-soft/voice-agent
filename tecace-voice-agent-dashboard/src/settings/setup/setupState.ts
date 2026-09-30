import type {
  SetupChange,
  SetupMessage,
  SetupSession,
  SetupStateResponse,
  SetupTopic,
  SetupTurnResponse,
  SetupUnavailableReason,
} from "../../api/types";
import type { SectionId } from "../../routing";
import { withDefaults, type CallSettings } from "../callSettings";

// The guided setup's state, kept pure so it can be tested without React: the interview the server
// holds, the one turn in flight, and which board cards the latest reply touched. `useGuidedSetup`
// drives it; the chat and the board only read it.

export type SetupState = {
  loading: boolean; // first GET in flight
  loadError: string | null;
  available: boolean;
  unavailableReason: SetupUnavailableReason | null;
  session: SetupSession | null;
  /** The text whose turn is in flight ("" = start); shown as an optimistic bubble. */
  pending: string | null;
  /** After a failed turn: what the composer should hold again ("" = offer Start again). */
  retryText: string | null;
  error: string | null;
  /** Board card keys changed by the latest reply; cleared by the hook ~2 s later. */
  highlightIds: string[];
  /** The draft the last GET/turn returned — the fallback when the container has none. */
  draft: CallSettings | null;
  dirty: boolean;
};

export const initialSetupState: SetupState = {
  loading: true,
  loadError: null,
  available: false,
  unavailableReason: null,
  session: null,
  pending: null,
  retryText: null,
  error: null,
  highlightIds: [],
  draft: null,
  dirty: false,
};

export type SetupAction =
  | { type: "load" }
  | { type: "loaded"; response: SetupStateResponse }
  | { type: "load_failed"; message: string }
  | { type: "sending"; text: string }
  | { type: "replied"; response: SetupTurnResponse }
  | { type: "failed"; message: string }
  /** After a failed turn: the server's copy, which may already hold that turn and a draft it wrote. */
  | { type: "synced"; response: SetupStateResponse; failedText: string | null }
  | { type: "reset_done" }
  | { type: "highlight_cleared" };

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case "load":
      return { ...state, loading: true, loadError: null };
    case "loaded": {
      const r = action.response;
      return {
        ...state,
        loading: false,
        available: r.available,
        unavailableReason: r.unavailableReason ?? null,
        session: r.session,
        draft: withDefaults(r.draft),
        dirty: r.dirty,
        error: null,
      };
    }
    case "load_failed":
      return { ...state, loading: false, loadError: action.message };
    case "sending":
      return { ...state, pending: action.text, retryText: null, error: null };
    case "replied": {
      // The server's session already holds the user's message, so the optimistic bubble just goes.
      const r = action.response;
      return {
        ...state,
        session: r.session,
        pending: null,
        draft: withDefaults(r.draft),
        dirty: r.dirty,
        highlightIds: keysOf(r.reply.changes),
        error: null,
      };
    }
    case "failed":
      return { ...state, pending: null, retryText: state.pending ?? null, error: action.message };
    case "synced": {
      // A turn can fail after the server saved it (OpenAI dropped out mid-way: the message, what was
      // written, and a "say continue" note are all there). Show that, keep the error, and don't hand
      // the owner back a message the transcript already holds.
      const r = action.response;
      const lastUser = r.session?.messages.filter((m) => m.role === "user").at(-1);
      const recorded = action.failedText !== null && lastUser?.text === action.failedText;
      return {
        ...state,
        available: r.available,
        unavailableReason: r.unavailableReason ?? null,
        session: r.session,
        draft: withDefaults(r.draft),
        dirty: r.dirty,
        retryText: recorded ? null : state.retryText,
      };
    }
    case "reset_done":
      // The draft stays: resetting ends the conversation, not what the consultant already wrote.
      return { ...state, session: null, pending: null, error: null, retryText: null, highlightIds: [] };
    case "highlight_cleared":
      return { ...state, highlightIds: [] };
  }
}

/** Which board card a change lands on; null for a remove (the card is gone). */
export function cardKey(c: SetupChange): string | null {
  if (c.op === "remove") return null;
  switch (c.kind) {
    case "transfer":
      return c.id ? `transfer:${c.id}` : null;
    case "message":
      return c.id ? `message:${c.id}` : null;
    case "appointments":
      return "appointments";
    case "timezone":
      return "timezone";
  }
}

export function keysOf(changes?: SetupChange[]): string[] {
  const keys: string[] = [];
  for (const c of changes ?? []) {
    const key = cardKey(c);
    if (key !== null && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

const VERB: Record<SetupChange["op"], string> = { add: "Added", update: "Updated", remove: "Removed" };

// The server's labels read `Transfer "Sam" → (206) 555-0134`; the chat line wants just the name.
function changeName(label: string): string {
  return /"([^"]+)"/.exec(label)?.[1] ?? label;
}

export function changeLabel(c: SetupChange): string {
  switch (c.kind) {
    case "transfer":
      return `${VERB[c.op]} transfer: ${changeName(c.label)}`;
    case "message":
      return `${VERB[c.op]} message scenario: ${changeName(c.label)}`;
    case "appointments":
      return "Updated appointments";
    case "timezone":
      return "Set the time zone";
  }
}

/** The settings section a change can be reviewed in; the time zone has none of its own. */
export function sectionFor(kind: SetupChange["kind"]): SectionId | null {
  switch (kind) {
    case "transfer":
      return "transfers";
    case "message":
      return "take-message";
    case "appointments":
      return "appointments";
    case "timezone":
      return null;
  }
}

export const TOPIC_LABEL: Record<SetupTopic, string> = {
  transfers: "Transfers",
  messages: "Messages",
  appointments: "Appointments",
};

/** The conversation as shown: the server's messages, plus the user's text while its turn is in flight. */
export function visibleMessages(state: SetupState): SetupMessage[] {
  const messages = state.session?.messages ?? [];
  return state.pending ? [...messages, { role: "user", text: state.pending, at: "" }] : messages;
}

export function canSend(state: SetupState): boolean {
  const s = state.session;
  return state.pending === null && state.available && s?.status === "active" && s.turnCount < s.maxTurns;
}
