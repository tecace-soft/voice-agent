import { describe, expect, it } from "vitest";
import {
  AMBIENCE,
  AMBIENCE_LEVELS,
  BABBLE_LOWPASS_HZ,
  ENVELOPE_RATE,
  MIN_BUFFER_RATE,
  RING,
  VOICE_BANDS,
  fillImpulseResponse,
  fillSyllableEnvelope,
  fillWhiteNoise,
  nextRingDelayMs,
  nextTypingBurst,
} from "../../src/demos/lib/ambience";

/** A deterministic stand-in for Math.random, so a failure is reproducible. */
function seeded(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const rms = (channel: Float32Array) =>
  Math.sqrt(channel.reduce((sum, v) => sum + v * v, 0) / channel.length);

describe("the levels", () => {
  it("offers silence and two rooms", () => {
    expect(AMBIENCE_LEVELS).toEqual(["off", "quiet", "busy"]);
  });

  it("makes busy busier than quiet in every part of the mix", () => {
    expect(AMBIENCE.busy.babble).toBeGreaterThan(AMBIENCE.quiet.babble);
    expect(AMBIENCE.busy.rumble).toBeGreaterThan(AMBIENCE.quiet.rumble);
    expect(AMBIENCE.busy.typing).toBeGreaterThan(AMBIENCE.quiet.typing);
    expect(AMBIENCE.busy.voices).toBeGreaterThan(AMBIENCE.quiet.voices);
  });

  it("keeps the phone at the other desk out of the quiet office", () => {
    expect(AMBIENCE.quiet.ring).toBe(0);
    expect(AMBIENCE.busy.ring).toBeGreaterThan(0);
  });

  it("never asks for more voices than there are bands to carve them with", () => {
    for (const mix of Object.values(AMBIENCE)) {
      expect(mix.voices).toBeLessThanOrEqual(VOICE_BANDS.length);
    }
  });

  it("stays a background: every gain is a long way under the voice", () => {
    for (const mix of Object.values(AMBIENCE)) {
      for (const gain of [mix.rumble, mix.babble, mix.typing, mix.ring]) {
        expect(gain).toBeLessThan(0.2);
      }
    }
  });
});

describe("the voices", () => {
  it("puts each one in the speech range, under the wall it is heard through", () => {
    for (const band of VOICE_BANDS) {
      expect(band.hz).toBeGreaterThan(300);
      expect(band.hz).toBeLessThan(BABBLE_LOWPASS_HZ);
    }
  });

  it("gives no two the same centre or the same rhythm, or they are one person", () => {
    expect(new Set(VOICE_BANDS.map((b) => b.hz)).size).toBe(VOICE_BANDS.length);
    expect(new Set(VOICE_BANDS.map((b) => b.rate)).size).toBe(VOICE_BANDS.length);
  });

  it("stays above the bottom octaves a laptop speaker cannot reproduce", () => {
    // The old flat room tone sat at 151 Hz and was inaudible for this reason
    // as much as for its level.
    for (const band of VOICE_BANDS) expect(band.hz).toBeGreaterThan(400);
  });
});

describe("fillSyllableEnvelope", () => {
  const channel = new Float32Array(ENVELOPE_RATE * 7);
  fillSyllableEnvelope(channel, ENVELOPE_RATE, seeded(7));

  it("is stored at a rate createBuffer will actually accept", () => {
    // Below 3000 Hz createBuffer throws, the catch around the graph swallows
    // it, and the call quietly loses the telephone band along with the room.
    expect(ENVELOPE_RATE).toBeGreaterThanOrEqual(MIN_BUFFER_RATE);
  });

  it("never goes negative, which would invert the noise instead of silencing it", () => {
    for (const sample of channel) {
      expect(sample).toBeGreaterThanOrEqual(0);
      expect(sample).toBeLessThanOrEqual(1);
    }
  });

  it("opens and closes, rather than sitting at one level", () => {
    const loud = channel.filter((sample) => sample > 0.6).length;
    const quiet = channel.filter((sample) => sample < 0.05).length;
    expect(loud).toBeGreaterThan(channel.length * 0.05);
    expect(quiet).toBeGreaterThan(channel.length * 0.02);
  });

  it("glides between syllables instead of stepping, which would click", () => {
    let steps = 0;
    for (let i = 1; i < channel.length; i++) {
      if (Math.abs(channel[i]! - channel[i - 1]!) > 0.1) steps++;
    }
    expect(steps).toBe(0);
  });

  it("changes at a syllable rate, not a hum and not a drone", () => {
    // Count the crossings of the midpoint: speech turns over a few times a
    // second, so seven seconds should show several and nowhere near a hundred.
    let crossings = 0;
    for (let i = 1; i < channel.length; i++) {
      if ((channel[i - 1]! < 0.4) !== (channel[i]! < 0.4)) crossings++;
    }
    const perSecond = crossings / 7;
    expect(perSecond).toBeGreaterThan(0.5);
    expect(perSecond).toBeLessThan(12);
  });
});

describe("fillWhiteNoise", () => {
  it("fills the range without a bias to one side", () => {
    const channel = new Float32Array(8192);
    fillWhiteNoise(channel, seeded(3));
    const mean = channel.reduce((sum, v) => sum + v, 0) / channel.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(rms(channel)).toBeGreaterThan(0.5);
  });
});

describe("fillImpulseResponse", () => {
  const channel = new Float32Array(4096);
  fillImpulseResponse(channel, 48000, seeded(11));

  it("decays, so it is a room and not a repeat", () => {
    const head = rms(channel.slice(0, 512));
    const tail = rms(channel.slice(-512));
    expect(head).toBeGreaterThan(tail * 8);
  });

  it("ends at silence", () => {
    expect(Math.abs(channel[channel.length - 1]!)).toBeLessThan(0.01);
  });
});

describe("nextTypingBurst", () => {
  it("types a few words, then stops to think", () => {
    const random = seeded(5);
    for (let i = 0; i < 200; i++) {
      const burst = nextTypingBurst(random);
      expect(burst.clicks).toBeGreaterThanOrEqual(4);
      expect(burst.clicks).toBeLessThan(25);
      // Between about 3 and 15 keys a second: a person, not a printer.
      expect(burst.spacingMs).toBeGreaterThanOrEqual(70);
      expect(burst.spacingMs).toBeLessThan(170);
      expect(burst.restMs).toBeGreaterThan(burst.spacingMs);
    }
  });

  it("does not give the same burst twice, which is what a loop sounds like", () => {
    const random = seeded(5);
    const seen = new Set(
      Array.from({ length: 20 }, () => JSON.stringify(nextTypingBurst(random))),
    );
    expect(seen.size).toBe(20);
  });
});

describe("the phone at the other desk", () => {
  it("rings rarely enough to be somebody else's problem", () => {
    const random = seeded(9);
    for (let i = 0; i < 100; i++) {
      const delay = nextRingDelayMs(random);
      expect(delay).toBeGreaterThanOrEqual(60_000);
      expect(delay).toBeLessThan(151_000);
    }
  });

  it("is US ringback, rolled off like it is across the room", () => {
    expect(RING.hz).toEqual([440, 480]);
    expect(RING.lowpassHz).toBeLessThan(1000);
    expect(RING.offSec).toBeGreaterThan(RING.onSec);
  });
});
