import crypto from 'node:crypto';

export const TWILIO_AUDIO = { codec: 'mulaw', sampleRate: 8000, channels: 1 };

function decodeMuLawByte(value) {
  const u = (~value) & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

function encodeMuLawSample(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = 0;
  let pcm = Math.max(-CLIP, Math.min(CLIP, sample | 0));
  if (pcm < 0) { sign = 0x80; pcm = -pcm; }
  pcm += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; mask >>= 1) exponent -= 1;
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

export function mulaw8kToPcm16k(payloadBase64) {
  const input = Buffer.from(payloadBase64, 'base64');
  const output = Buffer.allocUnsafe(input.length * 4);
  for (let i = 0; i < input.length; i += 1) {
    const sample = decodeMuLawByte(input[i]);
    output.writeInt16LE(sample, i * 4);
    output.writeInt16LE(sample, i * 4 + 2);
  }
  return output;
}

export function pcm24kToMulaw8k(pcmBuffer) {
  const inputSamples = Math.floor(pcmBuffer.length / 2);
  const outputSamples = Math.floor(inputSamples / 3);
  const output = Buffer.allocUnsafe(outputSamples);
  for (let i = 0; i < outputSamples; i += 1) {
    const base = i * 3;
    const a = pcmBuffer.readInt16LE(base * 2);
    const b = pcmBuffer.readInt16LE((base + 1) * 2);
    const c = pcmBuffer.readInt16LE((base + 2) * 2);
    output[i] = encodeMuLawSample(Math.round((a + b + c) / 3));
  }
  return output;
}

export function validateTwilioUpgrade({ authToken, signature, publicUrl }) {
  if (!authToken) throw new Error('TWILIO_AUTH_TOKEN is required in twilio mode');
  if (!signature) throw new Error('X-Twilio-Signature is required in twilio mode');
  if (!publicUrl) throw new Error('PUBLIC_MEDIA_WSS_URL is required in twilio mode');
  const expected = crypto.createHmac('sha1', authToken).update(publicUrl, 'utf8').digest('base64');
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function normalizeTwilioMessage(message) {
  const event = String(message?.event || '');
  if (event === 'connected') return { kind: 'provider.connected' };

  if (event === 'start') {
    const start = message.start || {};
    const streamId = String(start.streamSid || message.streamSid || '');
    return {
      kind: 'call.started',
      callId: streamId,
      streamId,
      providerCallId: String(start.callSid || ''),
      sequence: Number(message.sequenceNumber || 1),
      providerAudio: TWILIO_AUDIO,
    };
  }

  if (event === 'media') {
    const payload = String(message.media?.payload || '');
    if (!payload) throw new Error('Twilio media payload is required');
    const streamId = String(message.streamSid || '');
    return {
      kind: 'audio.inbound',
      callId: streamId,
      streamId,
      sequence: Number(message.sequenceNumber || 0),
      providerPayloadBase64: payload,
      pcm16k: mulaw8kToPcm16k(payload),
    };
  }

  if (event === 'dtmf') {
    const streamId = String(message.streamSid || '');
    return {
      kind: 'dtmf.received',
      callId: streamId,
      streamId,
      sequence: Number(message.sequenceNumber || 0),
      digit: String(message.dtmf?.digit || ''),
    };
  }

  if (event === 'mark') {
    const streamId = String(message.streamSid || '');
    return {
      kind: 'provider.mark',
      callId: streamId,
      streamId,
      sequence: Number(message.sequenceNumber || 0),
      name: String(message.mark?.name || ''),
    };
  }

  if (event === 'stop') {
    const streamId = String(message.streamSid || '');
    return {
      kind: 'call.stopped',
      callId: streamId,
      streamId,
      providerCallId: String(message.stop?.callSid || ''),
      sequence: Number(message.sequenceNumber || 0),
      reason: 'provider_stop',
    };
  }

  throw new Error(`unsupported Twilio event: ${event}`);
}

export function twilioMediaMessage(streamSid, mulawBuffer) {
  return JSON.stringify({ event: 'media', streamSid, media: { payload: mulawBuffer.toString('base64') } });
}

export function twilioMarkMessage(streamSid, name) {
  return JSON.stringify({ event: 'mark', streamSid, mark: { name } });
}

export function twilioClearMessage(streamSid) {
  return JSON.stringify({ event: 'clear', streamSid });
}
