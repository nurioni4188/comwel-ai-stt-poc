import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireGatewayInternalAuth } from './_gatewayAuth.js';

const CAPABILITIES = {
  provider: 'simulator',
  inboundAudio: [{ codec: 'pcm_s16le', sampleRate: 16000, channels: 1 }],
  outboundAudio: [{ codec: 'pcm_s16le', sampleRate: 16000, channels: 1 }],
  supportsBidirectionalMedia: true,
  supportsHandoff: true,
  supportsDtmf: true,
};

const GATEWAY_OPERATIONS = {
  stt_ingest: '/api/stt-ingest',
  rag_answer: '/api/stt-rag-answer',
  session_complete: '/api/stt-session-complete',
} as const;

type GatewayOperation = keyof typeof GATEWAY_OPERATIONS;

const MEDIA_GATEWAY = {
  version: 'v0.15.0',
  service: 'live-telephony-e2e-baseline',
  websocket: { path: '/v1/media', transport: 'persistent-websocket', hostedSeparately: true, heartbeatMs: 15000, maxFrameBytes: 131072 },
  internalAudio: { codec: 'pcm_s16le', sampleRate: 16000, channels: 1 },
  providerIntegration: {
    implementation: 'twilio-media-streams',
    enabledByDefault: false,
    inboundAudio: { codec: 'mulaw', sampleRate: 8000, channels: 1 },
    outboundAudio: { codec: 'mulaw', sampleRate: 8000, channels: 1 },
    inboundEvents: ['connected', 'start', 'media', 'dtmf', 'mark', 'stop'],
    outboundEvents: ['media', 'mark', 'clear'],
    requiredSecrets: ['TWILIO_AUTH_TOKEN', 'PUBLIC_MEDIA_WSS_URL'],
    signatureValidationRequired: true,
    signatureUrlCompatibility: 'exact WSS URL plus trailing-slash variant',
  },
  liveBridge: {
    enabledByDefault: false,
    turnWindowMs: 8000,
    upstreamTimeoutMs: 20000,
    flow: ['Twilio media', 'PCM16/16k memory buffer', 'CLOVA STT', 'approved-evidence RAG', 'OpenAI server TTS', 'Twilio media playback'],
    aiAppBaseUrlEnv: 'AI_APP_BASE_URL',
    internalApiAuthEnv: 'STT_INTERNAL_API_TOKEN',
    protectedUpstream: 'POST /api/telephony-adapter with gatewayOperation',
    featureGate: 'LIVE_E2E_ENABLED=true',
    rawAudioPersistence: false,
    transcriptPersistence: 'one stt_poc session per live phone call; recognized turn text is stored as sequential transcript chunks',
    sessionCompletion: 'best-effort stt-session-complete after in-flight turn settles on call/socket close',
  },
  serverTts: {
    implementation: 'openai-audio-speech',
    model: 'gpt-4o-mini-tts',
    responseFormat: 'pcm',
    pcmInputContract: { codec: 'pcm_s16le', sampleRate: 24000, channels: 1 },
    timeoutMs: 30000,
    telephoneOutput: { codec: 'mulaw', sampleRate: 8000, channels: 1 },
    requiredSecrets: ['OPENAI_API_KEY'],
    monthlyBaseFee: false,
  },
  gatewayRequiredEnv: [
    'TELEPHONY_PROVIDER=twilio',
    'LIVE_E2E_ENABLED=true',
    'TWILIO_AUTH_TOKEN',
    'PUBLIC_MEDIA_WSS_URL',
    'OPENAI_API_KEY',
    'AI_APP_BASE_URL',
    'STT_INTERNAL_API_TOKEN',
    'GATEWAY_CONTROL_TOKEN',
  ],
  optionalTuningEnv: ['LIVE_TURN_MS', 'LIVE_HTTP_TIMEOUT_MS', 'OPENAI_TTS_TIMEOUT_MS', 'HEARTBEAT_MS', 'MAX_FRAME_BYTES'],
  publicEndpoints: ['/health', '/v1/twiml', 'WSS /v1/media (Twilio signature required)'],
  protectedControlPlane: ['GET /v1/sessions', 'POST /v1/tts', 'POST /v1/clear'],
  controlAuth: 'Bearer or x-gateway-control-token using GATEWAY_CONTROL_TOKEN',
  scope: 'live bridge code hardened; persistent WSS hosting and Twilio trial number connection still required for real-call E2E',
};

function normalizeInbound(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('telephony event must be an object');
  const event = raw as Record<string, unknown>;
  const type = String(event.type ?? '');
  const callId = String(event.callId ?? '').trim();
  const sequence = Number(event.sequence);
  const occurredAt = String(event.occurredAt ?? '').trim();
  if (!callId || !Number.isInteger(sequence) || sequence < 0 || !occurredAt) throw new Error('callId, sequence, occurredAt are required');
  if (type === 'call.started') return { type, callId, sequence, occurredAt, from: event.from ? String(event.from) : undefined, to: event.to ? String(event.to) : undefined };
  if (type === 'audio.inbound') {
    if (!event.format || typeof event.format !== 'object' || Array.isArray(event.format)) throw new Error('audio format is required');
    const format = event.format as Record<string, unknown>;
    const codec = String(format.codec ?? '');
    const sampleRate = Number(format.sampleRate);
    const channels = Number(format.channels);
    if (!['pcm_s16le', 'mulaw', 'alaw', 'opus'].includes(codec)) throw new Error('unsupported codec');
    if (!Number.isInteger(sampleRate) || sampleRate <= 0 || (channels !== 1 && channels !== 2)) throw new Error('invalid audio format');
    return { type, callId, sequence, occurredAt, format: { codec, sampleRate, channels }, payloadBase64: String(event.payloadBase64 ?? '') };
  }
  if (type === 'dtmf.received') {
    const digit = String(event.digit ?? '');
    if (!/^[0-9*#]$/.test(digit)) throw new Error('invalid DTMF digit');
    return { type, callId, sequence, occurredAt, digit };
  }
  if (type === 'call.stopped') {
    const allowed = ['caller_hangup', 'agent_hangup', 'provider_error', 'completed', 'unknown'];
    const reason = String(event.reason ?? 'unknown');
    return { type, callId, sequence, occurredAt, reason: allowed.includes(reason) ? reason : 'unknown' };
  }
  throw new Error(`unsupported inbound event: ${type}`);
}

function parseBody(rawBody: unknown): Record<string, unknown> {
  if (typeof rawBody === 'string') return JSON.parse(rawBody) as Record<string, unknown>;
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) return {};
  return rawBody as Record<string, unknown>;
}

async function proxyGatewayOperation(
  req: VercelRequest,
  res: VercelResponse,
  body: Record<string, unknown>
) {
  if (!requireGatewayInternalAuth(req, res)) return;

  const operation = String(body.gatewayOperation ?? '') as GatewayOperation;
  const targetPath = GATEWAY_OPERATIONS[operation];
  if (!targetPath) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ ok: false, error: 'invalid_gateway_operation' });
  }

  const deploymentHost = process.env.VERCEL_URL?.trim();
  if (!deploymentHost) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ ok: false, error: 'gateway_upstream_not_configured' });
  }

  const upstream = await fetch(`https://${deploymentHost}${targetPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-stt-gateway-proxy': '1',
    },
    body: JSON.stringify(body.payload ?? {}),
  });

  const text = await upstream.text();
  res.setHeader('Cache-Control', 'no-store');
  res.status(upstream.status);
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);
  return res.send(text);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      version: 'v0.15.0',
      mode: 'live-telephony-e2e-baseline',
      adapter: CAPABILITIES,
      internalAudio: { codec: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      lifecycle: ['call.started', 'audio.inbound', 'dtmf.received', 'call.stopped'],
      commands: ['audio.outbound', 'audio.clear', 'call.handoff', 'call.hangup'],
      mediaGateway: MEDIA_GATEWAY,
      note: 'Live STT→RAG→Server TTS bridge is code-hardened. Gateway upstream calls use shared-secret authentication through this existing adapter function.',
    });
  }

  if (req.method === 'POST') {
    try {
      const body = parseBody(req.body);
      if ('gatewayOperation' in body) return await proxyGatewayOperation(req, res, body);
      return res.status(200).json({ ok: true, normalized: normalizeInbound(body) });
    } catch (error) {
      return res.status(400).json({ ok: false, error: 'invalid_telephony_event', detail: error instanceof Error ? error.message : String(error) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
