import { randomUUID } from 'node:crypto';

const requestedTurnMs = Number(process.env.LIVE_TURN_MS || 8000);
const TURN_MS = Number.isFinite(requestedTurnMs) ? Math.min(15000, Math.max(1000, Math.round(requestedTurnMs))) : 8000;
const requestedTimeoutMs = Number(process.env.LIVE_HTTP_TIMEOUT_MS || 20000);
const HTTP_TIMEOUT_MS = Number.isFinite(requestedTimeoutMs) ? Math.min(60000, Math.max(3000, Math.round(requestedTimeoutMs))) : 20000;
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const TURN_BYTES = Math.round(SAMPLE_RATE * BYTES_PER_SAMPLE * TURN_MS / 1000);
const AI_APP_BASE_URL = String(process.env.AI_APP_BASE_URL || '').trim().replace(/\/$/, '');

export function wavFromPcm16k(pcm) {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  const byteRate = SAMPLE_RATE * BYTES_PER_SAMPLE;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

function endpoint(path) {
  if (!AI_APP_BASE_URL) throw new Error('AI_APP_BASE_URL is required when LIVE_E2E_ENABLED=true');
  const url = new URL(path, `${AI_APP_BASE_URL}/`);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('AI_APP_BASE_URL must use HTTPS outside localhost');
  }
  return url.toString();
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`invalid JSON from ${url}: ${text.slice(0, 300)}`); }
    if (!response.ok) throw new Error(`${url} ${response.status}: ${payload.detail || payload.error || text.slice(0, 300)}`);
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`upstream timeout after ${HTTP_TIMEOUT_MS}ms: ${url}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function transcribeTurn(session, pcm) {
  const live = session.live;
  if (!live) throw new Error('live session is not initialized');

  const chunkIndex = live.nextChunkIndex;
  const chunkStartMs = chunkIndex * TURN_MS;
  const chunkEndMs = chunkStartMs + TURN_MS;
  const wav = wavFromPcm16k(pcm);
  const payload = await postJson(endpoint('/api/stt-ingest'), {
    sessionId: live.sttSessionId,
    chunkIndex,
    chunkStartMs,
    chunkEndMs,
    audioBase64: wav.toString('base64'),
    mimeType: 'audio/wav',
  });
  const text = String(payload.text || '').trim();
  live.sttStarted = true;
  live.nextChunkIndex += 1;
  return text;
}

async function answerTurn(session, question) {
  return postJson(endpoint('/api/stt-rag-answer'), {
    question,
    history: session.history.slice(-6),
  });
}

async function waitUntilIdle(live, maxWaitMs = HTTP_TIMEOUT_MS + 5000) {
  const deadline = Date.now() + maxWaitMs;
  while (live.processing && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function createLiveBridge({ onAnswer, onFallback, onError }) {
  return {
    turnMs: TURN_MS,
    targetBytes: TURN_BYTES,

    initSession(session) {
      session.live = {
        enabled: true,
        processing: false,
        speaking: false,
        stopped: false,
        chunks: [],
        bytes: 0,
        turns: 0,
        sttSessionId: randomUUID(),
        sttStarted: false,
        sttCompletionStarted: false,
        sttCompleted: false,
        nextChunkIndex: 0,
      };
      session.history = [];
    },

    resetAudio(session) {
      if (!session.live) return;
      session.live.chunks = [];
      session.live.bytes = 0;
    },

    markPlaybackStarted(session) {
      if (session.live) session.live.speaking = true;
    },

    markPlaybackFinished(session) {
      if (!session.live) return;
      session.live.speaking = false;
      this.resetAudio(session);
    },

    stop(session) {
      if (!session.live) return;
      session.live.stopped = true;
      this.resetAudio(session);
    },

    async completeSession(session) {
      const live = session.live;
      if (!live || live.sttCompleted || live.sttCompletionStarted) return { completed: false };
      live.sttCompletionStarted = true;
      try {
        await waitUntilIdle(live);
        if (!live.sttStarted) return { completed: false };
        await postJson(endpoint('/api/stt-session-complete'), { sessionId: live.sttSessionId });
        live.sttCompleted = true;
        return { completed: true };
      } finally {
        live.sttCompletionStarted = false;
      }
    },

    async pushPcm(session, pcmChunk) {
      const live = session.live;
      if (!live || live.stopped || live.processing || live.speaking) return null;
      if (!Buffer.isBuffer(pcmChunk) || pcmChunk.length === 0) return null;

      live.chunks.push(pcmChunk);
      live.bytes += pcmChunk.length;
      if (live.bytes < TURN_BYTES) return null;

      const joined = Buffer.concat(live.chunks, live.bytes);
      const pcm = joined.subarray(0, TURN_BYTES);
      const remainder = joined.subarray(TURN_BYTES);
      live.chunks = remainder.length ? [remainder] : [];
      live.bytes = remainder.length;
      live.processing = true;
      live.turns += 1;

      try {
        const question = await transcribeTurn(session, pcm);
        if (question.length < 2) {
          await onFallback(session, '질문을 정확히 인식하지 못했습니다. 한 문장으로 다시 말씀해 주세요.', 'empty_stt');
          return { generated: false, reason: 'empty_stt' };
        }

        const rag = await answerTurn(session, question);
        session.history.push({ role: 'user', content: question });

        if (!rag.generated) {
          const fallback = String(rag.answer || '승인근거가 충분하지 않아 담당자 확인이 필요합니다.');
          session.history.push({ role: 'assistant', content: fallback });
          await onFallback(session, fallback, String(rag.reason || 'insufficient_evidence'));
          live.stopped = true;
          return { generated: false, question, reason: rag.reason };
        }

        const answer = String(rag.answer || '').trim();
        session.history.push({ role: 'assistant', content: answer });
        await onAnswer(session, answer, rag);
        return { generated: true, question, answer, confidence: rag.confidence };
      } catch (error) {
        await onError(session, error);
        live.stopped = true;
        return { generated: false, reason: 'bridge_error' };
      } finally {
        live.processing = false;
      }
    },
  };
}

export const LIVE_BRIDGE_CONFIG = {
  turnMs: TURN_MS,
  httpTimeoutMs: HTTP_TIMEOUT_MS,
  sampleRate: SAMPLE_RATE,
  channels: 1,
  format: 'pcm_s16le',
  aiAppBaseUrlConfigured: Boolean(AI_APP_BASE_URL),
  rawAudioPersistence: false,
  transcriptPersistence: 'one stt_poc call session per live phone call; recognized turn text is persisted by stt-ingest',
  sttSessionCompletion: 'best-effort on phone session close via stt-session-complete',
};
