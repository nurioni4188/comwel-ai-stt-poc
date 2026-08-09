import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const STT_SCHEMA = 'stt_poc';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUMMARY_DRAFT_TYPE = 'complaint_summary_extractive_v1';
const MAX_SUMMARY_LENGTH = 700;

interface SummaryRequestBody {
  sessionId?: string;
}

interface TranscriptChunkRow {
  chunk_index: number;
  transcript: string | null;
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

    const { data: session, error: sessionError } = await supabase
      .from('call_sessions')
      .select('id,status')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!session) {
      return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
    }
    if (session.status !== 'completed') {
      return res.status(409).json({
        error: '요지 생성 대기',
        detail: '녹음 종료와 세션 완료 처리 후 요지를 생성할 수 있습니다.',
      });
    }

    const { data: chunks, error: chunksError } = await supabase
      .from('transcript_chunks')
      .select('chunk_index,transcript')
      .eq('session_id', sessionId)
      .order('chunk_index', { ascending: true });

    if (chunksError) throw chunksError;

    const rows = (chunks ?? []) as TranscriptChunkRow[];
    const transcriptItems = rows
      .map((row) => normalizeText(row.transcript ?? ''))
      .filter(Boolean);

    if (transcriptItems.length === 0) {
      return res.status(422).json({
        error: '요지 생성 실패',
        detail: '인식된 통화 내용이 없습니다.',
      });
    }

    const summary = buildSourceBoundSummary(transcriptItems);
    const now = new Date().toISOString();

    const { data: existingDraft, error: existingError } = await supabase
      .from('drafts')
      .select('id')
      .eq('session_id', sessionId)
      .eq('draft_type', SUMMARY_DRAFT_TYPE)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingDraft) {
      const { error: updateError } = await supabase
        .from('drafts')
        .update({ content: summary, updated_at: now })
        .eq('id', existingDraft.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase.from('drafts').insert({
        session_id: sessionId,
        draft_type: SUMMARY_DRAFT_TYPE,
        content: summary,
        updated_at: now,
      });
      if (insertError) throw insertError;
    }

    return res.status(200).json({
      ok: true,
      sessionId,
      mode: 'extractive_v1',
      summary,
      sourceChunkCount: transcriptItems.length,
    });
  } catch (error) {
    const detail = getErrorMessage(error);
    console.error('[stt-summary] failed:', error);

    return res.status(500).json({
      error: '민원 요지 생성 실패',
      ...(process.env.VERCEL_ENV !== 'production' ? { detail } : {}),
    });
  }
}

function buildSourceBoundSummary(items: string[]): string {
  const requestKeywords = [
    '요청',
    '문의',
    '확인',
    '처리',
    '신청',
    '불편',
    '보험',
    '산재',
    '보상',
    '민원',
    '어떻게',
    '왜',
    '언제',
  ];

  const scored = items.map((text, index) => ({
    text,
    index,
    score: requestKeywords.reduce(
      (total, keyword) => total + (text.includes(keyword) ? 1 : 0),
      0
    ),
  }));

  const selected = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .sort((a, b) => a.index - b.index);

  const fallback = scored.slice(0, Math.min(3, scored.length));
  const source = selected.length > 0 ? selected : fallback;
  const combined = source.map((item) => item.text).join(' ');

  return truncateAtWordBoundary(combined, MAX_SUMMARY_LENGTH);
}

function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;

  const clipped = value.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(' ');
  const safeEnd = lastSpace >= Math.floor(maxLength * 0.7) ? lastSpace : maxLength;
  return `${clipped.slice(0, safeEnd).trim()}…`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseBody(rawBody: unknown): SummaryRequestBody {
  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody) as SummaryRequestBody;
    } catch {
      return {};
    }
  }

  return rawBody && typeof rawBody === 'object'
    ? (rawBody as SummaryRequestBody)
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
