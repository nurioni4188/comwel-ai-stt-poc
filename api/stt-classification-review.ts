import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const STT_SCHEMA = 'stt_poc';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set(['workers_compensation','employment_insurance','insurance_eligibility','premium_collection','wage_claims','welfare','certificate_general','institutional_operations','other']);
const ISSUES = new Set(['application_eligibility','required_documents','employer_confirmation','procedure','processing_time','reason_explanation','appeal','correction_change','retroactive_application','payment_benefit','other']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({ error:'Method not allowed' }); }
  try {
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !serviceRoleKey) throw new Error('필수 환경변수가 누락되었습니다.');

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const sessionId = String(body.sessionId ?? '').trim();
    const confirmedCategory = String(body.confirmedCategory ?? '').trim();
    const reviewerNote = String(body.reviewerNote ?? '').trim();
    const rawIssues = Array.isArray(body.confirmedIssues) ? body.confirmedIssues.map(String) : [];
    const confirmedIssues = [...new Set(rawIssues.filter((v) => ISSUES.has(v)))];

    if (!UUID_PATTERN.test(sessionId)) return res.status(400).json({ error:'sessionId는 올바른 UUID여야 합니다.' });
    if (!CATEGORIES.has(confirmedCategory)) return res.status(400).json({ error:'담당자 확정 업무영역이 올바르지 않습니다.' });
    if (reviewerNote.length > 2000) return res.status(400).json({ error:'담당자 메모는 2000자 이하여야 합니다.' });

    const db = createClient(supabaseUrl, serviceRoleKey, { db:{ schema:STT_SCHEMA }, auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } });
    const { data, error } = await db.rpc('save_classification_review', {
      p_session_id: sessionId,
      p_confirmed_category: confirmedCategory,
      p_confirmed_issues: confirmedIssues,
      p_reviewer_note: reviewerNote || null,
    });
    if (error) throw error;

    return res.status(200).json({ ok:true, review:data });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[stt-classification-review] failed:', error);
    return res.status(500).json({ error:'분류 담당자 검토 저장 실패', ...(process.env.VERCEL_ENV !== 'production' ? { detail } : {}) });
  }
}
