import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const STT_SCHEMA = 'stt_poc';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ConfirmDraftRequestBody {
  sessionId?: string;
  actor?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('필수 환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    }

    const body = parseBody(req.body);
    const sessionId = body.sessionId?.trim() ?? '';
    const actor = body.actor?.trim() || 'staff';

    if (!UUID_PATTERN.test(sessionId)) {
      return res.status(400).json({ error: 'sessionId는 올바른 UUID여야 합니다.' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      db: { schema: STT_SCHEMA },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await supabase.rpc('confirm_current_draft', {
      p_session_id: sessionId,
      p_actor: actor,
    });
    if (error) throw error;

    return res.status(200).json({
      ok: true,
      sessionId,
      draft: data,
    });
  } catch (error) {
    console.error('[stt-draft-confirm] failed:', error);
    return res.status(500).json({
      error: '담당자 확정 처리 실패',
      ...(process.env.VERCEL_ENV !== 'production'
        ? { detail: getErrorMessage(error) }
        : {}),
    });
  }
}

function parseBody(rawBody: unknown): ConfirmDraftRequestBody {
  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody) as ConfirmDraftRequestBody;
    } catch {
      return {};
    }
  }
  return rawBody && typeof rawBody === 'object'
    ? (rawBody as ConfirmDraftRequestBody)
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
