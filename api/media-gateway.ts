import type { VercelRequest, VercelResponse } from '@vercel/node';

const manifest = {
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
  inbound: ['call.started', 'audio.inbound', 'dtmf.received', 'call.stopped'],
  outbound: ['audio.outbound', 'audio.clear', 'call.handoff', 'call.hangup'],
  gatewayEvents: ['gateway.ready', 'audio.accepted', 'audio.outbound.accepted', 'audio.cleared', 'call.handoff.accepted', 'call.closed', 'gateway.error'],
  scope: 'provider-neutral simulator only; no PSTN/SIP provider or server TTS connected',
};

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, ...manifest });

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('message must be an object');
      const message = body as Record<string, unknown>;
      const type = String(message.type ?? '');
      const callId = String(message.callId ?? '').trim();
      const sequence = Number(message.sequence);
      if (![...manifest.inbound, ...manifest.outbound].includes(type)) throw new Error('unsupported message type');
      if (!callId || !Number.isInteger(sequence) || sequence < 0) throw new Error('callId and non-negative integer sequence are required');
      if ((type === 'audio.inbound' || type === 'audio.outbound') && !String(message.payloadBase64 ?? '')) throw new Error('payloadBase64 is required for audio frames');
      return res.status(200).json({ ok: true, accepted: { type, callId, sequence } });
    } catch (error) {
      return res.status(400).json({ ok: false, error: 'invalid_gateway_message', detail: error instanceof Error ? error.message : String(error) });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
