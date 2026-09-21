/** US ringback tone: 440 Hz + 480 Hz, two seconds on, four seconds off. */
export class Ringtone {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  async start(): Promise<void> {
    if (this.context) return;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;

    this.context = new Ctor();
    if (this.context.state === "suspended") {
      try {
        await this.context.resume();
      } catch {
        // Autoplay policy can refuse; the call still works without a tone.
      }
    }

    this.gain = this.context.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.context.destination);

    for (const frequency of [440, 480]) {
      const oscillator = this.context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(this.gain);
      oscillator.start();
      this.oscillators.push(oscillator);
    }

    this.cycle();
  }

  private cycle = () => {
    if (!this.context || !this.gain) return;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
    this.gain.gain.setValueAtTime(0.12, now + 1.95);
    this.gain.gain.linearRampToValueAtTime(0, now + 2);
    this.timer = setTimeout(this.cycle, 6000);
  };

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const oscillator of this.oscillators) {
      try {
        oscillator.stop();
      } catch {
        // Already stopped.
      }
    }
    this.oscillators = [];
    this.gain?.disconnect();
    this.gain = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
