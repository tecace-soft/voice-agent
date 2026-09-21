import type { CallSound } from "./types";
import { DEFAULT_CALL_SOUND } from "./types";
import {
  AMBIENCE,
  BABBLE_LOWPASS_HZ,
  ENVELOPE_RATE,
  ENVELOPE_SECONDS,
  NOISE_SECONDS,
  RING,
  VOICE_BANDS,
  fillImpulseResponse,
  fillRoomToneBuffer,
  fillSyllableEnvelope,
  fillWhiteNoise,
  nextRingDelayMs,
  nextTypingBurst,
  type AmbienceLevel,
  type AmbienceMix,
} from "./ambience";

/**
 * Makes the call sound like a phone call rather than a studio recording: the
 * agent's voice is narrowed to the telephone band, and the room they are
 * supposedly sitting in plays underneath.
 *
 * The ambience is built in lib/ambience.ts and mixed here. It goes through the
 * same telephone band as the voice when that is on, so it sits *on the line*
 * rather than in front of it — and, incidentally, out of the bottom octaves a
 * laptop speaker cannot reproduce, which is half of why the old flat room tone
 * could not be heard at all.
 *
 * The same graph carries two analysers — one on the microphone, one on the
 * agent's voice — so the page can draw who is talking without a second
 * audio context.
 */

export const PHONE_BAND = {
  /** Real phone lines roll off below this. */
  highpassHz: 220,
  /** ...and above this. */
  lowpassHz: 3600,
  /** A small lift where speech sits, so the narrowed band still cuts through. */
  presenceHz: 2000,
  presenceGainDb: 3,
  /** Make up for the energy the filters remove. */
  outputGain: 1.25,
} as const;

/** The bed under the voices: air handling, and the size of the room. */
export const RUMBLE = {
  lowpassHz: 500,
  /** Slow drift so the floor never sounds frozen. */
  driftHz: 0.07,
  driftDepth: 0.35,
} as const;

/** A keystroke: a click, not a tone. */
export const TYPING = {
  seconds: 0.035,
  highpassHz: 1500,
  decay: 5.5,
} as const;

/** The room the voices are heard through. */
export const REVERB_SECONDS = 0.55;

/** Small enough to read at 60 fps without lag, large enough to average a syllable. */
const METER_FFT = 512;

export function resolveCallSound(sound?: Partial<CallSound> | null): CallSound {
  return {
    phoneLine: sound?.phoneLine ?? DEFAULT_CALL_SOUND.phoneLine,
    ambience: resolveAmbience(sound),
  };
}

/**
 * Records written before the levels existed carry `roomTone`, a switch. On
 * meant a flat hiss so quiet it was never audible, so it maps to the quiet
 * office rather than to nothing.
 */
export function resolveAmbience(sound?: Partial<CallSound> | null): AmbienceLevel {
  if (sound?.ambience) return sound.ambience;
  if (sound?.roomTone === false) return "off";
  return DEFAULT_CALL_SOUND.ambience;
}

/** The two things the orb listens to. Either is null until its stream arrives, or forever without Web Audio. */
export type CallMeters = {
  input: AnalyserNode | null;
  output: AnalyserNode | null;
};

type Ctor = typeof AudioContext;

function audioContextCtor(): Ctor | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext
  );
}

export class CallAudio {
  private context: AudioContext | null = null;
  private element: HTMLAudioElement | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;

  /** Everything the ambience started, so stop() can take it all down. */
  private sources: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private clickBuffer: AudioBuffer | null = null;
  /**
   * Only the burst in flight. Keeping every keystroke in `sources` would grow
   * without bound — a ten minute call is well over a thousand of them — and
   * they are all finished the moment the next burst is scheduled.
   */
  private clicks: AudioBufferSourceNode[] = [];
  private typingTarget: AudioNode | null = null;
  private ringTarget: AudioNode | null = null;
  private stopped = false;

  readonly meters: CallMeters = { input: null, output: null };

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    try {
      const context = new Ctor();
      this.context = context;
      void context.resume().catch(() => undefined);
      return context;
    } catch {
      return null;
    }
  }

  private analyser(context: AudioContext): AnalyserNode {
    const node = context.createAnalyser();
    node.fftSize = METER_FFT;
    node.smoothingTimeConstant = 0.6;
    return node;
  }

  /**
   * Listens to the microphone for the meter only. The mic reaches the call
   * over WebRTC, not through this graph, so the analyser is a dead end and
   * nothing here is played back.
   */
  meterInput(stream: MediaStream): void {
    const context = this.ensureContext();
    if (!context) return;
    try {
      const source = context.createMediaStreamSource(stream);
      const analyser = this.analyser(context);
      source.connect(analyser);
      this.inputSource = source;
      this.meters.input = analyser;
    } catch {
      this.meters.input = null;
    }
  }

  /**
   * Routes the agent's audio through the effect chain. Returns false when the
   * browser has no Web Audio, in which case the caller should play the stream
   * straight through the audio element.
   */
  attach(stream: MediaStream, sound: CallSound): boolean {
    // Chrome only pulls frames from a remote WebRTC stream once it is attached
    // to a media element, so keep one alive and silent behind the graph.
    const element = document.createElement("audio");
    element.srcObject = stream;
    element.muted = true;
    element.autoplay = true;
    void element.play().catch(() => undefined);
    this.element = element;

    const context = this.ensureContext();
    if (!context) return false;
    this.stopped = false;

    try {
      const source = context.createMediaStreamSource(stream);
      const voice = this.phoneBand(context, source, sound.phoneLine);

      // The meter taps the voice as the visitor hears it, after the band-limit.
      const analyser = this.analyser(context);
      voice.connect(analyser);
      this.meters.output = analyser;

      voice.connect(context.destination);

      const level = resolveAmbience(sound);
      if (level !== "off") this.startAmbience(context, AMBIENCE[level], sound.phoneLine);
      return true;
    } catch {
      // Fall back to plain playback if anything in the graph fails.
      this.stop();
      return false;
    }
  }

  /** The telephone band, or the node straight through when it is switched off. */
  private phoneBand(context: AudioContext, input: AudioNode, on: boolean): AudioNode {
    if (!on) return input;

    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = PHONE_BAND.highpassHz;

    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = PHONE_BAND.lowpassHz;

    const presence = context.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = PHONE_BAND.presenceHz;
    presence.gain.value = PHONE_BAND.presenceGainDb;
    presence.Q.value = 1;

    const makeup = context.createGain();
    makeup.gain.value = PHONE_BAND.outputGain;

    input.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(presence);
    presence.connect(makeup);
    this.nodes.push(highpass, lowpass, presence, makeup);
    return makeup;
  }

  private buffer(context: AudioContext, seconds: number, rate: number): AudioBuffer {
    return context.createBuffer(1, Math.floor(rate * seconds), rate);
  }

  private startAmbience(
    context: AudioContext,
    mix: AmbienceMix,
    phoneLine: boolean,
  ): void {
    // One bus, so the whole room can be band-limited together and taken down
    // together.
    const bed = context.createGain();
    bed.gain.value = 1;
    this.nodes.push(bed);
    this.phoneBand(context, bed, phoneLine).connect(context.destination);

    this.startRumble(context, mix, bed);
    this.startBabble(context, mix, bed);
    if (mix.typing > 0) this.startTyping(context, mix, bed);
    if (mix.ring > 0) this.startRing(context, mix, bed);
  }

  private startRumble(context: AudioContext, mix: AmbienceMix, out: AudioNode): void {
    const buffer = this.buffer(context, NOISE_SECONDS, context.sampleRate);
    fillRoomToneBuffer(buffer.getChannelData(0));

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = RUMBLE.lowpassHz;

    const gain = context.createGain();
    gain.gain.value = mix.rumble;

    // A slow oscillator nudges the level so the floor breathes.
    const drift = context.createOscillator();
    drift.frequency.value = RUMBLE.driftHz;
    const driftGain = context.createGain();
    driftGain.gain.value = mix.rumble * RUMBLE.driftDepth;
    drift.connect(driftGain);
    driftGain.connect(gain.gain);
    drift.start();

    source.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(out);
    source.start();

    this.sources.push(source, drift);
    this.nodes.push(lowpass, gain, driftGain);
  }

  private startBabble(context: AudioContext, mix: AmbienceMix, out: AudioNode): void {
    // One noise buffer for every voice: the band each is carved with and the
    // rhythm each is given make them different people, and three copies of
    // four seconds of noise is memory spent for nothing.
    const noise = this.buffer(context, NOISE_SECONDS, context.sampleRate);
    fillWhiteNoise(noise.getChannelData(0));

    const wall = context.createBiquadFilter();
    wall.type = "lowpass";
    wall.frequency.value = BABBLE_LOWPASS_HZ;

    const level = context.createGain();
    level.gain.value = mix.babble;

    const room = context.createConvolver();
    const impulse = this.buffer(context, REVERB_SECONDS, context.sampleRate);
    fillImpulseResponse(impulse.getChannelData(0), context.sampleRate);
    room.buffer = impulse;

    wall.connect(room);
    room.connect(level);
    level.connect(out);
    this.nodes.push(wall, room, level);

    for (let index = 0; index < mix.voices; index++) {
      const band = VOICE_BANDS[index % VOICE_BANDS.length]!;

      const source = context.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      source.playbackRate.value = band.rate;

      const formant = context.createBiquadFilter();
      formant.type = "bandpass";
      formant.frequency.value = band.hz;
      formant.Q.value = band.q;

      // Silent until the envelope opens it; the envelope is the only thing
      // driving this gain, so it starts at zero rather than at one.
      const voice = context.createGain();
      voice.gain.value = 0;

      const envelopeBuffer = this.buffer(context, ENVELOPE_SECONDS, ENVELOPE_RATE);
      fillSyllableEnvelope(envelopeBuffer.getChannelData(0), ENVELOPE_RATE);
      const envelope = context.createBufferSource();
      envelope.buffer = envelopeBuffer;
      envelope.loop = true;
      envelope.playbackRate.value = band.rate;
      envelope.connect(voice.gain);

      source.connect(formant);
      formant.connect(voice);
      voice.connect(wall);

      // Started apart so the loop seams never line up into a pulse.
      const offset = (NOISE_SECONDS / (mix.voices + 1)) * (index + 1);
      source.start(0, offset);
      envelope.start(0, (ENVELOPE_SECONDS / (mix.voices + 1)) * (index + 1));

      this.sources.push(source, envelope);
      this.nodes.push(formant, voice);
    }
  }

  private startTyping(context: AudioContext, mix: AmbienceMix, out: AudioNode): void {
    const buffer = this.buffer(context, TYPING.seconds, context.sampleRate);
    const channel = buffer.getChannelData(0);
    fillWhiteNoise(channel);
    for (let i = 0; i < channel.length; i++) {
      channel[i] = channel[i]! * Math.exp((-TYPING.decay * i) / channel.length) ** 3;
    }
    this.clickBuffer = buffer;

    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = TYPING.highpassHz;

    const gain = context.createGain();
    gain.gain.value = mix.typing;

    highpass.connect(gain);
    gain.connect(out);
    this.nodes.push(highpass, gain);
    this.typingTarget = highpass;

    this.scheduleTyping(context);
  }

  private scheduleTyping(context: AudioContext): void {
    if (this.stopped) return;

    for (const click of this.clicks) click.disconnect();
    this.clicks = [];

    const burst = nextTypingBurst();
    const start = context.currentTime + 0.05;

    for (let i = 0; i < burst.clicks; i++) {
      const click = context.createBufferSource();
      click.buffer = this.clickBuffer;
      // Keys are not all the same key.
      click.playbackRate.value = 0.85 + Math.random() * 0.4;
      click.connect(this.typingTarget!);
      // Scheduled against the audio clock, so a busy main thread jitters the
      // burst's start and never the rhythm inside it.
      click.start(start + (i * burst.spacingMs) / 1000);
      this.clicks.push(click);
    }

    const after = burst.clicks * burst.spacingMs + burst.restMs;
    this.timers.push(setTimeout(() => this.scheduleTyping(context), after));
  }

  private startRing(context: AudioContext, mix: AmbienceMix, out: AudioNode): void {
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = RING.lowpassHz;

    const gain = context.createGain();
    gain.gain.value = mix.ring;

    lowpass.connect(gain);
    gain.connect(out);
    this.nodes.push(lowpass, gain);
    this.ringTarget = lowpass;

    this.timers.push(
      setTimeout(() => this.scheduleRing(context), nextRingDelayMs()),
    );
  }

  private scheduleRing(context: AudioContext): void {
    if (this.stopped || !this.ringTarget) return;

    // A phone nobody is picking up: the pattern runs a few times and stops.
    const cycles = 1 + Math.floor(Math.random() * RING.cycles);
    const period = RING.onSec + RING.offSec;
    const begin = context.currentTime + 0.1;

    for (const hz of RING.hz) {
      const tone = context.createOscillator();
      tone.frequency.value = hz;
      const envelope = context.createGain();
      envelope.gain.value = 0;

      for (let cycle = 0; cycle < cycles; cycle++) {
        const at = begin + cycle * period;
        // Ramped rather than switched, or each burst starts with a click.
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(0.5, at + 0.05);
        envelope.gain.setValueAtTime(0.5, at + RING.onSec - 0.05);
        envelope.gain.linearRampToValueAtTime(0, at + RING.onSec);
      }

      tone.connect(envelope);
      envelope.connect(this.ringTarget);
      tone.start(begin);
      tone.stop(begin + cycles * period);
      this.sources.push(tone);
      this.nodes.push(envelope);
    }

    this.timers.push(
      setTimeout(
        () => this.scheduleRing(context),
        cycles * period * 1000 + nextRingDelayMs(),
      ),
    );
  }

  /** Plain playback, used when Web Audio is unavailable. */
  attachPlain(stream: MediaStream): void {
    const element = document.createElement("audio");
    element.srcObject = stream;
    element.autoplay = true;
    void element.play().catch(() => undefined);
    this.element = element;
  }

  stop(): void {
    this.stopped = true;

    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];

    for (const source of [...this.sources, ...this.clicks]) {
      try {
        source.stop();
      } catch {
        // Already stopped, or scheduled and never started.
      }
      try {
        source.disconnect();
      } catch {
        // Nothing to disconnect.
      }
    }
    this.sources = [];
    this.clicks = [];

    for (const node of this.nodes) node.disconnect();
    this.nodes = [];

    this.clickBuffer = null;
    this.typingTarget = null;
    this.ringTarget = null;

    this.inputSource?.disconnect();
    this.inputSource = null;
    this.meters.input = null;
    this.meters.output = null;

    if (this.element) {
      this.element.srcObject = null;
      this.element.remove();
      this.element = null;
    }

    const context = this.context;
    this.context = null;
    void context?.close().catch(() => undefined);
  }
}
