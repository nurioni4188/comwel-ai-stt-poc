import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT || 8787);
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 15000);
const MAX_FRAME_BYTES = Number(process.env.MAX_FRAME_BYTES || 128 * 1024);
const INTERNAL_AUDIO = { codec: 'pcm_s16le', sampleRate: 16000, channels: 1 };

const sessions = new Map();

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

function handleMessage(ws, raw) {
  if (Buffer.byteLength(raw) > MAX_FRAME_BYTES) throw new Error('frame exceeds MAX_FRAME_BYTES');
  const message = JSON.parse(raw.toString('utf8'));
  const { type, callId, sequence } = validateEnvelope(message);

  if (type === 'call.started') {
    if (sessions.has(callId)) throw new Error('call already started');
    sessions.set(callId, {
      id: randomUUID(),
      callId,
      state: 'active',
      startedAt: new Date().toISOString(),
      lastSequence: sequence,
      inboundFrames: 0,
      outboundFrames: 0,
      lastSeenAt: Date.now(),
    });
    send(ws, { type: 'gateway.ready', callId, sequence, internalAudio: INTERNAL_AUDIO });
    return;
  }

  const session = sessionFor(callId);
  if (sequence <= session.lastSequence) throw new Error('sequence must increase monotonically');
  session.lastSequence = sequence;
  session.lastSeenAt = Date.now();

  if (type === 'audio.inbound') {
    const payloadBase64 = String(message.payloadBase64 || '');
    if (!payloadBase64) throw new Error('payloadBase64 is required');
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
    const payloadBase64 = String(message.payloadBase64 || '');
    if (!payloadBase64) throw new Error('payloadBase64 is required');
    session.outboundFrames += 1;
    send(ws, { type: 'audio.outbound.accepted', callId, sequence, outboundFrames: session.outboundFrames });
    return;
  }

  if (type === 'audio.clear') {
    send(ws, { type: 'audio.cleared', callId, sequence });
    return;
  }

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

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: 'v0.13.0', service: 'media-gateway', activeSessions: sessions.size, internalAudio: INTERNAL_AUDIO }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

const wss = new WebSocketServer({ server, path: '/v1/media', maxPayload: MAX_FRAME_BYTES });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    try { handleMessage(ws, raw); }
    catch (error) { send(ws, { type: 'gateway.error', error: error instanceof Error ? error.message : String(error) }); }
  });
  ws.on('close', () => {
    for (const [callId, session] of sessions) {
      if (Date.now() - session.lastSeenAt < HEARTBEAT_MS * 2) continue;
      closeSession(callId, 'socket_closed');
    }
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
  console.log(`[media-gateway] listening on :${PORT}`);
});

function shutdown() {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'server_shutdown');
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
