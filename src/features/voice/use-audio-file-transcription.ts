"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnVaultLocked } from "@tgoliveira/vault-core/react";
import { decodeAudioFileToPcm } from "@/lib/voice/audio-decode";
import { getVoiceModelHost } from "@/lib/voice/voice-config";
import type { TranscribeRequest } from "./transcription.worker";
import {
  ensureModelLoaded,
  getActiveVoiceModelId,
  getVoiceLoadOptions,
  getTranscriptionWorker,
  postTranscription,
  shouldDeferVoiceModelLoad,
  subscribeTranscription,
} from "./transcription-worker-client";

export type AudioFileStatus = "idle" | "decoding" | "transcribing" | "ready" | "error";

/** Sub-phase of the transcribing step, for a precise status label. */
export type AudioFilePhase = "" | "transcribing" | "diarizing";

interface UseAudioFileTranscriptionResult {
  supported: boolean;
  status: AudioFileStatus;
  transcript: string;
  fileName: string | null;
  error: string | null;
  /** 0..1 model-download progress (first use only). */
  progress: number;
  /** 0..1 decode progress while reading a (large) audio file. */
  decodeProgress: number;
  /** Which sub-step of transcription is running (for the status label). */
  phase: AudioFilePhase;
  /**
   * Decode + transcribe the file. `language` forces the transcription language
   * ("en"/"pt"/"es"); pass undefined to auto-detect. Optionally labels speakers.
   */
  transcribeFile: (file: File, diarize: boolean, language?: string) => Promise<void>;
  reset: () => void;
}

function isSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof Worker === "undefined") return false;
  const hasAudioCtx =
    typeof window.AudioContext !== "undefined" ||
    typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !==
      "undefined";
  return hasAudioCtx;
}

/**
 * Transcribe an uploaded audio file fully on-device: decode → Whisper (auto
 * language) → optional speaker diarization. The transcript is reviewed/edited
 * before insertion, mirroring the dictation flow. No audio leaves the device.
 */
export function useAudioFileTranscription(): UseAudioFileTranscriptionResult {
  const [supported] = useState(isSupported);
  const [status, setStatus] = useState<AudioFileStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [decodeProgress, setDecodeProgress] = useState(0);
  const [phase, setPhase] = useState<AudioFilePhase>("");
  const processingRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!shouldDeferVoiceModelLoad()) {
      ensureModelLoaded();
    }
    return subscribeTranscription((message) => {
      if (message.type === "progress") {
        // Model download drives the model bar; inference/diarization just set
        // the current phase label (Whisper gives no fine-grained % there).
        if (message.stage === "model") setProgress(message.value);
        else if (processingRef.current && message.stage === "inference") setPhase("transcribing");
        else if (processingRef.current && message.stage === "diarization") setPhase("diarizing");
        return;
      }
      if (message.type === "ready") return;
      // Only react once a transcription pass we started is in flight, so we
      // don't pick up messages meant for the dictation panel.
      if (!processingRef.current) return;
      if (message.type === "error") {
        processingRef.current = false;
        setPhase("");
        setError(message.message);
        setStatus("error");
        return;
      }
      processingRef.current = false;
      setPhase("");
      setTranscript(message.text.trim());
      setStatus("ready");
    });
  }, []);

  const transcribeFile = useCallback(async (file: File, diarize: boolean, language?: string) => {
    if (!supported) {
      setError("Audio file transcription is not supported in this browser.");
      setStatus("error");
      return;
    }
    setError(null);
    setTranscript("");
    setProgress(0);
    setDecodeProgress(0);
    setPhase("");
    setFileName(file.name);
    setStatus("decoding");
    const generation = ++generationRef.current;
    try {
      ensureModelLoaded({ force: true });
      const pcm = await decodeAudioFileToPcm(file, (value) => {
        if (generation === generationRef.current) setDecodeProgress(value);
      });
      if (generation !== generationRef.current) return;
      if (pcm.length === 0) {
        setError("That file didn't contain any audio we could read.");
        setStatus("error");
        return;
      }
      getTranscriptionWorker();
      processingRef.current = true;
      setPhase("transcribing");
      setStatus("transcribing");
      const request: TranscribeRequest = {
        type: "transcribe-file",
        audio: pcm,
        diarize,
        language,
        modelId: getActiveVoiceModelId(),
        modelHost: getVoiceModelHost(),
        ...getVoiceLoadOptions(),
      };
      postTranscription(request, [pcm.buffer]);
    } catch (err) {
      if (generation !== generationRef.current) return;
      processingRef.current = false;
      // Surface the underlying reason — it makes "unsupported codec" vs "empty
      // file" vs "too large" failures diagnosable instead of a blanket message.
      console.error("[audio-upload] could not read the audio file", err);
      const isDecodeError =
        err instanceof DOMException
          ? err.name === "EncodingError"
          : /decode|codec|audio track/i.test(err instanceof Error ? err.message : "");
      setError(
        isDecodeError
          ? "We couldn't decode this audio format on your device. Try a common format like MP3, WAV, or M4A (AAC)."
          : "We couldn't read this audio file. Please try a different file."
      );
      setStatus("error");
    }
  }, [supported]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    processingRef.current = false;
    setStatus("idle");
    setTranscript("");
    setFileName(null);
    setError(null);
    setProgress(0);
    setDecodeProgress(0);
    setPhase("");
  }, []);

  useOnVaultLocked(reset);

  return {
    supported,
    status,
    transcript,
    fileName,
    error,
    progress,
    decodeProgress,
    phase,
    transcribeFile,
    reset,
  };
}
