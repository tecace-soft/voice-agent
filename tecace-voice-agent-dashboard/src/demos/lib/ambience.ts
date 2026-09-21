/**
 * The sound of a place with people working in it, built from noise and filters
 * rather than a recording.
 *
 * A flat hiss behind the receptionist says "this audio has a noise floor". What
 * sells a front desk is the room *doing* something: somebody talking two desks
 * away, a keyboard going in bursts, a phone nobody is picking up. None of it
 * should be identifiable — the moment a word comes through it stops being
 * background and starts being a distraction.
 *
 * The voices are speech-shaped noise driven by a syllable-rate envelope, which
 * is how a multitalker babble masker is made. Behind a wall, at this level, the
 * ear fills in people. It is not a recording of an office and will not survive
 * being turned up; that is what the levels are for.
 *
 * These are the pure parts, kept out of lib/call-audio.ts so they can be
 * measured without a browser.
 */

export type AmbienceLevel = "off" | "quiet" | "busy";

export const AMBIENCE_LEVELS: AmbienceLevel[] = ["off", "quiet", "busy"];

export type AmbienceMix = {
  /** Air handling and distance. The bed everything else sits on. */
  rumble: number;
  /** Talking, somewhere else in the room. */
  babble: number;
  /** How many people are talking. */
  voices: number;
  /** A keyboard, in bursts, the way typing actually happens. */
  typing: number;
  /** A phone at another desk. Zero keeps it out entirely. */
  ring: number;
};

/**
 * Levels are named for the room, not for a number of decibels, because the
 * operator picks one by ear on a real call. `quiet` is a small office with
 * someone on the phone in the next room; `busy` is a front desk on a Monday.
 */
export const AMBIENCE: Record<Exclude<AmbienceLevel, "off">, AmbienceMix> = {
  quiet: { rumble: 0.0185, babble: 0.0345, voices: 2, typing: 0.0155, ring: 0 },
  busy: { rumble: 0.041, babble: 0.098, voices: 3, typing: 0.031, ring: 0.0043 },
};

/**
 * What those numbers were chosen to produce, measured by rendering the graph
 * through an OfflineAudioContext — a keystroke is a transient and is set by its
 * peak, the rest by RMS. They are recorded here because the gains themselves
 * say nothing: a keystroke at 0.11 sounded reasonable written down and came out
 * at -25 dBFS, which is as loud as the receptionist.
 */
export const MEASURED_DBFS = {
  quiet: { bed: -48, keystroke: -42 },
  busy: { bed: -41, keystroke: -36, ring: -50 },
} as const;

/**
 * Where each voice sits. Different centres so two of them read as two people
 * rather than one person in stereo, and a Q wide enough to keep vowels dull.
 */
export const VOICE_BANDS = [
  { hz: 520, q: 0.9, rate: 0.87 },
  { hz: 790, q: 0.9, rate: 1.0 },
  { hz: 640, q: 0.9, rate: 1.13 },
] as const;

/** Muffled by the wall it is coming through. */
export const BABBLE_LOWPASS_HZ = 1150;

/**
 * The envelope carries nothing above a few Hz, so it is stored well below the
 * audio rate and resampled up — 7 seconds of it costs 112KB instead of 1.3MB.
 *
 * It cannot go lower than this. `createBuffer` refuses a sample rate under
 * 3000 Hz, and the throw lands in the catch around the whole graph, which
 * silently drops the caller back to plain playback with no telephone band and
 * no room at all.
 */
export const ENVELOPE_RATE = 4000;
export const MIN_BUFFER_RATE = 3000;
export const ENVELOPE_SECONDS = 7;

export const NOISE_SECONDS = 4;

/** Pink-ish noise: white run through a one-pole low-pass. */
export function fillRoomToneBuffer(channel: Float32Array, random = Math.random): void {
  let last = 0;
  for (let i = 0; i < channel.length; i++) {
    const white = random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    channel[i] = last * 3.5;
  }
}

/** Flat white noise, for the voices and the keyboard to be carved out of. */
export function fillWhiteNoise(channel: Float32Array, random = Math.random): void {
  for (let i = 0; i < channel.length; i++) channel[i] = random() * 2 - 1;
}

/**
 * The rhythm of someone talking: a new level every syllable, glided into so it
 * does not click, with gaps where they stop for breath or to listen.
 *
 * Stays within 0..1 — it is multiplied onto a gain, and a negative value would
 * invert the noise rather than silence it.
 */
export function fillSyllableEnvelope(
  channel: Float32Array,
  sampleRate: number,
  random = Math.random,
): void {
  const glide = Math.exp(-1 / (sampleRate * 0.035));
  let value = 0;
  let target = 0;
  let hold = 0;
  for (let i = 0; i < channel.length; i++) {
    if (hold <= 0) {
      // Roughly a fifth of the time nobody is saying anything, which is what
      // stops it sounding like a machine that hums in words.
      target = random() < 0.22 ? 0 : 0.35 + random() * 0.65;
      hold = Math.floor(sampleRate * (0.09 + random() * 0.22));
    }
    hold--;
    value = target + (value - target) * glide;
    channel[i] = value;
  }
}

/**
 * A short room, as decaying noise. Convolved with the voices it puts them
 * somewhere other than against the microphone.
 */
export function fillImpulseResponse(
  channel: Float32Array,
  _sampleRate: number,
  random = Math.random,
): void {
  const decay = channel.length;
  for (let i = 0; i < decay; i++) {
    channel[i] = (random() * 2 - 1) * Math.pow(1 - i / decay, 2.4);
  }
}

export type TypingBurst = {
  /** Keys in this burst — a few words, then a pause to think. */
  clicks: number;
  /** Milliseconds between keys. */
  spacingMs: number;
  /** Silence after the burst, before the next one. */
  restMs: number;
};

/**
 * Typing is not a steady rattle. It comes in runs with pauses between, and a
 * steady one is the giveaway that nothing is really being written.
 */
export function nextTypingBurst(random = Math.random): TypingBurst {
  return {
    clicks: 4 + Math.floor(random() * 18),
    spacingMs: 70 + random() * 90,
    restMs: 2500 + random() * 9000,
  };
}

/** How long until the phone at the other desk rings again. */
export function nextRingDelayMs(random = Math.random): number {
  return 60_000 + random() * 90_000;
}

/** US ringback, which is these two tones together. */
export const RING = {
  hz: [440, 480],
  /** Heavily rolled off, because it is coming from across the room. */
  lowpassHz: 760,
  onSec: 2,
  offSec: 4,
  cycles: 3,
} as const;
