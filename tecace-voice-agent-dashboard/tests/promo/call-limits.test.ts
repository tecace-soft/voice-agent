import { describe, expect, it } from "vitest";
import {
  CALL_MAX_SEC,
  IDLE_CHECK_SEC,
  IDLE_END_SEC,
  callEnd,
  callLimitSec,
  shouldCheckIn,
  shouldWrapUp,
  type CallActivity,
} from "../../src/demos/lib/call-limits";

const T0 = 1_000_000;
const at = (sec: number) => T0 + sec * 1000;

function activity(overrides: Partial<CallActivity> = {}): CallActivity {
  return { startedAt: T0, lastCallerAt: T0, limitSec: CALL_MAX_SEC, ...overrides };
}

describe("callLimitSec", () => {
  it("caps a call at ten minutes whatever is left", () => {
    expect(callLimitSec(3600)).toBe(600);
  });

  it("gives a call only what the demo has left", () => {
    expect(callLimitSec(125.7)).toBe(125);
  });

  it("falls back to the cap when the server sent nothing usable", () => {
    expect(callLimitSec(undefined)).toBe(CALL_MAX_SEC);
    expect(callLimitSec(Number.NaN)).toBe(CALL_MAX_SEC);
  });
});

describe("callEnd", () => {
  it("keeps a call going while the caller is talking", () => {
    const a = activity({ lastCallerAt: at(100), lastAgentAt: at(110) });
    expect(callEnd(a, at(120))).toBeNull();
  });

  it("ends a call that reaches its limit even mid-conversation", () => {
    const a = activity({ limitSec: 300, lastCallerAt: at(299), lastAgentAt: at(300) });
    expect(callEnd(a, at(300))).toBe("time_limit");
  });

  it("ends a call nobody is on any more", () => {
    const a = activity({ lastCallerAt: at(10), lastAgentAt: at(20) });
    expect(callEnd(a, at(10 + IDLE_END_SEC))).toBe("idle");
  });

  it("counts silence from the start when the caller never spoke", () => {
    const a = activity({ lastAgentAt: at(5) });
    expect(callEnd(a, at(IDLE_END_SEC - 1))).toBeNull();
    expect(callEnd(a, at(IDLE_END_SEC))).toBe("idle");
  });

  it("does not cut the receptionist off mid-answer", () => {
    const a = activity({ lastCallerAt: at(0), lastAgentAt: at(IDLE_END_SEC) });
    expect(callEnd(a, at(IDLE_END_SEC + 1))).toBeNull();
  });
});

describe("shouldWrapUp", () => {
  it("fires thirty seconds before the limit", () => {
    const a = activity({ limitSec: 600 });
    expect(shouldWrapUp(a, at(569))).toBe(false);
    expect(shouldWrapUp(a, at(570))).toBe(true);
  });

  it("stays quiet on a call too short for a goodbye", () => {
    expect(shouldWrapUp(activity({ limitSec: 45 }), at(40))).toBe(false);
  });
});

describe("shouldCheckIn", () => {
  it("asks after the caller has been silent a while", () => {
    const a = activity({ lastCallerAt: at(0), lastAgentAt: at(5) });
    expect(shouldCheckIn(a, at(IDLE_CHECK_SEC - 1))).toBe(false);
    expect(shouldCheckIn(a, at(IDLE_CHECK_SEC))).toBe(true);
  });
});
