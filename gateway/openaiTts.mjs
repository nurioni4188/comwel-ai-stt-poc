const DEFAULT_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const DEFAULT_VOICE = process.env.OPENAI_TTS_VOICE || 'coral';
const DEFAULT_PCM_RATE = Number(process.env.OPENAI_TTS_PCM_RATE || 24000);

export const OPENAI_TTS_CONFIG = {
  provider: 'openai',
  model: DEFAULT_MODEL,
  voice: DEFAULT_VOICE,
  responseFormat: 'pcm',
  assumedPcmRate: DEFAULT_PCM_RATE,
};

export async function synthesizePcm(text, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for server TTS');

  const input = String(text || '').trim();
  if (!input) throw new Error('TTS text is required');
  if (input.length > 2000) throw new Error('TTS text exceeds v0.14 baseline limit of 2000 characters');

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
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`OpenAI TTS failed: ${response.status} ${detail.slice(0, 300)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
