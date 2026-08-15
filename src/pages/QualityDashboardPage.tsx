import { useEffect, useState } from 'react';
import './QualityDashboardPage.css';

type Classification = {
  primary_category:string;
  issues:string[];
  confidence:number;
  needs_review:boolean;
  rationale:string|null;
};
type Review = {
  confirmed_category:string;
  confirmed_issues:string[];
  decision:'accepted'|'corrected';
  reviewer_note:string|null;
  category_match:boolean;
  issues_exact_match:boolean;
  reviewed_at:string;
};
type DashboardResponse = {
  ok?: boolean;
  summary?: {
    evaluationCount:number;
    classificationCount:number;
    averageEditRatio:number;
    averageReviewDurationMs:number;
    needsReviewCount:number;
    classificationReviewCount:number;
    categoryAccuracy:number;
    exactAccuracy:number;
    correctedCount:number;
    reviewEventCount:number;
  };
  ratings?:Record<string,number>;
  issues?:Record<string,number>;
  categories?:Record<string,number>;
  recent?:Array<{
    sessionId:string;
    summary:string;
    confirmedAt:string|null;
    classification:Classification|null;
    review:Review|null;
  }>;
  note?:string|null;
  error?:string;
  detail?:string;
};

const ratingLabel:Record<string,string>={accurate:'정확',minor_edit:'경미한 수정',major_edit:'상당한 수정',unusable:'사용 불가'};
const categoryLabel:Record<string,string>={
  workers_compensation:'산재보험',employment_insurance:'고용보험',insurance_eligibility:'보험가입·자격',premium_collection:'보험료·징수',
  wage_claims:'임금채권',welfare:'복지',certificate_general:'증명·일반민원',institutional_operations:'기관운영',other:'기타',
};
const issueLabel:Record<string,string>={
  application_eligibility:'신청·자격',required_documents:'필요서류',employer_confirmation:'사업주 확인',procedure:'절차',processing_time:'처리기간',
  reason_explanation:'사유 설명',appeal:'불복·이의',correction_change:'정정·변경',retroactive_application:'소급 적용',payment_benefit:'지급·급여',other:'기타',
};
const categoryKeys=Object.keys(categoryLabel);
const issueKeys=Object.keys(issueLabel);

type EditorState={category:string;issues:string[];note:string};

export default function QualityDashboardPage(){
  const [data,setData]=useState<DashboardResponse|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [classifying,setClassifying]=useState<string|null>(null);
  const [reviewing,setReviewing]=useState<string|null>(null);
  const [editors,setEditors]=useState<Record<string,EditorState>>({});

  const load=async()=>{
    setLoading(true);setError(null);
    try{
      const response=await fetch('/api/stt-quality-dashboard');
      const result=await response.json() as DashboardResponse;
      if(!response.ok)throw new Error([result.error,result.detail].filter(Boolean).join(' · ')||'대시보드 조회 실패');
      setData(result);
      const next:Record<string,EditorState>={};
      for(const row of result.recent??[]){
        if(!row.classification)continue;
        next[row.sessionId]={
          category:row.review?.confirmed_category??row.classification.primary_category,
          issues:row.review?.confirmed_issues??row.classification.issues??[],
          note:row.review?.reviewer_note??'',
        };
      }
      setEditors(next);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setLoading(false);}
  };

  useEffect(()=>{void load();},[]);

  const classify=async(sessionId:string)=>{
    setClassifying(sessionId);setError(null);
    try{
      const response=await fetch('/api/stt-classify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId})});
      const result=await response.json() as {error?:string;detail?:string};
      if(!response.ok)throw new Error([result.error,result.detail].filter(Boolean).join(' · ')||'자동분류 실패');
      await load();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setClassifying(null);}
  };

  const saveReview=async(sessionId:string)=>{
    const editor=editors[sessionId];
    if(!editor)return;
    setReviewing(sessionId);setError(null);
    try{
      const response=await fetch('/api/stt-classification-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        sessionId,confirmedCategory:editor.category,confirmedIssues:editor.issues,reviewerNote:editor.note,
      })});
      const result=await response.json() as {error?:string;detail?:string};
      if(!response.ok)throw new Error([result.error,result.detail].filter(Boolean).join(' · ')||'담당자 분류 확정 실패');
      await load();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setReviewing(null);}
  };

  const updateEditor=(sessionId:string,patch:Partial<EditorState>)=>setEditors(prev=>({...prev,[sessionId]:{...(prev[sessionId]??{category:'other',issues:[],note:''}),...patch}}));
  const toggleIssue=(sessionId:string,key:string)=>{
    const current=editors[sessionId]??{category:'other',issues:[],note:''};
    const issues=current.issues.includes(key)?current.issues.filter(v=>v!==key):[...current.issues,key];
    updateEditor(sessionId,{issues});
  };

  if(loading&&!data)return <main className="dashboard-page"><p>품질 대시보드를 불러오는 중입니다…</p></main>;
  const summary=data?.summary;
  return <main className="dashboard-page">
    <header className="dashboard-header">
      <p className="dashboard-kicker">COMWEL AI STT PoC · v0.7.0</p>
      <h1>품질평가 · 민원분류 검증 대시보드</h1>
      <p>AI 참고분류를 담당자가 검토·정정·확정하고 실제 분류 정확도를 축적합니다. 자동처분·자격판단은 하지 않습니다.</p>
    </header>
    {error&&<div className="dashboard-error">{error}</div>}
    {data?.note&&<div className="dashboard-note">{data.note}</div>}

    <section className="metric-grid v07">
      <Metric title="AI 분류" value={summary?.classificationCount??0}/>
      <Metric title="담당자 검토" value={summary?.classificationReviewCount??0}/>
      <Metric title="업무영역 정확도" value={`${((summary?.categoryAccuracy??0)*100).toFixed(1)}%`}/>
      <Metric title="완전 일치율" value={`${((summary?.exactAccuracy??0)*100).toFixed(1)}%`}/>
      <Metric title="담당자 정정" value={summary?.correctedCount??0}/>
      <Metric title="감사 이벤트" value={summary?.reviewEventCount??0}/>
    </section>

    <section className="dashboard-grid">
      <Breakdown title="전체 평가 분포" data={data?.ratings??{}} labels={ratingLabel}/>
      <Breakdown title="AI 업무영역 분포" data={data?.categories??{}} labels={categoryLabel} empty="아직 자동분류 데이터가 없습니다."/>
    </section>

    <section className="recent-section">
      <div className="recent-heading"><h2>최근 담당자 확정 세션</h2><button onClick={()=>void load()} disabled={loading}>새로고침</button></div>
      <div className="recent-list">
        {(data?.recent??[]).map(row=>{
          const editor=editors[row.sessionId];
          return <article className="recent-card" key={row.sessionId}>
            <div className="recent-top"><code>{row.sessionId.slice(0,8)}</code><span>{formatDate(row.confirmedAt)}</span></div>
            <p>{row.summary||'(확정 요지 없음)'}</p>
            {row.classification?<>
              <div className="classification-result">
                <strong>AI: {categoryLabel[row.classification.primary_category]??row.classification.primary_category}</strong>
                <span>신뢰도 {(Number(row.classification.confidence)*100).toFixed(0)}%</span>
                <span>{row.classification.needs_review?'담당자 검토 필요':'참고 분류 완료'}</span>
                {row.classification.rationale&&<small>{row.classification.rationale}</small>}
              </div>
              <div className="review-editor">
                <div className="review-title-row"><strong>담당자 확정 분류</strong>{row.review&&<span className={row.review.decision==='accepted'?'review-ok':'review-corrected'}>{row.review.decision==='accepted'?'AI 일치':'담당자 정정'}</span>}</div>
                <label>업무영역<select value={editor?.category??row.classification.primary_category} onChange={e=>updateEditor(row.sessionId,{category:e.target.value})}>{categoryKeys.map(k=><option key={k} value={k}>{categoryLabel[k]}</option>)}</select></label>
                <div className="issue-picker"><span>쟁점</span><div>{issueKeys.map(k=><label key={k}><input type="checkbox" checked={Boolean(editor?.issues.includes(k))} onChange={()=>toggleIssue(row.sessionId,k)}/>{issueLabel[k]}</label>)}</div></div>
                <label>담당자 메모<textarea value={editor?.note??''} onChange={e=>updateEditor(row.sessionId,{note:e.target.value})} placeholder="AI 분류를 그대로 확정하거나 정정한 이유를 기록합니다."/></label>
                <button className="review-save-button" onClick={()=>void saveReview(row.sessionId)} disabled={reviewing===row.sessionId}>{reviewing===row.sessionId?'저장 중…':row.review?'분류 검토 갱신':'담당자 분류 확정'}</button>
                {row.review&&<small className="review-meta">업무영역 {row.review.category_match?'일치':'불일치'} · 쟁점 {row.review.issues_exact_match?'일치':'불일치'} · {formatDate(row.review.reviewed_at)}</small>}
              </div>
            </>:<div className="classification-empty">아직 자동분류하지 않았습니다.</div>}
            <button className="classify-button" onClick={()=>void classify(row.sessionId)} disabled={classifying===row.sessionId}>{classifying===row.sessionId?'분류 중…':row.classification?'다시 분류':'AI 참고분류 실행'}</button>
          </article>;
        })}
      </div>
    </section>
  </main>;
}

function Metric({title,value}:{title:string;value:string|number}){return <div className="metric-card"><span>{title}</span><strong>{value}</strong></div>;}
function Breakdown({title,data,labels,empty}:{title:string;data:Record<string,number>;labels:Record<string,string>;empty?:string}){
  const entries=Object.entries(data).filter(([,v])=>v>0);
  return <section className="breakdown-card"><h2>{title}</h2>{entries.length?<ul>{entries.map(([k,v])=><li key={k}><span>{labels[k]??k}</span><strong>{v}</strong></li>)}</ul>:<p>{empty??'데이터가 없습니다.'}</p>}</section>;
}
function formatDate(value:string|null){if(!value)return '-';const d=new Date(value);return Number.isNaN(d.getTime())?'-':d.toLocaleString('ko-KR');}
