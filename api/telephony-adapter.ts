import type { VercelRequest, VercelResponse } from '@vercel/node';
import { simulatorTelephonyAdapter } from '../src/telephony/simulatorAdapter';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      version: 'v0.12.0',
      mode: 'provider-neutral-contract',
      adapter: simulatorTelephonyAdapter.capabilities,
      internalAudio: { codec: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      lifecycle: ['call.started', 'audio.inbound', 'dtmf.received', 'call.stopped'],
      commands: ['audio.outbound', 'audio.clear', 'call.handoff', 'call.hangup'],
      note: 'This baseline validates the provider-neutral contract only. No PSTN/SIP provider is connected yet.',
    });
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const event = simulatorTelephonyAdapter.normalizeInbound(body);
      return res.status(200).json({ ok: true, normalized: event });
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
