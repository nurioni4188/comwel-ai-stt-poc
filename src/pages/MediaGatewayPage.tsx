import { useMemo, useState } from 'react';
import './RagAnswerPage.css';

type GatewayEvent = { type:string; callId:string; sequence:number; note:string };
type Manifest = { version?:string; service?:string; websocket?:{path:string;transport:string;hostedSeparately:boolean;heartbeatMs:number;maxFrameBytes:number}; internalAudio?:{codec:string;sampleRate:number;channels:number}; scope?:string };
type TelephonyContract = { ok?:boolean; mediaGateway?:Manifest; error?:string };

const CALL_ID='sim-call-001';

export default function MediaGatewayPage(){
  const [events,setEvents]=useState<GatewayEvent[]>([]);
  const [sequence,setSequence]=useState(0);
  const [state,setState]=useState<'idle'|'active'|'handoff'|'closed'>('idle');
  const [manifest,setManifest]=useState<Manifest|null>(null);
  const [error,setError]=useState<string|null>(null);

  const append=(type:string,note:string,nextState?:'idle'|'active'|'handoff'|'closed')=>{
    setSequence(prev=>{
      const next=prev+1;
      setEvents(current=>[...current,{type,callId:CALL_ID,sequence:next,note}]);
      return next;
    });
    if(nextState)setState(nextState);
  };

  const summary=useMemo(()=>({
    inbound:events.filter(e=>e.type==='audio.inbound').length,
    outbound:events.filter(e=>e.type==='audio.outbound').length,
    handoff:events.some(e=>e.type==='call.handoff'),
  }),[events]);

  const loadManifest=async()=>{
    setError(null);
    try{
      const response=await fetch('/api/telephony-adapter');
      const body=await response.json() as TelephonyContract;
      if(!response.ok)throw new Error(body.error||'manifest 조회 실패');
      if(!body.mediaGateway)throw new Error('media gateway manifest가 없습니다.');
      setManifest(body.mediaGateway);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  };

  const start=()=>{
    setEvents([{type:'call.started',callId:CALL_ID,sequence:1,note:'지속형 WebSocket 세션 시작'}]);
    setSequence(1);
    setState('active');
  };
  const inbound=()=>append('audio.inbound','전화망 → Gateway: PCM 16k mono 프레임 수신');
  const outbound=()=>append('audio.outbound','AI/Server TTS → Gateway → 전화망: 음성 프레임 송신');
  const clear=()=>append('audio.clear','barge-in 대비 재생 버퍼 비우기');
  const handoff=()=>append('call.handoff','담당자 전환 명령','handoff');
  const hangup=()=>append('call.hangup','통화 종료 명령','closed');

  return <main className="rag-page">
    <header className="rag-header">
      <p className="rag-kicker">COMWEL AI STT PoC · v0.13.0</p>
      <h1>Media Gateway Baseline</h1>
      <p>전화사업자와 AI 엔진 사이에서 <strong>지속형 WebSocket 세션·양방향 오디오·heartbeat·handoff·hangup</strong>을 담당하는 독립 게이트웨이 기준선입니다.</p>
    </header>

    <section className="rag-warning"><strong>시뮬레이터 전용</strong> · 실제 PSTN/SIP 미연결 · 실제 통화음성 미저장 · Server TTS 미연결 · Gateway는 Vercel 함수와 분리 배포</section>

    <section className="rag-input-card">
      <h2>Gateway 계약 확인</h2>
      <p>Vercel은 기존 Telephony Adapter 관리 API를 재사용하고, 장시간 WebSocket 연결은 별도 <code>gateway/</code> 서비스가 담당합니다.</p>
      <div className="rag-actions"><button className="primary" type="button" onClick={()=>void loadManifest()}>계약 API 확인</button></div>
      {manifest&&<div className="evidence-card"><p><strong>{manifest.version} · {manifest.service}</strong></p><p>WebSocket: {manifest.websocket?.path} · heartbeat {manifest.websocket?.heartbeatMs}ms · max frame {manifest.websocket?.maxFrameBytes} bytes</p><p>내부 오디오: {manifest.internalAudio?.codec} / {manifest.internalAudio?.sampleRate}Hz / {manifest.internalAudio?.channels}ch</p><small>{manifest.scope}</small></div>}
    </section>

    <section className="rag-input-card">
      <h2>미디어 세션 시뮬레이터</h2>
      <p><strong>상태:</strong> {state} · inbound {summary.inbound} · outbound {summary.outbound} · handoff {summary.handoff?'yes':'no'}</p>
      <div className="rag-actions">
        <button className="primary" type="button" onClick={start}>통화 시작</button>
        <button type="button" disabled={state!=='active'} onClick={inbound}>인바운드 오디오</button>
        <button type="button" disabled={state!=='active'} onClick={outbound}>아웃바운드 오디오</button>
        <button type="button" disabled={state!=='active'} onClick={clear}>재생 버퍼 비우기</button>
        <button type="button" disabled={state!=='active'} onClick={handoff}>담당자 전환</button>
        <button type="button" disabled={state==='idle'||state==='closed'} onClick={hangup}>통화 종료</button>
      </div>
    </section>

    {events.length>0&&<section className="rag-result"><h2>Gateway 이벤트 로그</h2><div className="evidence-list">{events.map(event=><article className="evidence-card" key={`${event.type}-${event.sequence}`}><strong>#{event.sequence} {event.type}</strong><p>{event.note}</p><small>callId: {event.callId}</small></article>)}</div></section>}
    {error&&<div className="rag-error">{error}</div>}
  </main>;
}
