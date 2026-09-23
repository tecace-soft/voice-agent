/**
 * When a call ends without anyone pressing hang up. Pure, so the rules can be
 * tested without a peer connection; `hooks/useLiveCall.ts` runs them once a
 * second.
 *
 * Before this, a caller who walked away left the microphone open and the
 * session billing until they closed the tab.
 */

/** No single call runs longer than this, whatever the allowance says. */
export const CALL_MAX_SEC = 10 * 60;

/** How long before the limit the receptionist is told to wrap up. */
export const WRAP_UP_LEAD_SEC = 30;

/** Caller silence after which the call is over. */
export const IDLE_END_SEC = 60;

/** Caller silence after which the receptionist asks if they are still there. */
export const IDLE_CHECK_SEC = 40;

/**
 * The receptionist must have been quiet this long too, so a long answer is
 * not cut off mid-sentence and the "still there?" gets a chance to be heard.
 */
export const AGENT_QUIET_SEC = 8;

export type CallEnd = "time_limit" | "idle";

export type CallActivity = {
  /** When `session.started` arrived. */
  startedAt: number;
  /** Last caller transcript fragment; the start of the call before any. */
  lastCallerAt: number;
  /** Last receptionist transcript fragment, if it has spoken. */
  lastAgentAt?: number;
  /** Seconds this call may run. */
  limitSec: number;
};

/**
 * The cap for one call: what is left of the demo, and never more than
 * CALL_MAX_SEC. A missing or nonsense number from the server gets the cap.
 */
export function callLimitSec(remainingSec?: number | null): number {
  if (typeof remainingSec !== "number" || !Number.isFinite(remainingSec)) {
    return CALL_MAX_SEC;
  }
  return Math.max(0, Math.min(CALL_MAX_SEC, Math.floor(remainingSec)));
}

function secondsSince(at: number, now: number): number {
  return (now - at) / 1000;
}

function agentQuiet(activity: CallActivity, now: number, sec: number): boolean {
  return activity.lastAgentAt === undefined || secondsSince(activity.lastAgentAt, now) >= sec;
}

/** Why the call should end now, or null to keep going. */
export function callEnd(activity: CallActivity, now: number): CallEnd | null {
  if (secondsSince(activity.startedAt, now) >= activity.limitSec) return "time_limit";
  if (
    secondsSince(activity.lastCallerAt, now) >= IDLE_END_SEC &&
    agentQuiet(activity, now, AGENT_QUIET_SEC)
  ) {
    return "idle";
  }
  return null;
}

/** Time to tell the receptionist the demo is nearly over. */
export function shouldWrapUp(activity: CallActivity, now: number): boolean {
  // A cap this short has no room for a goodbye; it would open with one.
  if (activity.limitSec <= WRAP_UP_LEAD_SEC * 2) return false;
  return secondsSince(activity.startedAt, now) >= activity.limitSec - WRAP_UP_LEAD_SEC;
}

/** Time to have the receptionist ask whether the caller is still there. */
export function shouldCheckIn(activity: CallActivity, now: number): boolean {
  return (
    secondsSince(activity.lastCallerAt, now) >= IDLE_CHECK_SEC &&
    agentQuiet(activity, now, AGENT_QUIET_SEC)
  );
}

export const WRAP_UP_INSTRUCTION =
  "The demo call is about to reach its time limit. Finish the sentence you are on, " +
  "tell the caller the demo time is up and that they can reach the team from the page " +
  "for more, then say goodbye. Keep it to two short sentences.";

export const CHECK_IN_INSTRUCTION =
  "The caller has been silent for a while. Ask once, briefly, whether they are still " +
  "there. If they stay silent the call will end on its own; do not keep asking.";
