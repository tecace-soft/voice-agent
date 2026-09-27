import { useCallback, useRef, useState } from "react";
import type { ToolCall, ToolResult } from "@/hooks/useLiveCall";
import type { CallSettings } from "../callSettings";
import {
  afterAnswer,
  event,
  initialTextState,
  replyText,
  sendLink,
  takeMessage,
  type PendingTransfer,
  type SimEvent,
  type SimMessage,
  type SimText,
  type TextState,
  type TransferAnswer,
} from "./simulate";

// The simulated phone line around an in-app test call: holds what the tools did and the one
// decision that needs the person testing (how the other phone answered a transfer).

export function useCallSimulator(settings: CallSettings, businessName: string, businessPhone: string | null) {
  const [pending, setPending] = useState<PendingTransfer | null>(null);
  const [texts, setTexts] = useState<SimText[]>([]);
  const [messages, setMessages] = useState<SimMessage[]>([]);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [textState, setTextState] = useState<TextState>(initialTextState);
  const [transferLog, setTransferLog] = useState<string[]>([]);

  // Refs for what the tool handler reads: it is called from inside the call hook, long after the
  // render that created it, and must see the current settings and state.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const textRef = useRef(textState);
  textRef.current = textState;
  const eventsRef = useRef<SimEvent[]>([]);
  const resolveRef = useRef<((result: ToolResult) => void) | null>(null);
  const pendingRef = useRef<PendingTransfer | null>(null);

  const log = useCallback((...add: SimEvent[]) => {
    eventsRef.current = [...eventsRef.current, ...add];
    setEvents(eventsRef.current);
  }, []);

  const reset = useCallback(() => {
    resolveRef.current = null;
    pendingRef.current = null;
    eventsRef.current = [];
    setPending(null);
    setTexts([]);
    setMessages([]);
    setEvents([]);
    setTextState(initialTextState());
    setTransferLog([]);
  }, []);

  const onToolCall = useCallback(
    async (call: ToolCall): Promise<ToolResult> => {
      const current = settingsRef.current;
      if (call.name === "transfer_call") {
        const scenario = current.transfer.scenarios.find((s) => s.id === call.args.scenario_id);
        const reason = typeof call.args.reason === "string" ? call.args.reason : "";
        const callerName = typeof call.args.caller_name === "string" ? call.args.caller_name : "";
        log(event("transfer_requested", { scenarioId: call.args.scenario_id, reason, callerName }));
        if (!scenario) {
          log(event("transfer_final", { success: false, why: "unknown scenario" }));
          return { output: JSON.stringify({ result: "failed" }), resume: true };
        }
        const next: PendingTransfer = { scenario, reason, callerName, index: 0 };
        pendingRef.current = next;
        setPending(next);
        return new Promise<ToolResult>((resolve) => {
          resolveRef.current = resolve;
        });
      }
      if (call.name === "send_link") {
        const outcome = sendLink(current, textRef.current, String(call.args.scenario_id ?? ""), businessName, businessPhone);
        textRef.current = outcome.state;
        setTextState(outcome.state);
        setTexts((t) => [...t, ...outcome.texts]);
        log(...outcome.events);
        return outcome.result;
      }
      if (call.name === "take_message") {
        const taken = takeMessage(call.args);
        setMessages((m) => [...m, taken.message]);
        log(taken.event);
        return taken.result;
      }
      if (call.name === "end_call") {
        log(event("end_call"));
        return { output: JSON.stringify({ ok: true }), resume: false, hangup: true };
      }
      return { output: JSON.stringify({ error: `unknown tool ${call.name}` }), resume: true };
    },
    [businessName, businessPhone, log],
  );

  /** The person testing plays the phone being rung. */
  const answer = useCallback(
    (how: TransferAnswer) => {
      const current = pendingRef.current;
      if (!current) return;
      const number = current.scenario.numbers[current.index] ?? "";
      log(event("transfer_attempt", { scenarioId: current.scenario.id, number, index: current.index, result: how }));
      setTransferLog((l) => [...l, `${number}: ${how.replace("_", " ")}`]);
      const step = afterAnswer(current, how);
      if ("next" in step) {
        pendingRef.current = step.next;
        setPending(step.next);
        return;
      }
      log(event("transfer_final", { scenarioId: current.scenario.id, success: step.success }));
      pendingRef.current = null;
      setPending(null);
      resolveRef.current?.(step.result);
      resolveRef.current = null;
    },
    [log],
  );

  /** The caller replying to a text. */
  const reply = useCallback(
    (what: "YES" | "STOP") => {
      const outcome = replyText(textRef.current, what, businessName);
      textRef.current = outcome.state;
      setTextState(outcome.state);
      setTexts((t) => [...t, ...outcome.texts]);
      log(...outcome.events);
    },
    [businessName, log],
  );

  return {
    onToolCall,
    reportExtras: useCallback(() => ({ events: eventsRef.current }), []),
    pending,
    answer,
    texts,
    reply,
    textState,
    messages,
    events,
    transferLog,
    reset,
  };
}
