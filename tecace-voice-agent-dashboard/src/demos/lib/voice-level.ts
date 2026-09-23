/**
 * The numbers behind the listening orb. Pure so the canvas can stay dumb and
 * this can be tested without one.
 */

/** RMS of ordinary speech sits around 0.03–0.2; this puts that range across most of the dial. */
const SPEECH_GAIN = 5;

/** A 0–1 loudness from one frame of time-domain samples. */
export function levelFromSamples(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, rms * SPEECH_GAIN);
}

const ATTACK = 0.35;
const RELEASE = 0.08;

/**
 * An envelope follower: a step towards the target that is quick on the way
 * up and slow on the way down, so a word shows at once and the orb breathes
 * out rather than snapping shut.
 */
export function follow(current: number, target: number): number {
  const goal = Math.min(1, Math.max(0, target));
  const rate = goal > current ? ATTACK : RELEASE;
  return current + (goal - current) * rate;
}

/** What the orb is doing: nobody on the line, the caller talking, or the receptionist. */
export type OrbMode = "idle" | "listening" | "speaking";

/**
 * Whose turn the film follows. The receptionist wins a tie, because the two
 * overlap on a phone call and it is their voice the orb stands for.
 */
export function orbMode(live: boolean, input: number, output: number): OrbMode {
  if (!live) return "idle";
  return output >= input && output > 0 ? "speaking" : "listening";
}

/** Film speed at rest in each mode, and how much a full level adds to it. */
const PLAYBACK: Record<OrbMode, { base: number; gain: number }> = {
  idle: { base: 0.65, gain: 0 },
  listening: { base: 0.9, gain: 0.55 },
  speaking: { base: 1.15, gain: 1 },
};

/**
 * How fast the orb's film runs. The picture is never redrawn or recoloured,
 * so speed is the one thing the voice moves: a slow drift while the line is
 * quiet, up to a little over double while the receptionist is talking.
 */
export function orbPlaybackRate(mode: OrbMode, energy: number): number {
  const { base, gain } = PLAYBACK[mode];
  return base + Math.min(1, Math.max(0, energy)) * gain;
}
