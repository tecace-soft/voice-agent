import { describe, expect, it } from "vitest";
import type { SetupChange, SetupMessage, SetupSession, SetupStateResponse, SetupTurnResponse } from "../src/api/types";
import { emptyCallSettings, withDefaults } from "../src/settings/callSettings";
import {
  TOPIC_LABEL,
  canSend,
  cardKey,
  changeLabel,
  initialSetupState,
  keysOf,
  sectionFor,
  setupReducer,
  visibleMessages,
  type SetupState,
} from "../src/settings/setup/setupState";

// The guided setup's pure state: what the chat and board show between the GET, each turn and a reset.

function session(over: Partial<SetupSession> = {}): SetupSession {
  return {
    id: "s1",
    status: "active",
    topics: { transfers: "pending", messages: "pending", appointments: "pending" },
    turnCount: 1,
    maxTurns: 30,
    messages: [{ role: "assistant", text: "Hi! What does your business do?", at: "2026-09-29T10:00:00Z" }],
    startedAt: "2026-09-29T10:00:00Z",
    ...over,
  };
}

function ready(over: Partial<SetupState> = {}): SetupState {
  return { ...initialSetupState, loading: false, available: true, session: session(), ...over };
}

const transferAdd: SetupChange = { kind: "transfer", op: "add", id: "t1", label: 'Transfer "Sam" → (206) 555-0134' };

describe("initialSetupState", () => {
  it("starts loading with nothing else", () => {
    expect(initialSetupState).toEqual({
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
    });
  });
});

describe("setupReducer", () => {
  it("load clears a previous load error", () => {
    const next = setupReducer({ ...initialSetupState, loading: false, loadError: "down" }, { type: "load" });
    expect(next.loading).toBe(true);
    expect(next.loadError).toBeNull();
  });

  it("loaded takes an available account's session and draft (with defaults filled in)", () => {
    const draft = { ...emptyCallSettings(), timezone: "America/Chicago" };
    const response: SetupStateResponse = { session: session(), draft, dirty: true, available: true };
    const next = setupReducer({ ...initialSetupState, error: "old" }, { type: "loaded", response });
    expect(next.loading).toBe(false);
    expect(next.available).toBe(true);
    expect(next.unavailableReason).toBeNull();
    expect(next.session).toEqual(session());
    expect(next.draft).toEqual(withDefaults(draft));
    expect(next.dirty).toBe(true);
    expect(next.error).toBeNull();
  });

  it("loaded keeps why an account can't use it", () => {
    const response = {
      session: null,
      draft: { transfer: { waterfallEnabled: false, scenarios: [] } },
      dirty: false,
      available: false,
      unavailableReason: "no_openai_key",
    } as unknown as SetupStateResponse;
    const next = setupReducer(initialSetupState, { type: "loaded", response });
    expect(next.available).toBe(false);
    expect(next.unavailableReason).toBe("no_openai_key");
    expect(next.session).toBeNull();
    // A partial draft from the server still arrives whole.
    expect(next.draft).toEqual(emptyCallSettings());
  });

  it("load_failed stops loading and says why", () => {
    const next = setupReducer(initialSetupState, { type: "load_failed", message: "Couldn't reach the server." });
    expect(next.loading).toBe(false);
    expect(next.loadError).toBe("Couldn't reach the server.");
  });

  it("sending holds the text and clears the last error and retry", () => {
    const next = setupReducer(ready({ error: "no", retryText: "old" }), { type: "sending", text: "We fix bikes" });
    expect(next.pending).toBe("We fix bikes");
    expect(next.error).toBeNull();
    expect(next.retryText).toBeNull();
  });

  it("replied replaces the session, drops the pending bubble and highlights the changed cards", () => {
    const reply: SetupMessage = {
      role: "assistant",
      text: "Done.",
      at: "2026-09-29T10:01:00Z",
      changes: [
        transferAdd,
        { kind: "transfer", op: "update", id: "t1", label: 'Transfer "Sam" → (206) 555-0134' },
        { kind: "message", op: "remove", id: "m1", label: 'Removed message situation "Old"' },
        { kind: "timezone", op: "update", label: "Time zone: America/Chicago" },
      ],
    };
    const nextSession = session({
      turnCount: 2,
      messages: [
        ...session().messages,
        { role: "user", text: "Put billing through to Sam", at: "2026-09-29T10:00:30Z" },
        reply,
      ],
    });
    const draft = emptyCallSettings();
    const response: SetupTurnResponse = { session: nextSession, reply, draft, dirty: true };
    const next = setupReducer(ready({ pending: "Put billing through to Sam", error: "x" }), { type: "replied", response });
    expect(next.session).toBe(nextSession);
    expect(next.pending).toBeNull();
    expect(next.error).toBeNull();
    expect(next.draft).toEqual(withDefaults(draft));
    expect(next.dirty).toBe(true);
    expect(next.highlightIds).toEqual(["transfer:t1", "timezone"]);
    // The server's messages already carry the user's text: it shows once, not twice.
    expect(visibleMessages(next).filter((m) => m.text === "Put billing through to Sam")).toHaveLength(1);
  });

  it("failed puts the text back in the composer", () => {
    const next = setupReducer(ready({ pending: "We fix bikes" }), { type: "failed", message: "Timed out" });
    expect(next.pending).toBeNull();
    expect(next.retryText).toBe("We fix bikes");
    expect(next.error).toBe("Timed out");
  });

  it("failed on a start keeps an empty retry, which offers Start again", () => {
    const next = setupReducer(ready({ session: null, pending: "" }), { type: "failed", message: "Timed out" });
    expect(next.retryText).toBe("");
  });

  it("failed with nothing in flight (a reset) leaves no retry", () => {
    const next = setupReducer(ready(), { type: "failed", message: "Couldn't reset" });
    expect(next.retryText).toBeNull();
    expect(next.error).toBe("Couldn't reset");
  });

  describe("synced (the server's copy after a failed turn)", () => {
    const failedText = "Put the front desk on 206 555 0177";
    const savedDraft = { ...emptyCallSettings(), timezone: "America/Chicago" };
    // What OpenAI dropping out mid-turn leaves: the message, and a note saying what was saved.
    const recorded = session({
      turnCount: 2,
      messages: [
        ...session().messages,
        { role: "user", text: failedText, at: "2026-09-29T10:00:30Z" },
        {
          role: "assistant",
          text: 'I saved: Transfer "Front desk". Then I lost the connection — say "continue" and I\'ll carry on.',
          at: "2026-09-29T10:00:40Z",
          changes: [transferAdd],
        },
      ],
    });
    const afterFailure = () => setupReducer(ready({ pending: failedText }), { type: "failed", message: "Timed out" });

    it("replaces the session and draft, keeps the error, and clears a retry the transcript already holds", () => {
      const response: SetupStateResponse = { session: recorded, draft: savedDraft, dirty: true, available: true };
      const next = setupReducer(afterFailure(), { type: "synced", response, failedText });
      expect(next.session).toBe(recorded);
      expect(next.draft).toEqual(withDefaults(savedDraft));
      expect(next.dirty).toBe(true);
      expect(next.available).toBe(true);
      expect(next.unavailableReason).toBeNull();
      expect(next.error).toBe("Timed out");
      expect(next.loading).toBe(false);
      expect(next.retryText).toBeNull();
      expect(visibleMessages(next).at(-1)?.text).toContain("lost the connection");
    });

    it("leaves the retry when the server never got the message", () => {
      const response: SetupStateResponse = { session: session(), draft: savedDraft, dirty: false, available: true };
      const next = setupReducer(afterFailure(), { type: "synced", response, failedText });
      expect(next.retryText).toBe(failedText);
      expect(next.error).toBe("Timed out");
      expect(next.session).toEqual(session());
      expect(next.dirty).toBe(false);
    });

    it("only counts the last user message as the one that was recorded", () => {
      // An earlier, identical message doesn't mean this one landed.
      const older = session({
        messages: [
          { role: "user", text: failedText, at: "2026-09-29T09:59:00Z" },
          { role: "assistant", text: "Done.", at: "2026-09-29T09:59:10Z" },
          { role: "user", text: "Something else", at: "2026-09-29T09:59:30Z" },
          { role: "assistant", text: "Ok.", at: "2026-09-29T09:59:40Z" },
        ],
      });
      const response: SetupStateResponse = { session: older, draft: savedDraft, dirty: false, available: true };
      expect(setupReducer(afterFailure(), { type: "synced", response, failedText }).retryText).toBe(failedText);
    });

    it("keeps an empty retry (Start again) after a failed opener, and takes the account's availability", () => {
      const failedStart = setupReducer(ready({ session: null, pending: "" }), { type: "failed", message: "Timed out" });
      const response = {
        session: session({ messages: [] }),
        draft: emptyCallSettings(),
        dirty: false,
        available: false,
        unavailableReason: "no_openai_key",
      } as SetupStateResponse;
      const next = setupReducer(failedStart, { type: "synced", response, failedText: "" });
      expect(next.retryText).toBe("");
      expect(next.session?.messages).toEqual([]);
      expect(next.available).toBe(false);
      expect(next.unavailableReason).toBe("no_openai_key");
    });
  });

  it("reset_done ends the session but keeps the draft", () => {
    const draft = { ...emptyCallSettings(), timezone: "America/Chicago" };
    const next = setupReducer(ready({ draft, dirty: true, error: "x", retryText: "hi", highlightIds: ["timezone"] }), {
      type: "reset_done",
    });
    expect(next.session).toBeNull();
    expect(next.pending).toBeNull();
    expect(next.error).toBeNull();
    expect(next.retryText).toBeNull();
    expect(next.highlightIds).toEqual([]);
    expect(next.draft).toBe(draft);
    expect(next.dirty).toBe(true);
  });

  it("highlight_cleared empties the highlights only", () => {
    const state = ready({ highlightIds: ["timezone"] });
    const next = setupReducer(state, { type: "highlight_cleared" });
    expect(next.highlightIds).toEqual([]);
    expect(next.session).toBe(state.session);
  });
});

describe("visibleMessages", () => {
  it("adds an optimistic bubble for text in flight", () => {
    const shown = visibleMessages(ready({ pending: "We fix bikes" }));
    expect(shown).toHaveLength(2);
    expect(shown[1]).toEqual({ role: "user", text: "We fix bikes", at: "" });
  });

  it("adds none for a start or when nothing is in flight", () => {
    expect(visibleMessages(ready({ pending: "" }))).toHaveLength(1);
    expect(visibleMessages(ready())).toHaveLength(1);
    expect(visibleMessages({ ...initialSetupState })).toEqual([]);
  });
});

describe("canSend", () => {
  it("is true for an active session with turns left and nothing in flight", () => {
    expect(canSend(ready())).toBe(true);
  });

  it("is false when finished, at the turn limit, in flight or unavailable", () => {
    expect(canSend(ready({ session: session({ status: "finished" }) }))).toBe(false);
    expect(canSend(ready({ session: session({ turnCount: 30, maxTurns: 30 }) }))).toBe(false);
    expect(canSend(ready({ pending: "hi" }))).toBe(false);
    expect(canSend(ready({ available: false }))).toBe(false);
    expect(canSend(ready({ session: null }))).toBe(false);
  });
});

describe("change helpers", () => {
  it("cardKey names the board card a change lands on", () => {
    expect(cardKey(transferAdd)).toBe("transfer:t1");
    expect(cardKey({ kind: "message", op: "update", id: "m1", label: "x" })).toBe("message:m1");
    expect(cardKey({ kind: "appointments", op: "update", label: "x" })).toBe("appointments");
    expect(cardKey({ kind: "timezone", op: "update", label: "x" })).toBe("timezone");
    expect(cardKey({ kind: "transfer", op: "remove", id: "t1", label: "x" })).toBeNull();
    expect(cardKey({ kind: "transfer", op: "add", label: "x" })).toBeNull();
    expect(cardKey({ kind: "message", op: "add", label: "x" })).toBeNull();
  });

  it("keysOf is unique, skips removes and keeps order", () => {
    expect(keysOf(undefined)).toEqual([]);
    expect(
      keysOf([
        { kind: "appointments", op: "update", label: "x" },
        transferAdd,
        { kind: "transfer", op: "remove", id: "t2", label: "x" },
        { ...transferAdd, op: "update" },
      ]),
    ).toEqual(["appointments", "transfer:t1"]);
  });

  it("changeLabel reduces a quoted name and keeps a plain label", () => {
    expect(changeLabel(transferAdd)).toBe("Added transfer: Sam");
    expect(changeLabel({ ...transferAdd, op: "update" })).toBe("Updated transfer: Sam");
    expect(changeLabel({ kind: "transfer", op: "remove", id: "t1", label: 'Removed transfer "Sam"' })).toBe(
      "Removed transfer: Sam",
    );
    expect(changeLabel({ kind: "message", op: "add", id: "m1", label: 'Message situation "Quote request"' })).toBe(
      "Added message scenario: Quote request",
    );
    expect(changeLabel({ kind: "message", op: "update", id: "m1", label: "Quote request" })).toBe(
      "Updated message scenario: Quote request",
    );
    expect(changeLabel({ kind: "message", op: "remove", id: "m1", label: 'Removed message situation "Old"' })).toBe(
      "Removed message scenario: Old",
    );
    expect(changeLabel({ kind: "appointments", op: "update", label: "Appointments: off" })).toBe("Updated appointments");
    expect(changeLabel({ kind: "timezone", op: "update", label: "Time zone: America/Chicago" })).toBe(
      "Set the time zone",
    );
  });

  it("sectionFor points a change at its settings section", () => {
    expect(sectionFor("transfer")).toBe("transfers");
    expect(sectionFor("message")).toBe("take-message");
    expect(sectionFor("appointments")).toBe("appointments");
    expect(sectionFor("timezone")).toBeNull();
  });

  it("TOPIC_LABEL names the three topics", () => {
    expect(TOPIC_LABEL).toEqual({ transfers: "Transfers", messages: "Messages", appointments: "Appointments" });
  });
});
