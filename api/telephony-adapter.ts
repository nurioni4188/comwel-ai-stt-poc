import type { VercelRequest, VercelResponse } from '@vercel/node';

const CAPABILITIES = {
  provider: 'simulator',
  inboundAudio: [{ codec: 'pcm_s16le', sampleRate: 16000, channels: 1 }],
  outboundAudio: [{ codec: 'pcm_s16le', sampleRate: 16000, channels: 1 }],
  supportsBidirectionalMedia: true,
  supportsHandoff: true,
  supportsDtmf: true,
};

const MEDIA_GATEWAY = {
  version: 'v0.13.0',
  service: 'media-gateway-baseline',
  websocket: {
    path: '/v1/media',
    transport: 'persistent-websocket',
    hostedSeparately: true,
    heartbeatMs: 15000,
    maxFrameBytes: 131072,
  },
  internalAudio: { codec: 'pcm_s16le', sampleRate: 16000, channels: 1 },
  gatewayEvents: ['gateway.ready', 'audio.accepted', 'audio.outbound.accepted', 'audio.cleared', 'call.handoff.accepted', 'call.closed', 'gateway.error'],
  scope: 'provider-neutral simulator only; no PSTN/SIP provider or server TTS connected',
};

function normalizeInbound(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('telephony event must be an object');
  }

  const event = raw as Record<string, unknown>;
  const type = String(event.type ?? '');
  const callId = String(event.callId ?? '').trim();
  const sequence = Number(event.sequence);
  const occurredAt = String(event.occurredAt ?? '').trim();

  if (!callId || !Number.isInteger(sequence) || sequence < 0 || !occurredAt) {
    throw new Error('callId, sequence, occurredAt are required');
  }

  if (type === 'call.started') {
    return {
      type,
      callId,
      sequence,
      occurredAt,
      from: event.from ? String(event.from) : undefined,
      to: event.to ? String(event.to) : undefined,
    };
  }

  if (type === 'audio.inbound') {
    if (!event.format || typeof event.format !== 'object' || Array.isArray(event.format)) {
      throw new Error('audio format is required');
    }
    const format = event.format as Record<string, unknown>;
    const codec = String(format.codec ?? '');
    const sampleRate = Number(format.sampleRate);
    const channels = Number(format.channels);
    if (!['pcm_s16le', 'mulaw', 'alaw', 'opus'].includes(codec)) throw new Error('unsupported codec');
    if (!Number.isInteger(sampleRate) || sampleRate <= 0 || (channels !== 1 && channels !== 2)) {
      throw new Error('invalid audio format');
    }
    return {
      type,
      callId,
      sequence,
      occurredAt,
      format: { codec, sampleRate, channels },
      payloadBase64: String(event.payloadBase64 ?? ''),
    };
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

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      version: 'v0.12.0',
      mode: 'provider-neutral-contract',
      adapter: CAPABILITIES,
      internalAudio: { codec: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      lifecycle: ['call.started', 'audio.inbound', 'dtmf.received', 'call.stopped'],
      commands: ['audio.outbound', 'audio.clear', 'call.handoff', 'call.hangup'],
      mediaGateway: MEDIA_GATEWAY,
      note: 'Telephony Adapter v0.12 contract with v0.13 Media Gateway manifest. No PSTN/SIP provider is connected yet.',
    });
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      return res.status(200).json({ ok: true, normalized: normalizeInbound(body) });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_telephony_event',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
