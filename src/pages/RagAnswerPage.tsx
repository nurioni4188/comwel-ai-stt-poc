import { useState } from 'react';
import './RagAnswerPage.css';

type Evidence={chunkId:string;documentId:string;title:string;sourceLabel:string;sourceUrl:string|null;domain:string;excerpt:string;score:number;approvedAt:string|null;isTestFixture:boolean};
type RagResponse={ok?:boolean;generated?:boolean;answer?:string;confidence?:number;evidence?:Evidence[];needsHumanReview?:boolean;reason?:string;mode?:string;contextTurns?:number;error?:string;detail?:string};
type Turn={role:'user'|'assistant';content:string;generated?:boolean;evidence?:Evidence[];confidence?:number;needsHumanReview?:boolean};

export default function RagAnswerPage(){
  const [question,setQuestion]=useState('개인정보가 포함된 실제 민원 원문을 이 PoC에 입력해도 되나요?');
  const [turns,setTurns]=useState<Turn[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);

  const ask=async()=>{
    const trimmed=question.trim(); if(trimmed.length<2)return;
    setLoading(true);setError(null);
    try{
      const history=turns.slice(-6).map(({role,content})=>({role,content}));
      const response=await fetch('/api/stt-rag-answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:trimmed,history})});
      const body=await response.json() as RagResponse;
      if(!response.ok)throw new Error([body.error,body.detail].filter(Boolean).join(' · ')||'답변 생성 실패');
      setTurns(prev=>[...prev,{role:'user',content:trimmed},{role:'assistant',content:body.answer??'',generated:body.generated,evidence:body.evidence??[],confidence:body.confidence,needsHumanReview:body.needsHumanReview}].slice(-12));
      setQuestion('');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setLoading(false);}
  };

  return <main className="rag-page">
    <header className="rag-header"><p className="rag-kicker">COMWEL AI STT PoC · v0.9.0</p><h1>다회차 승인근거 AI 상담</h1><p>최근 대화맥락을 이어가되, <strong>승인된 근거</strong>가 있을 때만 답변합니다. 대화 원문은 브라우저 세션에서만 유지합니다.</p></header>
    <section className="rag-warning"><strong>내부 시연용</strong> · 개인정보 및 실제 민원 원문 입력 금지 · 자동처분/자동발송 없음 · 담당자 최종확인 필수</section>

    {turns.length>0&&<section className="rag-result"><div className="rag-result-top"><h2>대화</h2><button type="button" onClick={()=>setTurns([])}>대화 초기화</button></div><div className="evidence-list">{turns.map((turn,i)=><article className="evidence-card" key={`${turn.role}-${i}`}><strong>{turn.role==='user'?'민원인':'AI'}</strong><p>{turn.content}</p>{turn.role==='assistant'&&<small>{turn.generated?'승인근거 기반 답변':'자동답변 보류'}{typeof turn.confidence==='number'?` · 신뢰도 ${(turn.confidence*100).toFixed(0)}%`:''}{turn.needsHumanReview?' · 담당자 확인 필요':''}</small>}{turn.role==='assistant'&&(turn.evidence?.length??0)>0&&<details><summary>사용 근거 {turn.evidence?.length}건</summary>{turn.evidence?.map((e,j)=><p key={e.chunkId}><strong>근거 {j+1}. {e.title}</strong><br/>{e.excerpt}</p>)}</details>}</article>)}</div></section>}

    <section className="rag-input-card"><label htmlFor="rag-question">다음 민원 질문</label><textarea id="rag-question" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={3000} rows={5} placeholder="이전 대화에 이어 질문하세요."/><div className="rag-actions"><button type="button" onClick={()=>setQuestion('개인정보가 포함된 실제 민원 원문을 이 PoC에 입력해도 되나요?')}>첫 질문 예시</button><button type="button" onClick={()=>setQuestion('그럼 주민등록번호가 들어간 내용도 입력하면 안 되나요?')}>후속 질문 예시</button><button type="button" onClick={()=>setQuestion('회사에서 이직사유를 자진퇴사로 신고했는데 제가 직접 권고사직으로 정정할 수 있나요?')}>근거 없음 예시</button><button className="primary" type="button" disabled={loading||question.trim().length<2} onClick={()=>void ask()}>{loading?'근거 검색 중…':'대화 이어서 답변'}</button></div></section>
    {error&&<div className="rag-error">{error}</div>}
  </main>;
}
