import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const STT_SCHEMA = 'stt_poc';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = ['workers_compensation','employment_insurance','insurance_eligibility','premium_collection','wage_claims','welfare','certificate_general','institutional_operations','other'] as const;
const ISSUES = ['application_eligibility','required_documents','employer_confirmation','procedure','processing_time','reason_explanation','appeal','correction_change','retroactive_application','payment_benefit','other'] as const;

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['primary_category','issues','confidence','needs_review','rationale'],
  properties: {
    primary_category: { type: 'string', enum: CATEGORIES },
    issues: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string', enum: ISSUES } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    needs_review: { type: 'boolean' },
    rationale: { type: 'string', minLength: 1, maxLength: 1000 },
  },
} as const;

type OpenAIResponse = { error?: { message?: string } | null; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }> };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  try {
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const model = process.env.OPENAI_MODEL?.trim();
    if (!supabaseUrl || !serviceRoleKey || !apiKey || !model) throw new Error('필수 환경변수가 누락되었습니다.');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const sessionId = String(body.sessionId ?? '').trim();
    if (!UUID_PATTERN.test(sessionId)) return res.status(400).json({ error: 'sessionId는 올바른 UUID여야 합니다.' });

    const db = createClient(supabaseUrl, serviceRoleKey, { db: { schema: STT_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data: draft, error: draftError } = await db.from('drafts')
      .select('id,content,version_no')
      .eq('session_id', sessionId).eq('source_type','staff').eq('status','confirmed').eq('is_current',true)
      .order('version_no',{ascending:false}).limit(1).maybeSingle();
    if (draftError) throw draftError;
    if (!draft) return res.status(409).json({ error: '담당자 확정본이 있어야 분류할 수 있습니다.' });

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, store: false,
        instructions: [
          '당신은 근로복지공단 내부 담당자의 민원 라우팅 참고용 분류 도구입니다.',
          '제공된 담당자 확정본에만 근거해 업무영역 1개와 쟁점을 분류하세요.',
          '분류는 자동처분·자격판단·법률판단이 아니며 애매하면 needs_review=true로 표시하세요.',
          'confidence가 0.75 미만이면 needs_review=true로 하세요.',
          'rationale에는 분류 근거를 짧게 설명하되 새로운 사실을 만들지 마세요.'
        ].join('\n'),
        input: [{ role: 'user', content: [{ type: 'input_text', text: `[담당자 확정 민원 요지]\n${String(draft.content).slice(0,12000)}` }] }],
        text: { format: { type: 'json_schema', name: 'complaint_routing_classification', strict: true, schema: SCHEMA } },
      }),
    });
    const payload = await response.json() as OpenAIResponse;
    if (!response.ok) throw new Error(payload.error?.message || `OpenAI Responses API 오류: ${response.status}`);
    let output = '';
    for (const item of payload.output ?? []) for (const part of item.content ?? []) {
      if (part.type === 'refusal' && part.refusal) throw new Error(`AI 응답 거절: ${part.refusal}`);
      if (part.type === 'output_text' && part.text) output = part.text;
    }
    if (!output) throw new Error('분류 결과가 비어 있습니다.');
    const classified = JSON.parse(output) as { primary_category:string; issues:string[]; confidence:number; needs_review:boolean; rationale:string };
    const needsReview = Boolean(classified.needs_review || Number(classified.confidence) < 0.75);
    const { data: saved, error: saveError } = await db.rpc('save_complaint_classification', {
      p_session_id: sessionId,
      p_primary_category: classified.primary_category,
      p_issues: classified.issues,
      p_confidence: classified.confidence,
      p_needs_review: needsReview,
      p_rationale: classified.rationale,
      p_model_name: model,
      p_schema_version: 'complaint_classification_v1',
    });
    if (saveError) throw saveError;
    return res.status(200).json({ ok:true, sessionId, classification:saved });
  } catch (error) {
    console.error('[stt-classify] failed:', error);
    return res.status(500).json({ error:'민원 자동분류 실패', ...(process.env.VERCEL_ENV !== 'production' ? { detail: error instanceof Error ? error.message : String(error) } : {}) });
  }
}
