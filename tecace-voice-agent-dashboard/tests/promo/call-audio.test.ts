import { describe, expect, it } from "vitest";
import { PHONE_BAND, resolveCallSound } from "../../src/demos/lib/call-audio";
import { fillRoomToneBuffer } from "../../src/demos/lib/ambience";
import { DEFAULT_VOICE, LIVE_VOICE_OPTIONS } from "../../src/demos/lib/types";

describe("resolveCallSound", () => {
  it("puts a quiet office behind the voice when nothing is stored", () => {
    expect(resolveCallSound(undefined)).toEqual({ phoneLine: true, ambience: "quiet" });
    expect(resolveCallSound(null)).toEqual({ phoneLine: true, ambience: "quiet" });
  });

  it("keeps the level the operator picked", () => {
    expect(resolveCallSound({ ambience: "busy" }).ambience).toBe("busy");
    expect(resolveCallSound({ ambience: "off" }).ambience).toBe("off");
    expect(resolveCallSound({ phoneLine: false, ambience: "off" })).toEqual({
      phoneLine: false,
      ambience: "off",
    });
  });

  it("reads an older record's room tone switch", () => {
    // On meant a flat hiss too quiet to hear, so it lands on the quiet office
    // rather than on nothing.
    expect(resolveCallSound({ roomTone: true }).ambience).toBe("quiet");
    expect(resolveCallSound({ roomTone: false }).ambience).toBe("off");
  });

  it("lets a level override the switch it replaced", () => {
    expect(resolveCallSound({ roomTone: false, ambience: "busy" }).ambience).toBe("busy");
  });
});

describe("phone band", () => {
  it("covers the speech range a phone line passes", () => {
    expect(PHONE_BAND.highpassHz).toBeGreaterThanOrEqual(200);
    expect(PHONE_BAND.lowpassHz).toBeLessThanOrEqual(4000);
    expect(PHONE_BAND.presenceHz).toBeGreaterThan(PHONE_BAND.highpassHz);
    expect(PHONE_BAND.presenceHz).toBeLessThan(PHONE_BAND.lowpassHz);
  });
});

describe("fillRoomToneBuffer", () => {
  it("fills the whole buffer within the audio range", () => {
    const channel = new Float32Array(2048);
    fillRoomToneBuffer(channel);
    expect(channel.some((sample) => sample !== 0)).toBe(true);
    for (const sample of channel) {
      expect(Math.abs(sample)).toBeLessThanOrEqual(1);
    }
  });

  it("is low-passed, so neighbouring samples track each other", () => {
    const channel = new Float32Array(4096);
    fillRoomToneBuffer(channel);
    let jumps = 0;
    for (let i = 1; i < channel.length; i++) {
      if (Math.abs(channel[i]! - channel[i - 1]!) > 0.2) jumps++;
    }
    expect(jumps).toBe(0);
  });
});

describe("voice catalogue", () => {
  it("defaults to a North American voice", () => {
    const fallback = LIVE_VOICE_OPTIONS.find((voice) => voice.id === DEFAULT_VOICE);
    expect(fallback?.accent).toBe("North American");
  });

  it("labels every voice with an accent", () => {
    for (const voice of LIVE_VOICE_OPTIONS) {
      expect(voice.accent.length).toBeGreaterThan(0);
      expect(voice.id).toMatch(/^[a-z]+$/);
    }
  });
});
