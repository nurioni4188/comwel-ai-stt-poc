import type {
  TelephonyAdapter,
  TelephonyCapabilities,
  TelephonyInboundEvent,
  TelephonyOutboundCommand,
} from './types';

const capabilities: TelephonyCapabilities = {
  provider: 'simulator',
  inboundAudio: [{ codec: 'pcm_s16le', sampleRate: 16000, channels: 1 }],
  outboundAudio: [{ codec: 'pcm_s16le', sampleRate: 16000, channels: 1 }],
  supportsBidirectionalMedia: true,
  supportsHandoff: true,
  supportsDtmf: true,
};

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('telephony event must be an object');
  }
}

export class SimulatorTelephonyAdapter implements TelephonyAdapter {
  readonly capabilities = capabilities;

  normalizeInbound(event: unknown): TelephonyInboundEvent {
    assertObject(event);
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
        metadata: undefined,
      };
    }

    if (type === 'audio.inbound') {
      assertObject(event.format);
      const codec = String(event.format.codec ?? '');
      const sampleRate = Number(event.format.sampleRate);
      const channels = Number(event.format.channels);
      if (!['pcm_s16le', 'mulaw', 'alaw', 'opus'].includes(codec)) {
        throw new Error('unsupported codec');
      }
      if (!Number.isInteger(sampleRate) || sampleRate <= 0 || (channels !== 1 && channels !== 2)) {
        throw new Error('invalid audio format');
      }
      return {
        type,
        callId,
        sequence,
        occurredAt,
        format: { codec: codec as 'pcm_s16le' | 'mulaw' | 'alaw' | 'opus', sampleRate, channels: channels as 1 | 2 },
        payloadBase64: String(event.payloadBase64 ?? ''),
      };
    }

    if (type === 'dtmf.received') {
      const digit = String(event.digit ?? '');
      if (!/^[0-9*#]$/.test(digit)) throw new Error('invalid DTMF digit');
      return { type, callId, sequence, occurredAt, digit };
    }

    if (type === 'call.stopped') {
      const reason = String(event.reason ?? 'unknown');
      const allowed = ['caller_hangup', 'agent_hangup', 'provider_error', 'completed', 'unknown'] as const;
      const normalizedReason = allowed.includes(reason as (typeof allowed)[number])
        ? (reason as (typeof allowed)[number])
        : 'unknown';
      return { type, callId, sequence, occurredAt, reason: normalizedReason };
    }

    throw new Error(`unsupported inbound event: ${type}`);
  }

  encodeOutbound(command: TelephonyOutboundCommand): unknown {
    return {
      provider: 'simulator',
      version: 'v0.12.0',
      ...command,
    };
  }
}

export const simulatorTelephonyAdapter = new SimulatorTelephonyAdapter();
