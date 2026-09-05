// api/stt-ingest.ts
// Vercel Serverless Function
// WAV 청크 → CLOVA Speech 단문 인식 → Supabase 저장

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const STT_SCHEMA = 'stt_poc';
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SttSupabaseClient = SupabaseClient<any, any, any, any, any>;

interface IngestRequestBody {
  sessionId: string;
  chunkIndex: number;
  chunkStartMs: number;
  chunkEndMs: number;
  audioBase64: string;
  mimeType?: string;
}

interface ClovaSpeechResult {
  text?: string;
  confidence?: number;
  quota?: number;
  [key: string]: unknown;
}

interface EnvironmentVariables {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  clovaInvokeUrl: string;
  clovaSecret: string;
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: 'Method not allowed',
      detail: 'POST 요청만 허용됩니다.',
    });
  }

  try {
    const env = getEnvironmentVariables();
    const body = parseRequestBody(req.body);
    validateRequestBody(body);

    const audioBuffer = decodeAudioBase64(body.audioBase64);
    if (audioBuffer.length > MAX_AUDIO_BYTES) {
      throw new RequestError(
        `오디오 청크는 ${MAX_AUDIO_BYTES}바이트 이하여야 합니다.`,
        413
      );
    }

    const supabase = createSupabaseClient(
      env.supabaseUrl,
      env.supabaseServiceRoleKey
    );

    await ensureCallSession(supabase, body.sessionId);

    const sttResult = await callClovaSpeech({
      invokeUrl: env.clovaInvokeUrl,
      secret: env.clovaSecret,
      audioBuffer,
    });

    const recognizedText =
      typeof sttResult.text === 'string' ? sttResult.text.trim() : '';
    const durationMs = Math.max(0, body.chunkEndMs - body.chunkStartMs);

    await saveTranscriptChunk(supabase, {
      sessionId: body.sessionId,
      chunkIndex: body.chunkIndex,
      transcript: recognizedText,
      audioFormat: 'audio/wav',
      durationMs,
    });

    return res.status(200).json({
      ok: true,
      text: recognizedText,
      chunkIndex: body.chunkIndex,
      durationMs,
    });
  } catch (error) {
    const detail = getErrorMessage(error);
    const statusCode = error instanceof RequestError ? error.statusCode : 500;

    console.error('[stt-ingest] failed:', error);

    return res.status(statusCode).json({
      error: statusCode >= 500 ? 'STT 처리 실패' : '요청 처리 실패',
      ...(process.env.VERCEL_ENV !== 'production' ? { detail } : {}),
    });
  }
}

function getEnvironmentVariables(): EnvironmentVariables {
  const values = {
    supabaseUrl: process.env.SUPABASE_URL?.trim(),
    supabaseServiceRoleKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    clovaInvokeUrl: process.env.CLOVA_SPEECH_INVOKE_URL?.trim(),
    clovaSecret: process.env.CLOVA_SPEECH_SECRET?.trim(),
  };

  const missing = [
    !values.supabaseUrl && 'SUPABASE_URL',
    !values.supabaseServiceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !values.clovaInvokeUrl && 'CLOVA_SPEECH_INVOKE_URL',
    !values.clovaSecret && 'CLOVA_SPEECH_SECRET',
  ].filter((value): value is string => Boolean(value));

  if (missing.length > 0) {
    throw new Error(`필수 환경변수 누락: ${missing.join(', ')}`);
  }

  return values as EnvironmentVariables;
}

function createSupabaseClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SttSupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: STT_SCHEMA },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }) as SttSupabaseClient;
}

function parseRequestBody(rawBody: unknown): IngestRequestBody {
  if (rawBody === null || rawBody === undefined) {
    throw new RequestError('요청 본문이 없습니다.', 400);
  }

  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody) as IngestRequestBody;
    } catch {
      throw new RequestError('요청 본문이 올바른 JSON이 아닙니다.', 400);
    }
  }

  if (typeof rawBody !== 'object') {
    throw new RequestError('요청 본문 형식이 올바르지 않습니다.', 400);
  }

  return rawBody as IngestRequestBody;
}

function validateRequestBody(body: IngestRequestBody): void {
  if (
    typeof body.sessionId !== 'string' ||
    !UUID_PATTERN.test(body.sessionId.trim())
  ) {
    throw new RequestError('sessionId는 올바른 UUID여야 합니다.', 400);
  }

  if (typeof body.audioBase64 !== 'string' || body.audioBase64.trim() === '') {
    throw new RequestError('audioBase64가 필요합니다.', 400);
  }

  if (body.mimeType && body.mimeType.split(';')[0].trim() !== 'audio/wav') {
    throw new RequestError('현재 audio/wav 형식만 허용됩니다.', 415);
  }

  if (!Number.isInteger(body.chunkIndex) || body.chunkIndex < 0) {
    throw new RequestError('chunkIndex는 0 이상의 정수여야 합니다.', 400);
  }

  if (!Number.isFinite(body.chunkStartMs) || body.chunkStartMs < 0) {
    throw new RequestError('chunkStartMs 값이 올바르지 않습니다.', 400);
  }

  if (
    !Number.isFinite(body.chunkEndMs) ||
    body.chunkEndMs < body.chunkStartMs
  ) {
    throw new RequestError('chunkEndMs 값이 올바르지 않습니다.', 400);
  }
}

function decodeAudioBase64(audioBase64: string): Buffer {
  const normalized = removeDataUrlPrefix(audioBase64);

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new RequestError('오디오 Base64 형식이 올바르지 않습니다.', 400);
  }

  const audioBuffer = Buffer.from(normalized, 'base64');
  if (audioBuffer.length === 0) {
    throw new RequestError('전송된 오디오 데이터가 비어 있습니다.', 400);
  }

  if (
    audioBuffer.length < 12 ||
    audioBuffer.toString('ascii', 0, 4) !== 'RIFF' ||
    audioBuffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new RequestError('유효한 WAV 파일이 아닙니다.', 415);
  }

  return audioBuffer;
}

async function ensureCallSession(
  supabase: SttSupabaseClient,
  sessionId: string
): Promise<void> {
  const { error } = await supabase.from('call_sessions').upsert(
    { id: sessionId, status: 'recording' },
    { onConflict: 'id', ignoreDuplicates: true }
  );

  if (error) {
    throw new Error(formatSupabaseError('call_sessions 생성 확인 실패', error));
  }
}

async function saveTranscriptChunk(
  supabase: SttSupabaseClient,
  input: {
    sessionId: string;
    chunkIndex: number;
    transcript: string;
    audioFormat: string;
    durationMs: number;
  }
): Promise<void> {
  const { error } = await supabase.from('transcript_chunks').upsert(
    {
      session_id: input.sessionId,
      chunk_index: input.chunkIndex,
      transcript: input.transcript,
      audio_format: input.audioFormat,
      duration_ms: Math.round(input.durationMs),
    },
    { onConflict: 'session_id,chunk_index' }
  );

  if (error) {
    throw new Error(formatSupabaseError('transcript_chunks 저장 실패', error));
  }
}

async function callClovaSpeech(input: {
  invokeUrl: string;
  secret: string;
  audioBuffer: Buffer;
}): Promise<ClovaSpeechResult> {
  let requestUrl: URL;

  try {
    requestUrl = new URL(input.invokeUrl);
  } catch {
    throw new Error('CLOVA_SPEECH_INVOKE_URL 형식이 올바르지 않습니다.');
  }

  if (!requestUrl.searchParams.has('lang')) {
    requestUrl.searchParams.set('lang', 'Kor');
  }

  const response = await fetch(requestUrl.toString(), {
    method: 'POST',
    headers: {
      'X-CLOVASPEECH-API-KEY': input.secret,
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array(input.audioBuffer),
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error('[CLOVA Speech] request failed:', {
      status: response.status,
      statusText: response.statusText,
      audioBytes: input.audioBuffer.length,
      response: responseText.slice(0, 1000),
    });

    throw new Error(
      `CLOVA Speech 응답 오류 ${response.status} ${response.statusText}: ` +
        responseText.slice(0, 500)
    );
  }

  if (!responseText.trim()) {
    throw new Error('CLOVA Speech 응답 본문이 비어 있습니다.');
  }

  let json: ClovaSpeechResult;
  try {
    json = JSON.parse(responseText) as ClovaSpeechResult;
  } catch {
    throw new Error(`CLOVA Speech JSON 해석 실패: ${responseText.slice(0, 500)}`);
  }

  if (typeof json.text !== 'string') {
    throw new Error(
      `CLOVA Speech 응답에 text 필드가 없습니다: ${responseText.slice(0, 500)}`
    );
  }

  return json;
}

function removeDataUrlPrefix(audioBase64: string): string {
  const trimmed = audioBase64.trim();
  const commaIndex = trimmed.indexOf(',');

  return trimmed.startsWith('data:') && commaIndex >= 0
    ? trimmed.slice(commaIndex + 1)
    : trimmed;
}

function formatSupabaseError(
  prefix: string,
  error: {
    message?: string;
    code?: string;
    details?: string;
    hint?: string;
  }
): string {
  return [
    prefix,
    error.message,
    error.code ? `code=${error.code}` : undefined,
    error.details ? `details=${error.details}` : undefined,
    error.hint ? `hint=${error.hint}` : undefined,
  ]
    .filter(Boolean)
    .join(' | ');
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch {
    return '알 수 없는 오류';
  }
}
