export type TelephonyCodec = 'pcm_s16le' | 'mulaw' | 'alaw' | 'opus';

export type TelephonyAudioFormat = {
  codec: TelephonyCodec;
  sampleRate: number;
  channels: 1 | 2;
};

export type TelephonyCapabilities = {
  provider: string;
  inboundAudio: TelephonyAudioFormat[];
  outboundAudio: TelephonyAudioFormat[];
  supportsBidirectionalMedia: boolean;
  supportsHandoff: boolean;
  supportsDtmf: boolean;
};

export type CallStartedEvent = {
  type: 'call.started';
  callId: string;
  sequence: number;
  occurredAt: string;
  from?: string;
  to?: string;
  metadata?: Record<string, string>;
};

export type InboundAudioEvent = {
  type: 'audio.inbound';
  callId: string;
  sequence: number;
  occurredAt: string;
  format: TelephonyAudioFormat;
  payloadBase64: string;
};

export type CallStoppedEvent = {
  type: 'call.stopped';
  callId: string;
  sequence: number;
  occurredAt: string;
  reason: 'caller_hangup' | 'agent_hangup' | 'provider_error' | 'completed' | 'unknown';
};

export type DtmfEvent = {
  type: 'dtmf.received';
  callId: string;
  sequence: number;
  occurredAt: string;
  digit: string;
};

export type TelephonyInboundEvent = CallStartedEvent | InboundAudioEvent | CallStoppedEvent | DtmfEvent;

export type OutboundAudioCommand = {
  type: 'audio.outbound';
  callId: string;
  sequence: number;
  format: TelephonyAudioFormat;
  payloadBase64: string;
};

export type ClearAudioCommand = {
  type: 'audio.clear';
  callId: string;
  sequence: number;
};

export type HandoffCommand = {
  type: 'call.handoff';
  callId: string;
  sequence: number;
  reason: 'insufficient_evidence' | 'privacy_risk' | 'caller_request' | 'system_error';
  target?: string;
};

export type HangupCommand = {
  type: 'call.hangup';
  callId: string;
  sequence: number;
  reason: 'completed' | 'system_error' | 'policy';
};

export type TelephonyOutboundCommand = OutboundAudioCommand | ClearAudioCommand | HandoffCommand | HangupCommand;

export interface TelephonyAdapter {
  readonly capabilities: TelephonyCapabilities;
  normalizeInbound(event: unknown): TelephonyInboundEvent;
  encodeOutbound(command: TelephonyOutboundCommand): unknown;
}

export const INTERNAL_TELEPHONY_AUDIO: TelephonyAudioFormat = {
  codec: 'pcm_s16le',
  sampleRate: 16000,
  channels: 1,
};
