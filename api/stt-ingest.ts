// api/stt-ingest.ts
//
// Vercel Serverless Function
//
// 역할:
// 1. 클라이언트에서 오디오 청크 수신
// 2. CLOVA Speech 단문 인식 API 호출
// 3. 결과를 Supabase stt_poc.transcript_chunks에 저장
//
// 서버 전용 환경변수:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - CLOVA_SPEECH_INVOKE_URL
// - CLOVA_SPEECH_SECRET

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  createClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

const STT_SCHEMA = 'stt_poc';

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

    const supabase = createSupabaseClient(
      env.supabaseUrl,
      env.supabaseServiceRoleKey
    );

    await ensureCallSession(supabase, body.sessionId);

    const sttResult = await callClovaSpeech({
      invokeUrl: env.clovaInvokeUrl,
      secret: env.clovaSecret,
      audioBase64: body.audioBase64,
      mimeType: body.mimeType,
    });

    const recognizedText =
      typeof sttResult.text === 'string'
        ? sttResult.text.trim()
        : '';

    const durationMs = Math.max(
      0,
      body.chunkEndMs - body.chunkStartMs
    );

    await saveTranscriptChunk(supabase, {
      sessionId: body.sessionId,
      chunkIndex: body.chunkIndex,
      transcript: recognizedText,
      audioFormat:
        body.mimeType?.trim() ||
        'application/octet-stream',
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

    console.error('[stt-ingest] failed:', error);

    return res.status(500).json({
      error: 'STT 처리 실패',

      // 로컬·Development에서만 상세 오류를 반환합니다.
      ...(process.env.VERCEL_ENV !== 'production'
        ? { detail }
        : {}),
    });
  }
}

function getEnvironmentVariables(): EnvironmentVariables {
  const supabaseUrl =
    process.env.SUPABASE_URL?.trim();

  const supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  const clovaInvokeUrl =
    process.env.CLOVA_SPEECH_INVOKE_URL?.trim();

  const clovaSecret =
    process.env.CLOVA_SPEECH_SECRET?.trim();

  const missing: string[] = [];

  if (!supabaseUrl) {
    missing.push('SUPABASE_URL');
  }

  if (!supabaseServiceRoleKey) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }

  if (!clovaInvokeUrl) {
    missing.push('CLOVA_SPEECH_INVOKE_URL');
  }

  if (!clovaSecret) {
    missing.push('CLOVA_SPEECH_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(
      `필수 환경변수 누락: ${missing.join(', ')}`
    );
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    clovaInvokeUrl,
    clovaSecret,
  };
}

function createSupabaseClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      db: {
        schema: STT_SCHEMA,
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  );
}

function parseRequestBody(
  rawBody: unknown
): IngestRequestBody {
  if (
    rawBody === null ||
    rawBody === undefined
  ) {
    throw new Error('요청 본문이 없습니다.');
  }

  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(
        rawBody
      ) as IngestRequestBody;
    } catch {
      throw new Error(
        '요청 본문이 올바른 JSON이 아닙니다.'
      );
    }
  }

  if (typeof rawBody !== 'object') {
    throw new Error(
      '요청 본문 형식이 올바르지 않습니다.'
    );
  }

  return rawBody as IngestRequestBody;
}

function validateRequestBody(
  body: IngestRequestBody
): void {
  if (
    typeof body.sessionId !== 'string' ||
    body.sessionId.trim() === ''
  ) {
    throw new Error('sessionId가 필요합니다.');
  }

  if (
    typeof body.audioBase64 !== 'string' ||
    body.audioBase64.trim() === ''
  ) {
    throw new Error('audioBase64가 필요합니다.');
  }

  if (
    !Number.isInteger(body.chunkIndex) ||
    body.chunkIndex < 0
  ) {
    throw new Error(
      'chunkIndex는 0 이상의 정수여야 합니다.'
    );
  }

  if (
    !Number.isFinite(body.chunkStartMs) ||
    body.chunkStartMs < 0
  ) {
    throw new Error(
      'chunkStartMs 값이 올바르지 않습니다.'
    );
  }

  if (
    !Number.isFinite(body.chunkEndMs) ||
    body.chunkEndMs < body.chunkStartMs
  ) {
    throw new Error(
      'chunkEndMs 값이 올바르지 않습니다.'
    );
  }
}

async function ensureCallSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<void> {
  const {
    data: existing,
    error: selectError,
  } = await supabase
    .from('call_sessions')
    .select('id')
    .eq('id', sessionId)
    .maybeSingle();

  if (selectError) {
    throw new Error(
      formatSupabaseError(
        'call_sessions 조회 실패',
        selectError
      )
    );
  }

  if (existing) {
    return;
  }

  const { error: insertError } =
    await supabase
      .from('call_sessions')
      .insert({
        id: sessionId,
        status: 'recording',
      });

  if (insertError) {
    throw new Error(
      formatSupabaseError(
        'call_sessions 생성 실패',
        insertError
      )
    );
  }
}

async function saveTranscriptChunk(
  supabase: SupabaseClient,
  input: {
    sessionId: string;
    chunkIndex: number;
    transcript: string;
    audioFormat: string;
    durationMs: number;
  }
): Promise<void> {
  const { error } = await supabase
    .from('transcript_chunks')
    .insert({
      session_id: input.sessionId,
      chunk_index: input.chunkIndex,
      transcript: input.transcript,
      audio_format: input.audioFormat,
      duration_ms: Math.round(input.durationMs),
    });

  if (error) {
    throw new Error(
      formatSupabaseError(
        'transcript_chunks 저장 실패',
        error
      )
    );
  }
}

async function callClovaSpeech(input: {
  invokeUrl: string;
  secret: string;
  audioBase64: string;
  mimeType?: string;
}): Promise<ClovaSpeechResult> {
  const normalizedBase64 =
    removeDataUrlPrefix(input.audioBase64);

  const audioBuffer = Buffer.from(
    normalizedBase64,
    'base64'
  );

  if (audioBuffer.length === 0) {
    throw new Error(
      '전송된 오디오 데이터가 비어 있습니다.'
    );
  }

  let requestUrl: URL;

  try {
    requestUrl = new URL(input.invokeUrl);
  } catch {
    throw new Error(
      'CLOVA_SPEECH_INVOKE_URL 형식이 올바르지 않습니다.'
    );
  }

  if (!requestUrl.searchParams.has('lang')) {
    requestUrl.searchParams.set('lang', 'Kor');
  }

  const response = await fetch(
    requestUrl.toString(),
    {
      method: 'POST',
      headers: {
        'X-CLOVASPEECH-API-KEY':
          input.secret,

        // 단문 인식 API에 바이너리 음원 전송
        'Content-Type':
          'application/octet-stream',
      },
      body: audioBuffer,
    }
  );

  const responseText =
    await response.text();

  if (!response.ok) {
    console.error(
      '[CLOVA Speech] request failed:',
      {
        status: response.status,
        statusText: response.statusText,
        mimeType:
          input.mimeType ||
          'unknown',
        audioBytes:
          audioBuffer.length,
        response:
          responseText.slice(0, 1000),
      }
    );

    throw new Error(
      `CLOVA Speech 응답 오류 ` +
        `${response.status} ` +
        `${response.statusText}: ` +
        responseText.slice(0, 500)
    );
  }

  if (!responseText.trim()) {
    throw new Error(
      'CLOVA Speech 응답 본문이 비어 있습니다.'
    );
  }

  let json: ClovaSpeechResult;

  try {
    json = JSON.parse(
      responseText
    ) as ClovaSpeechResult;
  } catch {
    throw new Error(
      `CLOVA Speech JSON 해석 실패: ` +
        responseText.slice(0, 500)
    );
  }

  if (typeof json.text !== 'string') {
    throw new Error(
      `CLOVA Speech 응답에 text 필드가 없습니다: ` +
        responseText.slice(0, 500)
    );
  }

  return json;
}

function removeDataUrlPrefix(
  audioBase64: string
): string {
  const trimmed = audioBase64.trim();

  const commaIndex = trimmed.indexOf(',');

  if (
    trimmed.startsWith('data:') &&
    commaIndex >= 0
  ) {
    return trimmed.slice(commaIndex + 1);
  }

  return trimmed;
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
  const parts = [
    prefix,
    error.message,
    error.code
      ? `code=${error.code}`
      : undefined,
    error.details
      ? `details=${error.details}`
      : undefined,
    error.hint
      ? `hint=${error.hint}`
      : undefined,
  ].filter(Boolean);

  return parts.join(' | ');
}

function getErrorMessage(
  error: unknown
): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return '알 수 없는 오류';
  }
}