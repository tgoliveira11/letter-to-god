"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnVaultLocked } from "@tgoliveira/vault-core/react";
import {
  concatFloat32,
  resampleLinear,
  WHISPER_SAMPLE_RATE,
} from "@/lib/voice/audio-pcm";
import { formatTranscript } from "@/lib/voice/transcript-format";
import { getVoiceModelHost } from "@/lib/voice/voice-config";
import type { VoiceLanguageCode } from "@/lib/voice/voice-languages";
import type { TranscribeRequest } from "./transcription.worker";
import {
  getActiveVoiceModelId,
  getTranscriptionWorker,
  getVoiceLoadOptions,
  postTranscription,
  subscribeTranscription,
} from "./transcription-worker-client";

export type VoiceStatus = "idle" | "recording" | "processing" | "ready" | "error";

/** How often, while recording, a partial pass runs. */
const PARTIAL_INTERVAL_MS = 1200;
/** Minimum new audio before the first partial pass of a segment runs. */
const MIN_PARTIAL_SECONDS = 0.6;
/**
 * Once the in-progress segment reaches this length, its transcript is committed
 * and a fresh segment starts. Keeping each partial pass bounded to a short,
 * recent window (instead of re-transcribing the whole growing recording) is what
 * keeps the live transcript responsive — well under Whisper's 30 s attention
 * window so a partial is always a single, fast inference chunk.
 */
const SEGMENT_COMMIT_SECONDS = 16;

/** Join a committed prefix with the latest text, with a single space. */
function joinText(prefix: string, next: string): string {
  const a = prefix.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}
/** Same-origin AudioWorklet module that captures raw PCM off the main thread. */
const CAPTURE_WORKLET_URL = "/worklets/audio-capture-worklet.js";
const CAPTURE_WORKLET_NAME = "audio-capture";

interface UseVoiceTranscriptionResult {
  supported: boolean;
  status: VoiceStatus;
  /** Live (partial) transcript while recording; final after stop. */
  transcript: string;
  error: string | null;
  /** 0..1 model-download progress (first use only). */
  progress: number;
  /** True while a transcription pass is running (partial or final). */
  transcribing: boolean;
  startRecording: (language: VoiceLanguageCode) => Promise<void>;
  stopRecording: () => void;
  reset: () => void;
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ||
    null
  );
}

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    getAudioContextCtor() !== null
  );
}

export function useVoiceTranscription(): UseVoiceTranscriptionResult {
  const [supported] = useState(isSupported);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [transcribing, setTranscribing] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const silentRef = useRef<GainNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcmRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef<number>(WHISPER_SAMPLE_RATE);
  const languageRef = useRef<VoiceLanguageCode>("en");
  const processingRef = useRef(false);
  const inFlightFinalRef = useRef(false);
  const pendingFinalRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcribeRef = useRef<(final: boolean) => void>(() => {});
  // Streaming segmentation state (ctx-rate sample indices).
  const committedTextRef = useRef("");
  const segmentStartRef = useRef(0);
  const sentEndRef = useRef(0);
  const sentCommitRef = useRef(false);
  const captureGenerationRef = useRef(0);

  // Subscribe to the shared (warm) worker for the lifetime of the hook.
  useEffect(() => {
    return subscribeTranscription((message) => {
      if (message.type === "progress") {
        setProgress(message.value);
        return;
      }
      if (message.type === "ready") return; // background warm-up acknowledgement
      // reset() (including vault lock) marks the in-flight pass inactive. A
      // late worker result must never restore a transcript after that boundary.
      if (!processingRef.current) return;
      processingRef.current = false;
      setTranscribing(false);
      if (message.type === "error") {
        setError(message.message);
        setStatus("error");
        return;
      }

      if (inFlightFinalRef.current) {
        // Final pass: the authoritative full-recording transcript.
        setTranscript(formatTranscript(message.text));
        setStatus("ready");
        committedTextRef.current = "";
        segmentStartRef.current = 0;
        return;
      }

      // Partial pass for the in-progress segment.
      if (sentCommitRef.current) {
        committedTextRef.current = joinText(committedTextRef.current, message.text);
        segmentStartRef.current = sentEndRef.current;
        sentCommitRef.current = false;
        setTranscript(formatTranscript(committedTextRef.current));
      } else {
        setTranscript(formatTranscript(joinText(committedTextRef.current, message.text)));
      }

      if (pendingFinalRef.current) {
        pendingFinalRef.current = false;
        transcribeRef.current(true);
      }
    });
  }, []);

  const transcribe = useCallback(
    (final: boolean) => {
      if (processingRef.current) {
        // A pass is already running; remember to finalize once it returns.
        if (final) pendingFinalRef.current = true;
        return;
      }
      const chunks = pcmRef.current;
      let totalSamples = 0;
      for (const chunk of chunks) totalSamples += chunk.length;
      if (totalSamples === 0) {
        if (final) setStatus("ready");
        return;
      }
      const rate = sampleRateRef.current;
      const merged = concatFloat32(chunks);

      // Final pass transcribes the whole recording for best accuracy; partials
      // transcribe only the short, recent (uncommitted) segment so each pass is
      // bounded and the live transcript keeps up.
      let sliceStart = 0;
      let willCommit = false;
      if (!final) {
        sliceStart = segmentStartRef.current;
        const segmentSeconds = (totalSamples - sliceStart) / rate;
        if (segmentSeconds < MIN_PARTIAL_SECONDS) return;
        willCommit = segmentSeconds >= SEGMENT_COMMIT_SECONDS;
      }

      const slice = sliceStart > 0 ? merged.subarray(sliceStart) : merged;
      let pcm = resampleLinear(slice, rate, WHISPER_SAMPLE_RATE);
      // resampleLinear returns the input unchanged when rates match; copy so we
      // can safely transfer a standalone buffer (not a view into `merged`).
      if (pcm.buffer === merged.buffer) pcm = new Float32Array(pcm);

      processingRef.current = true;
      inFlightFinalRef.current = final;
      sentEndRef.current = totalSamples;
      sentCommitRef.current = willCommit;
      setTranscribing(true);
      const request: TranscribeRequest = {
        type: "transcribe",
        audio: pcm,
        language: languageRef.current,
        modelId: getActiveVoiceModelId(),
        modelHost: getVoiceModelHost(),
        ...getVoiceLoadOptions(),
      };
      postTranscription(request, [pcm.buffer]);
    },
    []
  );

  useEffect(() => {
    transcribeRef.current = transcribe;
  }, [transcribe]);

  const teardownCapture = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (captureNodeRef.current) {
      captureNodeRef.current.port.onmessage = null;
      try {
        captureNodeRef.current.port.close();
      } catch {
        /* already closed */
      }
      try {
        captureNodeRef.current.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      silentRef.current?.disconnect();
    } catch {
      /* already disconnected */
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    const ctx = ctxRef.current;
    captureNodeRef.current = null;
    sourceRef.current = null;
    silentRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }, []);

  const startRecording = useCallback(
    async (language: VoiceLanguageCode) => {
      if (!supported) {
        setError("Voice capture is not supported in this browser.");
        setStatus("error");
        return;
      }
      setError(null);
      setTranscript("");
      setProgress(0);
      setTranscribing(false);
      pcmRef.current = [];
      processingRef.current = false;
      inFlightFinalRef.current = false;
      pendingFinalRef.current = false;
      committedTextRef.current = "";
      segmentStartRef.current = 0;
      sentEndRef.current = 0;
      sentCommitRef.current = false;
      languageRef.current = language;
      const generation = ++captureGenerationRef.current;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (generation !== captureGenerationRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const Ctor = getAudioContextCtor();
        if (!Ctor) throw new Error("AudioContext unavailable");
        const ctx = new Ctor();
        ctxRef.current = ctx;
        sampleRateRef.current = ctx.sampleRate || WHISPER_SAMPLE_RATE;

        // Capture raw PCM off the main thread via an AudioWorklet.
        await ctx.audioWorklet.addModule(CAPTURE_WORKLET_URL);
        if (generation !== captureGenerationRef.current) {
          teardownCapture();
          return;
        }

        const source = ctx.createMediaStreamSource(stream);
        sourceRef.current = source;
        const captureNode = new AudioWorkletNode(ctx, CAPTURE_WORKLET_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
        });
        captureNodeRef.current = captureNode;
        captureNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
          pcmRef.current.push(new Float32Array(event.data));
        };
        // Route through a muted gain node so the graph keeps pulling audio
        // without any audible echo.
        const silent = ctx.createGain();
        silent.gain.value = 0;
        silentRef.current = silent;
        source.connect(captureNode);
        captureNode.connect(silent);
        silent.connect(ctx.destination);

        // Ensure the (possibly already warm) shared worker exists.
        getTranscriptionWorker();
        intervalRef.current = setInterval(
          () => transcribeRef.current(false),
          PARTIAL_INTERVAL_MS
        );
        setStatus("recording");
      } catch {
        if (generation !== captureGenerationRef.current) return;
        teardownCapture();
        setError("Microphone access was denied or unavailable.");
        setStatus("error");
      }
    },
    [supported, teardownCapture]
  );

  const stopRecording = useCallback(() => {
    teardownCapture(); // stops capture; pcmRef keeps the full audio for the final pass
    setStatus("processing");
    transcribeRef.current(true);
  }, [teardownCapture]);

  const reset = useCallback(() => {
    captureGenerationRef.current += 1;
    teardownCapture();
    pcmRef.current = [];
    processingRef.current = false;
    inFlightFinalRef.current = false;
    pendingFinalRef.current = false;
    committedTextRef.current = "";
    segmentStartRef.current = 0;
    sentEndRef.current = 0;
    sentCommitRef.current = false;
    setTranscript("");
    setError(null);
    setProgress(0);
    setTranscribing(false);
    setStatus("idle");
  }, [teardownCapture]);

  useEffect(() => {
    // Release the microphone/audio graph on unmount, but keep the shared
    // (warm) transcription worker alive for instant reuse.
    return () => {
      teardownCapture();
    };
  }, [teardownCapture]);

  useOnVaultLocked(reset);

  return {
    supported,
    status,
    transcript,
    error,
    progress,
    transcribing,
    startRecording,
    stopRecording,
    reset,
  };
}
