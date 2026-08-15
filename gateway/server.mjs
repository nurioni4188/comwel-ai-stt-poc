import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { synthesizePcm, OPENAI_TTS_CONFIG } from './openaiTts.mjs';
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
const PUBLIC_MEDIA_WSS_URL = process.env.PUBLIC_MEDIA_WSS_URL || '';
const INTERNAL_AUDIO = { codec: 'pcm_s16le', sampleRate: 16000, channels: 1 };

const sessions = new Map();

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
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
  sessions.delete(callId);
}

function startSession({ callId, sequence, ws, providerCallId, streamId }) {
  if (!callId) throw new Error('callId is required');
  if (sessions.has(callId)) throw new Error('call already started');
  sessions.set(callId, {
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
  });
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

function handleTwilioMessage(ws, raw) {
  if (Buffer.byteLength(raw) > MAX_FRAME_BYTES) throw new Error('frame exceeds MAX_FRAME_BYTES');
  const normalized = normalizeTwilioMessage(JSON.parse(raw.toString('utf8')));
  if (normalized.kind === 'provider.connected' || normalized.kind === 'provider.mark') return;

  if (normalized.kind === 'call.started') {
    startSession({
      callId: normalized.callId,
      sequence: normalized.sequence,
      ws,
      providerCallId: normalized.providerCallId,
      streamId: normalized.streamId,
    });
    return;
  }

  const session = sessionFor(normalized.callId);
  session.lastSeenAt = Date.now();
  if (Number.isInteger(normalized.sequence) && normalized.sequence > session.lastSequence) session.lastSequence = normalized.sequence;

  if (normalized.kind === 'audio.inbound') {
    session.inboundFrames += 1;
    session.lastPcm16k = normalized.pcm16k;
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

async function sendServerTts(callId, text) {
  const session = sessionFor(callId);
  if (session.provider !== 'twilio') throw new Error('server TTS provider playback requires twilio mode in v0.14');
  if (!session.ws || session.ws.readyState !== WebSocket.OPEN) throw new Error('provider socket is not open');

  const pcm24k = await synthesizePcm(text);
  const mulaw8k = pcm24kToMulaw8k(pcm24k);
  session.ws.send(twilioMediaMessage(session.streamId, mulaw8k));
  const markName = `tts-${Date.now()}`;
  session.ws.send(twilioMarkMessage(session.streamId, markName));
  session.outboundFrames += 1;
  return { markName, bytes: mulaw8k.length, format: TWILIO_AUDIO };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') {
      json(res, 200, {
        ok: true,
        version: 'v0.14.0',
        service: 'media-gateway',
        provider: PROVIDER,
        activeSessions: sessions.size,
        internalAudio: INTERNAL_AUDIO,
        serverTts: { ...OPENAI_TTS_CONFIG, enabled: Boolean(process.env.OPENAI_API_KEY) },
      });
      return;
    }

    if (req.url === '/v1/twiml') {
      if (!PUBLIC_MEDIA_WSS_URL) { json(res, 503, { error: 'PUBLIC_MEDIA_WSS_URL_not_configured' }); return; }
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${PUBLIC_MEDIA_WSS_URL}" /></Connect></Response>`);
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/tts') {
      const body = await readJson(req);
      const result = await sendServerTts(String(body.callId || ''), String(body.text || ''));
      json(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/clear') {
      const body = await readJson(req);
      const session = sessionFor(String(body.callId || ''));
      if (session.provider !== 'twilio') throw new Error('clear provider playback requires twilio mode');
      session.ws.send(twilioClearMessage(session.streamId));
      json(res, 200, { ok: true });
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
    try {
      if (PROVIDER === 'twilio') handleTwilioMessage(ws, raw);
      else handleSimulatorMessage(ws, raw);
    } catch (error) {
      if (PROVIDER !== 'twilio') send(ws, { type: 'gateway.error', error: error instanceof Error ? error.message : String(error) });
      else console.error('[media-gateway] provider message error', error);
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
  console.log(`[media-gateway] v0.14.0 listening on :${PORT} provider=${PROVIDER}`);
});

function shutdown() {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'server_shutdown');
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
