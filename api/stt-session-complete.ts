import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const STT_SCHEMA = 'stt_poc';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CompleteRequestBody {
  sessionId?: string;
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
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        '필수 환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY'
      );
    }

    const body = parseBody(req.body);
    const sessionId = body.sessionId?.trim() ?? '';

    if (!UUID_PATTERN.test(sessionId)) {
      return res.status(400).json({
        error: '요청 처리 실패',
        detail: 'sessionId는 올바른 UUID여야 합니다.',
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      db: { schema: STT_SCHEMA },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await supabase
      .from('call_sessions')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .select('id')
      .maybeSingle();

    if (error) {
      throw new Error(
        [
          'call_sessions 완료 처리 실패',
          error.message,
          error.code ? `code=${error.code}` : undefined,
          error.details ? `details=${error.details}` : undefined,
          error.hint ? `hint=${error.hint}` : undefined,
        ]
          .filter(Boolean)
          .join(' | ')
      );
    }

    if (!data) {
      return res.status(404).json({
        error: '세션을 찾을 수 없습니다.',
        ...(process.env.VERCEL_ENV !== 'production'
          ? { detail: `sessionId=${sessionId}` }
          : {}),
      });
    }

    return res.status(200).json({ ok: true, sessionId });
  } catch (error) {
    const detail = getErrorMessage(error);
    console.error('[stt-session-complete] failed:', error);

    return res.status(500).json({
      error: '세션 완료 처리 실패',
      ...(process.env.VERCEL_ENV !== 'production' ? { detail } : {}),
    });
  }
}

function parseBody(rawBody: unknown): CompleteRequestBody {
  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody) as CompleteRequestBody;
    } catch {
      return {};
    }
  }

  return rawBody && typeof rawBody === 'object'
    ? (rawBody as CompleteRequestBody)
    : {};
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
