import { useEffect, useRef, type RefObject } from "react";
import type { CallMeters } from "@/lib/call-audio";
import { follow, levelFromSamples, orbMode, orbPlaybackRate } from "@/lib/voice-level";
import type { CallState } from "@/lib/types";

type Props = {
  state: CallState;
  /** From useLiveCall. Without it the orb only drifts. */
  meters?: RefObject<CallMeters>;
  /** Diameter in CSS pixels. */
  size?: number;
  className?: string;
};

const LIVE = new Set<CallState>(["ringing", "connected", "ending"]);

/** The film from the top of tecace.com, and one frame of it for before it loads. */
export const ORB_FILM = "/voice-orb.mp4";
export const ORB_STILL = "/voice-orb.png";

/** A playback rate is only written when it has moved this far, not sixty times a second. */
const RATE_STEP = 0.02;

/**
 * The TecAce ribbon inside a circle. It is the homepage film itself, not a
 * redrawing: `object-cover` on a square is the centre 720 of its 1280, and
 * nothing is recoloured. The voice moves its speed and nothing else — slow
 * while the line is quiet, faster for the caller, fastest for the
 * receptionist — read from the same analysers the call uses, so the movement
 * is the sound, not a guess about it. Decorative; the status text next to it
 * carries the meaning.
 */
export function VoiceOrb({ state, meters, size = 40, className }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // The frame loop reads the latest state without restarting on every change.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // With reduced motion the still stays up and the film is never fetched.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // React does not reliably write `muted` as an attribute, and autoplay needs it.
    video.muted = true;
    video.preload = "auto";
    const play = () => void video.play().catch(() => {});
    play();
    // A blocked autoplay starts on the press that starts the call.
    window.addEventListener("pointerdown", play, { once: true });

    const samples = new Float32Array(256);
    const read = (node: AnalyserNode | null) => {
      if (!node) return 0;
      node.getFloatTimeDomainData(samples);
      return levelFromSamples(samples);
    };

    let env = 0;
    let frame = 0;
    const tick = () => {
      const m = meters?.current;
      const live = Boolean(m) && LIVE.has(stateRef.current);
      const input = live ? read(m!.input) : 0;
      const output = live ? read(m!.output) : 0;
      env = follow(env, Math.max(input, output));
      const rate = orbPlaybackRate(orbMode(live, input, output), env);
      if (Math.abs(video.playbackRate - rate) > RATE_STEP) video.playbackRate = rate;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", play);
      video.pause();
    };
  }, [meters]);

  const dim = state === "error" || state === "ended";
  return (
    <video
      ref={videoRef}
      src={ORB_FILM}
      poster={ORB_STILL}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      className={`shrink-0 rounded-full object-cover transition-opacity duration-500 ${
        dim ? "opacity-60" : ""
      } ${className ?? ""}`}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
