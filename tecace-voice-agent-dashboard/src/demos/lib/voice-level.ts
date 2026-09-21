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
