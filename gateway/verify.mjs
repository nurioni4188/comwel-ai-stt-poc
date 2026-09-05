import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  mulaw8kToPcm16k,
  normalizeTwilioMessage,
  pcm24kToMulaw8k,
  validateTwilioUpgrade,
  TWILIO_AUDIO,
} from './twilioAdapter.mjs';
import { wavFromPcm16k } from './liveBridge.mjs';
import { OPENAI_TTS_CONFIG } from './openaiTts.mjs';

const authToken = 'test-auth-token';
const publicUrl = 'wss://gateway.example.test/v1/media';
const signature = crypto.createHmac('sha1', authToken).update(publicUrl, 'utf8').digest('base64');
const slashSignature = crypto.createHmac('sha1', authToken).update(`${publicUrl}/`, 'utf8').digest('base64');

assert.equal(validateTwilioUpgrade({ authToken, signature, publicUrl }), true);
assert.equal(validateTwilioUpgrade({ authToken, signature: slashSignature, publicUrl }), true);
assert.equal(validateTwilioUpgrade({ authToken, signature: 'invalid', publicUrl }), false);

const start = normalizeTwilioMessage({
  event: 'start',
  sequenceNumber: '1',
  streamSid: 'MZ_TEST_STREAM',
  start: {
    streamSid: 'MZ_TEST_STREAM',
    callSid: 'CA_TEST_CALL',
    mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: '8000', channels: '1' },
  },
});
assert.equal(start.kind, 'call.started');
assert.equal(start.callId, 'MZ_TEST_STREAM');
assert.equal(start.providerCallId, 'CA_TEST_CALL');
assert.deepEqual(start.providerAudio, TWILIO_AUDIO);

assert.throws(() => normalizeTwilioMessage({
  event: 'start',
  sequenceNumber: '1',
  streamSid: 'MZ_BAD',
  start: {
    streamSid: 'MZ_BAD',
    callSid: 'CA_BAD',
    mediaFormat: { encoding: 'audio/pcm', sampleRate: '16000', channels: '1' },
  },
}), /unsupported Twilio media format/);

const mulaw = Buffer.alloc(160, 0xff);
const pcm16k = mulaw8kToPcm16k(mulaw.toString('base64'));
assert.equal(pcm16k.length, 640);

assert.equal(OPENAI_TTS_CONFIG.responseFormat, 'pcm');
assert.equal(OPENAI_TTS_CONFIG.pcmRate, 24000);
assert.equal(OPENAI_TTS_CONFIG.sampleFormat, 'pcm_s16le');
assert.equal(OPENAI_TTS_CONFIG.channels, 1);
assert.ok(OPENAI_TTS_CONFIG.timeoutMs >= 3000 && OPENAI_TTS_CONFIG.timeoutMs <= 60000);

const pcm24k = Buffer.alloc(480);
const outboundMulaw = pcm24kToMulaw8k(pcm24k);
assert.equal(outboundMulaw.length, 80);

const wav = wavFromPcm16k(Buffer.alloc(320));
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
assert.equal(wav.readUInt32LE(24), 16000);
assert.equal(wav.readUInt16LE(22), 1);
assert.equal(wav.readUInt16LE(34), 16);
assert.equal(wav.readUInt32LE(40), 320);

const liveBridgeSource = readFileSync(new URL('./liveBridge.mjs', import.meta.url), 'utf8');
assert.match(liveBridgeSource, /sttSessionId: randomUUID\(\)/);
assert.match(liveBridgeSource, /nextChunkIndex/);
assert.match(liveBridgeSource, /\/api\/stt-session-complete/);
assert.match(liveBridgeSource, /const remainder = joined\.subarray\(TURN_BYTES\)/);
assert.match(liveBridgeSource, /await waitUntilIdle\(live\)/);

const ttsSource = readFileSync(new URL('./openaiTts.mjs', import.meta.url), 'utf8');
assert.match(ttsSource, /AbortController/);
assert.match(ttsSource, /response_format: 'pcm'/);
assert.doesNotMatch(ttsSource, /OPENAI_TTS_PCM_RATE/);

const serverSource = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
assert.match(serverSource, /GATEWAY_CONTROL_TOKEN/);
assert.match(serverSource, /gateway_control_token_not_configured/);
assert.match(serverSource, /pathname === '\/v1\/sessions'/);
assert.match(serverSource, /if \(!requireControl\(req, res\)\) return;/);
assert.match(serverSource, /liveBridge\.completeSession\(session\)/);
assert.doesNotMatch(serverSource, /session\.lastPcm16k\s*=/);
assert.match(serverSource, /PUBLIC_MEDIA_WSS_URL must use wss:\/\//);

console.log('PASS v0.15 gateway verification: Twilio signature/media contract, audio conversion, WAV framing, protected controls, STT lifecycle, TTS PCM contract');
