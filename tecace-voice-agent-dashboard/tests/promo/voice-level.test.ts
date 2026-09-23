import { describe, expect, it } from "vitest";
import { follow, levelFromSamples, orbMode, orbPlaybackRate } from "../../src/demos/lib/voice-level";

const sine = (amplitude: number, n = 256) =>
  Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin((i / n) * Math.PI * 8));

describe("levelFromSamples", () => {
  it("is zero for silence", () => {
    expect(levelFromSamples(new Float32Array(256))).toBe(0);
  });

  it("maps quiet speech into the lower half and loud speech near the top", () => {
    const quiet = levelFromSamples(sine(0.03));
    const loud = levelFromSamples(sine(0.3));
    expect(quiet).toBeGreaterThan(0.05);
    expect(quiet).toBeLessThan(0.5);
    expect(loud).toBeGreaterThan(0.8);
  });

  it("never exceeds one, however hot the signal", () => {
    expect(levelFromSamples(sine(1))).toBe(1);
    expect(levelFromSamples(sine(4))).toBe(1);
  });

  it("handles an empty buffer", () => {
    expect(levelFromSamples(new Float32Array(0))).toBe(0);
  });
});

describe("follow", () => {
  it("rises fast and falls slowly, so speech looks immediate and silence looks calm", () => {
    const up = follow(0, 1);
    const down = follow(1, 0);
    expect(up).toBeGreaterThan(0.25);
    expect(1 - down).toBeLessThan(0.15);
  });

  it("settles on the target", () => {
    let value = 0;
    for (let i = 0; i < 200; i++) value = follow(value, 0.6);
    expect(value).toBeCloseTo(0.6, 3);
  });

  it("stays within zero and one", () => {
    expect(follow(0, 2)).toBeLessThanOrEqual(1);
    expect(follow(1, -1)).toBeGreaterThanOrEqual(0);
  });
});

describe("orbMode", () => {
  it("is idle off the line, whatever the meters say", () => {
    expect(orbMode(false, 0.8, 0.8)).toBe("idle");
  });

  it("follows whoever is louder and gives the receptionist a tie", () => {
    expect(orbMode(true, 0.5, 0.1)).toBe("listening");
    expect(orbMode(true, 0.1, 0.5)).toBe("speaking");
    expect(orbMode(true, 0.3, 0.3)).toBe("speaking");
  });

  it("listens on a silent line", () => {
    expect(orbMode(true, 0, 0)).toBe("listening");
  });
});

describe("orbPlaybackRate", () => {
  it("drifts below real time at rest and ignores level while idle", () => {
    expect(orbPlaybackRate("idle", 0)).toBe(0.65);
    expect(orbPlaybackRate("idle", 1)).toBe(0.65);
  });

  it("runs faster for the receptionist than for the caller at the same level", () => {
    expect(orbPlaybackRate("speaking", 0.5)).toBeGreaterThan(orbPlaybackRate("listening", 0.5));
  });

  it("stays inside what a video element will play, however hot the level", () => {
    expect(orbPlaybackRate("speaking", 9)).toBeCloseTo(2.15);
    expect(orbPlaybackRate("listening", -1)).toBe(0.9);
  });
});
