// src/hooks/useCallRecorder.ts

import { useCallback, useEffect, useRef, useState } from 'react';

const CHUNK_DURATION_MS = 10_000;
const TARGET_SAMPLE_RATE = 16_000;

export interface SttChunkResult {
  chunkIndex: number;
  chunkStartMs: number;
  chunkEndMs: number;
  text: string;
  status: 'sending' | 'success' | 'error';
  error?: string;
}

interface SttApiResponse {
  ok?: boolean;
  text?: string;
  chunkIndex?: number;
  durationMs?: number;
  error?: string;
  detail?: string;
}

export interface UseCallRecorderResult {
  sessionId: string;
  isRecording: boolean;
  isSending: boolean;
  error: string | null;
  chunks: SttChunkResult[];
  cumulativeText: string;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  resetRecording: () => void;
}

/**
 * 마이크 PCM을 10초 단위 16kHz·mono·16-bit WAV로 변환해
 * /api/stt-ingest로 순차 전송합니다.
 *
 * 녹음을 새로 시작할 때마다 새 sessionId를 발급하고,
 * 모든 청크 전송이 끝난 뒤 세션 상태를 completed로 변경합니다.
 */
export function useCallRecorder(
  providedSessionId?: string
): UseCallRecorderResult {
  const initialSessionId = providedSessionId || crypto.randomUUID();
  const [sessionId, setSessionId] = useState(initialSessionId);
  const sessionIdRef = useRef(initialSessionId);

  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<SttChunkResult[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const muteGainRef = useRef<GainNode | null>(null);
  const pcmBuffersRef = useRef<Float32Array[]>([]);
  const chunkTimerRef = useRef<number | null>(null);
  const chunkIndexRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const currentChunkStartedAtRef = useRef(0);
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  const cumulativeText = chunks
    .filter(
      (chunk) =>
        chunk.status === 'success' && chunk.text.trim() !== ''
    )
    .map((chunk) => chunk.text.trim())
    .join(' ');

  const enqueueChunkUpload = useCallback(
    (
      wavBlob: Blob,
      targetSessionId: string,
      chunkIndex: number,
      chunkStartMs: number,
      chunkEndMs: number
    ) => {
      setChunks((previous) => [
        ...previous,
        {
          chunkIndex,
          chunkStartMs,
          chunkEndMs,
          text: '',
          status: 'sending',
        },
      ]);

      sendQueueRef.current = sendQueueRef.current
        .then(async () => {
          if (mountedRef.current) setIsSending(true);

          try {
            const audioBase64 = await blobToBase64(wavBlob);
            const response = await fetch('/api/stt-ingest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: targetSessionId,
                chunkIndex,
                chunkStartMs,
                chunkEndMs,
                audioBase64,
                mimeType: 'audio/wav',
              }),
            });

            const result = (await response.json()) as SttApiResponse;
            if (!response.ok) {
              throw new Error(
                result.detail ||
                  result.error ||
                  `ingest 실패: ${response.status}`
              );
            }

            if (!mountedRef.current) return;

            setChunks((previous) =>
              previous.map((chunk) =>
                chunk.chunkIndex === chunkIndex
                  ? {
                      ...chunk,
                      text:
                        typeof result.text === 'string'
                          ? result.text
                          : '',
                      status: 'success',
                      error: undefined,
                    }
                  : chunk
              )
            );
            setError(null);
          } catch (uploadError) {
            const message = getErrorMessage(uploadError);
            console.error(
              '[useCallRecorder] chunk upload failed:',
              uploadError
            );

            if (!mountedRef.current) return;

            setChunks((previous) =>
              previous.map((chunk) =>
                chunk.chunkIndex === chunkIndex
                  ? { ...chunk, status: 'error', error: message }
                  : chunk
              )
            );
            setError(message);
          }
        })
        .finally(() => {
          if (mountedRef.current) setIsSending(false);
        });
    },
    []
  );

  const flushCurrentChunk = useCallback(async () => {
    const audioContext = audioContextRef.current;
    if (!audioContext) return;

    const collectedBuffers = pcmBuffersRef.current;
    pcmBuffersRef.current = [];

    const totalSamples = collectedBuffers.reduce(
      (sum, buffer) => sum + buffer.length,
      0
    );
    if (totalSamples === 0) return;

    const mergedSamples = mergeFloat32Arrays(
      collectedBuffers,
      totalSamples
    );
    const resampledSamples = resampleLinear(
      mergedSamples,
      audioContext.sampleRate,
      TARGET_SAMPLE_RATE
    );
    if (resampledSamples.length === 0) return;

    const wavBuffer = encodeWav16BitMono(
      resampledSamples,
      TARGET_SAMPLE_RATE
    );
    const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

    const elapsedMs = Math.max(
      0,
      Math.round(performance.now() - recordingStartedAtRef.current)
    );
    const chunkStartMs = currentChunkStartedAtRef.current;
    const chunkEndMs = Math.max(chunkStartMs, elapsedMs);
    currentChunkStartedAtRef.current = chunkEndMs;

    const chunkIndex = chunkIndexRef.current;
    chunkIndexRef.current += 1;

    enqueueChunkUpload(
      wavBlob,
      sessionIdRef.current,
      chunkIndex,
      chunkStartMs,
      chunkEndMs
    );
  }, [enqueueChunkUpload]);

  const stopAudioResources = useCallback(async () => {
    if (chunkTimerRef.current !== null) {
      window.clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }

    if (processorNodeRef.current) {
      processorNodeRef.current.onaudioprocess = null;
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }

    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;

    muteGainRef.current?.disconnect();
    muteGainRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') await context.close();
  }, []);

  const completeSession = useCallback(async (targetSessionId: string) => {
    const response = await fetch('/api/stt-session-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: targetSessionId }),
    });

    const result = (await response.json()) as SttApiResponse;
    if (!response.ok) {
      throw new Error(
        result.detail ||
          result.error ||
          `세션 완료 처리 실패: ${response.status}`
      );
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecording || isSending) return;

    const newSessionId = crypto.randomUUID();
    sessionIdRef.current = newSessionId;
    setSessionId(newSessionId);
    setError(null);
    setChunks([]);

    chunkIndexRef.current = 0;
    pcmBuffersRef.current = [];
    currentChunkStartedAtRef.current = 0;
    sendQueueRef.current = Promise.resolve();

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('이 브라우저는 마이크 녹음을 지원하지 않습니다.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const AudioContextClass =
        window.AudioContext || getWebkitAudioContext();
      if (!AudioContextClass) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('이 브라우저는 Web Audio API를 지원하지 않습니다.');
      }

      const audioContext = new AudioContextClass();
      if (audioContext.state === 'suspended') await audioContext.resume();

      const sourceNode = audioContext.createMediaStreamSource(stream);
      const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      const muteGain = audioContext.createGain();
      muteGain.gain.value = 0;

      processorNode.onaudioprocess = (event) => {
        const channelData = event.inputBuffer.getChannelData(0);
        pcmBuffersRef.current.push(new Float32Array(channelData));
      };

      sourceNode.connect(processorNode);
      processorNode.connect(muteGain);
      muteGain.connect(audioContext.destination);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceNodeRef.current = sourceNode;
      processorNodeRef.current = processorNode;
      muteGainRef.current = muteGain;

      recordingStartedAtRef.current = performance.now();
      chunkTimerRef.current = window.setInterval(() => {
        void flushCurrentChunk();
      }, CHUNK_DURATION_MS);

      setIsRecording(true);
    } catch (startError) {
      const message = getErrorMessage(startError);
      console.error('[useCallRecorder] start failed:', startError);
      setError(message);
      setIsRecording(false);
      await stopAudioResources();
    }
  }, [flushCurrentChunk, isRecording, isSending, stopAudioResources]);

  const stopRecording = useCallback(async () => {
    if (!isRecording) return;

    const completedSessionId = sessionIdRef.current;
    setIsRecording(false);

    try {
      await flushCurrentChunk();
      await stopAudioResources();
      await sendQueueRef.current;

      // 빈 녹음은 DB 세션 자체가 생성되지 않으므로 완료 요청을 생략합니다.
      if (chunkIndexRef.current > 0) {
        setIsSending(true);
        await completeSession(completedSessionId);
      }
    } catch (stopError) {
      const message = getErrorMessage(stopError);
      console.error('[useCallRecorder] stop failed:', stopError);
      if (mountedRef.current) setError(message);
    } finally {
      if (mountedRef.current) setIsSending(false);
    }
  }, [completeSession, flushCurrentChunk, isRecording, stopAudioResources]);

  const resetRecording = useCallback(() => {
    if (isRecording || isSending) return;

    const nextSessionId = crypto.randomUUID();
    sessionIdRef.current = nextSessionId;
    setSessionId(nextSessionId);
    setChunks([]);
    setError(null);
    chunkIndexRef.current = 0;
    pcmBuffersRef.current = [];
    currentChunkStartedAtRef.current = 0;
  }, [isRecording, isSending]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (chunkTimerRef.current !== null) {
        window.clearInterval(chunkTimerRef.current);
      }
      processorNodeRef.current?.disconnect();
      sourceNodeRef.current?.disconnect();
      muteGainRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((track) => track.stop());

      const audioContext = audioContextRef.current;
      if (audioContext && audioContext.state !== 'closed') {
        void audioContext.close();
      }
    };
  }, []);

  return {
    sessionId,
    isRecording,
    isSending,
    error,
    chunks,
    cumulativeText,
    startRecording,
    stopRecording,
    resetRecording,
  };
}

function mergeFloat32Arrays(
  buffers: Float32Array[],
  totalLength: number
): Float32Array {
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const buffer of buffers) {
    merged.set(buffer, offset);
    offset += buffer.length;
  }

  return merged;
}

function resampleLinear(
  source: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Float32Array {
  if (
    source.length === 0 ||
    sourceSampleRate <= 0 ||
    targetSampleRate <= 0
  ) {
    return new Float32Array();
  }

  if (sourceSampleRate === targetSampleRate) {
    return new Float32Array(source);
  }

  const sampleRateRatio = sourceSampleRate / targetSampleRate;
  const targetLength = Math.max(
    1,
    Math.round(source.length / sampleRateRatio)
  );
  const output = new Float32Array(targetLength);

  for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
    const sourcePosition = targetIndex * sampleRateRatio;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(leftIndex + 1, source.length - 1);
    const fraction = sourcePosition - leftIndex;
    const leftSample = source[leftIndex] ?? 0;
    const rightSample = source[rightIndex] ?? leftSample;

    output[targetIndex] =
      leftSample + (rightSample - leftSample) * fraction;
  }

  return output;
}

function encodeWav16BitMono(
  samples: Float32Array,
  sampleRate: number
): ArrayBuffer {
  const bytesPerSample = 2;
  const numberOfChannels = 1;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(
    28,
    sampleRate * numberOfChannels * bytesPerSample,
    true
  );
  view.setUint16(32, numberOfChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let byteOffset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const pcmValue = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(byteOffset, Math.round(pcmValue), true);
    byteOffset += 2;
  }

  return buffer;
}

function writeAscii(
  view: DataView,
  offset: number,
  value: string
): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const blockSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    const block = bytes.subarray(
      offset,
      Math.min(offset + blockSize, bytes.length)
    );
    binary += String.fromCharCode(...block);
  }

  return btoa(binary);
}

function getWebkitAudioContext(): typeof AudioContext | undefined {
  return (
    window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }
  ).webkitAudioContext;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch {
    return '알 수 없는 오류';
  }
}
