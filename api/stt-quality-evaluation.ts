import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const STT_SCHEMA = 'stt_poc';
const QUALITY_SCHEMA_VERSION = 'quality_evaluation_v1';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_RATINGS = new Set([
  'accurate',
  'minor_edit',
  'major_edit',
  'unusable',
]);

interface QualityEvaluationRequestBody {
  sessionId?: string;
  overallRating?: string;
  factOmission?: boolean;
  factDistortion?: boolean;
  hallucination?: boolean;
  requestOmission?: boolean;
  confirmationOmission?: boolean;
  sttErrorImpact?: boolean;
  otherIssue?: boolean;
  reviewerNote?: string;
  actor?: string;
}

interface DraftRow {
  id: string;
  content: string;
  source_type: string;
  status: string;
  is_current: boolean;
  version_no: number;
  updated_at: string | null;
  confirmed_at: string | null;
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
    const overallRating = body.overallRating?.trim() ?? '';
    const reviewerNote = body.reviewerNote?.trim() ?? '';
    const actor = 'staff';

    if (!UUID_PATTERN.test(sessionId)) {
      return res.status(400).json({ error: 'sessionId는 올바른 UUID여야 합니다.' });
    }
    if (!ALLOWED_RATINGS.has(overallRating)) {
      return res.status(400).json({ error: 'overallRating 값이 올바르지 않습니다.' });
    }
    if (reviewerNote.length > 2000) {
      return res.status(400).json({ error: '평가 메모는 2000자 이하여야 합니다.' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      db: { schema: STT_SCHEMA },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const { data: draftRows, error: draftError } = await supabase
      .from('drafts')
      .select('id, content, source_type, status, is_current, version_no, updated_at, confirmed_at')
      .eq('session_id', sessionId)
      .in('source_type', ['ai', 'staff'])
      .order('version_no', { ascending: true });

    if (draftError) throw draftError;

    const drafts = (draftRows ?? []) as DraftRow[];
    const aiDraft = [...drafts].reverse().find((draft) => draft.source_type === 'ai');
    const staffDraft = [...drafts]
      .reverse()
      .find(
        (draft) =>
          draft.source_type === 'staff' &&
          draft.status === 'confirmed' &&
          draft.is_current
      );

    if (!aiDraft) {
      return res.status(409).json({ error: '평가할 AI 정제본이 없습니다.' });
    }
    if (!staffDraft) {
      return res.status(409).json({ error: '담당자 확정본 이후에만 품질평가를 저장할 수 있습니다.' });
    }

    const aiContent = aiDraft.content ?? '';
    const staffContent = staffDraft.content ?? '';
    const editDistance = levenshteinDistance(aiContent, staffContent);
    const denominator = Math.max(aiContent.length, staffContent.length, 1);
    const editRatio = Number((editDistance / denominator).toFixed(6));
    const reviewDurationMs = calculateReviewDurationMs(aiDraft.updated_at, staffDraft.confirmed_at);

    const { data, error: rpcError } = await supabase.rpc('save_quality_evaluation', {
      p_session_id: sessionId,
      p_overall_rating: overallRating,
      p_fact_omission: Boolean(body.factOmission),
      p_fact_distortion: Boolean(body.factDistortion),
      p_hallucination: Boolean(body.hallucination),
      p_request_omission: Boolean(body.requestOmission),
      p_confirmation_omission: Boolean(body.confirmationOmission),
      p_stt_error_impact: Boolean(body.sttErrorImpact),
      p_other_issue: Boolean(body.otherIssue),
      p_reviewer_note: reviewerNote || null,
      p_edit_distance: editDistance,
      p_edit_ratio: editRatio,
      p_ai_char_count: aiContent.length,
      p_staff_char_count: staffContent.length,
      p_review_duration_ms: reviewDurationMs,
      p_model_name: process.env.OPENAI_MODEL?.trim() || null,
      p_schema_version: QUALITY_SCHEMA_VERSION,
      p_actor: actor,
    });

    if (rpcError) throw rpcError;

    return res.status(200).json({
      ok: true,
      sessionId,
      metrics: {
        editDistance,
        editRatio,
        aiCharCount: aiContent.length,
        staffCharCount: staffContent.length,
        reviewDurationMs,
        modelName: process.env.OPENAI_MODEL?.trim() || null,
        schemaVersion: QUALITY_SCHEMA_VERSION,
      },
      evaluation: data,
    });
  } catch (error) {
    console.error('[stt-quality-evaluation] failed:', error);
    return res.status(500).json({
      error: '품질평가 저장 실패',
      ...(process.env.VERCEL_ENV !== 'production'
        ? { detail: getErrorMessage(error) }
        : {}),
    });
  }
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = new Array<number>(right.length + 1);
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left.charCodeAt(leftIndex - 1) === right.charCodeAt(rightIndex - 1) ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }

    previous = current;
  }

  return previous[right.length];
}

function calculateReviewDurationMs(
  aiUpdatedAt: string | null,
  confirmedAt: string | null
): number | null {
  if (!aiUpdatedAt || !confirmedAt) return null;
  const startedAt = Date.parse(aiUpdatedAt);
  const endedAt = Date.parse(confirmedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return null;
  return Math.max(0, endedAt - startedAt);
}

function parseBody(rawBody: unknown): QualityEvaluationRequestBody {
  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody) as QualityEvaluationRequestBody;
    } catch {
      return {};
    }
  }
  return rawBody && typeof rawBody === 'object'
    ? (rawBody as QualityEvaluationRequestBody)
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
