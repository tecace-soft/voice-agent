
import { promoFetch, promoUrl } from "@/api";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { CallAudio, resolveCallSound, type CallMeters } from "@/lib/call-audio";
import { readJson } from "@/lib/http";
import { Ringtone } from "@/lib/ringtone";
import { spokenGreeting } from "@/lib/prompt";
import { appendFragment } from "@/lib/transcript";
import type { CallSound, CallState, TranscriptEntry } from "@/lib/types";

type LiveEvent = {
  type: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  usage?: { seconds?: number };
  error?: { message?: string };
  reason?: string;
  delegation?: { id?: string };
  client_event_id?: string;
};

/**
 * `session.instructions.append` is the documented way to make the receptionist
 * speak first, but it carries something to *do*, and a model that decides to
 * wait leaves the caller listening to silence. `session.commentary.append`
 * carries something to *say*. Send the instruction, and if nothing has been
 * said by the time this is up, hand over the words themselves.
 */
const GREETING_RESCUE_MS = 2500;

const ICE_TIMEOUT_MS = 2000;
const CLOSE_TIMEOUT_MS = 5000;

async function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, ICE_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

export type UseLiveCall = {
  state: CallState;
  transcript: TranscriptEntry[];
  elapsedSec: number;
  usageSec: number;
  muted: boolean;
  thinking: boolean;
  error: string | null;
  /**
   * Analysers on the microphone and the agent's voice, for the listening
   * orb. A ref, not state: it is read sixty times a second by a canvas and
   * must never re-render React. Both null outside a call.
   */
  meters: RefObject<CallMeters>;
  dial: () => Promise<void>;
  hangup: () => void;
  toggleMute: () => void;
  reset: () => void;
};

export function useLiveCall(
  customerId: string,
  callSound?: Partial<CallSound> | null,
  /**
   * Set by the admin test panel. A call is a test because the operator made it
   * from inside the admin area, not because their browser happens to be
   * carrying an admin cookie while they look at the public page.
   */
  options?: { isTest?: boolean },
): UseLiveCall {
  const isTest = options?.isTest === true;
  const [state, setState] = useState<CallState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [usageSec, setUsageSec] = useState(0);
  const [muted, setMuted] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<CallAudio | null>(null);
  const metersRef = useRef<CallMeters>({ input: null, output: null });
  const ringtoneRef = useRef<Ringtone | null>(null);
  const soundRef = useRef(resolveCallSound(callSound));
  const callIdRef = useRef<string | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const usageRef = useRef(0);
  const startedAtRef = useRef(0);
  const reportedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const greetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // False once the component using this hook has unmounted. `dial` awaits the
  // microphone, ICE gathering and the session request; each await is a point
  // where the page may be gone, and a call started after that has no UI and
  // is never reported.
  const aliveRef = useRef(true);

  // Settings changed in the admin panel apply to the next call, since the
  // audio graph is built when the call starts.
  useEffect(() => {
    soundRef.current = resolveCallSound(callSound);
  }, [callSound]);

  const stopRingtone = useCallback(() => {
    ringtoneRef.current?.stop();
    ringtoneRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    stopRingtone();
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (greetTimerRef.current) {
      clearTimeout(greetTimerRef.current);
      greetTimerRef.current = null;
    }
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioRef.current?.stop();
    audioRef.current = null;
    metersRef.current = { input: null, output: null };
  }, [stopRingtone]);

  const report = useCallback(
    (status: "completed" | "failed" | "abandoned", endReason?: string, beacon = false) => {
      const callId = callIdRef.current;
      if (!callId || reportedRef.current) return;
      reportedRef.current = true;

      const durationSec =
        usageRef.current ||
        (startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0);
      const payload = JSON.stringify({
        // Sent so the server can find the record directly rather than looking
        // through every customer's calls for it.
        customerId,
        status,
        durationSec,
        endReason,
        transcript: transcriptRef.current,
      });
      const url = `/api/calls/${callId}`;

      if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(promoUrl(url), new Blob([payload], { type: "application/json" }));
        return;
      }
      void promoFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => undefined);
    },
    [customerId],
  );

  const finish = useCallback(
    (status: "completed" | "failed" | "abandoned", endReason?: string) => {
      report(status, endReason);
      teardown();
      setThinking(false);
      setState(status === "failed" ? "error" : "ended");
    },
    [report, teardown],
  );

  const send = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") dc.send(JSON.stringify(event));
  }, []);

  const handleEvent = useCallback(
    (event: LiveEvent, greeting: string) => {
      switch (event.type) {
        case "session.started": {
          stopRingtone();
          startedAtRef.current = Date.now();
          setState("connected");
          tickRef.current = setInterval(() => {
            setElapsedSec(Math.round((Date.now() - startedAtRef.current) / 1000));
          }, 1000);
          send({
            type: "session.instructions.append",
            event_id: `greet_${Date.now()}`,
            delegation_id: null,
            content: greeting,
          });
          greetTimerRef.current = setTimeout(() => {
            greetTimerRef.current = null;
            send({
              type: "session.commentary.append",
              event_id: `greet_say_${Date.now()}`,
              delegation_id: null,
              content: spokenGreeting(greeting),
            });
          }, GREETING_RESCUE_MS);
          break;
        }
        case "session.input_transcript.delta":
        case "session.output_transcript.delta": {
          if (!event.delta) break;
          const speaker =
            event.type === "session.input_transcript.delta" ? "caller" : "receptionist";
          if (speaker === "receptionist") {
            setThinking(false);
            // It spoke. The rescue would only talk over it.
            if (greetTimerRef.current) {
              clearTimeout(greetTimerRef.current);
              greetTimerRef.current = null;
            }
          }
          const next = appendFragment(transcriptRef.current, {
            speaker,
            delta: event.delta,
            startMs: event.start_ms ?? 0,
            endMs: event.end_ms ?? event.start_ms ?? 0,
          });
          transcriptRef.current = next;
          setTranscript(next);
          break;
        }
        case "session.delegation.created":
          setThinking(true);
          break;
        case "session.usage.updated":
          if (typeof event.usage?.seconds === "number") {
            usageRef.current = event.usage.seconds;
            setUsageSec(event.usage.seconds);
          }
          break;
        case "session.closed":
          if (typeof event.usage?.seconds === "number") {
            usageRef.current = event.usage.seconds;
            setUsageSec(event.usage.seconds);
          }
          finish("completed", event.reason);
          break;
        case "error":
          setError(event.error?.message ?? "The call ran into an error.");
          finish("failed", event.error?.message);
          break;
        default:
          break;
      }
    },
    [finish, send, stopRingtone],
  );

  const dial = useCallback(async () => {
    if (state === "connecting" || state === "ringing" || state === "connected") return;

    setError(null);
    setTranscript([]);
    transcriptRef.current = [];
    usageRef.current = 0;
    setUsageSec(0);
    setElapsedSec(0);
    setMuted(false);
    reportedRef.current = false;
    callIdRef.current = null;
    setState("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!aliveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const callAudio = new CallAudio();
      audioRef.current = callAudio;
      // One object for the life of the call; the analysers fill in as the
      // mic and then the agent's stream arrive.
      metersRef.current = callAudio.meters;
      callAudio.meterInput(stream);
      pc.addEventListener("track", (event) => {
        const remote = event.streams[0] ?? new MediaStream([event.track]);
        if (!callAudio.attach(remote, soundRef.current)) {
          callAudio.attachPlain(remote);
        }
      });

      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);
      if (!aliveRef.current) {
        teardown();
        return;
      }

      setState("ringing");
      ringtoneRef.current = new Ringtone();
      void ringtoneRef.current.start();

      const response = await promoFetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          sdp: pc.localDescription?.sdp,
          isTest,
        }),
      });

      // readJson because a crashed route answers with an empty body, and
      // response.json() would then report its own parse error instead of the
      // server's.
      const data = await readJson<{
        callId?: string;
        sdp?: string;
        greeting?: string;
      }>(response);

      if (!aliveRef.current) {
        // A session was granted to a page that is gone: hand the line back.
        teardown();
        if (data.callId) {
          callIdRef.current = data.callId;
          report("abandoned", "unmounted", true);
        }
        return;
      }

      if (!data.sdp) {
        throw new Error("Could not start the call.");
      }

      callIdRef.current = data.callId ?? null;
      const greeting = data.greeting ?? "Greet the caller now, then pause and listen.";
      dc.addEventListener("message", (event) => {
        try {
          handleEvent(JSON.parse(event.data) as LiveEvent, greeting);
        } catch {
          // Ignore frames that are not JSON.
        }
      });

      await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not start the call.";
      setError(
        message.includes("Permission denied") || message.includes("NotAllowed")
          ? "Microphone access is needed to make the call."
          : message,
      );
      stopRingtone();
      if (callIdRef.current) {
        finish("failed", message);
      } else {
        teardown();
        setState("error");
      }
    }
  }, [customerId, finish, handleEvent, isTest, report, state, stopRingtone, teardown]);

  const hangup = useCallback(() => {
    if (state !== "connected" && state !== "ringing") return;
    setState("ending");
    stopRingtone();
    send({ type: "session.close", event_id: `close_${Date.now()}` });
    closeTimerRef.current = setTimeout(() => {
      finish("completed", "close_timeout");
    }, CLOSE_TIMEOUT_MS);
  }, [finish, send, state, stopRingtone]);

  const toggleMute = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    send({
      type: next ? "session.input_audio.mute" : "session.input_audio.unmute",
      event_id: `mute_${Date.now()}`,
    });
    setMuted(next);
  }, [muted, send]);

  const reset = useCallback(() => {
    teardown();
    transcriptRef.current = [];
    setTranscript([]);
    setState("idle");
    setError(null);
    setElapsedSec(0);
    setUsageSec(0);
    setThinking(false);
  }, [teardown]);

  useEffect(() => {
    const onLeave = () => {
      if (pcRef.current) {
        report("abandoned", "page_hidden", true);
        teardown();
      }
    };
    // Set here, not only in useRef's initial value, so StrictMode's
    // mount -> cleanup -> mount leaves it true.
    aliveRef.current = true;
    window.addEventListener("pagehide", onLeave);
    return () => {
      aliveRef.current = false;
      window.removeEventListener("pagehide", onLeave);
      onLeave();
    };
  }, [report, teardown]);

  return {
    state,
    transcript,
    elapsedSec,
    usageSec,
    muted,
    thinking,
    error,
    meters: metersRef,
    dial,
    hangup,
    toggleMute,
    reset,
  };
}
