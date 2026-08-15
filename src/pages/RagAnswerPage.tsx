import { useState } from 'react';
import './RagAnswerPage.css';

type Evidence = {
  chunkId:string; documentId:string; title:string; sourceLabel:string; sourceUrl:string|null; domain:string;
  excerpt:string; score:number; approvedAt:string|null; isTestFixture:boolean;
};
type RagResponse = {
  ok?:boolean; generated?:boolean; answer?:string; confidence?:number; evidence?:Evidence[];
  needsHumanReview?:boolean; reason?:string; mode?:string; error?:string; detail?:string;
};

export default function RagAnswerPage(){
  const [question,setQuestion] = useState('개인정보가 포함된 실제 민원 원문을 이 PoC에 입력해도 되나요?');
  const [result,setResult] = useState<RagResponse|null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState<string|null>(null);

  const ask = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const response = await fetch('/api/stt-rag-answer',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({question}) });
      const body = await response.json() as RagResponse;
      if(!response.ok) throw new Error([body.error,body.detail].filter(Boolean).join(' · ') || '답변 생성 실패');
      setResult(body);
    } catch(e){ setError(e instanceof Error ? e.message : String(e)); }
    finally{ setLoading(false); }
  };

  return <main className="rag-page">
    <header className="rag-header">
      <p className="rag-kicker">COMWEL AI STT PoC · v0.8.0</p>
      <h1>승인근거 기반 AI 답변</h1>
      <p>민원 질문과 관련된 <strong>승인된 근거</strong>를 먼저 찾고, 충분한 근거가 있을 때만 AI 답변 초안을 생성합니다.</p>
    </header>

    <section className="rag-warning">
      <strong>내부 시연용</strong> · 개인정보 및 실제 민원 원문 입력 금지 · 자동처분/자동발송 없음 · 담당자 최종확인 필수
    </section>

    <section className="rag-input-card">
      <label htmlFor="rag-question">민원 질문</label>
      <textarea id="rag-question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={3000} rows={6} />
      <div className="rag-actions">
        <button type="button" onClick={()=>setQuestion('개인정보가 포함된 실제 민원 원문을 이 PoC에 입력해도 되나요?')}>승인근거 일치 예시</button>
        <button type="button" onClick={()=>setQuestion('회사에서 이직사유를 자진퇴사로 신고했는데 제가 직접 권고사직으로 정정할 수 있나요?')}>근거 없음 예시</button>
        <button className="primary" type="button" disabled={loading || question.trim().length<2} onClick={()=>void ask()}>{loading?'근거 검색 중…':'승인근거 검색 후 답변'}</button>
      </div>
    </section>

    {error && <div className="rag-error">{error}</div>}
    {result && <section className="rag-result">
      <div className="rag-result-top">
        <h2>{result.generated ? 'AI 답변 초안' : '자동답변 보류'}</h2>
        <span className={result.generated?'badge generated':'badge fallback'}>{result.generated?'근거 기반 생성':'담당자 확인 필요'}</span>
      </div>
      <p className="rag-answer">{result.answer}</p>
      <div className="rag-meta">
        {typeof result.confidence==='number' && <span>신뢰도 {(result.confidence*100).toFixed(0)}%</span>}
        <span>{result.needsHumanReview ? '담당자 확인 필요' : '담당자 참고 가능'}</span>
        {result.mode && <span>{result.mode==='approved_fixture_only'?'승인 fixture 전용':'승인자료 모드'}</span>}
      </div>

      <h3>사용 근거</h3>
      {(result.evidence ?? []).length ? <div className="evidence-list">{(result.evidence ?? []).map((e,i)=><article className="evidence-card" key={e.chunkId}>
        <div className="evidence-title"><strong>근거 {i+1}. {e.title}</strong><span>관련성 {e.score}</span></div>
        <p>{e.excerpt}</p>
        <small>{e.sourceLabel} · {e.isTestFixture?'PoC 테스트 승인자료':'승인자료'}{e.approvedAt?` · 승인 ${new Date(e.approvedAt).toLocaleDateString('ko-KR')}`:''}</small>
      </article>)}</div> : <p className="evidence-empty">질문과 충분히 부합하는 승인 근거가 없습니다.</p>}
    </section>}
  </main>;
}
