const DEFAULT_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const DEFAULT_VOICE = process.env.OPENAI_TTS_VOICE || 'coral';
const PCM_RATE = 24000;
const requestedTimeoutMs = Number(process.env.OPENAI_TTS_TIMEOUT_MS || 30000);
const TTS_TIMEOUT_MS = Number.isFinite(requestedTimeoutMs) ? Math.min(60000, Math.max(3000, Math.round(requestedTimeoutMs))) : 30000;

export const OPENAI_TTS_CONFIG = {
  provider: 'openai',
  model: DEFAULT_MODEL,
  voice: DEFAULT_VOICE,
  responseFormat: 'pcm',
  pcmRate: PCM_RATE,
  sampleFormat: 'pcm_s16le',
  channels: 1,
  timeoutMs: TTS_TIMEOUT_MS,
};

export async function synthesizePcm(text, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for server TTS');

  const input = String(text || '').trim();
  if (!input) throw new Error('TTS text is required');
  if (input.length > 2000) throw new Error('TTS text exceeds v0.15 telephone baseline limit of 2000 characters');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        voice: options.voice || DEFAULT_VOICE,
        input,
        response_format: 'pcm',
        instructions: options.instructions || 'Speak clear, calm Korean suitable for a public-service telephone consultation. Do not add or omit information.',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI TTS failed: ${response.status} ${detail.slice(0, 300)}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const pcm = Buffer.from(arrayBuffer);
    if (pcm.length === 0) throw new Error('OpenAI TTS returned empty PCM audio');
    if (pcm.length % 2 !== 0) throw new Error('OpenAI TTS returned invalid 16-bit PCM byte length');
    return pcm;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`OpenAI TTS timeout after ${TTS_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
