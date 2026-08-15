import { useEffect, useState } from 'react';
import './QualityDashboardPage.css';

type DashboardResponse = {
  ok?: boolean;
  summary?: {
    evaluationCount: number;
    classificationCount: number;
    averageEditRatio: number;
    averageReviewDurationMs: number;
    needsReviewCount: number;
  };
  ratings?: Record<string, number>;
  issues?: Record<string, number>;
  categories?: Record<string, number>;
  recent?: Array<{
    sessionId: string;
    summary: string;
    confirmedAt: string | null;
    classification: null | {
      primary_category: string;
      issues: string[];
      confidence: number;
      needs_review: boolean;
      rationale: string | null;
    };
  }>;
  note?: string | null;
  error?: string;
};

const ratingLabel: Record<string,string> = { accurate:'정확', minor_edit:'경미한 수정', major_edit:'상당한 수정', unusable:'사용 불가' };
const categoryLabel: Record<string,string> = {
  workers_compensation:'산재보험', employment_insurance:'고용보험', insurance_eligibility:'보험가입·자격', premium_collection:'보험료·징수',
  wage_claims:'임금채권', welfare:'복지', certificate_general:'증명·일반민원', institutional_operations:'기관운영', other:'기타',
};

export default function QualityDashboardPage() {
  const [data,setData] = useState<DashboardResponse | null>(null);
  const [error,setError] = useState<string | null>(null);
  const [loading,setLoading] = useState(true);
  const [classifying,setClassifying] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/stt-quality-dashboard');
      const result = await response.json() as DashboardResponse;
      if (!response.ok) throw new Error(result.error || '대시보드 조회 실패');
      setData(result);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  useEffect(()=>{ void load(); },[]);

  const classify = async (sessionId:string) => {
    setClassifying(sessionId); setError(null);
    try {
      const response = await fetch('/api/stt-classify',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sessionId}) });
      const result = await response.json() as { error?:string };
      if (!response.ok) throw new Error(result.error || '자동분류 실패');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setClassifying(null); }
  };

  if (loading && !data) return <main className="dashboard-page"><p>품질 대시보드를 불러오는 중입니다…</p></main>;

  const summary = data?.summary;
  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <p className="dashboard-kicker">COMWEL AI STT PoC · v0.6.0</p>
        <h1>품질평가 · 민원분류 대시보드</h1>
        <p>품질평가 데이터와 담당자 확정본의 업무 라우팅 참고 분류를 확인합니다. 자동처분·자격판단은 하지 않습니다.</p>
      </header>

      {error && <div className="dashboard-error">{error}</div>}
      {data?.note && <div className="dashboard-note">{data.note}</div>}

      <section className="metric-grid">
        <Metric title="평가 건수" value={summary?.evaluationCount ?? 0} />
        <Metric title="분류 건수" value={summary?.classificationCount ?? 0} />
        <Metric title="평균 수정률" value={`${((summary?.averageEditRatio ?? 0)*100).toFixed(2)}%`} />
        <Metric title="평균 검토시간" value={`${((summary?.averageReviewDurationMs ?? 0)/1000).toFixed(1)}초`} />
        <Metric title="분류 검토필요" value={summary?.needsReviewCount ?? 0} />
      </section>

      <section className="dashboard-grid">
        <Breakdown title="전체 평가 분포" data={data?.ratings ?? {}} labels={ratingLabel} />
        <Breakdown title="민원 업무영역 분포" data={data?.categories ?? {}} labels={categoryLabel} empty="아직 자동분류 데이터가 없습니다." />
      </section>

      <section className="recent-section">
        <div className="recent-heading"><h2>최근 담당자 확정 세션</h2><button onClick={()=>void load()} disabled={loading}>새로고침</button></div>
        <div className="recent-list">
          {(data?.recent ?? []).map(row => (
            <article className="recent-card" key={row.sessionId}>
              <div className="recent-top"><code>{row.sessionId.slice(0,8)}</code><span>{formatDate(row.confirmedAt)}</span></div>
              <p>{row.summary || '(확정 요지 없음)'}</p>
              {row.classification ? (
                <div className="classification-result">
                  <strong>{categoryLabel[row.classification.primary_category] ?? row.classification.primary_category}</strong>
                  <span>신뢰도 {(Number(row.classification.confidence)*100).toFixed(0)}%</span>
                  <span>{row.classification.needs_review ? '담당자 검토 필요' : '참고 분류 완료'}</span>
                  {row.classification.rationale && <small>{row.classification.rationale}</small>}
                </div>
              ) : <div className="classification-empty">아직 자동분류하지 않았습니다.</div>}
              <button className="classify-button" onClick={()=>void classify(row.sessionId)} disabled={classifying===row.sessionId}>
                {classifying===row.sessionId ? '분류 중…' : row.classification ? '다시 분류' : 'AI 참고분류 실행'}
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function Metric({title,value}:{title:string;value:string|number}) { return <div className="metric-card"><span>{title}</span><strong>{value}</strong></div>; }
function Breakdown({title,data,labels,empty}:{title:string;data:Record<string,number>;labels:Record<string,string>;empty?:string}) {
  const entries = Object.entries(data).filter(([,v])=>v>0);
  return <section className="breakdown-card"><h2>{title}</h2>{entries.length ? <ul>{entries.map(([k,v])=><li key={k}><span>{labels[k] ?? k}</span><strong>{v}</strong></li>)}</ul> : <p>{empty ?? '데이터가 없습니다.'}</p>}</section>;
}
function formatDate(value:string|null){ if(!value) return '-'; const d=new Date(value); return Number.isNaN(d.getTime())?'-':d.toLocaleString('ko-KR'); }
