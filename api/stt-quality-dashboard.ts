import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const STT_SCHEMA = 'stt_poc';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).json({ error:'Method not allowed' }); }
  try {
    const supabaseUrl = process.env.SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !serviceRoleKey) {
      const missing = [!supabaseUrl ? 'SUPABASE_URL' : null, !serviceRoleKey ? 'SUPABASE_SERVICE_ROLE_KEY' : null].filter(Boolean).join(', ');
      throw new Error(`필수 환경변수 누락: ${missing}`);
    }
    const db = createClient(supabaseUrl, serviceRoleKey, { db:{ schema:STT_SCHEMA }, auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } });

    const [
      { data:evaluations, error:e1 },
      { data:classifications, error:e2 },
      { data:staffDrafts, error:e3 },
      { data:reviews, error:e4 },
      { data:reviewEvents, error:e5 },
    ] = await Promise.all([
      db.from('draft_evaluations').select('session_id,overall_rating,fact_omission,fact_distortion,hallucination,request_omission,confirmation_omission,stt_error_impact,other_issue,edit_ratio,review_duration_ms,model_name,evaluated_at').order('evaluated_at',{ascending:false}),
      db.from('complaint_classifications').select('id,session_id,primary_category,issues,confidence,needs_review,rationale,classified_at').order('classified_at',{ascending:false}),
      db.from('drafts').select('session_id,content,confirmed_at').eq('source_type','staff').eq('status','confirmed').eq('is_current',true).order('confirmed_at',{ascending:false}).limit(30),
      db.from('classification_reviews').select('id,session_id,ai_classification_id,confirmed_category,confirmed_issues,decision,reviewer_note,category_match,issues_exact_match,reviewed_at').order('reviewed_at',{ascending:false}),
      db.from('classification_review_events').select('session_id,event_type,created_at').order('created_at',{ascending:false}).limit(500),
    ]);
    if (e1) throw new Error(`draft_evaluations 조회 실패: ${e1.message}`);
    if (e2) throw new Error(`complaint_classifications 조회 실패: ${e2.message}`);
    if (e3) throw new Error(`drafts 조회 실패: ${e3.message}`);
    if (e4) throw new Error(`classification_reviews 조회 실패: ${e4.message}`);
    if (e5) throw new Error(`classification_review_events 조회 실패: ${e5.message}`);

    const evals = evaluations ?? [];
    const classes = classifications ?? [];
    const reviewRows = reviews ?? [];
    const avg = (values:number[]) => values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;
    const ratings: Record<string,number> = { accurate:0, minor_edit:0, major_edit:0, unusable:0 };
    const issues: Record<string,number> = { fact_omission:0,fact_distortion:0,hallucination:0,request_omission:0,confirmation_omission:0,stt_error_impact:0,other_issue:0 };
    for (const row of evals as any[]) {
      ratings[row.overall_rating] = (ratings[row.overall_rating] ?? 0)+1;
      for (const key of Object.keys(issues)) if (row[key]) issues[key]++;
    }
    const categories: Record<string,number> = {};
    for (const row of classes as any[]) categories[row.primary_category] = (categories[row.primary_category] ?? 0)+1;
    const classMap = new Map((classes as any[]).map((row)=>[row.session_id,row]));
    const reviewMap = new Map((reviewRows as any[]).map((row)=>[row.session_id,row]));
    const recent = (staffDrafts ?? []).map((draft:any)=>({
      sessionId:draft.session_id,
      summary:String(draft.content ?? '').slice(0,240),
      confirmedAt:draft.confirmed_at,
      classification:classMap.get(draft.session_id) ?? null,
      review:reviewMap.get(draft.session_id) ?? null,
    }));

    const reviewedCount = reviewRows.length;
    const categoryMatches = (reviewRows as any[]).filter(r=>r.category_match).length;
    const exactMatches = (reviewRows as any[]).filter(r=>r.category_match && r.issues_exact_match).length;
    const correctedCount = (reviewRows as any[]).filter(r=>r.decision==='corrected').length;

    return res.status(200).json({
      ok:true,
      summary:{
        evaluationCount:evals.length,
        classificationCount:classes.length,
        averageEditRatio:avg((evals as any[]).map(r=>Number(r.edit_ratio ?? 0))),
        averageReviewDurationMs:avg((evals as any[]).map(r=>Number(r.review_duration_ms ?? 0)).filter(Number.isFinite)),
        needsReviewCount:(classes as any[]).filter(r=>r.needs_review).length,
        classificationReviewCount:reviewedCount,
        categoryAccuracy:reviewedCount ? categoryMatches/reviewedCount : 0,
        exactAccuracy:reviewedCount ? exactMatches/reviewedCount : 0,
        correctedCount,
        reviewEventCount:(reviewEvents ?? []).length,
      },
      ratings, issues, categories, recent,
      note: Math.max(evals.length, reviewedCount) < 30 ? '표본이 30건 미만이므로 현황 확인용 지표입니다.' : null,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[stt-quality-dashboard] failed:', error);
    return res.status(500).json({
      error:'품질 대시보드 조회 실패',
      ...(process.env.VERCEL_ENV !== 'production' ? { detail } : {}),
    });
  }
}
