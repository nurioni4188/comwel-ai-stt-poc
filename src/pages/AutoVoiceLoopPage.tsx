import { useCallback, useEffect, useRef, useState } from 'react';
import { useCallRecorder } from '../hooks/useCallRecorder';
import './RagAnswerPage.css';

type Evidence={chunkId:string;documentId:string;title:string;sourceLabel:string;sourceUrl:string|null;domain:string;excerpt:string;score:number;approvedAt:string|null;isTestFixture:boolean};
type RagResponse={ok?:boolean;generated?:boolean;answer?:string;confidence?:number;evidence?:Evidence[];needsHumanReview?:boolean;reason?:string;mode?:string;contextTurns?:number;error?:string;detail?:string};
type Turn={role:'user'|'assistant';content:string;generated?:boolean;evidence?:Evidence[];confidence?:number;needsHumanReview?:boolean};
type Phase='idle'|'listening'|'transcribing'|'thinking'|'speaking'|'paused'|'error';

const LISTEN_WINDOW_MS=8000;
const MAX_LOW_QUALITY_RETRIES=3;

function isLowQualityTranscript(value:string){
  const compact=value.replace(/[^가-힣a-zA-Z0-9]/g,'').toLowerCase();
  if(compact.length<4)return true;
  const fillerOnly=/^(으+|어+|음+|아+|허+|하+|흠+|응+|네+|예+)+$/.test(compact);
  if(fillerOnly)return true;
  const chars=[...compact];
  const unique=new Set(chars);
  if(compact.length<=10&&unique.size<=2)return true;
  const repeated=chars.filter((ch,i)=>i>0&&ch===chars[i-1]).length;
  return compact.length<=12&&repeated>=Math.max(2,Math.floor(compact.length*0.5));
}

export default function AutoVoiceLoopPage(){
  const {isRecording,isSending,error:sttError,cumulativeText,startRecording,stopRecording,resetRecording}=useCallRecorder();
  const [running,setRunning]=useState(false);
  const [phase,setPhase]=useState<Phase>('idle');
  const [turns,setTurns]=useState<Turn[]>([]);
  const [message,setMessage]=useState('자동 상담 시작을 누른 뒤 한 문장씩 말씀해 주세요.');
  const [error,setError]=useState<string|null>(null);
  const [secondsLeft,setSecondsLeft]=useState(8);
  const timerRef=useRef<number|null>(null);
  const countdownRef=useRef<number|null>(null);
  const processingRef=useRef(false);
  const utteranceRef=useRef<SpeechSynthesisUtterance|null>(null);
  const turnsRef=useRef<Turn[]>([]);
  const stopRecordingRef=useRef(stopRecording);
  const runningRef=useRef(false);
  const lowQualityRetriesRef=useRef(0);

  useEffect(()=>{turnsRef.current=turns;},[turns]);
  useEffect(()=>{stopRecordingRef.current=stopRecording;},[stopRecording]);
  useEffect(()=>{runningRef.current=running;},[running]);
  useEffect(()=>()=>{clearTimers(); if('speechSynthesis' in window)window.speechSynthesis.cancel();},[]);

  const clearTimers=()=>{
    if(timerRef.current!==null){window.clearTimeout(timerRef.current);timerRef.current=null;}
    if(countdownRef.current!==null){window.clearInterval(countdownRef.current);countdownRef.current=null;}
  };

  const beginListening=useCallback(async()=>{
    if(!runningRef.current)return;
    clearTimers();
    processingRef.current=false;
    setError(null);
    setSecondsLeft(8);
    setPhase('listening');
    setMessage('듣고 있습니다. 8초 안에 질문을 말씀해 주세요.');
    resetRecording();
    await startRecording();

    const startedAt=Date.now();
    countdownRef.current=window.setInterval(()=>{
      const elapsed=Date.now()-startedAt;
      setSecondsLeft(Math.max(0,Math.ceil((LISTEN_WINDOW_MS-elapsed)/1000)));
    },250);

    timerRef.current=window.setTimeout(async()=>{
      clearTimers();
      if(!runningRef.current)return;
      setPhase('transcribing');
      setMessage('발화를 종료하고 STT 결과를 확인하고 있습니다.');
      await stopRecordingRef.current();
    },LISTEN_WINDOW_MS);
  },[resetRecording,startRecording]);

  const stopLoop=useCallback((nextMessage='자동 상담을 중지했습니다.')=>{
    runningRef.current=false;
    setRunning(false);
    clearTimers();
    if('speechSynthesis' in window)window.speechSynthesis.cancel();
    utteranceRef.current=null;
    if(isRecording)void stopRecordingRef.current();
    setPhase('paused');
    setMessage(nextMessage);
  },[isRecording]);

  const speakAndContinue=useCallback((text:string)=>{
    if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined'){
      stopLoop('이 브라우저는 음성 읽기를 지원하지 않아 자동 상담을 중지했습니다.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(text);
    const voices=window.speechSynthesis.getVoices();
    const koreanVoice=voices.find(voice=>voice.lang.toLowerCase().startsWith('ko'));
    if(koreanVoice)utterance.voice=koreanVoice;
    utterance.lang='ko-KR';utterance.rate=1;utterance.pitch=1;utterance.volume=1;
    utterance.onstart=()=>{setPhase('speaking');setMessage('AI가 답변하고 있습니다. 마이크는 이 동안 사용하지 않습니다.');};
    utterance.onend=()=>{utteranceRef.current=null;if(runningRef.current)void beginListening();};
    utterance.onerror=()=>{utteranceRef.current=null;setError('브라우저 음성 재생 중 오류가 발생했습니다.');stopLoop('음성 재생 오류로 자동 상담을 중지했습니다.');};
    utteranceRef.current=utterance;
    window.speechSynthesis.speak(utterance);
  },[beginListening,stopLoop]);

  const promptRetry=useCallback((recognized:string)=>{
    lowQualityRetriesRef.current+=1;
    if(lowQualityRetriesRef.current>=MAX_LOW_QUALITY_RETRIES){
      stopLoop('질문을 명확하게 인식하지 못해 자동 상담을 중지했습니다. 다시 시작해 주세요.');
      return;
    }
    setError(null);
    setMessage(`인식문 “${recognized||'(없음)'}”은 질문으로 보기 어려워 다시 듣습니다.`);
    speakAndContinue('질문을 정확히 인식하지 못했습니다. 한 문장으로 다시 말씀해 주세요.');
  },[speakAndContinue,stopLoop]);

  const processQuestion=useCallback(async(question:string)=>{
    if(processingRef.current||!runningRef.current)return;
    processingRef.current=true;
    lowQualityRetriesRef.current=0;
    setPhase('thinking');
    setMessage('승인근거를 검색하고 AI 답변을 생성하고 있습니다.');
    try{
      const history=turnsRef.current.slice(-6).map(({role,content})=>({role,content}));
      const response=await fetch('/api/stt-rag-answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,history})});
      const body=await response.json() as RagResponse;
      if(!response.ok)throw new Error([body.error,body.detail].filter(Boolean).join(' · ')||'답변 생성 실패');
      const userTurn:Turn={role:'user',content:question};
      const assistantTurn:Turn={role:'assistant',content:body.answer??'',generated:body.generated,evidence:body.evidence??[],confidence:body.confidence,needsHumanReview:body.needsHumanReview};
      setTurns(prev=>[...prev,userTurn,assistantTurn].slice(-12));
      if(!body.generated){
        stopLoop('승인근거가 충분하지 않아 자동응답을 중지했습니다. 담당자 확인이 필요합니다.');
        return;
      }
      speakAndContinue(body.answer??'');
    }catch(e){
      const msg=e instanceof Error?e.message:String(e);
      setError(msg);
      setPhase('error');
      stopLoop('처리 오류로 자동 상담을 중지했습니다.');
    }finally{
      processingRef.current=false;
    }
  },[speakAndContinue,stopLoop]);

  useEffect(()=>{
    if(!running||phase!=='transcribing'||isRecording||isSending||processingRef.current)return;
    const text=cumulativeText.trim();
    if(!text||isLowQualityTranscript(text)){promptRetry(text);return;}
    void processQuestion(text);
  },[cumulativeText,isRecording,isSending,phase,processQuestion,promptRetry,running]);

  useEffect(()=>{
    if(sttError&&running){setError(sttError);stopLoop('STT 오류로 자동 상담을 중지했습니다.');}
  },[running,sttError,stopLoop]);

  const startLoop=async()=>{
    if(running)return;
    if(!('speechSynthesis' in window)){
      setError('이 브라우저는 Browser TTS를 지원하지 않습니다. Chrome 또는 Edge에서 확인해 주세요.');
      return;
    }
    runningRef.current=true;
    lowQualityRetriesRef.current=0;
    setRunning(true);
    setTurns([]);
    setError(null);
    await beginListening();
  };

  const statusLabel:Record<Phase,string>={idle:'대기',listening:`듣는 중 · ${secondsLeft}초`,transcribing:'STT 처리 중',thinking:'근거 검색·답변 생성 중',speaking:'AI 음성응답 중',paused:'중지',error:'오류'};

  return <main className="rag-page">
    <header className="rag-header"><p className="rag-kicker">COMWEL AI STT PoC · v0.11.0</p><h1>자동 음성대화 루프</h1><p>한 번 시작하면 <strong>CLOVA STT → 승인근거 RAG → AI 답변 → Browser TTS</strong> 순서로 자동 처리하고 다음 발화를 기다립니다.</p></header>
    <section className="rag-warning"><strong>내부 시연용</strong> · 개인정보 및 실제 민원 원문 입력 금지 · 1회 발화창 8초 · 저품질 STT는 최대 2회 자동 재질문 · 근거 부족/오류 시 자동 중지 · 자동처분/자동발송 없음</section>

    <section className="rag-input-card">
      <h2>자동 상담 제어</h2>
      <p><strong>상태:</strong> {statusLabel[phase]}</p>
      <p>{message}</p>
      <div className="rag-actions">
        <button className="primary" type="button" disabled={running} onClick={()=>void startLoop()}>🎙️ 자동 상담 시작</button>
        <button type="button" disabled={!running&&phase==='idle'} onClick={()=>stopLoop()}>■ 자동 상담 중지</button>
      </div>
    </section>

    {turns.length>0&&<section className="rag-result"><div className="rag-result-top"><h2>자동 대화 기록</h2><button type="button" onClick={()=>setTurns([])}>기록 초기화</button></div><div className="evidence-list">{turns.map((turn,i)=><article className="evidence-card" key={`${turn.role}-${i}`}><strong>{turn.role==='user'?'민원인':'AI'}</strong><p>{turn.content}</p>{turn.role==='assistant'&&<small>{turn.generated?'승인근거 기반 답변':'자동답변 보류'}{typeof turn.confidence==='number'?` · 신뢰도 ${(turn.confidence*100).toFixed(0)}%`:''}{turn.needsHumanReview?' · 담당자 확인 필요':''}</small>}{turn.role==='assistant'&&(turn.evidence?.length??0)>0&&<details><summary>사용 근거 {turn.evidence?.length}건</summary>{turn.evidence?.map((e,j)=><p key={e.chunkId}><strong>근거 {j+1}. {e.title}</strong><br/>{e.excerpt}</p>)}</details>}</article>)}</div></section>}

    <section className="rag-input-card"><h2>현재 STT 인식문</h2><p>{cumulativeText||'(대기 중)'}</p></section>
    {error&&<div className="rag-error">{error}</div>}
  </main>;
}
