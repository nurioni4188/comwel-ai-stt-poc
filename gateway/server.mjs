import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { synthesizePcm, OPENAI_TTS_CONFIG } from './openaiTts.mjs';
import { createLiveBridge, LIVE_BRIDGE_CONFIG } from './liveBridge.mjs';
import {
  normalizeTwilioMessage,
  pcm24kToMulaw8k,
  twilioClearMessage,
  twilioMarkMessage,
  twilioMediaMessage,
  validateTwilioUpgrade,
  TWILIO_AUDIO,
} from './twilioAdapter.mjs';

const PORT = Number(process.env.PORT || 8787);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 15000);
const MAX_FRAME_BYTES = Number(process.env.MAX_FRAME_BYTES || 128 * 1024);
const PROVIDER = process.env.TELEPHONY_PROVIDER || 'simulator';
const PUBLIC_MEDIA_WSS_URL = String(process.env.PUBLIC_MEDIA_WSS_URL || '').trim();
const LIVE_E2E_ENABLED = String(process.env.LIVE_E2E_ENABLED || '').toLowerCase() === 'true';
const GATEWAY_CONTROL_TOKEN = String(process.env.GATEWAY_CONTROL_TOKEN || '').trim();
const INTERNAL_AUDIO = { codec: 'pcm_s16le', sampleRate: 16000, channels: 1 };

const sessions = new Map();

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function validateEnvelope(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('message must be an object');
  const type = String(message.type || '');
  const callId = String(message.callId || '').trim();
  const sequence = Number(message.sequence);
  if (!type || !callId || !Number.isInteger(sequence) || sequence < 0) throw new Error('type, callId, sequence are required');
  return { type, callId, sequence };
}

function safeEqualText(expected, actual) {
  const left = Buffer.from(String(expected || ''));
  const right = Buffer.from(String(actual || ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function controlTokenFrom(req) {
  const authorization = String(req.headers.authorization || '').trim();
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || String(req.headers['x-gateway-control-token'] || '').trim();
}

function requireControl(req, res) {
  if (!GATEWAY_CONTROL_TOKEN) {
    json(res, 503, { ok: false, error: 'gateway_control_token_not_configured' });
    return false;
  }
  if (!safeEqualText(GATEWAY_CONTROL_TOKEN, controlTokenFrom(req))) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

function publicMediaUrl() {
  if (!PUBLIC_MEDIA_WSS_URL) throw new Error('PUBLIC_MEDIA_WSS_URL_not_configured');
  const url = new URL(PUBLIC_MEDIA_WSS_URL);
  if (url.protocol !== 'wss:') throw new Error('PUBLIC_MEDIA_WSS_URL must use wss://');
  if (url.search || url.hash) throw new Error('PUBLIC_MEDIA_WSS_URL must not contain query or fragment');
  return url.toString();
}

function liveReadiness() {
  const checks = {
    providerTwilio: PROVIDER === 'twilio',
    liveE2EEnabled: LIVE_E2E_ENABLED,
    twilioAuthToken: Boolean(process.env.TWILIO_AUTH_TOKEN),
    publicMediaWssUrl: Boolean(PUBLIC_MEDIA_WSS_URL),
    openAiApiKey: Boolean(process.env.OPENAI_API_KEY),
    aiAppBaseUrl: Boolean(LIVE_BRIDGE_CONFIG.aiAppBaseUrlConfigured),
    gatewayControlToken: Boolean(GATEWAY_CONTROL_TOKEN),
  };
  return { ready: Object.values(checks).every(Boolean), checks };
}

function sessionFor(callId) {
  const session = sessions.get(callId);
  if (!session) throw new Error('unknown callId');
  return session;
}

function closeSession(callId, reason = 'completed') {
  const session = sessions.get(callId);
  if (!session) return;
  session.state = 'closed';
  session.closedAt = new Date().toISOString();
  session.reason = reason;
  if (session.live) {
    liveBridge.stop(session);
    void liveBridge.completeSession(session)
      .then((result) => {
        if (result.completed) console.log('[live-e2e] STT session completed', { sessionId: session.id });
      })
      .catch((error) => console.error('[live-e2e] STT session completion failed', { sessionId: session.id, error: error instanceof Error ? error.message : String(error) }));
  }
  sessions.delete(callId);
}

function startSession({ callId, sequence, ws, providerCallId, streamId }) {
  if (!callId) throw new Error('callId is required');
  if (sessions.has(callId)) throw new Error('call already started');
  const session = {
    id: randomUUID(),
    callId,
    providerCallId: providerCallId || null,
    streamId: streamId || callId,
    provider: PROVIDER,
    ws,
    state: 'active',
    startedAt: new Date().toISOString(),
    lastSequence: sequence,
    inboundFrames: 0,
    outboundFrames: 0,
    lastSeenAt: Date.now(),
    lastMarkName: null,
  };
  if (LIVE_E2E_ENABLED && PROVIDER === 'twilio') liveBridge.initSession(session);
  sessions.set(callId, session);
  return session;
}

function handleSimulatorMessage(ws, raw) {
  if (Buffer.byteLength(raw) > MAX_FRAME_BYTES) throw new Error('frame exceeds MAX_FRAME_BYTES');
  const message = JSON.parse(raw.toString('utf8'));
  const { type, callId, sequence } = validateEnvelope(message);

  if (type === 'call.started') {
    startSession({ callId, sequence, ws });
    send(ws, { type: 'gateway.ready', callId, sequence, internalAudio: INTERNAL_AUDIO });
    return;
  }

  const session = sessionFor(callId);
  if (sequence <= session.lastSequence) throw new Error('sequence must increase monotonically');
  session.lastSequence = sequence;
  session.lastSeenAt = Date.now();

  if (type === 'audio.inbound') {
    if (!String(message.payloadBase64 || '')) throw new Error('payloadBase64 is required');
    session.inboundFrames += 1;
    send(ws, { type: 'audio.accepted', callId, sequence, inboundFrames: session.inboundFrames });
    return;
  }
  if (type === 'dtmf.received') {
    const digit = String(message.digit || '');
    if (!/^[0-9*#]$/.test(digit)) throw new Error('invalid DTMF digit');
    send(ws, { type: 'dtmf.accepted', callId, sequence, digit });
    return;
  }
  if (type === 'audio.outbound') {
    if (!String(message.payloadBase64 || '')) throw new Error('payloadBase64 is required');
    session.outboundFrames += 1;
    send(ws, { type: 'audio.outbound.accepted', callId, sequence, outboundFrames: session.outboundFrames });
    return;
  }
  if (type === 'audio.clear') { send(ws, { type: 'audio.cleared', callId, sequence }); return; }
  if (type === 'call.handoff') {
    session.state = 'handoff';
    send(ws, { type: 'call.handoff.accepted', callId, sequence, target: String(message.target || 'human-agent') });
    return;
  }
  if (type === 'call.hangup' || type === 'call.stopped') {
    const reason = String(message.reason || (type === 'call.hangup' ? 'agent_hangup' : 'completed'));
    send(ws, { type: 'call.closed', callId, sequence, reason });
    closeSession(callId, reason);
    return;
  }
  throw new Error(`unsupported message type: ${type}`);
}

async function sendServerTts(callId, text) {
  const session = sessionFor(callId);
  if (session.provider !== 'twilio') throw new Error('server TTS provider playback requires twilio mode');
  if (!session.ws || session.ws.readyState !== WebSocket.OPEN) throw new Error('provider socket is not open');
  const normalizedText = String(text || '').trim();
  if (!normalizedText) throw new Error('TTS text is required');

  if (session.live) liveBridge.markPlaybackStarted(session);
  try {
    const pcm24k = await synthesizePcm(normalizedText);
    const mulaw8k = pcm24kToMulaw8k(pcm24k);
    session.ws.send(twilioMediaMessage(session.streamId, mulaw8k));
    const markName = `tts-${Date.now()}`;
    session.lastMarkName = markName;
    session.ws.send(twilioMarkMessage(session.streamId, markName));
    session.outboundFrames += 1;
    return { markName, bytes: mulaw8k.length, format: TWILIO_AUDIO };
  } catch (error) {
    if (session.live) liveBridge.markPlaybackFinished(session);
    throw error;
  }
}

const liveBridge = createLiveBridge({
  onAnswer: async (session, answer) => {
    console.log('[live-e2e] approved answer', { sessionId: session.id, chars: answer.length });
    await sendServerTts(session.callId, answer);
  },
  onFallback: async (session, text, reason) => {
    console.log('[live-e2e] fallback', { sessionId: session.id, reason });
    await sendServerTts(session.callId, text);
  },
  onError: async (session, error) => {
    console.error('[live-e2e] bridge error', { sessionId: session.id, error: error instanceof Error ? error.message : String(error) });
    try { await sendServerTts(session.callId, '현재 자동상담 연결에 문제가 있어 담당자 확인이 필요합니다.'); }
    catch (ttsError) { console.error('[live-e2e] error prompt TTS failed', ttsError instanceof Error ? ttsError.message : String(ttsError)); }
  },
});

async function handleTwilioMessage(ws, raw) {
  if (Buffer.byteLength(raw) > MAX_FRAME_BYTES) throw new Error('frame exceeds MAX_FRAME_BYTES');
  const normalized = normalizeTwilioMessage(JSON.parse(raw.toString('utf8')));
  if (normalized.kind === 'provider.connected') return;

  if (normalized.kind === 'call.started') {
    const session = startSession({
      callId: normalized.callId,
      sequence: normalized.sequence,
      ws,
      providerCallId: normalized.providerCallId,
      streamId: normalized.streamId,
    });
    console.log('[live-e2e] call started', { sessionId: session.id, live: Boolean(session.live) });
    if (session.live) await sendServerTts(session.callId, '안녕하세요. 근로복지공단 자동 음성상담 시험 서비스입니다. 궁금한 사항을 한 문장으로 말씀해 주세요.');
    return;
  }

  const session = sessionFor(normalized.callId);
  session.lastSeenAt = Date.now();
  if (Number.isInteger(normalized.sequence) && normalized.sequence > session.lastSequence) session.lastSequence = normalized.sequence;

  if (normalized.kind === 'provider.mark') {
    if (session.live && (!session.lastMarkName || normalized.name === session.lastMarkName)) {
      liveBridge.markPlaybackFinished(session);
      session.lastMarkName = null;
    }
    return;
  }

  if (normalized.kind === 'audio.inbound') {
    session.inboundFrames += 1;
    if (session.live) await liveBridge.pushPcm(session, normalized.pcm16k);
    return;
  }
  if (normalized.kind === 'dtmf.received') {
    session.lastDtmf = normalized.digit;
    return;
  }
  if (normalized.kind === 'call.stopped') {
    closeSession(normalized.callId, normalized.reason);
    return;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', 'http://gateway.local');
    const pathname = requestUrl.pathname;

    if (pathname === '/health') {
      json(res, 200, {
        ok: true,
        version: 'v0.15.0',
        service: 'media-gateway',
        provider: PROVIDER,
        activeSessions: sessions.size,
        internalAudio: INTERNAL_AUDIO,
        serverTts: { ...OPENAI_TTS_CONFIG, enabled: Boolean(process.env.OPENAI_API_KEY) },
        liveE2E: { ...LIVE_BRIDGE_CONFIG, enabled: LIVE_E2E_ENABLED, readiness: liveReadiness() },
        controlPlane: { protected: true, configured: Boolean(GATEWAY_CONTROL_TOKEN) },
      });
      return;
    }

    if (pathname === '/v1/twiml') {
      const streamUrl = publicMediaUrl();
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${streamUrl}" /></Connect></Response>`);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/tts') {
      if (!requireControl(req, res)) return;
      const body = await readJson(req);
      const result = await sendServerTts(String(body.callId || ''), String(body.text || ''));
      json(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/clear') {
      if (!requireControl(req, res)) return;
      const body = await readJson(req);
      const session = sessionFor(String(body.callId || ''));
      if (session.provider !== 'twilio') throw new Error('clear provider playback requires twilio mode');
      session.ws.send(twilioClearMessage(session.streamId));
      session.lastMarkName = null;
      if (session.live) liveBridge.markPlaybackFinished(session);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/sessions') {
      if (!requireControl(req, res)) return;
      json(res, 200, {
        ok: true,
        sessions: [...sessions.values()].map((session) => ({
          sessionId: session.id,
          callId: session.callId,
          providerCallId: session.providerCallId,
          state: session.state,
          startedAt: session.startedAt,
          lastSeenAt: new Date(session.lastSeenAt).toISOString(),
          inboundFrames: session.inboundFrames,
          outboundFrames: session.outboundFrames,
          live: session.live ? {
            processing: session.live.processing,
            speaking: session.live.speaking,
            stopped: session.live.stopped,
            turns: session.live.turns,
            bufferedBytes: session.live.bytes,
            sttChunks: session.live.nextChunkIndex,
            sttCompleted: session.live.sttCompleted,
          } : null,
        })),
      });
      return;
    }

    json(res, 404, { error: 'not_found' });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

const wss = new WebSocketServer({ server, path: '/v1/media', maxPayload: MAX_FRAME_BYTES });

wss.on('connection', (ws, req) => {
  if (PROVIDER === 'twilio') {
    try {
      const signature = String(req.headers['x-twilio-signature'] || '');
      const valid = validateTwilioUpgrade({ authToken: process.env.TWILIO_AUTH_TOKEN, signature, publicUrl: PUBLIC_MEDIA_WSS_URL });
      if (!valid) { ws.close(1008, 'invalid_twilio_signature'); return; }
    } catch {
      ws.close(1008, 'twilio_validation_failed');
      return;
    }
  }

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    if (PROVIDER === 'twilio') {
      void handleTwilioMessage(ws, raw).catch((error) => console.error('[media-gateway] provider message error', error instanceof Error ? error.message : String(error)));
    } else {
      try { handleSimulatorMessage(ws, raw); }
      catch (error) { send(ws, { type: 'gateway.error', error: error instanceof Error ? error.message : String(error) }); }
    }
  });
  ws.on('close', () => {
    for (const [callId, session] of sessions) if (session.ws === ws) closeSession(callId, 'socket_closed');
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

server.listen(PORT, () => {
  console.log(`[media-gateway] v0.15.0 listening on :${PORT} provider=${PROVIDER} liveE2E=${LIVE_E2E_ENABLED}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'server_shutdown');
  server.close(() => console.log('[media-gateway] HTTP server closed'));
  const forceExit = setTimeout(() => process.exit(1), Math.max(10000, LIVE_BRIDGE_CONFIG.httpTimeoutMs + 6000));
  forceExit.unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
